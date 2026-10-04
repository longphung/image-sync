import { Directory, File, Paths } from 'expo-file-system';
import { checkFilename } from './sync';

const PHOTOS_DIR_NAME = 'camera-photos';

export function getPhotosDirectory(): Directory {
  const dir = new Directory(Paths.document, PHOTOS_DIR_NAME);
  if (!dir.exists) {
    dir.create({ intermediates: true });
  }
  return dir;
}

// Native download, so the JS thread stays free even for a 190 MB video. Writes to `<name>.part`
// and moves it into place on success: Android streams straight into the target, and a partial
// file under the final name would later be skipped as "already downloaded".
// Resolves false when the file was already downloaded. `onPercent` gets an integer 0–100, only
// when it changes, and never if the server sends no size.
export async function downloadToPhotosDir(
  url: string,
  filename: string,
  { signal, onPercent }: { signal?: AbortSignal; onPercent?: (percent: number) => void } = {},
): Promise<boolean> {
  checkFilename(filename);
  const dir = getPhotosDirectory();
  const dest = new File(dir, filename);
  if (dest.exists) return false;

  const part = new File(dir, `${filename}.part`);
  let lastPercent = -1;
  try {
    await File.downloadFileAsync(url, part, {
      idempotent: true, // overwrite a stale .part left by an earlier crash
      signal,
      onProgress: ({ bytesWritten, totalBytes }) => {
        if (totalBytes <= 0 || !onPercent) return;
        const percent = Math.min(100, Math.floor((bytesWritten * 100) / totalBytes));
        if (percent !== lastPercent) {
          lastPercent = percent;
          onPercent(percent);
        }
      },
    });
    // Another download of the same file (the detail screen while Sync All runs) can finish
    // first; its copy is complete, so this one is a skip rather than a failed move.
    if (dest.exists) {
      part.delete();
      return false;
    }
    await part.move(dest);
  } catch (err) {
    try {
      if (part.exists) part.delete();
    } catch {}
    if (dest.exists && !signal?.aborted) return false;
    throw err;
  }
  return true;
}

// expo-media-library needs the file:// URI of the downloaded file.
export function fileUriFor(filename: string): string {
  return new File(getPhotosDirectory(), filename).uri;
}

export function listDownloadedFilenames(): Set<string> {
  return new Set(getPhotosDirectory().list().map((entry) => entry.name));
}

// ponytail: extension sniffing — the listing doesn't expose DLNA upnp:class / mime yet;
// move classification into src/camera/dlna.ts if the camera ever serves extensionless URLs.
export function isVideoFile(filename: string): boolean {
  return /\.(mp4|mts|m2ts|mov)$/i.test(filename);
}
