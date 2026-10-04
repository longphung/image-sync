import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { DEFAULT_HOST, getCameraInfo, listImages, type CameraApi, type ImageItem } from './camera';
import { getCurrentSsid } from './wifi';

export type ConnectionStatus = 'idle' | 'connecting' | 'connected' | 'error';
export type ImagesStatus = 'idle' | 'loading' | 'loaded' | 'error';

type CameraConnectionValue = {
  host: string;
  setHost: (host: string) => void;
  status: ConnectionStatus;
  api: CameraApi | null;
  /** Camera's UPnP friendly/model name, or null if the device description had none. */
  cameraName: string | null;
  errorMessage: string | null;
  connect: () => Promise<void>;
  disconnect: () => void;
  /** SSID the phone is currently joined to, or null if unknown / not on Wi-Fi. */
  wifiSsid: string | null;
  /** `joinedSsid` is used when the OS won't reveal the SSID (e.g. no location permission). */
  refreshWifiSsid: (joinedSsid?: string) => Promise<void>;
  images: ImageItem[];
  imagesStatus: ImagesStatus;
  imagesError: string | null;
  refreshImages: () => Promise<void>;
};

const CameraConnectionContext = createContext<CameraConnectionValue | null>(null);

// This is intentionally memory-only (no AsyncStorage): `CameraApi` comes from discovery
// against whatever camera is currently joined, so it's not meaningful to persist/restore.
// It resets on every JS reload, which is why app/images.tsx guards against a null api.
export function CameraConnectionProvider({ children }: { children: ReactNode }) {
  const [host, setHost] = useState(DEFAULT_HOST);
  const [status, setStatus] = useState<ConnectionStatus>('idle');
  const [api, setApi] = useState<CameraApi | null>(null);
  const [cameraName, setCameraName] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [wifiSsid, setWifiSsid] = useState<string | null>(null);
  const [images, setImages] = useState<ImageItem[]>([]);
  const [imagesStatus, setImagesStatus] = useState<ImagesStatus>('idle');
  const [imagesError, setImagesError] = useState<string | null>(null);

  const connect = useCallback(async () => {
    setStatus('connecting');
    setErrorMessage(null);
    try {
      const trimmed = host.trim();
      const info = await getCameraInfo(trimmed.length > 0 ? trimmed : undefined);
      setApi(info.api);
      setCameraName(info.name ?? null);
      setImages([]);
      setImagesStatus('idle');
      setStatus('connected');
    } catch (err) {
      setStatus('error');
      setErrorMessage(err instanceof Error ? err.message : String(err));
    }
  }, [host]);

  const disconnect = useCallback(() => {
    setApi(null);
    setCameraName(null);
    setImages([]);
    setImagesStatus('idle');
    setImagesError(null);
    setStatus('idle');
    setErrorMessage(null);
  }, []);

  const refreshWifiSsid = useCallback(async (joinedSsid?: string) => {
    setWifiSsid((await getCurrentSsid()) ?? joinedSsid ?? null);
  }, []);

  const refreshImages = useCallback(async () => {
    if (!api) return;
    setImagesStatus('loading');
    setImagesError(null);
    try {
      // The camera lists oldest first; show newest first.
      setImages((await listImages(api)).reverse());
      setImagesStatus('loaded');
    } catch (err) {
      console.log('[Images] listImages error', err);
      setImagesStatus('error');
      setImagesError(err instanceof Error ? err.message : String(err));
    }
  }, [api]);

  const value = useMemo(
    () => ({
      host,
      setHost,
      status,
      api,
      cameraName,
      errorMessage,
      connect,
      disconnect,
      wifiSsid,
      refreshWifiSsid,
      images,
      imagesStatus,
      imagesError,
      refreshImages,
    }),
    [
      host,
      status,
      api,
      cameraName,
      errorMessage,
      connect,
      disconnect,
      wifiSsid,
      refreshWifiSsid,
      images,
      imagesStatus,
      imagesError,
      refreshImages,
    ],
  );

  return (
    <CameraConnectionContext.Provider value={value}>{children}</CameraConnectionContext.Provider>
  );
}

export function useCameraConnection(): CameraConnectionValue {
  const value = useContext(CameraConnectionContext);
  if (!value) {
    throw new Error('useCameraConnection must be used within a CameraConnectionProvider');
  }
  return value;
}
