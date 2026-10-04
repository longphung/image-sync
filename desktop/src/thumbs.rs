//! Thumbnails: library ones cached in `.thumbs/<name>.jpg` next to the file, for the phone; card ones in
//! the app cache dir for the desktop window's grid.

use image::metadata::Orientation;
use image::{DynamicImage, ImageDecoder, ImageReader};
use std::collections::{HashMap, HashSet, VecDeque};
use std::fs;
use std::io::{Cursor, Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::{Arc, Condvar, Mutex, OnceLock};

const SIZE: u32 = 320;

/// Writes a thumbnail of `src` to `out` unless it's already there.
pub fn thumbnail(src: &Path, out: &Path) -> bool {
    if out.exists() {
        return true;
    }
    let Some(ext) = src.extension().and_then(|e| e.to_str()).map(|e| e.to_ascii_lowercase()) else { return false };
    if out.parent().is_none_or(|dir| fs::create_dir_all(dir).is_err()) {
        return false;
    }
    // Written to a unique temp name and renamed, so a crash or a concurrent request never leaves a
    // broken cached thumbnail.
    let tmp = out.with_extension(format!("{}.part.jpg", uuid::Uuid::new_v4().simple()));
    let ok = match ext.as_str() {
        "jpg" | "jpeg" => jpeg_preview(src, &tmp) || fs::read(src).is_ok_and(|d| resize(&d, &tmp, None)),
        "arw" => fs::read(src).is_ok_and(|d| tiff_preview(&d).is_some_and(|(jpeg, o)| resize(jpeg, &tmp, o))),
        "mp4" | "mts" => video_frame(src, &tmp),
        _ => false,
    };
    if ok && fs::rename(&tmp, out).is_ok() {
        true
    } else {
        let _ = fs::remove_file(&tmp);
        false
    }
}

type Reply = Box<dyn FnOnce(Option<Vec<u8>>) + Send>;
type Job = (PathBuf, PathBuf); // (source, cached thumbnail)

/// Thumbnail work for the card grid. Every card item is pre-generated in the background, newest
/// first like the grid, so scrolling mostly reads cached files. A tile that's on screen before its
/// thumbnail exists jumps that queue, and urgent requests are served newest first, so after a fast
/// scroll the tiles in view now go before the ones already scrolled past.
#[derive(Default)]
pub struct Queue {
    state: Mutex<QueueState>,
    wake: Condvar,
}

#[derive(Default)]
struct QueueState {
    urgent: Vec<Job>,
    background: VecDeque<Job>,
    busy: HashSet<PathBuf>,
    waiting: HashMap<PathBuf, Vec<Reply>>,
}

impl Queue {
    /// One worker per core: USB reads are small (see `jpeg_preview`), so decoding is the bottleneck.
    pub fn start() -> Arc<Self> {
        let queue = Arc::new(Queue::default());
        for _ in 0..std::thread::available_parallelism().map_or(2, |n| n.get()) {
            let queue = queue.clone();
            std::thread::spawn(move || queue.work());
        }
        queue
    }

    /// Replaces the background pre-generation list.
    pub fn prefetch(&self, jobs: Vec<Job>) {
        self.state.lock().unwrap().background = jobs.into();
        self.wake.notify_all();
    }

    /// Replies with the thumbnail's JPEG bytes, or `None` if one can't be made.
    pub fn get(&self, src: PathBuf, out: PathBuf, reply: Reply) {
        let mut state = self.state.lock().unwrap();
        if out.exists() {
            drop(state);
            return reply(fs::read(&out).ok());
        }
        state.waiting.entry(out.clone()).or_default().push(reply);
        if !state.busy.contains(&out) {
            state.urgent.push((src, out));
            self.wake.notify_one();
        }
    }

    fn work(&self) {
        loop {
            let (src, out) = {
                let mut state = self.state.lock().unwrap();
                loop {
                    match state.urgent.pop().or_else(|| state.background.pop_front()) {
                        // Already being made, or made with nobody waiting for it.
                        Some((_, out)) if state.busy.contains(&out) || (out.exists() && !state.waiting.contains_key(&out)) => {}
                        Some(job) => {
                            state.busy.insert(job.1.clone());
                            break job;
                        }
                        None => state = self.wake.wait(state).unwrap(),
                    }
                }
            };
            let ok = thumbnail(&src, &out);
            let replies = {
                let mut state = self.state.lock().unwrap();
                state.busy.remove(&out);
                state.waiting.remove(&out).unwrap_or_default()
            };
            let jpeg = ok.then(|| fs::read(&out).ok()).flatten();
            for reply in replies {
                reply(jpeg.clone());
            }
        }
    }
}

/// `orientation` overrides the JPEG's own EXIF tag, for embedded previews that carry none.
fn resize(jpeg: &[u8], out: &Path, orientation: Option<u16>) -> bool {
    let result = (|| -> image::ImageResult<()> {
        let mut decoder = ImageReader::new(Cursor::new(jpeg)).with_guessed_format()?.into_decoder()?;
        let orientation = match orientation.and_then(|o| Orientation::from_exif(o as u8)) {
            Some(o) => o,
            None => decoder.orientation()?,
        };
        let mut img = DynamicImage::from_decoder(decoder)?;
        img.apply_orientation(orientation);
        img.thumbnail(SIZE, SIZE).to_rgb8().save_with_format(out, image::ImageFormat::Jpeg)
    })();
    result.is_ok()
}

/// A JPEG's embedded preview instead of the full 20 MP image: Sony's ~1616x1080 MPF preview when
/// there is one (a seek plus a ~400 KB read), otherwise the 160x120 EXIF thumbnail. The main
/// image's EXIF Orientation is applied, since the previews carry none.
fn jpeg_preview(src: &Path, out: &Path) -> bool {
    let Ok(mut file) = fs::File::open(src) else { return false };
    let mut head = Vec::new();
    if (&mut file).take(64 * 1024).read_to_end(&mut head).is_err() {
        return false;
    }
    let exif = find(&head, b"Exif\0\0").and_then(|i| tiff_preview(&head[i + 6..]));
    let orientation = exif.and_then(|(_, o)| o);
    if let Some((offset, len)) = mpf_preview(&head) {
        let mut jpeg = vec![0; len];
        let read = file.seek(SeekFrom::Start(offset as u64)).and_then(|_| file.read_exact(&mut jpeg));
        if read.is_ok() && resize(&jpeg, out, orientation) {
            return true;
        }
    }
    exif.is_some_and(|(thumb, o)| resize(thumb, out, o))
}

fn find(d: &[u8], needle: &[u8]) -> Option<usize> {
    d.windows(needle.len()).position(|w| w == needle)
}

/// Minimal TIFF reader, enough for IFD entries holding offsets and lengths.
struct Tiff<'a> {
    d: &'a [u8],
    le: bool,
}

