import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { router } from 'expo-router';
import type { WifiOcrField } from './labelOcr/types';

type LabelOcrContextValue = {
  field: WifiOcrField | null;
  beginRead: (field: WifiOcrField, onConfirm: (text: string) => void) => void;
  confirmRead: (text: string) => void;
  cancelRead: () => void;
  /** Unmount-time safety net only (swipe/back-gesture dismiss) — never call from a button,
   * it does not navigate. `cancelRead`/`confirmRead` already popped the route by the time
   * this would run. */
  clearRead: () => void;
};

const LabelOcrContext = createContext<LabelOcrContextValue | null>(null);

export function LabelOcrProvider({ children }: { children: ReactNode }) {
  const [field, setField] = useState<WifiOcrField | null>(null);
  const onConfirmRef = useRef<((text: string) => void) | null>(null);

  const beginRead = useCallback((nextField: WifiOcrField, onConfirm: (text: string) => void) => {
    onConfirmRef.current = onConfirm;
    setField(nextField);
    router.push('/read-label');
  }, []);

  // Don't clear `field` here: router.back() animates the pop over ~250-300ms, during
  // which app/read-label.tsx (and its native header title) is still visible. Clearing it
  // synchronously would flash the header to a fallback value mid-exit-animation. The next
  // beginRead() overwrites it long before it would ever matter again.
  const confirmRead = useCallback((text: string) => {
    onConfirmRef.current?.(text);
    onConfirmRef.current = null;
    router.back();
  }, []);

  const cancelRead = useCallback(() => {
    onConfirmRef.current = null;
    router.back();
  }, []);

  const clearRead = useCallback(() => {
    onConfirmRef.current = null;
    setField(null);
  }, []);

  const value = useMemo(
    () => ({ field, beginRead, confirmRead, cancelRead, clearRead }),
    [field, beginRead, confirmRead, cancelRead, clearRead],
  );

  return <LabelOcrContext.Provider value={value}>{children}</LabelOcrContext.Provider>;
}

export function useLabelOcr(): LabelOcrContextValue {
  const value = useContext(LabelOcrContext);
  if (!value) {
    throw new Error('useLabelOcr must be used within a LabelOcrProvider');
  }
  return value;
}
