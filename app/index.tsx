import { useCallback, useEffect, useState } from 'react';
import { Platform, StyleSheet, Text, TextInput, TouchableOpacity } from 'react-native';
import { LegendList } from '@legendapp/list/react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Trans, useLingui } from '@lingui/react/macro';
import { useCameraConnection } from '../src/CameraConnectionContext';
import {
  isSecuredNetwork,
  isWepNetwork,
  joinNetwork,
  requestLocationPermission,
  scanNetworks,
  type WifiEntry,
} from '../src/wifi';

export default function ConnectScreen() {
  const { t } = useLingui();
  const { host, setHost, status, errorMessage, connect } = useCameraConnection();

  const [networks, setNetworks] = useState<WifiEntry[]>([]);
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);

  const [ssid, setSsid] = useState('');
  const [password, setPassword] = useState('');
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);

  useEffect(() => {
    if (status === 'connected') {
      router.push('/images');
    }
  }, [status]);

  const handleScan = useCallback(async (force: boolean) => {
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
  }, [t]);

  const handleSelectNetwork = useCallback((entry: WifiEntry) => {
    setSsid(entry.SSID);
    setPassword('');
    setJoinError(null);
  }, []);

  const handleJoin = useCallback(async () => {
    if (!ssid.trim()) return;
    setJoining(true);
    setJoinError(null);
    try {
      const selected = networks.find((entry) => entry.SSID === ssid);
      const isWep = selected ? isWepNetwork(selected) : false;
      const needsPassword = selected ? isSecuredNetwork(selected) : password.length > 0;
      await joinNetwork(ssid, needsPassword ? password : null, isWep, false);
    } catch (err) {
      setJoinError(err instanceof Error ? err.message : String(err));
    } finally {
      setJoining(false);
    }
  }, [ssid, password, networks]);

  return (
    <SafeAreaView style={styles.safeArea} edges={['bottom', 'left', 'right']}>
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <Text style={styles.title}>
          <Trans>Connect to Camera</Trans>
        </Text>

        {Platform.OS === 'android' ? (
          <>
            <Text style={styles.label}>
              <Trans>1. Join the camera&apos;s Wi-Fi network</Trans>
            </Text>
            <TouchableOpacity
              style={styles.button}
              onPress={() => handleScan(false)}
              disabled={scanning}
            >
              <Text style={styles.buttonText}>
                {scanning ? <Trans>Scanning…</Trans> : <Trans>Scan Wi-Fi</Trans>}
              </Text>
            </TouchableOpacity>
            {networks.length > 0 && (
              <TouchableOpacity
                style={styles.button}
                onPress={() => handleScan(true)}
                disabled={scanning}
              >
                <Text style={styles.buttonText}>
                  <Trans>Rescan</Trans>
                </Text>
              </TouchableOpacity>
            )}
            {scanError && <Text style={styles.error}>{scanError}</Text>}

            <LegendList
              style={styles.networkList}
              data={networks}
              keyExtractor={(entry) => entry.BSSID}
              recycleItems
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={[styles.networkRow, ssid === item.SSID && styles.networkRowSelected]}
                  onPress={() => handleSelectNetwork(item)}
                >
                  <Text>{item.SSID}</Text>
                  <Text style={styles.networkMeta}>
                    {isSecuredNetwork(item) ? <Trans>Secured</Trans> : <Trans>Open</Trans>} ·{' '}
                    <Trans>{item.level} dBm</Trans>
                  </Text>
                </TouchableOpacity>
              )}
            />
          </>
        ) : (
          <>
            <Text style={styles.label}>
              <Trans>1. Type the camera&apos;s Wi-Fi network name and connect</Trans>
            </Text>
            <TextInput
              value={ssid}
              onChangeText={setSsid}
              placeholder={t`Camera SSID`}
              placeholderTextColor="#888"
              autoCapitalize="none"
              autoCorrect={false}
              style={styles.input}
            />
          </>
        )}

        {ssid.length > 0 && (
          <>
            <TextInput
              value={password}
              onChangeText={setPassword}
              placeholder={t`Password (leave blank for open networks)`}
              placeholderTextColor="#888"
              autoCapitalize="none"
              autoCorrect={false}
              secureTextEntry
              style={styles.input}
            />
            <TouchableOpacity style={styles.button} onPress={handleJoin} disabled={joining}>
              <Text style={styles.buttonText}>
                {joining ? <Trans>Joining…</Trans> : <Trans>Join {ssid}</Trans>}
              </Text>
            </TouchableOpacity>
            {joinError && <Text style={styles.error}>{joinError}</Text>}
          </>
        )}

        <Text style={styles.label}>
          <Trans>2. Connect to the camera (fallback: manual IP)</Trans>
        </Text>
        <Text style={styles.label}>
          <Trans>Status: {status}</Trans>
        </Text>
        {errorMessage && <Text style={styles.error}>{errorMessage}</Text>}
        <TextInput
          value={host}
          onChangeText={setHost}
          placeholder="192.168.122.1"
          placeholderTextColor="#888"
          autoCapitalize="none"
          autoCorrect={false}
          style={styles.input}
        />
        <TouchableOpacity style={styles.button} onPress={connect}>
          <Text style={styles.buttonText}>
            <Trans>Connect</Trans>
          </Text>
        </TouchableOpacity>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#fff',
  },
  container: {
    flex: 1,
    paddingTop: 24,
    paddingHorizontal: 16,
  },
  title: {
    fontSize: 20,
    fontWeight: '600',
    marginBottom: 12,
  },
  label: {
    marginTop: 12,
    marginBottom: 4,
    fontWeight: '500',
  },
  error: {
    color: 'red',
    marginBottom: 8,
  },
  input: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 6,
    padding: 8,
    marginBottom: 8,
    color: '#111',
    backgroundColor: '#fff',
  },
  button: {
    backgroundColor: '#2a6df4',
    borderRadius: 6,
    padding: 10,
    alignItems: 'center',
    marginBottom: 8,
  },
  buttonText: {
    color: '#fff',
    fontWeight: '600',
  },
  networkList: {
    maxHeight: 200,
    marginBottom: 8,
  },
  networkRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 8,
    paddingHorizontal: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#ddd',
  },
  networkRowSelected: {
    backgroundColor: '#eef3ff',
  },
  networkMeta: {
    color: '#666',
    fontSize: 12,
  },
});
