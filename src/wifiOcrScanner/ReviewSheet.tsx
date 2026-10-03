import { useEffect, useRef } from 'react';
import { ActivityIndicator, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import BottomSheet, {
  BottomSheetFooter,
  BottomSheetView,
  useBottomSheetScrollableCreator,
  type BottomSheetFooterProps,
} from '@gorhom/bottom-sheet';
import { LegendList } from '@legendapp/list/react-native';
import { Trans } from '@lingui/react/macro';
import type { CaptureState } from './types';
import { colors } from '../theme/colors';

type ReviewSheetProps = {
  capture: CaptureState;
  onSelectLine: (line: string) => void;
  onChangeText: (text: string) => void;
  onRetake: () => void;
  onConfirm: (text: string) => void;
};

function CandidateLinesList({
  lines,
  selected,
  onSelect,
}: {
  lines: string[];
  selected: string;
  onSelect: (line: string) => void;
}) {
  const renderScrollComponent = useBottomSheetScrollableCreator();
  return (
    <LegendList
      data={lines}
      style={styles.linesList}
      renderScrollComponent={renderScrollComponent}
      keyExtractor={(item, index) => `${index}-${item}`}
      recycleItems
      renderItem={({ item }) => (
        <TouchableOpacity
          style={[styles.lineRow, item === selected && styles.lineRowSelected]}
          onPress={() => onSelect(item)}
        >
          <Text style={styles.lineText}>{item}</Text>
        </TouchableOpacity>
      )}
    />
  );
}

export function ReviewSheet({ capture, onSelectLine, onChangeText, onRetake, onConfirm }: ReviewSheetProps) {
  const sheetRef = useRef<BottomSheet>(null);
  const open = capture.kind !== 'camera-ready';

  useEffect(() => {
    if (open) {
      sheetRef.current?.snapToIndex(0);
    } else {
      sheetRef.current?.close();
    }
  }, [open]);

  const renderFooter = (footerProps: BottomSheetFooterProps) => {
    if (capture.kind !== 'reviewing') return null;
    const trimmed = capture.text.trim();
    return (
      <BottomSheetFooter {...footerProps}>
        <View style={styles.footerContent}>
          <TextInput
            value={capture.text}
            onChangeText={onChangeText}
            autoCapitalize="none"
            autoCorrect={false}
            style={styles.reviewInput}
            placeholderTextColor={colors.secondaryLabel}
          />
          <View style={styles.reviewActions}>
            <TouchableOpacity style={styles.secondaryButton} onPress={onRetake}>
              <Text style={styles.secondaryButtonText}>
                <Trans>Retake</Trans>
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.button, trimmed.length === 0 && styles.buttonDisabled]}
              disabled={trimmed.length === 0}
              onPress={() => onConfirm(trimmed)}
            >
              <Text style={styles.buttonText}>
                <Trans>Use This Text</Trans>
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </BottomSheetFooter>
    );
  };

  return (
    <BottomSheet
      ref={sheetRef}
      index={-1}
      snapPoints={['45%', '90%']}
      enableDynamicSizing={false}
      enablePanDownToClose
      keyboardBehavior="interactive"
      keyboardBlurBehavior="restore"
      android_keyboardInputMode="adjustResize"
      footerComponent={renderFooter}
      backgroundStyle={{ backgroundColor: colors.card }}
      handleIndicatorStyle={{ backgroundColor: colors.separator }}
      onClose={() => {
        if (open) onRetake();
      }}
    >
      <BottomSheetView style={styles.sheetBody} enableFooterMarginAdjustment>
        {capture.kind === 'recognizing' && (
          <View style={styles.centeredRow}>
            <ActivityIndicator />
            <Text style={styles.recognizingText}>
              <Trans>Reading text…</Trans>
            </Text>
          </View>
        )}

        {capture.kind === 'error' && (
          <View style={styles.centeredRow}>
            <Text style={styles.error}>{capture.message}</Text>
            <TouchableOpacity style={styles.button} onPress={onRetake}>
              <Text style={styles.buttonText}>
                <Trans>Retake</Trans>
              </Text>
            </TouchableOpacity>
          </View>
        )}

        {capture.kind === 'reviewing' &&
          (capture.lines.length === 0 ? (
            <Text style={styles.reviewNote}>
              <Trans>No text detected — you can type it in manually below.</Trans>
            </Text>
          ) : (
            <CandidateLinesList lines={capture.lines} selected={capture.text} onSelect={onSelectLine} />
          ))}
      </BottomSheetView>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  sheetBody: {
    flex: 1,
    // BottomSheetView applies its own {position:'absolute', top/left/right:0} after this
    // style, with no `bottom` — without one, an absolutely positioned view can't stretch to
    // fill its parent, so a flex:1 child (the LegendList below) collapses to 0 height and
    // renders nothing. Setting `bottom: 0` here completes all four anchors.
    bottom: 0,
    paddingHorizontal: 16,
  },
  centeredRow: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 24,
    gap: 12,
  },
  recognizingText: {
    fontWeight: '600',
    color: colors.label,
  },
  reviewNote: {
    color: colors.secondaryLabel,
  },
  linesList: {
    flex: 1,
  },
  lineRow: {
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: colors.separator,
    marginBottom: 6,
  },
  lineRowSelected: {
    borderColor: colors.tint,
    backgroundColor: colors.fill,
  },
  lineText: {
    color: colors.label,
  },
  footerContent: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 16,
    backgroundColor: colors.card,
  },
  reviewInput: {
    borderWidth: 1,
    borderColor: colors.separator,
    borderRadius: 6,
    padding: 8,
    color: colors.label,
    backgroundColor: colors.card,
    marginBottom: 12,
  },
  reviewActions: {
    flexDirection: 'row',
    gap: 8,
  },
  error: {
    color: colors.error,
    textAlign: 'center',
  },
  button: {
    flex: 1,
    backgroundColor: colors.tint,
    borderRadius: 6,
    padding: 10,
    alignItems: 'center',
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  buttonText: {
    color: colors.onTint,
    fontWeight: '600',
  },
  secondaryButton: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.tint,
    borderRadius: 6,
    padding: 10,
    alignItems: 'center',
  },
  secondaryButtonText: {
    color: colors.tint,
    fontWeight: '600',
  },
});
