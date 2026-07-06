import { useCallback, useEffect, useRef } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, Stack } from 'expo-router';
import { useCameraPermissions } from 'expo-camera';
import { Trans, useLingui } from '@lingui/react/macro';
import { useWifiScan } from '../src/WifiScanContext';
import { isTextRecognitionSupported } from '../src/ocr';
import { useWifiOcrCapture } from '../src/wifiOcrScanner/useWifiOcrCapture';
import { PermissionGate } from '../src/wifiOcrScanner/PermissionGate';
import { CameraCaptureView } from '../src/wifiOcrScanner/CameraCaptureView';
import { ReviewSheet } from '../src/wifiOcrScanner/ReviewSheet';

function CancelHeaderButton({ onPress }: { onPress: () => void }) {
  return (
    <TouchableOpacity onPress={onPress} hitSlop={12}>
      <Text style={styles.cancelText}>
        <Trans>Cancel</Trans>
      </Text>
    </TouchableOpacity>
  );
}

export default function ScanWifiScreen() {
  const { t } = useLingui();
  const { field, confirmScan, cancelScan, clearScan } = useWifiScan();
  const supported = isTextRecognitionSupported();
  const [permission, requestPermission] = useCameraPermissions();
  const { capture, cameraRef, handleCapture, handleRetake, handleSelectLine, handleTextChange } =
    useWifiOcrCapture();
  const settledRef = useRef(false);

  useEffect(() => {
    if (!field) router.back();
  }, [field]);

  useEffect(() => {
    return () => {
      // If the modal was dismissed via swipe/back rather than Cancel/Confirm, the route is
      // already popping — clearScan() only resets shared context state, it must not call
      // router.back() again (cancelScan()/confirmScan() would double-pop).
      if (!settledRef.current) clearScan();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleCancel = useCallback(() => {
    settledRef.current = true;
    cancelScan();
  }, [cancelScan]);

  const handleConfirm = useCallback(
    (text: string) => {
      settledRef.current = true;
      confirmScan(text);
    },
    [confirmScan],
  );

  if (!field) return null;

  const gated = !supported || permission === null || !permission.granted;
  const title = field === 'ssid' ? t`Scan Wi-Fi Name` : t`Scan Wi-Fi Password`;

  return (
    <>
      <Stack.Screen
        options={{
          title,
          headerLeft: () => <CancelHeaderButton onPress={handleCancel} />,
        }}
      />
      <SafeAreaView style={styles.safeArea} edges={['bottom', 'left', 'right']}>
        {gated ? (
          <PermissionGate
            field={field}
            supported={supported}
            permission={permission}
            onRequestPermission={requestPermission}
            onClose={handleCancel}
          />
        ) : (
          <View style={styles.cameraScreen}>
            <CameraCaptureView
              field={field}
              cameraRef={cameraRef}
              showOverlay={capture.kind === 'camera-ready'}
              onCapture={handleCapture}
            />
            <ReviewSheet
              capture={capture}
              onSelectLine={handleSelectLine}
              onChangeText={handleTextChange}
              onRetake={handleRetake}
              onConfirm={handleConfirm}
            />
          </View>
        )}
      </SafeAreaView>
    </>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#000',
  },
  cameraScreen: {
    flex: 1,
  },
  cancelText: {
    color: '#2a6df4',
    fontWeight: '600',
    fontSize: 16,
  },
});
