import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { router, useLocalSearchParams } from 'expo-router';
import { Trans, useLingui } from '@lingui/react/macro';
import { desktopBaseUrl, DESKTOP_PORT, pairWithCode, PairCodeError, parseHostPort, requestPairCode } from '../src/camera';
import { errorMessage } from '../src/camera/http';
import { DESKTOP_TIMEOUT_MS, PHONE_NAME, useCameraConnection } from '../src/CameraConnectionContext';
import { ActionButton } from '../src/components/ActionButton';
import { loadLastPairAddress, saveLastPairAddress } from '../src/desktops';
import { Card } from '../src/components/Card';
import { colors } from '../src/theme/colors';

const inputStyle = {
  color: colors.label,
  backgroundColor: colors.fill,
  borderRadius: 10,
  borderCurve: 'continuous',
  paddingHorizontal: 12,
  paddingVertical: 10,
  fontSize: 16,
} as const;

type Target = { host: string; port: number };

/**
 * Pairs by the 6-digit code the desktop pops up when asked. Opened with `host`/`port`/`name` for a
 * desktop found on the network (asks for a code at once), or without them to type an address.
 */
export default function PairCodeScreen() {
  const { t } = useLingui();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ host?: string; port?: string; name?: string }>();
  const { addDesktop, connectDesktop } = useCameraConnection();
  const [address, setAddress] = useState(loadLastPairAddress);
  const [target, setTarget] = useState<Target | null>(
    params.host ? { host: params.host, port: Number(params.port) || DESKTOP_PORT } : null,
  );
  const [requestId, setRequestId] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const name = params.name || target?.host;

  const request = useCallback(
    async (to: Target) => {
      setBusy(true);
      setError(null);
      setCode('');
      try {
        setRequestId(await requestPairCode(desktopBaseUrl(to.host, to.port), PHONE_NAME, DESKTOP_TIMEOUT_MS));
        setTarget(to);
      } catch (err) {
        setError(errorMessage(err));
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  // A desktop picked from the list gets its code right away.
  useEffect(() => {
    if (params.host) request({ host: params.host, port: Number(params.port) || DESKTOP_PORT });
  }, [params.host, params.port, request]);

  const submitAddress = useCallback(() => {
    const parsed = parseHostPort(address);
    if (parsed) request(parsed);
    else setError(t`Enter an address like 192.168.1.5 or 192.168.1.5:8765.`);
  }, [address, request, t]);

  const submitCode = useCallback(
    async (value: string) => {
      if (!target || !requestId) return;
      setBusy(true);
      setError(null);
      try {
        const desktop = await pairWithCode(target.host, target.port, requestId, value, PHONE_NAME, DESKTOP_TIMEOUT_MS);
        addDesktop(desktop);
        saveLastPairAddress(target.port === DESKTOP_PORT ? target.host : `${target.host}:${target.port}`);
        router.back();
        // Like scan-pairing: the desktop list shows it connecting, then opens its photos.
        connectDesktop(desktop);
      } catch (err) {
        if (err instanceof PairCodeError && err.expired) {
          setRequestId(null);
          setError(t`This code has expired. Request a new one.`);
        } else if (err instanceof PairCodeError) {
          setCode('');
          setError(t`Wrong code. Check the code on the desktop and try again.`);
        } else {
          setError(errorMessage(err));
        }
        setBusy(false);
      }
    },
    [target, requestId, addDesktop, connectDesktop, t],
  );

  const onChangeCode = useCallback(
    (text: string) => {
      const digits = text.replace(/\D/g, '').slice(0, 6);
      setCode(digits);
      if (digits.length === 6) submitCode(digits);
    },
    [submitCode],
  );

  return (
    <KeyboardAwareScrollView
      contentInsetAdjustmentBehavior="automatic"
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ padding: 16, paddingBottom: 16 + insets.bottom, gap: 16 }}
    >
      {!target && (
        <Card>
          <Text style={{ color: colors.label, fontSize: 15 }}>
            <Trans>Desktop address, as shown in the desktop app's Phone &amp; settings tab.</Trans>
          </Text>
          <TextInput
            value={address}
            onChangeText={setAddress}
            placeholder={`192.168.1.5:${DESKTOP_PORT}`}
            placeholderTextColor={colors.secondaryLabel}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            returnKeyType="go"
            onSubmitEditing={submitAddress}
            editable={!busy}
            style={inputStyle}
          />
          <ActionButton label={t`Request Code`} onPress={submitAddress} disabled={busy || !address.trim()} />
        </Card>
      )}

      {requestId && (
        <Card>
          <Text style={{ color: colors.label, fontSize: 15 }}>
            <Trans>Enter the 6-digit code shown on {name}.</Trans>
          </Text>
          <TextInput
            value={code}
            onChangeText={onChangeCode}
            placeholder="000000"
            placeholderTextColor={colors.secondaryLabel}
            keyboardType="number-pad"
            textContentType="oneTimeCode"
            autoComplete="one-time-code"
            maxLength={6}
            autoFocus
            editable={!busy}
            style={[inputStyle, { fontSize: 32, letterSpacing: 8, textAlign: 'center', fontVariant: ['tabular-nums'] }]}
          />
        </Card>
      )}

      {busy && (
        <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
          <ActivityIndicator />
          <Text style={{ color: colors.label }}>{requestId ? <Trans>Pairing…</Trans> : <Trans>Asking for a code…</Trans>}</Text>
        </View>
      )}

      {error && (
        <Text style={{ color: colors.error }} selectable>
          {error}
        </Text>
      )}

      {target && !requestId && !busy && (
        <ActionButton label={t`Request New Code`} onPress={() => request(target)} />
      )}
    </KeyboardAwareScrollView>
  );
}
