import { type RefObject } from 'react';
import { ActivityIndicator, Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { CameraView } from 'expo-camera';
import { Trans } from '@lingui/react/macro';
import type { CaptureState, WifiOcrField } from './types';

type CameraCaptureViewProps = {
  field: WifiOcrField;
  cameraRef: RefObject<CameraView | null>;
  capture: CaptureState;
  cameraReady: boolean;
  onCameraReady: () => void;
  onCapture: () => void;
};

export function CameraCaptureView({
  field,
  cameraRef,
  capture,
  cameraReady,
  onCameraReady,
  onCapture,
}: CameraCaptureViewProps) {
  const showLiveCamera = capture.kind === 'camera-ready' || capture.kind === 'error';
  const frozenPhotoUri =
    capture.kind === 'recognizing' || capture.kind === 'reviewing' ? capture.photoUri : null;
  const showOverlay = capture.kind === 'camera-ready';

  return (
    <View style={StyleSheet.absoluteFill}>
      {showLiveCamera ? (
        <CameraView
          ref={cameraRef}
          style={StyleSheet.absoluteFill}
          facing="back"
          onCameraReady={onCameraReady}
        />
      ) : frozenPhotoUri ? (
        <Image source={{ uri: frozenPhotoUri }} style={StyleSheet.absoluteFill} resizeMode="cover" />
      ) : null}
      {showOverlay && (
        <View style={styles.captureOverlay}>
          <Text style={styles.instructions}>
            {field === 'ssid' ? (
              <Trans>Point the camera at the Wi-Fi name on the label, then tap capture.</Trans>
            ) : (
              <Trans>Point the camera at the password on the label, then tap capture.</Trans>
            )}
          </Text>
          {cameraReady ? (
            <TouchableOpacity style={styles.shutterButton} onPress={onCapture} />
          ) : (
            <View style={styles.preparingRow}>
              <ActivityIndicator color="#fff" />
              <Text style={styles.preparingText}>
                <Trans>Preparing camera…</Trans>
              </Text>
            </View>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  captureOverlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    alignItems: 'center',
    paddingBottom: 40,
    paddingHorizontal: 24,
    gap: 16,
  },
  instructions: {
    color: '#fff',
    textAlign: 'center',
    fontSize: 14,
    backgroundColor: 'rgba(0,0,0,0.4)',
    padding: 8,
    borderRadius: 6,
  },
  shutterButton: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: '#fff',
    borderWidth: 4,
    borderColor: 'rgba(255,255,255,0.5)',
  },
  preparingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  preparingText: {
    color: '#fff',
  },
});
