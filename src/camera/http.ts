const TIMEOUT_MS = 30_000;

/**
 * `fetch()` the body as text, failing on a non-2xx status or after `timeoutMs`.
 * RN's `AbortSignal` polyfill has no `AbortSignal.timeout()`, hence the manual timer.
 */
export async function fetchText(
  url: string,
  init: RequestInit = {},
  timeoutMs = TIMEOUT_MS,
): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`.trim());
    return await res.text();
  } catch (err) {
    if (controller.signal.aborted) throw new Error(`timed out after ${timeoutMs / 1000}s`);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