impl<'a> Tiff<'a> {
    fn new(d: &'a [u8]) -> Option<Self> {
        let le = match d.get(..2)? {
            b"II" => true,
            b"MM" => false,
            _ => return None,
        };
        Some(Tiff { d, le })
    }

    fn u16(&self, o: usize) -> Option<usize> {
        let b: [u8; 2] = self.d.get(o..o + 2)?.try_into().ok()?;
        Some(if self.le { u16::from_le_bytes(b) } else { u16::from_be_bytes(b) } as usize)
    }

    fn u32(&self, o: usize) -> Option<usize> {
        let b: [u8; 4] = self.d.get(o..o + 4)?.try_into().ok()?;
        Some(if self.le { u32::from_le_bytes(b) } else { u32::from_be_bytes(b) } as usize)
    }

    /// The (tag, entry offset) of each entry in the IFD at `ifd`, and the next IFD's offset.
    fn ifd(&self, ifd: usize) -> Option<(Vec<(usize, usize)>, usize)> {
        let n = self.u16(ifd)?;
        let entries = (0..n).map(|i| Some((self.u16(ifd + 2 + i * 12)?, ifd + 2 + i * 12))).collect::<Option<_>>()?;
        Some((entries, self.u32(ifd + 2 + n * 12)?))
    }
}

/// The largest JPEG embedded in a TIFF (an ARW, or a JPEG's EXIF block), found via the
/// JPEGInterchangeFormat (0x201) / JPEGInterchangeFormatLength (0x202) tags along the IFD chain,
/// plus the first Orientation (0x112) tag seen. No raw decode.
fn tiff_preview(d: &[u8]) -> Option<(&[u8], Option<u16>)> {
    let t = Tiff::new(d)?;
    let mut best: &[u8] = &[];
    let mut orientation = None;
    let mut ifd = t.u32(4)?;
    // Bounded, so a corrupt file with an IFD loop can't spin forever.
    for _ in 0..8 {
        if ifd == 0 {
            break;
        }
        let (entries, next) = t.ifd(ifd)?;
        let (mut off, mut len) = (0, 0);
        for (tag, entry) in entries {
            match tag {
                0x112 => orientation = orientation.or(t.u16(entry + 8).map(|o| o as u16)),
                0x201 => off = t.u32(entry + 8)?,
                0x202 => len = t.u32(entry + 8)?,
                _ => {}
            }
        }
        if let Some(jpeg) = d.get(off..off.checked_add(len)?) {
            if jpeg.len() > best.len() {
                best = jpeg;
            }
        }
        ifd = next;
    }
    (!best.is_empty()).then_some((best, orientation))
}

