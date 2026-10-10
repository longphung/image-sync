import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { crc32 as zlibCrc32 } from 'node:zlib';
import { crc32, zipParts } from './zip.ts';

test('crc32 matches zlib, also when fed in chunks', () => {
  const data = new TextEncoder().encode('The quick brown fox jumps over the lazy dog');
  assert.equal(crc32(data), zlibCrc32(data));
  assert.equal(crc32(data.subarray(10), crc32(data.subarray(0, 10))), zlibCrc32(data));
});

test('zipParts builds an archive Python can read back', () => {
  const files = { 'DSC00001.JPG': 'jpeg bytes', 'ảnh.MP4': 'video bytes, longer' };
  const entries = Object.entries(files).map(([name, text]) => {
    const data = new TextEncoder().encode(text);
    return { name, size: data.length, crc: crc32(data), data };
  });
  const path = join(mkdtempSync(join(tmpdir(), 'zip-test-')), 'out.zip');
  writeFileSync(path, Buffer.concat(zipParts(entries)));
  const out = execFileSync('python3', [
    '-I',
    '-c',
    'import json,sys,zipfile; z=zipfile.ZipFile(sys.argv[1]); assert z.testzip() is None; ' +
      'print(json.dumps({n: z.read(n).decode() for n in z.namelist()}))',
    path,
  ]);
  assert.deepEqual(JSON.parse(String(out)), files);
});
