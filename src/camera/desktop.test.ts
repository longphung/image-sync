/// <reference types="node" />
// Run with `pnpm test`. Talks to a throwaway local HTTP server standing in for the desktop app.
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, test } from 'node:test';

import {
  firstReachable,
  listImagesDesktop,
  pairDesktop,
  pairWithCode,
  PairCodeError,
  parseStoredDesktops,
  requestPairCode,
} from './desktop.ts';
import { fetchText } from './http.ts';

let server: Server;
let base: string;
let port: number;

before(async () => {
  server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    const t = url.searchParams.get('t');
    switch (url.pathname) {
      case '/images':
        if (t !== 'good') return void res.writeHead(401).end();
        return void res.end('[{"title":"A.JPG","url":"u","filename":"A.JPG","thumbnailUrl":"th"}]');
      case '/pair':
        if (req.method !== 'POST' || t !== 'qr') return void res.writeHead(401).end();
        return void res.end(url.searchParams.get('name') === 'notoken' ? '{}' : '{"token":"phone"}');
      case '/pair/request':
        return void res.end('{"request":"r1"}');
      case '/pair/code': {
        const p = url.searchParams;
        if (p.get('request') !== 'r1') return void res.writeHead(410).end();
        if (p.get('code') !== '123456') return void res.writeHead(401).end();
        return void res.end('{"token":"phone","id":"u1","name":"mac","hosts":["10.0.0.9","mac.ts.net"],"port":8765}');
      }
      case '/garbage':
        return void res.end('<html>not json</html>');
      case '/hang':
        return; // never answers
      default:
        res.writeHead(404).end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = (server.address() as AddressInfo).port;
  base = `http://127.0.0.1:${port}`;
});

after(() => {
  server.closeAllConnections();
  server.close();
});

describe('fetchText', () => {
  test('fails on a non-2xx status', async () => {
    await assert.rejects(fetchText(`${base}/nope`), /HTTP 404/);
  });

  test('times out on a server that never answers', async () => {
    await assert.rejects(fetchText(`${base}/hang`, {}, 100), /timed out after 0.1s/);
  });

  test('fails when nothing listens', async () => {
    await assert.rejects(fetchText('http://127.0.0.1:1/'));
  });
});

describe('desktop client against a server', () => {
  test('lists images with the right token', async () => {
    const items = await listImagesDesktop(base, 'good');
    assert.equal(items[0].filename, 'A.JPG');
  });

  test('a revoked token fails with 401 and never shows the token', async () => {
    await assert.rejects(listImagesDesktop(base, 'secret-revoked'), (err: Error) => {
      assert.match(err.message, /401/);
      assert.doesNotMatch(err.message, /secret-revoked/);
      return true;
    });
  });

  test('pairing trades the QR token for the phone token', async () => {
    assert.equal(await pairDesktop(base, 'qr', 'iPhone'), 'phone');
  });

  test('pairing with a used QR token fails', async () => {
    await assert.rejects(pairDesktop(base, 'old-qr', 'iPhone'), /POST .*\/pair: HTTP 401/);
  });

  test('pairing fails when the reply has no token', async () => {
    await assert.rejects(pairDesktop(base, 'qr', 'notoken'), /no token/);
  });

  test('pairing by code: request, then trade the code for a desktop entry', async () => {
    assert.equal(await requestPairCode(base, 'iPhone'), 'r1');
    assert.deepEqual(await pairWithCode('127.0.0.1', port, 'r1', '123456', 'iPhone'), {
      id: 'u1',
      name: 'mac',
      // The address that worked first, then the desktop's own list.
      hosts: ['127.0.0.1', '10.0.0.9', 'mac.ts.net'],
      port,
      token: 'phone',
    });
  });

  test('pairing by code tells a wrong code from an expired request', async () => {
    await assert.rejects(
      pairWithCode('127.0.0.1', port, 'r1', '000000', 'iPhone'),
      (err) => err instanceof PairCodeError && !err.expired,
    );
    await assert.rejects(
      pairWithCode('127.0.0.1', port, 'gone', '123456', 'iPhone'),
      (err) => err instanceof PairCodeError && err.expired,
    );
  });

  test('a non-JSON body is an error, not a crash later', async () => {
    await assert.rejects(fetchText(`${base}/garbage`).then(JSON.parse));
  });
});

describe('firstReachable', () => {
  test('falls through a dead host to the next one', async () => {
    const { baseUrl, result } = await firstReachable(['127.0.0.2', '127.0.0.1'], port, (url) =>
      listImagesDesktop(url, 'good', 500),
    );
    assert.equal(baseUrl, base);
    assert.equal(result.length, 1);
  });

  test('reports every host when all fail', async () => {
    await assert.rejects(
      firstReachable(['127.0.0.2', '127.0.0.1'], port, (url) => listImagesDesktop(url, 'bad', 500)),
      (err: Error) => {
        assert.equal(err.message.split('\n').length, 2);
        assert.match(err.message, /401/);
        return true;
      },
    );
  });

  test('fails clearly with no hosts', async () => {
    await assert.rejects(firstReachable([], port, async () => 1), /No address/);
  });
});

describe('parseStoredDesktops', () => {
  const ok = { id: 'u1', name: 'mac', hosts: ['192.168.1.5'], port: 8765, token: 'phone' };

  test('reads a valid list', () => {
    assert.deepEqual(parseStoredDesktops(JSON.stringify([ok])), [ok]);
  });

  test('a corrupt or foreign file gives an empty list instead of crashing', () => {
    assert.deepEqual(parseStoredDesktops('{not json'), []);
    assert.deepEqual(parseStoredDesktops('{"id":"u1"}'), []);
    assert.deepEqual(parseStoredDesktops(''), []);
  });

  test('drops malformed entries and keeps the good ones', () => {
    const text = JSON.stringify([ok, { ...ok, hosts: [] }, { ...ok, port: '8765' }, null, 'x']);
    assert.deepEqual(parseStoredDesktops(text), [ok]);
  });
});
