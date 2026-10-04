import { listImagesDesktop } from './desktop.ts';
import { listImagesDlna } from './dlna.ts';
import { listImagesScalar } from './scalar.ts';
import type { CameraApi, ImageItem } from './types.ts';

export { DEFAULT_HOST, getCameraInfo } from './discovery.ts';
export {
  desktopBaseUrl,
  firstReachable,
  listImagesDesktop,
  pairDesktop,
  parsePairingQr,
  type PairedDesktop,
  type PairingQr,
} from './desktop.ts';
export type { CameraApi, CameraInfo, ImageItem } from './types.ts';

/** Dispatches to the DLNA, Scalar or desktop backend. */
export function listImages(api: CameraApi): Promise<ImageItem[]> {
  switch (api.kind) {
    case 'dlna':
      return listImagesDlna(api.controlUrl, api.photoRoot);
    case 'scalar':
      return listImagesScalar(api.baseUrl);
    case 'desktop':
      return listImagesDesktop(api.baseUrl, api.token);
  }
}
