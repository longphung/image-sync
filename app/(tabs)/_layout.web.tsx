import { NativeTabs } from 'expo-router/unstable-native-tabs';
import { useLingui } from '@lingui/react/macro';

// The web build is served by a desktop hub; a browser can't reach the camera (plain http on its
// own Wi-Fi, no CORS), so only the Desktop tab exists.
export default function TabsLayout() {
  const { t } = useLingui();
  return (
    <NativeTabs>
      <NativeTabs.Trigger name="(desktops)">
        <NativeTabs.Trigger.Label>{t`Desktop`}</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="desktopcomputer" md="computer" />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
