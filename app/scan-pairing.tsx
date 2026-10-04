import { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, Linking, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';
import { Trans, useLingui } from '@lingui/react/macro';
import { parsePairingQr } from '../src/camera';
import { errorMessage } from '../src/camera/http';
import { useCameraConnection } from '../src/CameraConnectionContext';
import { ActionButton } from '../src/components/ActionButton';
import { colors } from '../src/theme/colors';

export default function ScanPairingScreen() {
  const { t } = useLingui();
  const [permission, requestPermission] = useCameraPermissions();
  const { pairWithDesktop, connectDesktop } = useCameraConnection();
  const [pairing, setPairing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // onBarcodeScanned fires on every frame; only the first one counts until "Try Again".
  const busy = useRef(false);

  const handleScanned = useCallback(
    async ({ data }: BarcodeScanningResult) => {
      if (busy.current) return;
      busy.current = true;
      setPairing(true);
      try {
        const desktop = await pairWithDesktop(parsePairingQr(data));
        router.back();
        // Like join-wifi: the home screen shows the desktop connecting, then opens its photos.
        connectDesktop(desktop);
      } catch (err) {
        setError(errorMessage(err));
        setPairing(false);
      }
    },
    [pairWithDesktop, connectDesktop],
  );

  const retry = useCallback(() => {
    setError(null);
    busy.current = false;
  }, []);

  if (!permission) return null;

  if (!permission.granted) {
    return (
      <View style={{ flex: 1, padding: 24, gap: 16, justifyContent: 'center' }}>
        <Text style={{ color: colors.label, fontSize: 17, textAlign: 'center' }}>
          <Trans>Camera access is needed to scan the pairing code shown on your computer.</Trans>
        </Text>
        {permission.canAskAgain ? (
          <ActionButton label={t`Allow Camera`} onPress={requestPermission} />
        ) : (
          <ActionButton label={t`Open Settings`} onPress={() => Linking.openSettings()} />
        )}
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: '#000' }}>
      <CameraView
        style={{ flex: 1 }}
        facing="back"
        barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
        onBarcodeScanned={error || pairing ? undefined : handleScanned}
      />
      <SafeAreaView
        edges={['bottom', 'left', 'right']}
        style={{ position: 'absolute', left: 0, right: 0, bottom: 0, padding: 16, gap: 12 }}
      >
        <View style={{ backgroundColor: colors.card, borderRadius: 16, borderCurve: 'continuous', padding: 16, gap: 12 }}>
          {pairing ? (
            <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
              <ActivityIndicator />
              <Text style={{ color: colors.label }}>
                <Trans>Pairing…</Trans>
              </Text>
            </View>
          ) : error ? (
            <>
              <Text style={{ color: colors.error }} selectable>
                {error}
              </Text>
              <ActionButton label={t`Try Again`} onPress={retry} />
            </>
          ) : (
            <Text style={{ color: colors.label }}>
              <Trans>
                Point the camera at the pairing code in the image-sync desktop app (Phone & settings tab).
              </Trans>
            </Text>
          )}
        </View>
      </SafeAreaView>
    </View>
  );
}
