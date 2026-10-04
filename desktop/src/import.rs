//! Copies photos and videos off a mounted Sony camera / SD card volume into the library folder.
//! The camera volume is only ever read.

use serde::Serialize;
use std::fs;
use std::io::{self, BufRead, Read};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::SystemTime;

/// Folders on the card that hold media (see docs/desktop-plan.md, "What gets imported").
const SOURCES: [&str; 4] = ["DCIM", "PRIVATE/AVCHD/BDMV/STREAM", "MP_ROOT", "PRIVATE/M4ROOT/CLIP"];
const MEDIA_EXTS: [&str; 5] = ["jpg", "jpeg", "arw", "mts", "mp4"];

#[derive(Clone, Default, Serialize)]
pub struct Counts {
    pub total: usize,
    pub copied: usize,
    pub skipped: usize,
    pub failed: usize,
    /// AVCHD clips converted to MP4 after copying, and conversions that failed (the `.MTS` stays listed).
    pub converted: usize,
    pub convert_failed: usize,
    /// The clip being converted right now, and how far along it is.
    pub converting: Option<String>,
    pub percent: u8,
}

pub fn is_camera_volume(root: &Path) -> bool {
    root.join("DCIM").is_dir() && root.join("PRIVATE").is_dir()
}

/// A visible file with a photo/video extension. Hidden files are excluded, which also drops the
/// `._DSC00001.JPG` AppleDouble files macOS writes onto FAT-formatted cards.
pub fn is_media(path: &Path) -> bool {
    let Some(name) = path.file_name().and_then(|n| n.to_str()) else { return false };
    let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("").to_ascii_lowercase();
    !name.starts_with('.') && MEDIA_EXTS.contains(&ext.as_str())
}

pub fn is_video(path: &Path) -> bool {
    path.extension().and_then(|e| e.to_str()).is_some_and(|e| ["mts", "mp4"].contains(&e.to_ascii_lowercase().as_str()))
}

pub fn is_mts(path: &Path) -> bool {
    path.extension().is_some_and(|e| e.eq_ignore_ascii_case("mts"))
}

/// Where a card file goes in the library: `<library>/<YYYY-MM-DD>/<name>`, dated by the file's
/// modified time in local time (cards store local wall-clock times). Per-date folders keep Sony's
/// wrapping `DSC00001.JPG` counter from colliding.
pub fn library_dest(src: &Path, library: &Path) -> Option<PathBuf> {
    let modified = fs::metadata(src).and_then(|m| m.modified()).ok()?;
    let day = chrono::DateTime::<chrono::Local>::from(modified).format("%Y-%m-%d").to_string();
    Some(library.join(day).join(src.file_name()?))
}

/// Where a card file's library copy may be: its date folder, or the top level for files synced
/// before per-date folders.
fn library_copies(src: &Path, library: &Path) -> impl Iterator<Item = PathBuf> {
    library_dest(src, library).into_iter().chain(src.file_name().map(|name| library.join(name)))
}

/// The library already has a file with the same name and size.
pub fn is_imported(src: &Path, library: &Path) -> bool {
    let len = |p: &Path| fs::metadata(p).map(|m| m.len()).ok();
    len(src).is_some_and(|l| library_copies(src, library).any(|p| len(&p) == Some(l)))
}

pub fn media_files(root: &Path) -> Vec<PathBuf> {
    fn walk(dir: &Path, out: &mut Vec<PathBuf>) {
        let Ok(entries) = fs::read_dir(dir) else { return };
        for path in entries.flatten().map(|e| e.path()) {
            if path.is_dir() {
                walk(&path, out);
            } else if is_media(&path) {
                out.push(path);
            }
        }
    }
    let mut out = Vec::new();
    for source in SOURCES {
        walk(&root.join(source), &mut out);
    }
    out
}

/// Imports the given card files into `library`, calling `on_progress` after each step.
/// A file is skipped when the library already has one with the same name and size.
/// With `ffmpeg`, AVCHD clips are then converted to MP4 next to their library copy. That happens
/// after every file is copied, so the camera can be unplugged while it runs.
pub fn import_files(
    files: &[PathBuf],
    library: &Path,
    ffmpeg: Option<&Path>,
    mut on_progress: impl FnMut(&Counts),
) -> io::Result<Counts> {
    fs::create_dir_all(library)?;
    let mut counts = Counts { total: files.len(), ..Default::default() };
    on_progress(&counts);
    for src in files {
        if is_imported(src, library) {
            counts.skipped += 1;
        } else if library_dest(src, library).is_some_and(|dst| copy_file(src, &dst).is_ok()) {
            counts.copied += 1;
        } else {
            counts.failed += 1;
        }
        on_progress(&counts);
    }
    let Some(ffmpeg) = ffmpeg else { return Ok(counts) };
    // Also catches clips synced before ffmpeg was installed.
    let clips = files.iter().filter(|src| is_mts(src)).filter_map(|src| library_copies(src, library).find(|p| p.is_file()));
    for clip in clips.filter(|c| !c.with_extension("mp4").exists()).collect::<Vec<_>>() {
        counts.converting = clip.file_name().map(|n| n.to_string_lossy().into_owned());
        counts.percent = 0;
        on_progress(&counts);
        let result = convert_to_mp4(ffmpeg, &clip, |percent| {
            counts.percent = percent;
            on_progress(&counts);
        });
        match result {
            Ok(()) => counts.converted += 1,
            Err(e) => {
                eprintln!("Converting {} failed: {e}", clip.display());
                counts.convert_failed += 1;
            }
        }
    }
    counts.converting = None;
    on_progress(&counts);
    Ok(counts)
}

