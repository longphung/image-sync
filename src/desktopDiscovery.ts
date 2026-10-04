import { useEffect, useState } from 'react';
import Zeroconf from 'react-native-zeroconf';

/** A desktop advertising `_image-sync._tcp` on the LAN, keyed by its TXT `id`. */
export type FoundDesktop = { id: string; name: string; host: string; port: number };

/**
 * Browses for desktops while `active`; changing `scanKey` restarts the browse (pull to refresh).
 * mDNS never crosses networks, so this is LAN-only.
 */
export function useDesktopDiscovery(active: boolean, scanKey = 0): Record<string, FoundDesktop> {
  const [found, setFound] = useState<Record<string, FoundDesktop>>({});

  useEffect(() => {
    if (!active) return;
    const zeroconf = new Zeroconf();
    // `remove` only carries the service name, so remember which id each name was.
    const idsByName = new Map<string, string>();
    zeroconf.on('resolved', (service) => {
      const id = service.txt?.id;
      // IPv4 first: an IPv6 link-local address would need its zone id escaped in the URL.
      const host = service.ipv4[0] ?? service.addresses[0];
      if (!id || !host) return;
      idsByName.set(service.name, id);
      setFound((prev) => ({
        ...prev,
        [id]: { id, name: service.txt.name || service.name, host, port: service.port },
      }));
    });
    zeroconf.on('remove', (name) => {
      const id = idsByName.get(name);
      if (!id) return;
      setFound(({ [id]: _, ...rest }) => rest);
    });
    zeroconf.on('error', (err) => console.log('[Discovery] zeroconf error', err));
    zeroconf.scan({ type: 'image-sync', protocol: 'tcp', domain: 'local.' });
    return () => {
      zeroconf.stop();
      zeroconf.removeDeviceListeners();
      setFound({}); // a desktop that leaves while we're not browsing must not linger
    };
  }, [active, scanKey]);

  return found;
}
