import React, { useEffect, useRef, useState } from 'react';
import { View, StyleSheet, Modal, Animated, Dimensions, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme, SPACING } from '../../constants/theme';
import { t } from '../../localization/i18n';
import { Typography } from './Typography';
import { Button } from './Button';
import { AnimatedTouchable } from './AnimatedTouchable';

interface BottomSheetTimePickerProps {
  isVisible: boolean;
  onClose: () => void;
  title?: string;
  initialTime: string; // "HH:mm"
  onConfirm: (time: string) => void;
  /** One-tap shortcuts shown under the steppers. */
  quickTimes?: string[];
}

const { height: SCREEN_HEIGHT } = Dimensions.get('window');
const DAY = 1440;
const MINUTE_STEP = 5;
const DEFAULT_QUICK_TIMES = ['08:00', '12:00', '20:00', '22:00'];

const toMinutes = (time: string) => {
  const [h, m] = time.split(':').map(n => parseInt(n, 10));
  return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : 12 * 60;
};
const pad = (n: number) => n.toString().padStart(2, '0');
const wrap = (mins: number) => ((mins % DAY) + DAY) % DAY;

export const BottomSheetTimePicker: React.FC<BottomSheetTimePickerProps> = ({
  isVisible,
  onClose,
  title,
  initialTime,
  onConfirm,
  quickTimes = DEFAULT_QUICK_TIMES,
}) => {
  const { isDark, COLORS: dynamicColors } = useTheme();
  const insets = useSafeAreaInsets();
  const slideAnim = useRef(new Animated.Value(SCREEN_HEIGHT)).current;

  const [total, setTotal] = useState(12 * 60);
  const hour = pad(Math.floor(total / 60));
  const minute = pad(total % 60);
  const time = `${hour}:${minute}`;

  useEffect(() => {
    if (isVisible) {
      setTotal(toMinutes(initialTime));
      Animated.spring(slideAnim, {
        toValue: 0,
        useNativeDriver: true,
        tension: 50,
        friction: 8,
      }).start();
    } else {
      Animated.timing(slideAnim, {
        toValue: SCREEN_HEIGHT,
        duration: 250,
        useNativeDriver: true,
      }).start();
    }
  }, [isVisible, initialTime]);

  const handleConfirm = () => {
    onConfirm(time);
    onClose();
  };

  const stepHour = (dir: 1 | -1) => setTotal(v => wrap(v + dir * 60));
  // Snap to the 5-minute grid: 07:32 +5 → 07:35, −5 → 07:30.
  const stepMinute = (dir: 1 | -1) => setTotal(v => wrap(
    dir > 0 ? Math.floor(v / MINUTE_STEP) * MINUTE_STEP + MINUTE_STEP
            : Math.ceil(v / MINUTE_STEP) * MINUTE_STEP - MINUTE_STEP,
  ));

  const chevronBg = isDark ? dynamicColors.surface : dynamicColors.lightGray;
  const boxBg = isDark ? dynamicColors.background : dynamicColors.surface;

  const renderColumn = (label: string, value: string, onStep: (dir: 1 | -1) => void, upLabel: string, downLabel: string) => (
    <View style={styles.column}>
      <Typography variant="caption" color={dynamicColors.textSecondary} style={styles.columnLabel}>{label}</Typography>
      <AnimatedTouchable
        onPress={() => onStep(1)}
        repeatOnLongPress
        accessibilityLabel={upLabel}
        accessibilityHint={t('picker.hold_hint')}
        style={[styles.chevronBtn, { backgroundColor: chevronBg }]}
      >
        <Ionicons name="chevron-up" size={28} color={dynamicColors.primary} />
      </AnimatedTouchable>
      <View style={[styles.timeBox, { backgroundColor: boxBg, borderColor: dynamicColors.border }]}>
        <Typography maxFontSizeMultiplier={1.1} style={[styles.timeText, { color: dynamicColors.text }]}>{value}</Typography>
      </View>
      <AnimatedTouchable
        onPress={() => onStep(-1)}
        repeatOnLongPress
        accessibilityLabel={downLabel}
        accessibilityHint={t('picker.hold_hint')}
        style={[styles.chevronBtn, { backgroundColor: chevronBg }]}
      >
        <Ionicons name="chevron-down" size={28} color={dynamicColors.primary} />
      </AnimatedTouchable>
    </View>
  );

  return (
    <Modal visible={isVisible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.modalContainer}>
        <Pressable
          style={styles.backdrop}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel={t('common.close')}
        />
        <Animated.View
          accessibilityViewIsModal
          style={[
            styles.sheet,
            {
              backgroundColor: dynamicColors.card,
              paddingBottom: SPACING.lg + insets.bottom,
              transform: [{ translateY: slideAnim }]
            }
          ]}
        >
          <View style={[styles.handle, { backgroundColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.05)' }]} />

          <Typography variant="subheader" style={styles.title}>{title ?? t('picker.select_time')}</Typography>

          <View style={styles.stepperContainer}>
            {renderColumn(t('picker.hour'), hour, stepHour, t('picker.hour_up'), t('picker.hour_down'))}
            <View style={styles.colonContainer}>
              <Typography maxFontSizeMultiplier={1.1} style={[styles.colonText, { color: dynamicColors.text }]}>:</Typography>
            </View>
            {renderColumn(t('picker.minute'), minute, stepMinute, t('picker.minute_up'), t('picker.minute_down'))}
          </View>

          <Typography
            variant="caption"
            color={dynamicColors.textSecondary}
            accessibilityLiveRegion="polite"
            style={styles.selectedText}
          >
            {t('picker.selected_time', { time })}
          </Typography>

          {quickTimes.length > 0 && (
            <View style={styles.presetsRow}>
              {quickTimes.map((q) => {
                const selected = q === time;
                return (
                  <AnimatedTouchable
                    key={q}
                    onPress={() => setTotal(toMinutes(q))}
                    accessibilityLabel={q}
                    accessibilityState={{ selected }}
                    style={[
                      styles.presetChip,
                      {
                        backgroundColor: selected ? dynamicColors.primary : chevronBg,
                        borderColor: selected ? dynamicColors.primary : dynamicColors.border,
                      }
                    ]}
                  >
                    <Typography
                      maxFontSizeMultiplier={1.3}
                      style={{ fontWeight: '700', color: selected ? dynamicColors.onPrimary : dynamicColors.text }}
                    >
                      {q}
                    </Typography>
                  </AnimatedTouchable>
                );
              })}
            </View>
          )}

          <Button title={t('common.confirm')} onPress={handleConfirm} style={{ marginTop: SPACING.md }} />
        </Animated.View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  modalContainer: {
    flex: 1,
    justifyContent: 'flex-end',
    alignItems: 'center',
  },
  backdrop: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  sheet: {
    borderTopLeftRadius: 32,
    borderTopRightRadius: 32,
    padding: SPACING.lg,
    width: '100%',
    maxWidth: 560,
  },
  handle: { width: 40, height: 5, borderRadius: 3, alignSelf: 'center', marginBottom: 20 },
  title: { textAlign: 'center', marginBottom: SPACING.md, fontWeight: 'bold' },

  stepperContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: 8,
  },
  column: {
    alignItems: 'center',
    gap: 8,
  },
  columnLabel: {
    marginBottom: 2,
  },
  chevronBtn: {
    width: 64,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
  },
  timeBox: {
    width: 88,
    height: 80,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
  },
  timeText: {
    fontSize: 38,
    lineHeight: 46,
    fontWeight: '900',
    letterSpacing: 1,
  },
  colonContainer: {
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 26, // offsets the column label so the colon lines up with the digits
  },
  colonText: {
    fontSize: 42,
    fontWeight: '900',
    marginHorizontal: 12,
  },
  selectedText: {
    textAlign: 'center',
    marginTop: 4,
  },
  presetsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    gap: 8,
    marginTop: SPACING.md,
    width: '100%',
  },
  presetChip: {
    flexGrow: 1,
    flexBasis: 64,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  }
});
