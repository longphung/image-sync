import { listImagesDlna } from './dlna.ts';
import { listImagesScalar } from './scalar.ts';
import type { CameraApi, ImageItem } from './types.ts';

export { DEFAULT_HOST, getCameraInfo } from './discovery.ts';
export type { CameraApi, CameraInfo, ImageItem } from './types.ts';

/** Dispatches to the DLNA or Scalar backend based on what discovery returned. */
export function listImages(api: CameraApi): Promise<ImageItem[]> {
  return api.kind === 'dlna'
    ? listImagesDlna(api.controlUrl, api.photoRoot)
    : listImagesScalar(api.baseUrl);
}
