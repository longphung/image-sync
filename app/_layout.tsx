import '../src/i18n';
import { i18n } from '../src/i18n';
import { I18nProvider } from '@lingui/react';
import { useLingui } from '@lingui/react/macro';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { BottomSheetModalProvider } from '@gorhom/bottom-sheet';
import { CameraConnectionProvider } from '../src/CameraConnectionContext';
import { WifiScanProvider } from '../src/WifiScanContext';

function AppNavigator() {
  const { t } = useLingui();
  return (
    <Stack>
      <Stack.Screen name="index" options={{ title: t`Connect` }} />
      <Stack.Screen name="images" options={{ title: t`Images` }} />
      <Stack.Screen name="image/[filename]" options={{ title: t`Image` }} />
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
              <BottomSheetModalProvider>
                <I18nProvider i18n={i18n}>
                  <StatusBar style="auto" />
                  <AppNavigator />
                </I18nProvider>
              </BottomSheetModalProvider>
            </WifiScanProvider>
          </CameraConnectionProvider>
        </KeyboardProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
