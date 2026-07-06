import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { CameraApi, getCameraApi } from 'image-sync-core';

export type ConnectionStatus = 'idle' | 'connecting' | 'connected' | 'error';

type CameraConnectionValue = {
  host: string;
  setHost: (host: string) => void;
  status: ConnectionStatus;
  api: CameraApi | null;
  errorMessage: string | null;
  connect: () => void;
  disconnect: () => void;
};

const CameraConnectionContext = createContext<CameraConnectionValue | null>(null);

// This is intentionally memory-only (no AsyncStorage): `CameraApi` is a live uniffi
// object tied to the current JS process, not something meaningful to persist/restore.
// It resets on every JS reload, which is why app/images.tsx guards against a null api.
export function CameraConnectionProvider({ children }: { children: ReactNode }) {
  const [host, setHost] = useState('192.168.122.1');
  const [status, setStatus] = useState<ConnectionStatus>('idle');
  const [api, setApi] = useState<CameraApi | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const connect = useCallback(() => {
    setStatus('connecting');
    setErrorMessage(null);
    try {
      const trimmed = host.trim();
      const resolved = getCameraApi(trimmed.length > 0 ? trimmed : undefined);
      setApi(resolved);
      setStatus('connected');
    } catch (err) {
      setStatus('error');
      setErrorMessage(err instanceof Error ? err.message : String(err));
    }
  }, [host]);

  const disconnect = useCallback(() => {
    setApi(null);
    setStatus('idle');
    setErrorMessage(null);
  }, []);

  const value = useMemo(
    () => ({ host, setHost, status, api, errorMessage, connect, disconnect }),
    [host, status, api, errorMessage, connect, disconnect],
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
