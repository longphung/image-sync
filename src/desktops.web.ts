import { parseStoredDesktops, type PairedDesktop } from './camera/desktop';

export type { PairedDesktop };

// The web build keeps paired desktops in localStorage instead of a file in the documents directory.
const KEY = 'image-sync.desktops';

export function loadDesktops(): PairedDesktop[] {
  try {
    return parseStoredDesktops(localStorage.getItem(KEY) ?? '[]');
  } catch (err) {
    console.log('[Desktops] could not read localStorage', err);
    return [];
  }
}

export function saveDesktops(desktops: PairedDesktop[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(desktops));
  } catch (err) {
    console.log('[Desktops] could not write localStorage', err);
  }
}

// The last address paired by code, to prefill the pair-code screen. Separate from the paired list.
const LAST_ADDRESS_KEY = 'image-sync.lastPairAddress';

export function loadLastPairAddress(): string {
  try {
    return localStorage.getItem(LAST_ADDRESS_KEY) ?? '';
  } catch {
    return '';
  }
}

export function saveLastPairAddress(address: string): void {
  try {
    localStorage.setItem(LAST_ADDRESS_KEY, address);
  } catch (err) {
    console.log('[Desktops] could not write localStorage', err);
  }
}
