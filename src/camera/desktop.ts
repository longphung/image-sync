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
  // A page served over HTTPS may only call HTTPS (no mixed content). The hub serves both on the
  // same port; the native app has no `location` and always uses plain HTTP.
  const scheme = globalThis.location?.protocol === 'https:' ? 'https' : 'http';
  // A bare IPv6 address needs brackets in a URL.
  return `${scheme}://${host.includes(':') ? `[${host}]` : host}:${port}`;
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

/** Default hub port, used when a typed address has none. */
export const DESKTOP_PORT = 8765;

/** Parses a typed `host`, `host:port` or `[ipv6]:port`. Returns null for anything unusable. */
export function parseHostPort(text: string): { host: string; port: number } | null {
  const m = text.trim().match(/^(?:\[([^\]]+)\]|([^\s:/]+))(?::(\d{1,5}))?$/);
  const port = m?.[3] ? Number(m[3]) : DESKTOP_PORT;
  if (!m || port < 1 || port > 65535) return null;
  return { host: m[1] ?? m[2], port };
}

/** Asks the desktop to show a 6-digit code; returns the request id to send back with it. */
export async function requestPairCode(baseUrl: string, phoneName: string, timeoutMs?: number): Promise<string> {
  let body: string;
  try {
    body = await fetchText(`${baseUrl}/pair/request?name=${encodeURIComponent(phoneName)}`, { method: 'POST' }, timeoutMs);
  } catch (err) {
    throw new Error(`HTTP request failed: POST ${baseUrl}/pair/request: ${errorMessage(err)}`);
  }
  const request = (JSON.parse(body) as { request?: unknown }).request;
  if (typeof request !== 'string') throw new Error('Desktop /pair/request returned no request id');
  return request;
}

/**
 * A rejected code. `expired`: the request is gone (expired, denied, used, or too many wrong
 * codes), so a new code has to be requested; otherwise the user can just retype.
 */
export class PairCodeError extends Error {
  readonly expired: boolean;
  constructor(expired: boolean, message: string) {
    super(message);
    this.expired = expired;
  }
}

/** Trades the code shown on the desktop for this phone's own token and the desktop's details. */
export async function pairWithCode(
  host: string,
  port: number,
  requestId: string,
  code: string,
  phoneName: string,
  timeoutMs?: number,
): Promise<PairedDesktop> {
  const baseUrl = desktopBaseUrl(host, port);
  const q = `request=${encodeURIComponent(requestId)}&code=${encodeURIComponent(code)}&name=${encodeURIComponent(phoneName)}`;
  let body: string;
  try {
    body = await fetchText(`${baseUrl}/pair/code?${q}`, { method: 'POST' }, timeoutMs);
  } catch (err) {
    const message = errorMessage(err);
    if (/^HTTP 401\b/.test(message)) throw new PairCodeError(false, 'Wrong code');
    if (/^HTTP 410\b/.test(message)) throw new PairCodeError(true, 'Code expired');
    throw new Error(`HTTP request failed: POST ${baseUrl}/pair/code: ${message}`);
  }
  return parsePairReply(body, host, port);
}

/**
 * `{ token, id, name, hosts, port }` from `/pair` or `/pair/code` -> the desktop to store. The
 * address that just worked goes first, so it's what the phone tries next time.
 */
export function parsePairReply(text: string, host: string, port: number): PairedDesktop {
  const r = JSON.parse(text) as Record<string, unknown>;
  const hosts = Array.isArray(r.hosts) ? r.hosts.filter((h): h is string => typeof h === 'string') : [];
  return parsePairingQr(
    JSON.stringify({ ...r, v: 1, hosts: [host, ...hosts.filter((h) => h !== host)], port }),
  );
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
