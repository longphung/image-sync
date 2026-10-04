export type ImageItem = {
  title: string;
  url: string;
  filename: string;
  thumbnailUrl: string;
};

export type CameraApi =
  | { kind: 'dlna'; controlUrl: string; photoRoot: string }
  | { kind: 'scalar'; baseUrl: string }
  | { kind: 'desktop'; baseUrl: string; token: string };

/**
 * Result of discovery: which API the camera speaks plus its display name
 * (UPnP `friendlyName`, falling back to `modelName`), when present.
 */
export type CameraInfo = {
  api: CameraApi;
  name?: string;
};
