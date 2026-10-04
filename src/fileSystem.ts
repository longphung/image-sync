import { Directory, File, Paths } from 'expo-file-system';

const PHOTOS_DIR_NAME = 'camera-photos';

export function getPhotosDirectory(): Directory {
  const dir = new Directory(Paths.document, PHOTOS_DIR_NAME);
  if (!dir.exists) {
    dir.create({ intermediates: true });
  }
  return dir;
}

// download_image() in Rust does std::fs::File::create(dest_path) on a plain
// path — expo-file-system URIs are always file://, so strip it before
// crossing the FFI boundary.
export function toFsPath(uri: string): string {
  return decodeURIComponent(uri.replace(/^file:\/\//, ''));
}

export function destPathFor(filename: string): string {
  return toFsPath(new File(getPhotosDirectory(), filename).uri);
}

// Unlike destPathFor(), keeps the file:// scheme intact — expo-media-library needs a real
// URI, not the bare fs path used for the Rust FFI boundary.
export function fileUriFor(filename: string): string {
  return new File(getPhotosDirectory(), filename).uri;
}

export function listDownloadedFilenames(): Set<string> {
  return new Set(getPhotosDirectory().list().map((entry) => entry.name));
}

// ponytail: extension sniffing — the Rust listing doesn't expose DLNA upnp:class / mime yet;
// move classification into image-sync-core if the camera ever serves extensionless URLs.
export function isVideoFile(filename: string): boolean {
  return /\.(mp4|mts|m2ts|mov)$/i.test(filename);
}