const INTERLACED_FIELD_ORDERS: [&str; 4] = ["tt", "bb", "tb", "bt"];

/// Converts an AVCHD clip to an H.264/AAC MP4 next to it, keeping the original (same rules as
/// `src/convertVideo.ts`): progressive video is stream-copied, interlaced video is deinterlaced
/// with `bwdif` and re-encoded, and AC-3 audio becomes AAC. Written via `<name>.mp4.part`.
pub fn convert_to_mp4(ffmpeg: &Path, src: &Path, mut on_percent: impl FnMut(u8)) -> io::Result<()> {
    let dst = src.with_extension("mp4");
    let part = part_path(&dst);
    // ffprobe ships next to ffmpeg; a bare "ffmpeg" (found on PATH) becomes a bare "ffprobe".
    let probe = Command::new(ffmpeg.with_file_name("ffprobe"))
        .args(["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=field_order:format=duration"])
        .args(["-of", "default=noprint_wrappers=1"])
        .arg(src)
        .output()?;
    let probe = String::from_utf8_lossy(&probe.stdout);
    let field = |key: &str| probe.lines().find_map(|l| l.strip_prefix(key)?.strip_prefix('=')).unwrap_or("");
    let duration_us = field("duration").parse::<f64>().unwrap_or(0.0) * 1e6;
    let video: &[&str] = if INTERLACED_FIELD_ORDERS.contains(&field("field_order")) {
        // ponytail: libx264 off macOS; try h264_nvenc / h264_qsv / h264_vaapi if it's too slow there.
        if cfg!(target_os = "macos") {
            &["-vf", "bwdif", "-c:v", "h264_videotoolbox", "-b:v", "20M"]
        } else {
            &["-vf", "bwdif", "-c:v", "libx264", "-preset", "fast", "-crf", "18"]
        }
    } else {
        &["-c:v", "copy"]
    };

    let mut child = Command::new(ffmpeg)
        .args(["-v", "error", "-nostats", "-progress", "pipe:1", "-y", "-i"])
        .arg(src)
        .args(["-map", "0:v:0", "-map", "0:a:0?"])
        .args(video)
        .args(["-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", "-f", "mp4"])
        .arg(&part)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()?;
    // Drained on its own thread so a chatty stderr can't fill its pipe and stall ffmpeg.
    let mut stderr = child.stderr.take().unwrap();
    let errors = std::thread::spawn(move || {
        let mut s = String::new();
        let _ = stderr.read_to_string(&mut s);
        s
    });
    for line in io::BufReader::new(child.stdout.take().unwrap()).lines().map_while(Result::ok) {
        if let Some(us) = line.strip_prefix("out_time_us=").and_then(|v| v.parse::<f64>().ok()) {
            if duration_us > 0.0 {
                on_percent((us * 100.0 / duration_us).clamp(0.0, 100.0) as u8);
            }
        }
    }
    let status = child.wait()?;
    let errors = errors.join().unwrap_or_default();
    let result = if status.success() {
        // Same modified time as the clip, which the library sorts by.
        fs::metadata(src)
            .and_then(|m| m.modified())
            .and_then(|t| set_modified(&part, t))
            .and_then(|_| fs::rename(&part, &dst))
    } else {
        Err(io::Error::other(format!("ffmpeg {status}: {}", errors.trim())))
    };
    if result.is_err() {
        let _ = fs::remove_file(&part);
    }
    result
}

fn part_path(dst: &Path) -> PathBuf {
    let mut part = dst.as_os_str().to_owned();
    part.push(".part");
    PathBuf::from(part)
}

fn set_modified(path: &Path, time: SystemTime) -> io::Result<()> {
    fs::File::options().write(true).open(path)?.set_modified(time)
}

