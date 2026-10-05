import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import {
  DEFAULT_HOST,
  firstReachable,
  getCameraInfo,
  listImages,
  listImagesDesktop,
  pairDesktop,
  type CameraApi,
  type ImageItem,
  type PairingQr,
} from './camera';
import { errorMessage as messageOf } from './camera/http';
import { loadDesktops, saveDesktops, type PairedDesktop } from './desktops';
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
  /** Paired desktop hubs, persisted across launches. */
  desktops: PairedDesktop[];
  /** Id of the desktop `status` refers to, or null when it's about the camera. */
  desktopId: string | null;
  connectDesktop: (desktop: PairedDesktop) => Promise<void>;
  /** Trades the QR's one-time token for this phone's own token and stores the desktop. */
  pairWithDesktop: (qr: PairingQr) => Promise<PairedDesktop>;
  /** Stores a desktop paired by code, replacing an older entry for the same desktop. */
  addDesktop: (desktop: PairedDesktop) => void;
  forgetDesktop: (id: string) => void;
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

/** How this device shows up in the desktop's paired list and pairing dialog. */
export const PHONE_NAME = Constants.deviceName ?? (Platform.OS === 'web' ? 'Web browser' : Platform.OS);

// Short per-host timeout so an unreachable LAN address doesn't hold up the remote one for 30s.
export const DESKTOP_TIMEOUT_MS = 5_000;

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
  const [desktops, setDesktops] = useState<PairedDesktop[]>(loadDesktops);
  const [desktopId, setDesktopId] = useState<string | null>(null);

  const connect = useCallback(async () => {
    setStatus('connecting');
    setErrorMessage(null);
    setDesktopId(null);
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

  // Listing /images doubles as the reachability check, so its result seeds the grid.
  const connectDesktop = useCallback(async (desktop: PairedDesktop) => {
    setStatus('connecting');
    setErrorMessage(null);
    setDesktopId(desktop.id);
    try {
      const { baseUrl, result } = await firstReachable(desktop.hosts, desktop.port, (url) =>
        listImagesDesktop(url, desktop.token, DESKTOP_TIMEOUT_MS),
      );
      setApi({ kind: 'desktop', baseUrl, token: desktop.token });
      setCameraName(desktop.name);
      // The desktop lists oldest first, like the camera; show newest first.
      setImages(result.reverse());
      setImagesStatus('loaded');
      setImagesError(null);
      setStatus('connected');
    } catch (err) {
      setStatus('error');
      setErrorMessage(messageOf(err));
    }
  }, []);

  const updateDesktops = useCallback((next: (prev: PairedDesktop[]) => PairedDesktop[]) => {
    setDesktops((prev) => {
      const list = next(prev);
      saveDesktops(list);
      return list;
    });
  }, []);

  // Re-pairing the same desktop replaces its entry (and its now-revoked token).
  const addDesktop = useCallback(
    (desktop: PairedDesktop) => updateDesktops((prev) => [...prev.filter((d) => d.id !== desktop.id), desktop]),
    [updateDesktops],
  );

  const pairWithDesktop = useCallback(
    async (qr: PairingQr) => {
      const { result: token } = await firstReachable(qr.hosts, qr.port, (url) =>
        pairDesktop(url, qr.token, PHONE_NAME, DESKTOP_TIMEOUT_MS),
      );
      const desktop: PairedDesktop = { ...qr, token };
      addDesktop(desktop);
      return desktop;
    },
    [addDesktop],
  );

  const forgetDesktop = useCallback(
    (id: string) => updateDesktops((prev) => prev.filter((d) => d.id !== id)),
    [updateDesktops],
  );

  const disconnect = useCallback(() => {
    setApi(null);
    setCameraName(null);
    setImages([]);
    setImagesStatus('idle');
    setImagesError(null);
    setStatus('idle');
    setErrorMessage(null);
    setDesktopId(null);
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
      desktops,
      desktopId,
      connectDesktop,
      pairWithDesktop,
      addDesktop,
      forgetDesktop,
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
      desktops,
      desktopId,
      connectDesktop,
      pairWithDesktop,
      addDesktop,
      forgetDesktop,
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
