import '../src/i18n';
import { i18n } from '../src/i18n';
import { I18nProvider } from '@lingui/react';
import { useLingui } from '@lingui/react/macro';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { CameraConnectionProvider } from '../src/CameraConnectionContext';
import { WifiScanProvider } from '../src/WifiScanContext';
import { colors } from '../src/theme/colors';

function AppNavigator() {
  const { t } = useLingui();
  return (
    <Stack screenOptions={{ contentStyle: { backgroundColor: colors.background } }}>
      <Stack.Screen name="index" options={{ title: 'image-sync', headerLargeTitle: true }} />
      <Stack.Screen name="join-wifi" options={{ title: t`Join Camera Wi-Fi` }} />
      <Stack.Screen name="images" options={{ title: t`Images` }} />
      <Stack.Screen
        name="sync"
        options={{ title: t`Sync All`, presentation: 'fullScreenModal', gestureEnabled: false }}
      />
      <Stack.Screen
        name="image/[filename]"
        options={{
          title: t`Image`,
          headerTransparent: true,
          headerTintColor: '#fff',
          contentStyle: { backgroundColor: '#000' },
        }}
      />
      <Stack.Screen name="scan-wifi" options={{ title: t`Scan Wi-Fi`, presentation: 'modal' }} />
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <KeyboardProvider>
          <CameraConnectionProvider>
            <WifiScanProvider>
              <I18nProvider i18n={i18n}>
                <StatusBar style="auto" />
                <AppNavigator />
              </I18nProvider>
            </WifiScanProvider>
          </CameraConnectionProvider>
        </KeyboardProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