/// Copies via `<name>.part` and renames on success, so a partial file never sits under the final
/// name (where it would later be skipped as already imported). Keeps the source's modified time,
/// which the HTTP API sorts by.
fn copy_file(src: &Path, dst: &Path) -> io::Result<()> {
    let part = part_path(dst);
    let result = (|| {
        fs::create_dir_all(dst.parent().unwrap())?;
        fs::copy(src, &part)?;
        set_modified(&part, fs::metadata(src)?.modified()?)?;
        fs::rename(&part, dst)
    })();
    if result.is_err() {
        let _ = fs::remove_file(&part);
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn imports_media_skips_repeats_and_junk() {
        let tmp = std::env::temp_dir().join(format!("image-sync-test-{}", uuid::Uuid::new_v4()));
        let card = tmp.join("card");
        let library = tmp.join("library");
        let put = |rel: &str, body: &[u8]| {
            let p = card.join(rel);
            fs::create_dir_all(p.parent().unwrap()).unwrap();
            fs::write(p, body).unwrap();
        };
        put("DCIM/100MSDCF/DSC00001.JPG", b"jpg");
        put("DCIM/100MSDCF/DSC00002.ARW", b"raw");
        put("DCIM/100MSDCF/._DSC00001.JPG", b"appledouble");
        put("PRIVATE/AVCHD/BDMV/STREAM/00000.MTS", b"mts");
        put("PRIVATE/M4ROOT/CLIP/C0001.MP4", b"mp4");
        put("MP_ROOT/100ANV01/MAH00001.MP4", b"mp4");
        put("MP_ROOT/100ANV01/MAH00001.THM", b"thm");
        put("PRIVATE/SONY/SONYCARD.IND", b"ind");
        assert!(is_camera_volume(&card));

        let first = import_files(&media_files(&card), &library, None, |_| {}).unwrap();
        assert_eq!((first.total, first.copied, first.skipped, first.failed), (5, 5, 0, 0));
        let jpg = library_dest(&card.join("DCIM/100MSDCF/DSC00001.JPG"), &library).unwrap();
        assert_eq!(jpg.parent().unwrap().parent().unwrap(), library);
        assert_eq!(fs::read(&jpg).unwrap(), b"jpg");
        assert!(!jpg.with_extension("JPG.part").exists());

        // Same name + size is skipped; a different size (e.g. a truncated earlier copy) is re-copied.
        let mp4 = library_dest(&card.join("PRIVATE/M4ROOT/CLIP/C0001.MP4"), &library).unwrap();
        fs::write(&mp4, b"m").unwrap();
        let second = import_files(&media_files(&card), &library, None, |_| {}).unwrap();
        assert_eq!((second.copied, second.skipped), (1, 4));
        assert_eq!(fs::read(&mp4).unwrap(), b"mp4");

        // A copy at the top level, synced before per-date folders, also counts.
        let flat = card.join("DCIM/100MSDCF/DSC00003.JPG");
        fs::write(&flat, b"old").unwrap();
        fs::write(library.join("DSC00003.JPG"), b"old").unwrap();
        assert!(is_imported(&flat, &library));

        fs::remove_dir_all(tmp).unwrap();
    }

    /// Needs ffmpeg + ffprobe on PATH; skipped otherwise.
    #[test]
    fn converts_interlaced_ac3_clip_to_mp4() {
        let Some(ffmpeg) = crate::thumbs::ffmpeg() else { return eprintln!("no ffmpeg, skipped") };
        let tmp = std::env::temp_dir().join(format!("image-sync-test-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&tmp).unwrap();
        let mts = tmp.join("00000.MTS");
        let made = Command::new(ffmpeg)
            .args(["-v", "error", "-f", "lavfi", "-i", "testsrc=duration=1:size=320x240:rate=25"])
            .args(["-f", "lavfi", "-i", "sine=duration=1", "-c:v", "mpeg2video", "-flags", "+ilme+ildct"])
            .args(["-top", "1", "-c:a", "ac3", "-f", "mpegts"])
            .arg(&mts)
            .status()
            .unwrap();
        assert!(made.success());

        let mut last = 0;
        convert_to_mp4(ffmpeg, &mts, |p| last = p).unwrap();
        let mp4 = tmp.join("00000.mp4");
        assert!(mts.exists() && !tmp.join("00000.mp4.part").exists());
        assert!(last > 50, "progress reached {last}%");
        let probe = Command::new(ffmpeg.with_file_name("ffprobe"))
            .args(["-v", "error", "-show_entries", "stream=codec_name", "-of", "csv=p=0"])
            .arg(&mp4)
            .output()
            .unwrap();
        assert_eq!(String::from_utf8_lossy(&probe.stdout).split_whitespace().collect::<Vec<_>>(), ["h264", "aac"]);
        assert_eq!(fs::metadata(&mp4).unwrap().modified().unwrap(), fs::metadata(&mts).unwrap().modified().unwrap());
        fs::remove_dir_all(tmp).unwrap();
    }
}
