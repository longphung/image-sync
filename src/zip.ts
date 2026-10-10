// Minimal store-only (uncompressed) ZIP writer for the web build's "Download All": photos and
// videos are already compressed, and storing lets the zip be assembled from the downloaded Files
// as Blob parts, without copying or re-reading any data.

const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});

/** CRC-32 of `chunk`, continuing from `crc` (the result for the previous chunks, 0 to start). */
export function crc32(chunk: Uint8Array, crc = 0): number {
  let c = ~crc;
  for (let i = 0; i < chunk.length; i++) c = CRC_TABLE[(c ^ chunk[i]) & 0xff] ^ (c >>> 8);
  return ~c >>> 0;
}

export type ZipEntry<T> = { name: string; size: number; crc: number; data: T };

/**
 * The parts of a ZIP holding `entries`, in order: header bytes interleaved with each entry's
 * `data` untouched, ready for `new Blob(parts)`.
 */
// ponytail: no ZIP64, so the whole archive must stay under 4 GB; add ZIP64 records if a sync
// of long videos ever needs more.
export function zipParts<T>(entries: ZipEntry<T>[], date = new Date()): (Uint8Array<ArrayBuffer> | T)[] {
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1);
  const day = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  const parts: (Uint8Array<ArrayBuffer> | T)[] = [];
  const central: Uint8Array<ArrayBuffer>[] = [];
  let offset = 0;
  for (const { name, size, crc, data } of entries) {
    const nameBytes = new TextEncoder().encode(name);
    // Shared tail of the local and central headers: version 2.0, UTF-8 names, stored.
    const common = (v: DataView, at: number) => {
      v.setUint16(at, 20, true);
      v.setUint16(at + 2, 0x0800, true);
      v.setUint16(at + 4, 0, true);
      v.setUint16(at + 6, time, true);
      v.setUint16(at + 8, day, true);
      v.setUint32(at + 10, crc, true);
      v.setUint32(at + 14, size, true);
      v.setUint32(at + 18, size, true);
      v.setUint16(at + 22, nameBytes.length, true);
    };
    const local = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    common(lv, 4);
    local.set(nameBytes, 30);

    const cd = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(cd.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    common(cv, 6);
    cv.setUint32(42, offset, true);
    cd.set(nameBytes, 46);

    parts.push(local, data);
    central.push(cd);
    offset += local.length + size;
  }
  const cdSize = central.reduce((n, c) => n + c.length, 0);
  if (offset + cdSize > 0xffffffff) throw new Error('Too much to download as one zip (over 4 GB)');
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, offset, true);
  return [...parts, ...central, end];
}
