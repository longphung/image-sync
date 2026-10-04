import '../src/i18n';
import { i18n } from '../src/i18n';
import { I18nProvider } from '@lingui/react';
import { useLingui } from '@lingui/react/macro';
import { Stack } from 'expo-router';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { CameraConnectionProvider } from '../src/CameraConnectionContext';
import { LabelOcrProvider } from '../src/LabelOcrContext';
import { colors } from '../src/theme/colors';

function AppNavigator() {
  const { t } = useLingui();
  return (
    // Status bar is driven per screen by react-native-screens (statusBarStyle), not
    // expo-status-bar: it works with both the iOS scene lifecycle and Android edge-to-edge.
    <Stack screenOptions={{ contentStyle: { backgroundColor: colors.background }, statusBarStyle: 'auto' }}>
      <Stack.Screen name="(tabs)" options={{ headerShown: false, title: 'image-sync' }} />
      <Stack.Screen name="join-wifi" options={{ title: t`Join Camera Wi-Fi` }} />
      <Stack.Screen name="images" options={{ title: t`Images` }} />
      <Stack.Screen
        name="sync"
        options={{ title: t`Sync All`, presentation: 'fullScreenModal', gestureEnabled: false }}
      />
      <Stack.Screen
        name="image/[filename]"
        options={{
          title: t`Media`,
          headerTransparent: true,
          statusBarStyle: 'light',
          headerTintColor: '#fff',
          contentStyle: { backgroundColor: '#000' },
        }}
      />
      <Stack.Screen name="read-label" options={{ title: t`Read Wi-Fi Label`, presentation: 'modal' }} />
      <Stack.Screen name="scan-pairing" options={{ title: t`Pair with Desktop`, presentation: 'modal' }} />
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <KeyboardProvider>
          <CameraConnectionProvider>
            <LabelOcrProvider>
              <I18nProvider i18n={i18n}>
                <AppNavigator />
              </I18nProvider>
            </LabelOcrProvider>
          </CameraConnectionProvider>
        </KeyboardProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
