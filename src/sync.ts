// Pure Sync All loop: the download itself is injected, so the failure handling is testable in Node.
import type { ImageItem } from './camera/types.ts';

export type SyncCounts = { downloaded: number; skipped: number; failed: number };
export type SyncFailure = {
  item: ImageItem;
  message: string;
  /** False when trying again can't help (a name clash), so "Retry Failed" leaves it out. */
  retryable: boolean;
};

/** Resolves true when the file was written, false when it was already on the phone. */
export type Download = (
  item: ImageItem,
  opts: { signal: AbortSignal; onPercent: (percent: number) => void },
) => Promise<boolean>;

export type SyncEvents = {
  onStart?: (index: number, item: ImageItem) => void;
  onPercent?: (percent: number) => void;
  onResult?: (counts: SyncCounts, failures: SyncFailure[]) => void;
};

export type SyncResult = {
  counts: SyncCounts;
  failures: SyncFailure[];
  /** Why the run stopped before the end, if it did (never set for a cancel). */
  stoppedEarly: string | null;
};

// Wi-Fi dropped, desktop unpaired, phone full: every remaining file would fail too, each after
// its own timeout, so stop instead of grinding through the whole list.
export const MAX_CONSECUTIVE_FAILURES = 3;

/**
 * Throws unless `filename` is a plain file name. It comes from the camera or desktop over the
 * network, and a `../` or `/` in it would write outside the photos directory.
 */
export function checkFilename(filename: string): void {
  if (!filename || filename === '.' || filename === '..' || /[/\\\0]/.test(filename) || filename.endsWith('.part')) {
    throw new Error(`Refusing to save a file named "${filename}".`);
  }
}

export function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export async function runSync(
  items: ImageItem[],
  download: Download,
  signal: AbortSignal,
  events: SyncEvents = {},
): Promise<SyncResult> {
  const counts: SyncCounts = { downloaded: 0, skipped: 0, failed: 0 };
  const failures: SyncFailure[] = [];
  const seen = new Set<string>();
  let consecutive = 0;

  const fail = (item: ImageItem, message: string, retryable = true) => {
    counts.failed++;
    failures.push({ item, message, retryable });
  };

  for (let i = 0; i < items.length; i++) {
    if (signal.aborted) break;
    const item = items[i];
    events.onStart?.(i, item);
    if (seen.has(item.filename)) {
      // Two listed files with one name (e.g. the same DSC number in two camera folders): the
      // second would be "skipped" as already downloaded and silently never reach the phone.
      fail(item, `Another file in this list is also named ${item.filename}; it was not downloaded.`, false);
    } else {
      seen.add(item.filename);
      try {
        const wrote = await download(item, { signal, onPercent: (p) => events.onPercent?.(p) });
        if (wrote) counts.downloaded++;
        else counts.skipped++;
        consecutive = 0;
      } catch (err) {
        if (signal.aborted) break; // the AbortError from Cancel isn't a failure
        fail(item, errorText(err));
        if (++consecutive >= MAX_CONSECUTIVE_FAILURES) {
          events.onResult?.({ ...counts }, [...failures]);
          return {
            counts,
            failures,
            stoppedEarly: `Stopped after ${consecutive} failures in a row. Check the connection and try again.`,
          };
        }
      }
    }
    events.onResult?.({ ...counts }, [...failures]);
  }
  return { counts, failures, stoppedEarly: null };
}
