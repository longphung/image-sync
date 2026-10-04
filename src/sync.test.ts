/// <reference types="node" />
// Run with `pnpm test`. Covers Sync All's failure handling with a fake download.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import type { ImageItem } from './camera/types.ts';
import { checkFilename, MAX_CONSECUTIVE_FAILURES, runSync, type Download } from './sync.ts';

const item = (filename: string): ImageItem => ({
  title: filename,
  filename,
  url: `http://cam/${filename}`,
  thumbnailUrl: '',
});

describe('runSync', () => {
  test('counts downloads and files already on the phone as skipped', async () => {
    const onPhone = new Set(['A.JPG']);
    const download: Download = async (i) => !onPhone.has(i.filename);
    const r = await runSync([item('A.JPG'), item('B.JPG')], download, new AbortController().signal);
    assert.deepEqual(r.counts, { downloaded: 1, skipped: 1, failed: 0 });
    assert.equal(r.stoppedEarly, null);
  });

  test('a failed file is recorded and the run carries on', async () => {
    const download: Download = async (i) => {
      if (i.filename === 'B.JPG') throw new Error('HTTP 500');
      return true;
    };
    const r = await runSync([item('A.JPG'), item('B.JPG'), item('C.JPG')], download, new AbortController().signal);
    assert.deepEqual(r.counts, { downloaded: 2, skipped: 0, failed: 1 });
    assert.deepEqual(
      r.failures.map((f) => [f.item.filename, f.message, f.retryable]),
      [['B.JPG', 'HTTP 500', true]],
    );
  });

  test('stops after repeated failures in a row instead of trying every file', async () => {
    let calls = 0;
    const download: Download = async () => {
      calls++;
      throw new Error('Network request failed');
    };
    const items = Array.from({ length: 10 }, (_, i) => item(`${i}.JPG`));
    const r = await runSync(items, download, new AbortController().signal);
    assert.equal(calls, MAX_CONSECUTIVE_FAILURES);
    assert.equal(r.counts.failed, MAX_CONSECUTIVE_FAILURES);
    assert.match(r.stoppedEarly ?? '', /failures in a row/);
  });

  test('a success in between resets the failure streak', async () => {
    let n = 0;
    const download: Download = async () => {
      if (n++ % 2 === 0) throw new Error('flaky');
      return true;
    };
    const items = Array.from({ length: 6 }, (_, i) => item(`${i}.JPG`));
    const r = await runSync(items, download, new AbortController().signal);
    assert.equal(r.stoppedEarly, null);
    assert.deepEqual(r.counts, { downloaded: 3, skipped: 0, failed: 3 });
  });

  test('cancelling mid-download is not a failure and stops the run', async () => {
    const controller = new AbortController();
    const download: Download = (_, { signal }) =>
      new Promise((_, reject) => {
        signal.addEventListener('abort', () => reject(new Error('AbortError')));
        controller.abort();
      });
    const r = await runSync([item('A.JPG'), item('B.JPG')], download, controller.signal);
    assert.deepEqual(r.counts, { downloaded: 0, skipped: 0, failed: 0 });
    assert.equal(r.stoppedEarly, null);
  });

  test('a second file with the same name fails instead of being silently skipped', async () => {
    const written = new Set<string>();
    const download: Download = async (i) => {
      if (written.has(i.filename)) return false;
      written.add(i.filename);
      return true;
    };
    const dup = { ...item('DSC00001.JPG'), url: 'http://cam/101MSDCF/DSC00001.JPG' };
    const r = await runSync([item('DSC00001.JPG'), dup], download, new AbortController().signal);
    assert.deepEqual(r.counts, { downloaded: 1, skipped: 0, failed: 1 });
    assert.equal(r.failures[0].retryable, false);
  });

  test('non-Error throwables still produce a message', async () => {
    const download: Download = async () => {
      throw 'disk full';
    };
    const r = await runSync([item('A.JPG')], download, new AbortController().signal);
    assert.equal(r.failures[0].message, 'disk full');
  });
});

describe('checkFilename', () => {
  test('accepts plain names, including the desktop date prefix', () => {
    checkFilename('DSC00001.JPG');
    checkFilename('2025-06-14_C0001.MP4');
  });

  test('rejects names that would escape the photos directory or clash with .part files', () => {
    for (const bad of ['', '.', '..', '../x.jpg', 'a/b.jpg', 'a\\b.jpg', 'x.jpg.part', 'a\0b']) {
      assert.throws(() => checkFilename(bad), /Refusing/, JSON.stringify(bad));
    }
  });
});