/// The first secondary image in a JPEG's MPF (CIPA DC-007) index, as (file offset, length). MP Entry
/// (0xB002) offsets are relative to the MPF TIFF header that follows the `MPF\0` signature.
fn mpf_preview(head: &[u8]) -> Option<(usize, usize)> {
    let base = find(head, b"MPF\0")? + 4;
    let t = Tiff::new(&head[base..])?;
    let (entries, _) = t.ifd(t.u32(4)?)?;
    let &(_, entry) = entries.iter().find(|(tag, _)| *tag == 0xB002)?;
    let (count, list) = (t.u32(entry + 4)?, t.u32(entry + 8)?);
    (1..count / 16).find_map(|i| {
        let (len, off) = (t.u32(list + i * 16 + 4)?, t.u32(list + i * 16 + 8)?);
        (off != 0).then_some((base + off, len))
    })
}

fn video_frame(src: &Path, out: &Path) -> bool {
    let Some(ffmpeg) = ffmpeg() else { return false };
    Command::new(ffmpeg)
        .args(["-v", "error", "-y", "-i"])
        .arg(src)
        .args(["-frames:v", "1", "-vf", &format!("scale={SIZE}:-2")])
        .arg(out)
        .status()
        .is_ok_and(|s| s.success())
}

/// System ffmpeg, if installed. Apps launched from Finder don't get the shell's PATH, so the usual
/// Homebrew locations are checked explicitly.
pub fn ffmpeg() -> Option<&'static Path> {
    static FOUND: OnceLock<Option<PathBuf>> = OnceLock::new();
    FOUND
        .get_or_init(|| {
            ["ffmpeg", "/opt/homebrew/bin/ffmpeg", "/usr/local/bin/ffmpeg"]
                .into_iter()
                .map(PathBuf::from)
                .find(|p| Command::new(p).arg("-version").output().is_ok_and(|o| o.status.success()))
        })
        .as_deref()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tiff_preview_picks_largest_jpeg_in_ifd_chain() {
        // Little-endian TIFF: IFD0 at 8 points at a 2-byte "jpeg", IFD1 at a 4-byte one.
        let mut d = b"II*\0".to_vec();
        d.extend(8u32.to_le_bytes());
        let ifd = |off: u32, len: u32, next: u32| {
            let mut v = 2u16.to_le_bytes().to_vec();
            for (tag, val) in [(0x201u16, off), (0x202, len)] {
                v.extend(tag.to_le_bytes());
                v.extend(4u16.to_le_bytes()); // LONG
                v.extend(1u32.to_le_bytes());
                v.extend(val.to_le_bytes());
            }
            v.extend(next.to_le_bytes());
            v
        };
        d.extend(ifd(68, 2, 38)); // bytes 8..38
        d.extend(ifd(70, 4, 0)); // bytes 38..68
        d.extend(b"ABWXYZ"); // bytes 68..74
        assert_eq!(tiff_preview(&d), Some((&b"WXYZ"[..], None)));
        assert_eq!(tiff_preview(b"not a tiff"), None);
    }

    #[test]
    fn mpf_preview_finds_the_secondary_image() {
        // "junk", then "MPF\0" and a little-endian TIFF whose IFD0 (at 8) has one MP Entry tag
        // pointing at a 2-entry list (at 26): the primary image (offset 0), then a 100-byte preview at 5000.
        let mut d = b"junkMPF\0II*\0".to_vec();
        d.extend(8u32.to_le_bytes());
        d.extend(1u16.to_le_bytes());
        d.extend(0xB002u16.to_le_bytes());
        d.extend(7u16.to_le_bytes()); // UNDEFINED
        d.extend(32u32.to_le_bytes());
        d.extend(26u32.to_le_bytes());
        d.extend(0u32.to_le_bytes()); // no next IFD
        for (len, off) in [(9000u32, 0u32), (100, 5000)] {
            d.extend(0u32.to_le_bytes()); // attribute
            d.extend(len.to_le_bytes());
            d.extend(off.to_le_bytes());
            d.extend(0u32.to_le_bytes()); // dependent images
        }
        assert_eq!(mpf_preview(&d), Some((8 + 5000, 100)));
        assert_eq!(mpf_preview(b"no index here"), None);
    }
}
