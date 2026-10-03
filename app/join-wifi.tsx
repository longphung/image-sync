import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, Text, TextInput, View } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { router, useLocalSearchParams } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { Trans, useLingui } from '@lingui/react/macro';
import { useCameraConnection } from '../src/CameraConnectionContext';
import { ActionButton } from '../src/components/ActionButton';
import { Card } from '../src/components/Card';
import { isTextRecognitionSupported } from '../src/ocr';
import { colors } from '../src/theme/colors';
import { useWifiScan } from '../src/WifiScanContext';
import {
  isSecuredNetwork,
  isWepNetwork,
  joinNetwork,
  requestLocationPermission,
  scanNetworks,
  signalSymbol,
  type WifiEntry,
} from '../src/wifi';

const inputStyle = {
  flex: 1,
  color: colors.label,
  fontSize: 16,
  paddingVertical: 10,
} as const;

const fieldStyle = {
  flexDirection: 'row',
  alignItems: 'center',
  gap: 8,
  backgroundColor: colors.fill,
  borderRadius: 10,
  borderCurve: 'continuous',
  paddingHorizontal: 12,
} as const;

export default function JoinWifiScreen() {
  const { t } = useLingui();
  const params = useLocalSearchParams<{ manual?: string }>();
  const { connect, refreshWifiSsid } = useCameraConnection();
  const { beginScan } = useWifiScan();
  const ocrSupported = isTextRecognitionSupported();

  // iOS can't list nearby networks, so it's always manual SSID entry there.
  const [manual, setManual] = useState(Platform.OS !== 'android' || params.manual === '1');
  const [networks, setNetworks] = useState<WifiEntry[]>([]);
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);

  const [ssid, setSsid] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);

  const handleScan = useCallback(
    async (force: boolean) => {
      setScanning(true);
      setScanError(null);
      try {
        const granted = await requestLocationPermission();
        if (!granted) {
          setScanError(t`Location permission was denied.`);
          return;
        }
        setNetworks(await scanNetworks(force));
      } catch (err) {
        setScanError(err instanceof Error ? err.message : String(err));
      } finally {
        setScanning(false);
      }
    },
    [t],
  );

  useEffect(() => {
    if (!manual) handleScan(false);
    // Only auto-scan once on open; later scans are user-triggered.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectSsid = useCallback((next: string) => {
    setSsid(next);
    setPassword('');
    setJoinError(null);
  }, []);

  const handleJoin = useCallback(async () => {
    const target = ssid.trim();
    if (!target) return;
    setJoining(true);
    setJoinError(null);
    try {
      const selected = networks.find((entry) => entry.SSID === target);
      const isWep = selected ? isWepNetwork(selected) : false;
      const needsPassword = selected ? isSecuredNetwork(selected) : password.length > 0;
      await joinNetwork(target, needsPassword ? password : null, isWep, false);
      await refreshWifiSsid(target);
      router.back();
      // Step 2 starts automatically: the home screen shows "Checking camera…", then opens photos.
      connect();
    } catch (err) {
      setJoinError(err instanceof Error ? err.message : String(err));
    } finally {
      setJoining(false);
    }
  }, [ssid, password, networks, refreshWifiSsid, connect]);

  const handleScanSsid = useCallback(() => {
    beginScan('ssid', (text) => {
      setManual(true);
      selectSsid(text);
    });
  }, [beginScan, selectSsid]);

  const handleScanPassword = useCallback(() => {
    beginScan('password', (text) => setPassword(text));
  }, [beginScan]);

  const selectedNetwork = networks.find((entry) => entry.SSID === ssid);

  return (
    <KeyboardAwareScrollView
      contentInsetAdjustmentBehavior="automatic"
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ padding: 16, gap: 16 }}
    >
      {!manual ? (
        <>
          <Text style={{ color: colors.secondaryLabel }}>
            <Trans>Select your camera&apos;s Wi-Fi network.</Trans>
          </Text>
          <ActionButton
            label={scanning ? t`Scanning…` : t`Scan for Camera`}
            onPress={() => handleScan(true)}
            disabled={scanning}
          />
          {scanError && <Text style={{ color: colors.error }}>{scanError}</Text>}

          <Card style={{ paddingVertical: 4, gap: 0 }}>
            <Text style={{ color: colors.secondaryLabel, fontSize: 13, paddingVertical: 8 }}>
              <Trans>Camera networks</Trans>
            </Text>
            {scanning && networks.length === 0 ? (
              <ActivityIndicator style={{ paddingVertical: 16 }} />
            ) : networks.length === 0 ? (
              <Text style={{ color: colors.secondaryLabel, paddingVertical: 12 }}>
                <Trans>No camera networks found. Make sure the camera is in Send to Smartphone mode, then scan again.</Trans>
              </Text>
            ) : (
              networks.map((item) => (
                <NetworkRow
                  key={item.BSSID}
                  entry={item}
                  selected={ssid === item.SSID}
                  onPress={() => selectSsid(item.SSID)}
                />
              ))
            )}
          </Card>

          <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 8 }}>
            <ActionButton label={t`Enter Wi-Fi manually`} variant="text" onPress={() => setManual(true)} />
            {ocrSupported && (
              <ActionButton label={t`Scan Wi-Fi label`} variant="text" onPress={handleScanSsid} />
            )}
          </View>
        </>
      ) : (
        <View style={{ gap: 8 }}>
          <Text style={{ color: colors.secondaryLabel, fontSize: 13 }}>
            <Trans>Wi-Fi name</Trans>
          </Text>
          <View style={fieldStyle}>
            <TextInput
              value={ssid}
              onChangeText={setSsid}
              placeholder={t`Camera SSID (DIRECT-…)`}
              placeholderTextColor={colors.secondaryLabel}
              autoCapitalize="none"
              autoCorrect={false}
              style={inputStyle}
            />
          </View>
          {ocrSupported && (
            <ActionButton
              label={t`Scan Wi-Fi name`}
              variant="secondary"
              systemImage="text.viewfinder"
              onPress={handleScanSsid}
            />
          )}
        </View>
      )}

      {ssid.trim().length > 0 && (
        <View style={{ gap: 12 }}>
          {selectedNetwork && (
            <Card style={{ flexDirection: 'row', alignItems: 'center' }}>
              <NetworkSummary entry={selectedNetwork} />
            </Card>
          )}
          <View style={{ gap: 8 }}>
            <Text style={{ color: colors.secondaryLabel, fontSize: 13 }}>
              <Trans>Wi-Fi password</Trans>
            </Text>
            <View style={fieldStyle}>
              <TextInput
                value={password}
                onChangeText={setPassword}
                placeholder={t`Leave blank for open networks`}
                placeholderTextColor={colors.secondaryLabel}
                autoCapitalize="none"
                autoCorrect={false}
                secureTextEntry={!showPassword}
                style={inputStyle}
              />
              <Pressable
                onPress={() => setShowPassword((v) => !v)}
                hitSlop={12}
                accessibilityRole="button"
                accessibilityLabel={showPassword ? t`Hide password` : t`Show password`}
              >
                <SymbolView
                  name={
                    showPassword
                      ? { ios: 'eye.slash', android: 'visibility_off' }
                      : { ios: 'eye', android: 'visibility' }
                  }
                  size={22}
                  tintColor={colors.secondaryLabel}
                />
              </Pressable>
            </View>
          </View>
          {ocrSupported && (
            <ActionButton
              label={t`Scan password`}
              variant="secondary"
              systemImage="text.viewfinder"
              onPress={handleScanPassword}
            />
          )}
          <ActionButton
            label={joining ? t`Joining…` : t`Join ${ssid}`}
            onPress={handleJoin}
            disabled={joining}
          />
          {joinError && (
            <Text style={{ color: colors.error }} selectable>
              {joinError}
            </Text>
          )}
          {Platform.OS === 'android' && (
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <SymbolView name={{ ios: 'info.circle', android: 'info' }} size={18} tintColor={colors.secondaryLabel} />
              <Text style={{ flex: 1, color: colors.secondaryLabel, fontSize: 13 }}>
                <Trans>Android will also route this app&apos;s traffic over this Wi-Fi network (it has no internet).</Trans>
              </Text>
            </View>
          )}
        </View>
      )}
    </KeyboardAwareScrollView>
  );
}

