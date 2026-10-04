import { errorMessage, fetchText } from './http.ts';
import type { ImageItem } from './types.ts';
import {
  attr,
  childNodes,
  descendants,
  parseXml,
  tagName,
  textOf,
  unescapeXmlEntitiesOnce,
  type XmlNode,
} from './xml.ts';

const BROWSE_BATCH = 50;

export type DidlRes = { url: string; protocolInfo: string; size: number };
export type DidlItem = { title: string; res: DidlRes[] };
export type DidlNode = { kind: 'container'; id: string } | { kind: 'item'; item: DidlItem };

/** Recursively browse the container tree from `photoRoot`, collecting every `<item>`. */
export async function listImagesDlna(controlUrl: string, photoRoot: string): Promise<ImageItem[]> {
  const items = await collectItems(controlUrl, photoRoot);
  return items.map(buildImageItem);
}

function browseSoapEnvelope(objectId: string, start: number, count: number): string {
  return (
    '<?xml version="1.0" encoding="utf-8"?>' +
    '<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">' +
    '<s:Body>' +
    '<u:Browse xmlns:u="urn:schemas-upnp-org:service:ContentDirectory:1">' +
    `<ObjectID>${objectId}</ObjectID>` +
    '<BrowseFlag>BrowseDirectChildren</BrowseFlag>' +
    '<Filter>*</Filter>' +
    `<StartingIndex>${start}</StartingIndex>` +
    `<RequestedCount>${count}</RequestedCount>` +
    '<SortCriteria></SortCriteria>' +
    '</u:Browse>' +
    '</s:Body>' +
    '</s:Envelope>'
  );
}

async function sendBrowseRequest(
  controlUrl: string,
  objectId: string,
  start: number,
  count: number,
): Promise<string> {
  try {
    return await fetchText(controlUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/xml; charset="utf-8"',
        SOAPAction: '"urn:schemas-upnp-org:service:ContentDirectory:1#Browse"',
      },
      body: browseSoapEnvelope(objectId, start, count),
    });
  } catch (err) {
    throw new Error(`SOAP Browse error: Browse(${objectId}) failed: ${errorMessage(err)}`);
  }
}

/**
 * Parse one SOAP Browse response: the `TotalMatches` count, and the `Result` element's nested
 * (doubly-escaped) DIDL-Lite content, or `null` if there's no `Result`.
 */
export function parseBrowseResponse(raw: string): { nodes: DidlNode[] | null; total: number } {
  let total = 0;
  let resultText: string | null = null;
  for (const node of descendants(parseXml(raw))) {
    const tag = tagName(node);
    if (tag === 'TotalMatches') {
      total = parseUnsigned(textOf(node).trim());
    } else if (tag === 'Result') {
      // The parser already undid the SOAP envelope's escaping; undo the second layer here.
      resultText = unescapeXmlEntitiesOnce(textOf(node));
    }
  }
  return { nodes: resultText === null ? null : parseDidl(resultText), total };
}

async function browseAllChildren(controlUrl: string, objectId: string): Promise<DidlNode[]> {
  const children: DidlNode[] = [];
  let start = 0;
  for (;;) {
    const raw = await sendBrowseRequest(controlUrl, objectId, start, BROWSE_BATCH);
    const { nodes, total } = parseBrowseResponse(raw);
    if (!nodes || nodes.length === 0) break;
    start += nodes.length;
    children.push(...nodes);
    if (start >= total) break;
  }
  return children;
}

async function collectItems(controlUrl: string, objectId: string): Promise<DidlItem[]> {
  const items: DidlItem[] = [];
  for (const node of await browseAllChildren(controlUrl, objectId)) {
    if (node.kind === 'item') {
      items.push(node.item);
    } else if (node.id) {
      items.push(...(await collectItems(controlUrl, node.id)));
    }
  }
  return items;
}

/**
 * Parse a DIDL-Lite document: one entry per `<container>` (just its `id`) or `<item>` (title +
 * all `<res>` entries), in document order.
 */
export function parseDidl(xml: string): DidlNode[] {
  const nodes: DidlNode[] = [];
  const walk = (list: XmlNode[]) => {
    for (const node of list) {
      const tag = tagName(node);
      if (tag === 'item') {
        nodes.push({ kind: 'item', item: parseItem(node) });
      } else {
        if (tag === 'container') nodes.push({ kind: 'container', id: attr(node, 'id') ?? '' });
        walk(childNodes(node));
      }
    }
  };
  walk(parseXml(xml));
  return nodes;
}

function parseItem(item: XmlNode): DidlItem {
  const result: DidlItem = { title: '', res: [] };
  for (const node of descendants(childNodes(item))) {
    const tag = tagName(node);
    if (tag === 'title') {
      result.title = textOf(node).trim();
    } else if (tag === 'res') {
      result.res.push({
        url: textOf(node).trim(),
        protocolInfo: attr(node, 'protocolInfo') ?? '',
        size: parseUnsigned(attr(node, 'size') ?? ''),
      });
    }
  }
  return result;
}

function parseUnsigned(s: string): number {
  return /^\d+$/.test(s) ? Number(s) : 0;
}

/**
 * Prefer the `<res>` with no `DLNA.ORG_PN=` in its `protocolInfo` (the original, full-resolution
 * file), keeping the largest by `size` if there are several. Falls back to the first converted
 * (thumbnail/small/large) resource in document order if no original is present — a faithful port
 * of the reference client's behavior, not "fixed" to pick the largest fallback, since that's
 * what has been validated against real hardware.
 * One deliberate deviation: a video whose actual file carries a DLNA profile
 * (e.g. `video/mp4:DLNA.ORG_PN=AVC_MP4_...`) would otherwise resolve to its JPEG thumbnail, so
 * the first `video/*` resource wins over image fallbacks.
 */
export function pickOriginalRes(resList: DidlRes[]): { url: string; filename: string } {
  let originalUrl = '';
  let originalSize = -1;
  let fallbackUrl = '';
  let videoFallbackUrl = '';

  for (const res of resList) {
    if (!res.url) continue;
    if (!res.protocolInfo.includes('DLNA.ORG_PN=')) {
      if (res.size > originalSize) {
        originalSize = res.size;
        originalUrl = res.url;
      }
    } else {
      fallbackUrl ||= res.url;
      if (!videoFallbackUrl && res.protocolInfo.includes(':video/')) videoFallbackUrl = res.url;
    }
  }

  const url = originalUrl || videoFallbackUrl || fallbackUrl;
  return { url, filename: urlBasename(url) };
}

export function thumbnailUrl(resList: DidlRes[]): string {
  return resList.find((r) => r.protocolInfo.includes('JPEG_TN'))?.url ?? '';
}

/** Last path segment of a URL, ignoring the query string. */
export function urlBasename(url: string): string {
  return url.split('?')[0].split('/').filter(Boolean).pop() ?? '';
}

function buildImageItem(item: DidlItem): ImageItem {
  const { url, filename } = pickOriginalRes(item.res);
  return {
    title: item.title,
    url,
    filename: filename || item.title,
    thumbnailUrl: thumbnailUrl(item.res),
  };
}
