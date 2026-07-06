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
      message: 'Android requires location permission to scan for nearby Wi-Fi networks.',
      buttonPositive: 'OK',
    },
  );
  return granted === PermissionsAndroid.RESULTS.GRANTED;
}

function describeScanError(err: unknown): string {
  const code = (err as { code?: string })?.code;
  switch (code) {
    case LOAD_WIFI_LIST_ERRORS.locationPermissionMissing:
      return 'Location permission is required to scan for Wi-Fi networks.';
    case LOAD_WIFI_LIST_ERRORS.locationServicesOff:
      return 'Turn on location services to scan for Wi-Fi networks.';
    default:
      return err instanceof Error ? err.message : String(err);
  }
}

export async function scanNetworks(force: boolean): Promise<WifiEntry[]> {
  try {
    return await (force ? WifiManager.reScanAndLoadWifiList() : WifiManager.loadWifiList());
  } catch (err) {
    throw new Error(describeScanError(err));
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
