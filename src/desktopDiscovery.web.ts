import { useEffect, useState } from 'react';
import { DESKTOP_PORT } from './camera';
import type { FoundDesktop } from './desktopDiscovery';

export type { FoundDesktop };

/**
 * The web build is served by a desktop hub (at `/app`), so the only desktop it can find is the one
 * that served it, identified by `GET /info`. No mDNS in a browser.
 */
export function useDesktopDiscovery(active: boolean, scanKey = 0): Record<string, FoundDesktop> {
  const [found, setFound] = useState<Record<string, FoundDesktop>>({});

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    fetch('/info')
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        // Not served by a hub (e.g. `pnpm web`): the dev server answers with its HTML page.
        return res.headers.get('content-type')?.includes('json') ? res.json() : {};
      })
      .then((info: { id?: unknown; name?: unknown }) => {
        if (cancelled || typeof info.id !== 'string') return;
        const id = info.id;
        const name = typeof info.name === 'string' ? info.name : location.hostname;
        setFound({ [id]: { id, name, host: location.hostname, port: Number(location.port) || DESKTOP_PORT } });
      })
      .catch((err) => console.log('[Discovery] /info failed', err));
    return () => {
      cancelled = true;
    };
  }, [active, scanKey]);

  return found;
}
