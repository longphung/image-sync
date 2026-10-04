import { PermissionsAndroid, Platform } from 'react-native';
import WifiManager, { LOAD_WIFI_LIST_ERRORS, type WifiEntry } from 'react-native-wifi-reborn';

export type { WifiEntry };

export async function requestLocationPermission(): Promise<boolean> {
  if (Platform.OS !== 'android') {
    return true;
  }
  const granted = await PermissionsAndroid.request(
    PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
    {
      title: 'Location permission',
      message: 'Android requires location permission to search for nearby Wi-Fi networks.',
      buttonPositive: 'OK',
    },
  );
  return granted === PermissionsAndroid.RESULTS.GRANTED;
}

function describeSearchError(err: unknown): string {
  const code = (err as { code?: string })?.code;
  switch (code) {
    case LOAD_WIFI_LIST_ERRORS.locationPermissionMissing:
      return 'Location permission is required to search for Wi-Fi networks.';
    case LOAD_WIFI_LIST_ERRORS.locationServicesOff:
      return 'Turn on location services to search for Wi-Fi networks.';
    default:
      return err instanceof Error ? err.message : String(err);
  }
}

export async function searchNetworks(force: boolean): Promise<WifiEntry[]> {
  try {
    const list = await (force ? WifiManager.reScanAndLoadWifiList() : WifiManager.loadWifiList());
    return list.filter((entry) => entry.SSID.startsWith('DIRECT-'));
  } catch (err) {
    throw new Error(describeSearchError(err));
  }
}

export function isSecuredNetwork(entry: WifiEntry): boolean {
  return /WPA|WEP|EAP/i.test(entry.capabilities);
}

export function isWepNetwork(entry: WifiEntry): boolean {
  return /WEP/i.test(entry.capabilities) && !/WPA/i.test(entry.capabilities);
}

// The camera's AP has no internet. Without forcing usage, Android 9+'s multi-network
// policy can keep routing this app's HTTP calls over mobile data even though the SSID
// join above succeeded - don't remove this call.
export async function joinNetwork(
  ssid: string,
  password: string | null,
  isWep: boolean,
  isHidden: boolean,
): Promise<void> {
  await WifiManager.connectToProtectedSSID(ssid, password, isWep, isHidden);
  if (Platform.OS === 'android') {
    await WifiManager.forceWifiUsageWithOptions(true, { noInternet: true });
  }
}

// Reading the SSID needs location permission (both platforms) — treat any failure as
// "unknown" rather than an error; it's only used for status display.
export async function getCurrentSsid(): Promise<string | null> {
  try {
    const ssid = await WifiManager.getCurrentWifiSSID();
    return ssid && ssid !== '<unknown ssid>' ? ssid : null;
  } catch {
    return null;
  }
}

/** Material Symbol name for an RSSI reading (dBm). */
export function signalSymbol(level: number) {
  if (level >= -55) return 'network_wifi' as const;
  if (level >= -67) return 'network_wifi_3_bar' as const;
  if (level >= -78) return 'network_wifi_2_bar' as const;
  return 'network_wifi_1_bar' as const;
}
