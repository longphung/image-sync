import { errorMessage, fetchText } from './http.ts';
import type { ImageItem } from './types.ts';

/** What the desktop's pairing QR encodes (see docs/desktop-plan.md). */
export type PairingQr = {
  id: string;
  name: string;
  /** Tried in order: LAN IP first, then the optional remote (VPN) address. */
  hosts: string[];
  port: number;
  /** One-time pairing token, traded for this phone's own token by `POST /pair`. */
  token: string;
};

/** A paired desktop hub. `token` is this phone's own token from `POST /pair`, not the QR's. */
export type PairedDesktop = PairingQr;

export function desktopBaseUrl(host: string, port: number): string {
  // A bare IPv6 address needs brackets in a URL.
  return `http://${host.includes(':') ? `[${host}]` : host}:${port}`;
}

/** Parses the QR text, throwing a user-facing message if it isn't an image-sync pairing code. */
export function parsePairingQr(text: string): PairingQr {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('Not an image-sync pairing code.');
  }
  const d = data as Partial<PairingQr> & { v?: unknown };
  if (
    typeof d !== 'object' || d === null ||
    d.v !== 1 ||
    typeof d.id !== 'string' ||
    typeof d.token !== 'string' ||
    typeof d.port !== 'number' ||
    !Array.isArray(d.hosts) || d.hosts.length === 0 ||
    !d.hosts.every((h) => typeof h === 'string')
  ) {
    throw new Error('Not an image-sync pairing code.');
  }
  return { id: d.id, name: typeof d.name === 'string' ? d.name : 'Desktop', hosts: d.hosts, port: d.port, token: d.token };
}

/** `GET /images` body -> `ImageItem[]`. The URLs in it already carry the token. */
export function parseDesktopImages(text: string): ImageItem[] {
  const items: unknown = JSON.parse(text);
  if (!Array.isArray(items)) throw new Error('Desktop /images did not return a list');
  return items.filter(
    (i): i is ImageItem =>
      typeof i?.title === 'string' &&
      typeof i.url === 'string' &&
      typeof i.filename === 'string' &&
      typeof i.thumbnailUrl === 'string',
  );
}

export async function listImagesDesktop(
  baseUrl: string,
  token: string,
  timeoutMs?: number,
): Promise<ImageItem[]> {
  let body: string;
  try {
    body = await fetchText(`${baseUrl}/images?t=${encodeURIComponent(token)}`, {}, timeoutMs);
  } catch (err) {
    // The URL without the token, so it never ends up on screen.
    throw new Error(`HTTP request failed: GET ${baseUrl}/images: ${errorMessage(err)}`);
  }
  return parseDesktopImages(body);
}

/** Trades the QR's one-time token for this phone's own token. */
export async function pairDesktop(
  baseUrl: string,
  pairingToken: string,
  phoneName: string,
  timeoutMs?: number,
): Promise<string> {
  const url = `${baseUrl}/pair?t=${encodeURIComponent(pairingToken)}&name=${encodeURIComponent(phoneName)}`;
  let body: string;
  try {
    body = await fetchText(url, { method: 'POST' }, timeoutMs);
  } catch (err) {
    throw new Error(`HTTP request failed: POST ${baseUrl}/pair: ${errorMessage(err)}`);
  }
  const token = (JSON.parse(body) as { token?: unknown }).token;
  if (typeof token !== 'string') throw new Error('Desktop /pair returned no token');
  return token;
}

/** Calls `fn` with each host's base URL in order and returns the first success. */
export async function firstReachable<T>(
  hosts: string[],
  port: number,
  fn: (baseUrl: string) => Promise<T>,
): Promise<{ baseUrl: string; result: T }> {
  const errors: string[] = [];
  for (const host of hosts) {
    const baseUrl = desktopBaseUrl(host, port);
    try {
      return { baseUrl, result: await fn(baseUrl) };
    } catch (err) {
      errors.push(errorMessage(err));
    }
  }
  throw new Error(errors.length > 0 ? errors.join('\n') : 'No address to try');
}

/** Reads the stored desktop list, dropping anything malformed instead of failing the app. */
export function parseStoredDesktops(text: string): PairedDesktop[] {
  let list: unknown;
  try {
    list = JSON.parse(text);
  } catch {
    return [];
  }
  if (!Array.isArray(list)) return [];
  return list.flatMap((d) => {
    try {
      return [parsePairingQr(JSON.stringify({ ...d, v: 1 }))];
    } catch {
      return [];
    }
  });
}
