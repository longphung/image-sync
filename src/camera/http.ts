const TIMEOUT_MS = 30_000;

/**
 * `fetch()` the body as text, failing on a non-2xx status or after `TIMEOUT_MS`.
 * RN's `AbortSignal` polyfill has no `AbortSignal.timeout()`, hence the manual timer.
 */
export async function fetchText(url: string, init: RequestInit = {}): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`.trim());
    return await res.text();
  } catch (err) {
    if (controller.signal.aborted) throw new Error(`timed out after ${TIMEOUT_MS / 1000}s`);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
