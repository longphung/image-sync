import { useCallback, useEffect, useRef } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, Stack } from 'expo-router';
import { useCameraPermissions } from 'expo-camera';
import { Trans, useLingui } from '@lingui/react/macro';
import { useLabelOcr } from '../src/LabelOcrContext';
import { isTextRecognitionSupported } from '../src/ocr';
import { useWifiOcrCapture } from '../src/labelOcr/useWifiOcrCapture';
import { PermissionGate } from '../src/labelOcr/PermissionGate';
import { CameraCaptureView } from '../src/labelOcr/CameraCaptureView';
import { ReviewSheet } from '../src/labelOcr/ReviewSheet';
import { colors } from '../src/theme/colors';

function CancelHeaderButton({ onPress }: { onPress: () => void }) {
  return (
    <TouchableOpacity onPress={onPress} hitSlop={12}>
      <Text style={styles.cancelText}>
        <Trans>Cancel</Trans>
      </Text>
    </TouchableOpacity>
  );
}

export default function ReadLabelScreen() {
  const { t } = useLingui();
  const { field, confirmRead, cancelRead, clearRead } = useLabelOcr();
  const supported = isTextRecognitionSupported();
  const [permission, requestPermission] = useCameraPermissions();
  const {
    capture,
    cameraRef,
    cameraReady,
    handleCapture,
    handleCameraReady,
    handleRetake,
    handleSelectLine,
    handleTextChange,
  } = useWifiOcrCapture();
  const settledRef = useRef(false);

  useEffect(() => {
    if (!field) router.back();
  }, [field]);

  useEffect(() => {
    return () => {
      // If the modal was dismissed via swipe/back rather than Cancel/Confirm, the route is
      // already popping — clearRead() only resets shared context state, it must not call
      // router.back() again (cancelRead()/confirmRead() would double-pop).
      if (!settledRef.current) clearRead();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleCancel = useCallback(() => {
    settledRef.current = true;
    cancelRead();
  }, [cancelRead]);

  const handleConfirm = useCallback(
    (text: string) => {
      settledRef.current = true;
      confirmRead(text);
    },
    [confirmRead],
  );

  if (!field) return null;

  const gated = !supported || permission === null || !permission.granted;
  const title = field === 'ssid' ? t`Read Wi-Fi Name` : t`Read Wi-Fi Password`;

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
              capture={capture}
              cameraReady={cameraReady}
              onCameraReady={handleCameraReady}
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
    color: colors.tint,
    fontWeight: '600',
    fontSize: 16,
  },
});
