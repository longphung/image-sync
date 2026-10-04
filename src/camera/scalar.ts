import { urlBasename } from './dlna.ts';
import { errorMessage, fetchText } from './http.ts';
import type { ImageItem } from './types.ts';

const BATCH = 50;

// Loosely-typed JSON-RPC payloads; every field is read defensively.
type Json = any;

/**
 * Walk every scheme/source on a Scalar Web API camera and return all still images found,
 * mirroring `SonyCamera.list_all_images` in the Python reference.
 */
export async function listImagesScalar(baseUrl: string): Promise<ImageItem[]> {
  const rpc = { baseUrl, id: 1 };
  const results: ImageItem[] = [];
  for (const scheme of await getSchemeList(rpc)) {
    for (const source of await getSourceList(rpc, scheme)) {
      for (const item of await getAllContent(rpc, source)) {
        results.push(contentItemToImageItem(item));
      }
    }
  }
  return results;
}

type Rpc = { baseUrl: string; id: number };

async function call(rpc: Rpc, method: string, params: Json[], version: string): Promise<Json> {
  const url = `${rpc.baseUrl.replace(/\/+$/, '')}/avContent`;
  const body = JSON.stringify({ method, params, id: rpc.id++, version });

  let resp: Json;
  try {
    const text = await fetchText(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });
    resp = JSON.parse(text);
  } catch (err) {
    throw new Error(`Scalar JSON-RPC error: ${url}: ${errorMessage(err)}`);
  }

  if (Array.isArray(resp?.error)) {
    const code = Number.isInteger(resp.error[0]) ? resp.error[0] : -1;
    const msg = typeof resp.error[1] === 'string' ? resp.error[1] : '';
    throw new Error(`Scalar JSON-RPC error: API error ${code}: ${msg}`);
  }
  return resp?.result ?? [];
}

function stringField(value: Json, key: string): string | undefined {
  const field = value?.[key];
  return typeof field === 'string' ? field : undefined;
}

/** The `key` string of every entry in `result[0]`. */
function stringsAt(result: Json, key: string): string[] {
  const entries: Json[] = Array.isArray(result?.[0]) ? result[0] : [];
  return entries.map((e) => stringField(e, key)).filter((s) => s !== undefined);
}

async function getSchemeList(rpc: Rpc): Promise<string[]> {
  return stringsAt(await call(rpc, 'getSchemeList', [], '1.0'), 'scheme');
}

async function getSourceList(rpc: Rpc, scheme: string): Promise<string[]> {
  return stringsAt(await call(rpc, 'getSourceList', [{ scheme }], '1.0'), 'source');
}

async function getContentCount(rpc: Rpc, uri: string): Promise<number> {
  const params = [{ uri, type: ['still'], target: 'all' }];
  const result = await call(rpc, 'getContentCount', params, '1.2');
  const count = result?.[0]?.count;
  return Number.isInteger(count) && count >= 0 ? count : 0;
}

async function getContentList(rpc: Rpc, uri: string, start: number, count: number): Promise<Json[]> {
  const params = [
    {
      uri,
      stIdx: start,
      cnt: count,
      type: ['still'],
      target: 'all',
      view: 'date',
      sort: 'ascending',
    },
  ];
  const result = await call(rpc, 'getContentList', params, '1.3');
  return Array.isArray(result?.[0]) ? result[0] : [];
}

async function getAllContent(rpc: Rpc, uri: string): Promise<Json[]> {
  const total = await getContentCount(rpc, uri);
  const items: Json[] = [];
  for (let start = 0; start < total; ) {
    const batch = Math.min(BATCH, total - start);
    items.push(...(await getContentList(rpc, uri, start, batch)));
    start += batch;
  }
  return items;
}

/**
 * Extract `{ title, url, filename, thumbnailUrl }` from a single `getContentList` entry,
 * preferring the original full-resolution file and falling back through `largeUrl` ->
 * `thumbnailUrl`, and the title when no filename is otherwise available.
 */
export function contentItemToImageItem(item: Json): ImageItem {
  const title = stringField(item, 'title') ?? '';
  const content = item?.content;
  const orig = Array.isArray(content?.original) ? content.original[0] : undefined;
  const thumbnailUrl = stringField(content, 'thumbnailUrl') ?? '';
  const url = stringField(orig, 'url') || stringField(content, 'largeUrl') || thumbnailUrl;
  const filename = stringField(orig, 'fileName') || urlBasename(url) || title;
  return { title, url, filename, thumbnailUrl };
}
