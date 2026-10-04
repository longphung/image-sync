import { useCallback, useRef, useState, type RefObject } from 'react';
import type { CameraView } from 'expo-camera';
import { useLingui } from '@lingui/react/macro';
import { extractTextLines } from '../ocr';
import type { CaptureState } from './types';

type WifiOcrCapture = {
  capture: CaptureState;
  cameraRef: RefObject<CameraView | null>;
  cameraReady: boolean;
  handleCapture: () => Promise<void>;
  handleCameraReady: () => void;
  handleRetake: () => void;
  handleSelectLine: (line: string) => void;
  handleTextChange: (text: string) => void;
};

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

export function useWifiOcrCapture(): WifiOcrCapture {
  const { t } = useLingui();
  const [capture, setCapture] = useState<CaptureState>({ kind: 'camera-ready' });
  const [cameraReady, setCameraReady] = useState(false);
  const cameraRef = useRef<CameraView>(null);

  const handleCameraReady = useCallback(() => setCameraReady(true), []);

  const handleCapture = useCallback(async () => {
    const cam = cameraRef.current;
    if (!cam || !cameraReady) {
      if (__DEV__) {
        console.warn(
          '[useWifiOcrCapture] handleCapture fired while camera not ready — should be unreachable once the shutter is gated on cameraReady',
        );
      }
      return;
    }
    try {
      const photo = await withTimeout(
        cam.takePictureAsync({ quality: 0.8, skipProcessing: true }),
        10_000,
        t`Camera took too long to respond. Please try again.`,
      );
      if (!photo?.uri) throw new Error(t`Failed to capture photo.`);
      setCameraReady(false);
      setCapture({ kind: 'recognizing', photoUri: photo.uri });
      const lines = await extractTextLines(photo.uri);
      setCapture({ kind: 'reviewing', photoUri: photo.uri, lines, text: lines[0] ?? '' });
    } catch (err) {
      setCapture({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  }, [t, cameraReady]);

  const handleRetake = useCallback(() => {
    setCameraReady(false);
    setCapture({ kind: 'camera-ready' });
  }, []);

  const handleSelectLine = useCallback((line: string) => {
    setCapture((c) => (c.kind === 'reviewing' ? { ...c, text: line } : c));
  }, []);

  const handleTextChange = useCallback((text: string) => {
    setCapture((c) => (c.kind === 'reviewing' ? { ...c, text } : c));
  }, []);

  return {
    capture,
    cameraRef,
    cameraReady,
    handleCapture,
    handleCameraReady,
    handleRetake,
    handleSelectLine,
    handleTextChange,
  };
}
