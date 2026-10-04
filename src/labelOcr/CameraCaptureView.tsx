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
        <View style={styles.frameContainer} pointerEvents="none">
          <View style={styles.frame}>
            <View style={[styles.corner, styles.topLeft]} />
            <View style={[styles.corner, styles.topRight]} />
            <View style={[styles.corner, styles.bottomLeft]} />
            <View style={[styles.corner, styles.bottomRight]} />
          </View>
        </View>
      )}
      {showOverlay && (
        <View style={styles.captureOverlay}>
          <Text style={styles.instructions}>
            {field === 'ssid' ? (
              <Trans>Align the Wi-Fi name on the camera label inside the frame, then tap capture.</Trans>
            ) : (
              <Trans>Align the password on the camera label inside the frame, then tap capture.</Trans>
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

const CORNER = 28;

const styles = StyleSheet.create({
  frameContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    // Keep the frame clear of the instructions + shutter at the bottom.
    paddingBottom: 160,
  },
  frame: {
    width: '80%',
    aspectRatio: 1.6,
  },
  corner: {
    position: 'absolute',
    width: CORNER,
    height: CORNER,
    borderColor: '#fff',
  },
  topLeft: { top: 0, left: 0, borderTopWidth: 3, borderLeftWidth: 3, borderTopLeftRadius: 8 },
  topRight: { top: 0, right: 0, borderTopWidth: 3, borderRightWidth: 3, borderTopRightRadius: 8 },
  bottomLeft: { bottom: 0, left: 0, borderBottomWidth: 3, borderLeftWidth: 3, borderBottomLeftRadius: 8 },
  bottomRight: {
    bottom: 0,
    right: 0,
    borderBottomWidth: 3,
    borderRightWidth: 3,
    borderBottomRightRadius: 8,
  },
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
    fontSize: 15,
    backgroundColor: 'rgba(0,0,0,0.45)',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    borderCurve: 'continuous',
    overflow: 'hidden',
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
