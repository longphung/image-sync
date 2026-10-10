// Web build of fileSystem.ts: downloads are kept in memory as Files for this page's lifetime, and
// "saving" hands them to the share sheet (Save Image/Video -> Photos on iOS) or, where sharing
// isn't available (it needs HTTPS; the hub serves plain http on the LAN), to a browser download.
import { checkFilename } from './sync';
import { crc32, zipParts } from './zip';

const downloaded = new Map<string, File>();
// CRC-32 of each downloaded file, computed while streaming so "Download All" can zip instantly.
const crcs = new Map<string, number>();

// Resolves false when the file was already downloaded in this page. `onPercent` gets an integer
// 0–100, only when it changes, and never if the server sends no size.
export async function downloadToPhotosDir(
  url: string,
  filename: string,
  { signal, onPercent }: { signal?: AbortSignal; onPercent?: (percent: number) => void } = {},
): Promise<boolean> {
  checkFilename(filename);
  if (downloaded.has(filename)) return false;
  const res = await fetch(url, { signal });
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status} ${res.statusText}`.trim());
  const total = Number(res.headers.get('Content-Length')) || 0;
  const reader = res.body.getReader();
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let received = 0;
  let lastPercent = -1;
  let crc = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    crc = crc32(value, crc);
    received += value.length;
    if (total > 0 && onPercent) {
      const percent = Math.min(100, Math.floor((received * 100) / total));
      if (percent !== lastPercent) onPercent((lastPercent = percent));
    }
  }
  const type = res.headers.get('Content-Type') ?? 'application/octet-stream';
  downloaded.set(filename, new File(chunks, filename, { type }));
  crcs.set(filename, crc);
  return true;
}

export function fileUriFor(filename: string): string {
  const file = downloaded.get(filename);
  if (!file) throw new Error(`${filename} has not been downloaded`);
  return URL.createObjectURL(file);
}

export function listDownloadedFilenames(): Set<string> {
  return new Set(downloaded.keys());
}

// ponytail: extension sniffing, same as fileSystem.ts.
export function isVideoFile(filename: string): boolean {
  return /\.(mp4|mts|m2ts|mov)$/i.test(filename);
}

export async function saveToLibrary(filename: string, _opts: object = {}): Promise<void> {
  await saveAllToLibrary([filename]);
}

/**
 * Shares every file in one sheet, since a share needs a fresh tap each time and Sync All has
 * many. Falls back to a single browser download: the file itself, or one zip of all of them,
 * since browsers block (or ask about) a burst of separate downloads.
 */
export async function saveAllToLibrary(filenames: string[]): Promise<void> {
  const files = filenames.flatMap((name) => downloaded.get(name) ?? []);
  if (files.length === 0) return;
  if (navigator.canShare?.({ files })) {
    try {
      await navigator.share({ files });
      return;
    } catch (err) {
      // Closing the sheet isn't a failure; anything else falls back to downloads.
      if (err instanceof DOMException && err.name === 'AbortError') return;
    }
  }
  // Built synchronously from the in-memory Files, so the tap's user activation is still live.
  const blob =
    files.length === 1
      ? files[0]
      : new Blob(
          zipParts(files.map((f) => ({ name: f.name, size: f.size, crc: crcs.get(f.name)!, data: f }))),
          { type: 'application/zip' },
        );
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = files.length === 1 ? files[0].name : `photos-${new Date().toISOString().slice(0, 10)}.zip`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 60_000);
}
