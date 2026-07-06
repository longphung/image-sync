export type WifiOcrField = 'ssid' | 'password';

export type CaptureState =
  | { kind: 'camera-ready' }
  | { kind: 'recognizing'; photoUri: string }
  | { kind: 'reviewing'; photoUri: string; lines: string[]; text: string }
  | { kind: 'error'; message: string };
