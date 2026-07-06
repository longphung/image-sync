import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { router } from 'expo-router';

export type WifiScanField = 'ssid' | 'password';

type WifiScanContextValue = {
  field: WifiScanField | null;
  beginScan: (field: WifiScanField, onConfirm: (text: string) => void) => void;
  confirmScan: (text: string) => void;
  cancelScan: () => void;
  /** Unmount-time safety net only (swipe/back-gesture dismiss) — never call from a button,
   * it does not navigate. `cancelScan`/`confirmScan` already popped the route by the time
   * this would run. */
  clearScan: () => void;
};

const WifiScanContext = createContext<WifiScanContextValue | null>(null);

export function WifiScanProvider({ children }: { children: ReactNode }) {
  const [field, setField] = useState<WifiScanField | null>(null);
  const onConfirmRef = useRef<((text: string) => void) | null>(null);

  const beginScan = useCallback((nextField: WifiScanField, onConfirm: (text: string) => void) => {
    onConfirmRef.current = onConfirm;
    setField(nextField);
    router.push('/scan-wifi');
  }, []);

  // Don't clear `field` here: router.back() animates the pop over ~250-300ms, during
  // which app/scan-wifi.tsx (and its native header title) is still visible. Clearing it
  // synchronously would flash the header to a fallback value mid-exit-animation. The next
  // beginScan() overwrites it long before it would ever matter again.
  const confirmScan = useCallback((text: string) => {
    onConfirmRef.current?.(text);
    onConfirmRef.current = null;
    router.back();
  }, []);

  const cancelScan = useCallback(() => {
    onConfirmRef.current = null;
    router.back();
  }, []);

  const clearScan = useCallback(() => {
    onConfirmRef.current = null;
    setField(null);
  }, []);

  const value = useMemo(
    () => ({ field, beginScan, confirmScan, cancelScan, clearScan }),
    [field, beginScan, confirmScan, cancelScan, clearScan],
  );

  return <WifiScanContext.Provider value={value}>{children}</WifiScanContext.Provider>;
}

export function useWifiScan(): WifiScanContextValue {
  const value = useContext(WifiScanContext);
  if (!value) {
    throw new Error('useWifiScan must be used within a WifiScanProvider');
  }
  return value;
}
