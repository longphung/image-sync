import { useCallback, useEffect } from 'react';
import { ActivityIndicator, Alert, Platform, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { router, useFocusEffect } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { Trans, useLingui } from '@lingui/react/macro';
import { useCameraConnection } from '../src/CameraConnectionContext';
import { ActionButton } from '../src/components/ActionButton';
import { Card } from '../src/components/Card';
import { colors } from '../src/theme/colors';

export default function ConnectScreen() {
  const { t } = useLingui();
  const insets = useSafeAreaInsets();
  const { host, setHost, status, cameraName, errorMessage, connect, wifiSsid, refreshWifiSsid } =
    useCameraConnection();

  useEffect(() => {
    if (status === 'connected') {
      router.push('/images');
    }
  }, [status]);

  useFocusEffect(
    useCallback(() => {
      refreshWifiSsid();
    }, [refreshWifiSsid]),
  );

  const showHelp = useCallback(() => {
    Alert.alert(
      t`Connecting to your camera`,
      t`On the camera, choose "Send to Smartphone" so it starts its own Wi-Fi network (named DIRECT-…). The network name and password are shown on the camera screen. Join that network here, then tap Connect.`,
    );
  }, [t]);

  return (
    <KeyboardAwareScrollView
      contentInsetAdjustmentBehavior="automatic"
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ padding: 16, paddingBottom: 16 + insets.bottom, gap: 16 }}
    >
      <Text style={{ color: colors.secondaryLabel, fontSize: 15 }}>
        <Trans>Transfer photos from your Sony camera to your phone.</Trans>
      </Text>

      <Card>
        <StepHeader
          icon={{ ios: 'wifi', android: 'wifi' }}
          step={t`1. Camera Wi-Fi`}
          title={wifiSsid ? wifiSsid : t`Not connected`}
          connected={!!wifiSsid}
        />
        <Text style={{ color: colors.secondaryLabel }}>
          {wifiSsid ? (
            <Trans>Your phone is on this Wi-Fi network.</Trans>
          ) : (
            <Trans>Join your camera&apos;s Wi-Fi network (DIRECT-…).</Trans>
          )}
        </Text>
        {Platform.OS === 'android' ? (
          <>
            <ActionButton
              label={t`Search for Camera`}
              onPress={() => router.push('/join-wifi')}
            />
            <ActionButton
              label={t`Enter Wi-Fi Manually`}
              variant="secondary"
              onPress={() => router.push({ pathname: '/join-wifi', params: { manual: '1' } })}
            />
          </>
        ) : (
          <ActionButton
            label={t`Join Camera Wi-Fi`}
            systemImage="wifi"
            variant={wifiSsid ? 'secondary' : 'primary'}
            onPress={() => router.push('/join-wifi')}
          />
        )}
      </Card>

      <Card>
        <StepHeader
          icon={{ ios: 'camera', android: 'photo_camera' }}
          step={t`2. Camera`}
          title={
            status === 'connected'
              ? (cameraName ?? t`Connected`)
              : status === 'connecting'
                ? t`Checking camera…`
                : t`Not connected`
          }
          connected={status === 'connected'}
          loading={status === 'connecting'}
        />
        {errorMessage ? (
          <Text style={{ color: colors.error }} selectable>
            {errorMessage}
          </Text>
        ) : (
          <Text style={{ color: colors.secondaryLabel }}>
            <Trans>Connect to the camera at this address.</Trans>
          </Text>
        )}
        <View style={{ gap: 4 }}>
          <Text style={{ color: colors.secondaryLabel, fontSize: 13 }}>
            <Trans>Host IP</Trans>
          </Text>
          <TextInput
            value={host}
            onChangeText={setHost}
            placeholder="192.168.122.1"
            placeholderTextColor={colors.secondaryLabel}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="numbers-and-punctuation"
            style={{
              color: colors.label,
              backgroundColor: colors.fill,
              borderRadius: 10,
              borderCurve: 'continuous',
              paddingHorizontal: 12,
              paddingVertical: 10,
              fontSize: 16,
            }}
          />
        </View>
        {status === 'connected' ? (
          <ActionButton label={t`Open Photos`} onPress={() => router.push('/images')} />
        ) : (
          <ActionButton
            label={t`Connect`}
            onPress={connect}
            disabled={status === 'connecting'}
            variant={wifiSsid ? 'primary' : 'secondary'}
          />
        )}
      </Card>

      <View style={{ alignItems: 'flex-start' }}>
        <ActionButton label={t`Need help?`} variant="text" onPress={showHelp} />
      </View>
    </KeyboardAwareScrollView>
  );
}

function StepHeader({
  icon,
  step,
  title,
  connected,
  loading,
}: {
  icon: React.ComponentProps<typeof SymbolView>['name'];
  step: string;
  title: string;
  connected: boolean;
  loading?: boolean;
}) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
      <SymbolView name={icon} size={28} tintColor={connected ? colors.success : colors.tint} />
      <View style={{ flex: 1 }}>
        <Text style={{ color: colors.secondaryLabel, fontSize: 12, textTransform: 'uppercase' }}>
          {step}
        </Text>
        <Text style={{ color: colors.label, fontSize: 17, fontWeight: '600' }} numberOfLines={1}>
          {title}
        </Text>
      </View>
      {loading ? (
        <ActivityIndicator />
      ) : connected ? (
        <SymbolView
          name={{ ios: 'checkmark.circle.fill', android: 'check_circle' }}
          size={22}
          tintColor={colors.success}
        />
      ) : null}
    </View>
  );
}