function NetworkSummary({ entry }: { entry: WifiEntry }) {
  return (
    <>
      <SymbolView
        name={{ ios: 'wifi', android: signalSymbol(entry.level) }}
        size={24}
        tintColor={colors.label}
        style={{ marginRight: 12 }}
      />
      <View style={{ flex: 1 }}>
        <Text style={{ color: colors.label, fontSize: 16 }} numberOfLines={1}>
          {entry.SSID}
        </Text>
        <Text style={{ color: colors.secondaryLabel, fontSize: 13 }}>
          {isSecuredNetwork(entry) ? <Trans>Secured</Trans> : <Trans>Open</Trans>} ·{' '}
          <Trans>{entry.level} dBm</Trans>
        </Text>
      </View>
    </>
  );
}

function NetworkRow({
  entry,
  selected,
  onPress,
}: {
  entry: WifiEntry;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      android_ripple={{ color: colors.fill }}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 12,
        borderTopWidth: 0.5,
        borderTopColor: colors.separator,
      }}
    >
      <NetworkSummary entry={entry} />
      <SymbolView
        name={{
          ios: selected ? 'checkmark.circle.fill' : 'circle',
          android: selected ? 'radio_button_checked' : 'radio_button_unchecked',
        }}
        size={22}
        tintColor={selected ? colors.tint : colors.secondaryLabel}
      />
    </Pressable>
  );
}
