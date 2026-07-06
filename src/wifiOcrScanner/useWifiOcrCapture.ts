import { useCallback, useRef, useState, type RefObject } from 'react';
import type { CameraView } from 'expo-camera';
import { useLingui } from '@lingui/react/macro';
import { extractTextLines } from '../ocr';
import type { CaptureState } from './types';

type WifiOcrCapture = {
  capture: CaptureState;
  cameraRef: RefObject<CameraView | null>;
  handleCapture: () => Promise<void>;
  handleRetake: () => void;
  handleSelectLine: (line: string) => void;
  handleTextChange: (text: string) => void;
};

export function useWifiOcrCapture(): WifiOcrCapture {
  const { t } = useLingui();
  const [capture, setCapture] = useState<CaptureState>({ kind: 'camera-ready' });
  const cameraRef = useRef<CameraView>(null);

  const handleCapture = useCallback(async () => {
    const cam = cameraRef.current;
    if (!cam) return;
    try {
      const photo = await cam.takePictureAsync({ quality: 0.8, skipProcessing: true });
      if (!photo?.uri) throw new Error(t`Failed to capture photo.`);
      setCapture({ kind: 'recognizing', photoUri: photo.uri });
      const lines = await extractTextLines(photo.uri);
      setCapture({ kind: 'reviewing', photoUri: photo.uri, lines, text: lines[0] ?? '' });
    } catch (err) {
      setCapture({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  }, [t]);

  const handleRetake = useCallback(() => setCapture({ kind: 'camera-ready' }), []);

  const handleSelectLine = useCallback((line: string) => {
    setCapture((c) => (c.kind === 'reviewing' ? { ...c, text: line } : c));
  }, []);

  const handleTextChange = useCallback((text: string) => {
    setCapture((c) => (c.kind === 'reviewing' ? { ...c, text } : c));
  }, []);

  return { capture, cameraRef, handleCapture, handleRetake, handleSelectLine, handleTextChange };
}
