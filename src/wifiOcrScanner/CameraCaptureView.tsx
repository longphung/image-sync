import { type RefObject } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { CameraView } from 'expo-camera';
import { Trans } from '@lingui/react/macro';
import type { WifiOcrField } from './types';

type CameraCaptureViewProps = {
  field: WifiOcrField;
  cameraRef: RefObject<CameraView | null>;
  showOverlay: boolean;
  onCapture: () => void;
};

export function CameraCaptureView({
  field,
  cameraRef,
  showOverlay,
  onCapture,
}: CameraCaptureViewProps) {
  return (
    <View style={StyleSheet.absoluteFill}>
      <CameraView ref={cameraRef} style={StyleSheet.absoluteFill} facing="back" />
      {showOverlay && (
        <View style={styles.captureOverlay}>
          <Text style={styles.instructions}>
            {field === 'ssid' ? (
              <Trans>Point the camera at the Wi-Fi name on the label, then tap capture.</Trans>
            ) : (
              <Trans>Point the camera at the password on the label, then tap capture.</Trans>
            )}
          </Text>
          <TouchableOpacity style={styles.shutterButton} onPress={onCapture} />
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
});
