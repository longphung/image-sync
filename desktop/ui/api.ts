import { convertFileSrc, invoke } from '@tauri-apps/api/core';

/** Mirrors `MediaItem` in src/main.rs. `imported` is always true for library items. */
export type MediaItem = { name: string; path: string; size: number; video: boolean; imported: boolean };

export type Status = {
  import: {
    running: boolean;
    volume: string | null;
    counts: {
      total: number; copied: number; skipped: number; failed: number;
      converted: number; convert_failed: number; converting: string | null; percent: number;
    };
    error: string | null;
  };
  camera: string | null;
  settings: { library: string; port: number; remote_host: string; phones: Phone[] };
  ffmpeg: boolean;
  pairing_qr: string;
};

export type Phone = { id: string; name: string; paired: number };

export const getStatus = () => invoke<Status>('status');
export const getCard = () => invoke<MediaItem[]>('card');
export const getLibrary = () => invoke<MediaItem[]>('library');
export const openLibrary = () => invoke<void>('open_library');
export const sync = (paths: string[]) => invoke<void>('sync', { paths });
export const saveSettings = (library: string, port: number, remoteHost: string) =>
  invoke<void>('save_settings', { library, port, remoteHost });
export const removePhone = (id: string) => invoke<void>('remove_phone', { id });
export const unpairAll = () => invoke<void>('unpair_all');

/** Grid thumbnail, generated and cached by the Rust thumbnail queue. */
export const thumbUrl = (item: MediaItem) => convertFileSrc(item.path, 'thumb');
/** The original file on the card or in the library (asset protocol, with Range support for video seeking). */
export const fileUrl = (item: MediaItem) => convertFileSrc(item.path);

export const mb = (bytes: number) => `${(bytes / 1e6).toFixed(1)} MB`;
