import { ActivityIndicator, Linking, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import type { PermissionResponse } from 'expo-camera';
import { Trans } from '@lingui/react/macro';
import type { WifiOcrField } from './types';

type PermissionGateProps = {
  field: WifiOcrField;
  supported: boolean;
  permission: PermissionResponse | null;
  onRequestPermission: () => void;
  onClose: () => void;
};

export function PermissionGate({
  field,
  supported,
  permission,
  onRequestPermission,
  onClose,
}: PermissionGateProps) {
  if (!supported) {
    return (
      <View style={styles.centeredContent}>
        <Text style={styles.message}>
          {field === 'ssid' ? (
            <Trans>
              Text scanning isn&apos;t available on this device. You can still type the Wi-Fi name
              in manually.
            </Trans>
          ) : (
            <Trans>
              Text scanning isn&apos;t available on this device. You can still type the password
              in manually.
            </Trans>
          )}
        </Text>
        <TouchableOpacity style={styles.button} onPress={onClose}>
          <Text style={styles.buttonText}>
            <Trans>Close</Trans>
          </Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (permission === null) {
    return (
      <View style={styles.centeredContent}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <View style={styles.centeredContent}>
      <Text style={styles.message}>
        <Trans>Camera access is needed to scan the Wi-Fi label.</Trans>
      </Text>
      {permission.canAskAgain ? (
        <TouchableOpacity style={styles.button} onPress={onRequestPermission}>
          <Text style={styles.buttonText}>
            <Trans>Grant Camera Access</Trans>
          </Text>
        </TouchableOpacity>
      ) : (
        <TouchableOpacity style={styles.button} onPress={() => Linking.openSettings()}>
          <Text style={styles.buttonText}>
            <Trans>Open Settings</Trans>
          </Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  centeredContent: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    gap: 12,
    backgroundColor: '#fff',
  },
  message: {
    fontSize: 15,
    textAlign: 'center',
    color: '#333',
  },
  button: {
    backgroundColor: '#2a6df4',
    borderRadius: 6,
    padding: 10,
    alignItems: 'center',
  },
  buttonText: {
    color: '#fff',
    fontWeight: '600',
  },
});
