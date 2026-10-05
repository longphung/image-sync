import { File, Paths } from 'expo-file-system';
import { parseStoredDesktops, type PairedDesktop } from './camera/desktop';

export type { PairedDesktop };

const file = () => new File(Paths.document, 'desktops.json');

export function loadDesktops(): PairedDesktop[] {
  try {
    const f = file();
    return f.exists ? parseStoredDesktops(f.textSync()) : [];
  } catch (err) {
    console.log('[Desktops] could not read desktops.json', err);
    return [];
  }
}

export function saveDesktops(desktops: PairedDesktop[]): void {
  file().write(JSON.stringify(desktops));
}

// ponytail: only the web build remembers the last pair-by-code address (native has mDNS and QR);
// persist it next to desktops.json if native ever needs it.
export function loadLastPairAddress(): string {
  return '';
}

export function saveLastPairAddress(_address: string): void {}
