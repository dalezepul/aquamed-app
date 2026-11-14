import React, { useEffect, useRef, useState } from 'react';
import { View, StyleSheet, Modal, Animated, Dimensions, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme, SPACING } from '../../constants/theme';
import { t } from '../../localization/i18n';
import { Typography } from './Typography';
import { Button } from './Button';
import { AnimatedTouchable } from './AnimatedTouchable';

interface BottomSheetNumberPickerProps {
  isVisible: boolean;
  onClose: () => void;
  title?: string;
  initialValue: number;
  min?: number;
  max?: number;
  step?: number;
  presets?: number[];
  /** 'add' (default): chips add their value (−5, +1…). 'set': chips jump to that value (7, 14, 30…). */
  presetMode?: 'add' | 'set';
  onConfirm: (value: number) => void;
}

const { height: SCREEN_HEIGHT } = Dimensions.get('window');

export const BottomSheetNumberPicker: React.FC<BottomSheetNumberPickerProps> = ({
  isVisible,
  onClose,
  title,
  initialValue,
  min = 0,
  max = 999,
  step = 1,
  presets = [-5, -1, 1, 5],
  presetMode = 'add',
  onConfirm,
}) => {
  const { isDark, COLORS: dynamicColors } = useTheme();
  const insets = useSafeAreaInsets();
  const slideAnim = useRef(new Animated.Value(SCREEN_HEIGHT)).current;

  const [selectedValue, setSelectedValue] = useState(initialValue);

  useEffect(() => {
    if (isVisible) {
      setSelectedValue(initialValue);
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
  }, [isVisible, initialValue]);

  const handleConfirm = () => {
    onConfirm(selectedValue);
    onClose();
  };

  const clamp = (v: number) => Math.min(max, Math.max(min, v));
  const adjustValue = (amount: number) => setSelectedValue(prev => clamp(prev + amount));

  const chevronBg = isDark ? dynamicColors.surface : dynamicColors.lightGray;

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

          <Typography variant="subheader" style={styles.title}>{title ?? t('picker.select_number')}</Typography>

          <View style={styles.stepperContainer}>
            <AnimatedTouchable
              onPress={() => adjustValue(step)}
              repeatOnLongPress
              disabled={selectedValue >= max}
              accessibilityLabel={t('picker.increase', { step })}
              accessibilityHint={t('picker.hold_hint')}
              style={[styles.chevronBtn, { backgroundColor: chevronBg, marginBottom: 12 }, selectedValue >= max && styles.dimmed]}
            >
              <Ionicons name="chevron-up" size={28} color={dynamicColors.primary} />
            </AnimatedTouchable>

            <View style={[styles.valueBox, { backgroundColor: isDark ? dynamicColors.background : dynamicColors.surface, borderColor: dynamicColors.border, marginBottom: 12 }]}>
              <Typography
                maxFontSizeMultiplier={1.1}
                accessibilityLiveRegion="polite"
                style={[styles.valueText, { color: dynamicColors.text }]}
              >
                {selectedValue}
              </Typography>
            </View>

            <AnimatedTouchable
              onPress={() => adjustValue(-step)}
              repeatOnLongPress
              disabled={selectedValue <= min}
              accessibilityLabel={t('picker.decrease', { step })}
              accessibilityHint={t('picker.hold_hint')}
              style={[styles.chevronBtn, { backgroundColor: chevronBg }, selectedValue <= min && styles.dimmed]}
            >
              <Ionicons name="chevron-down" size={28} color={dynamicColors.primary} />
            </AnimatedTouchable>
          </View>

          {presets && presets.length > 0 && (
            <View style={styles.presetsRow}>
              {presets.map((p) => {
                const label = presetMode === 'set' ? String(p) : p > 0 ? `+${p}` : String(p);
                const selected = presetMode === 'set' && p === selectedValue;
                return (
                  <AnimatedTouchable
                    key={p}
                    onPress={() => (presetMode === 'set' ? setSelectedValue(clamp(p)) : adjustValue(p))}
                    accessibilityLabel={label}
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
                      {label}
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
  modalContainer: { flex: 1, justifyContent: 'flex-end', alignItems: 'center' },
  backdrop: { position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, backgroundColor: 'rgba(0,0,0,0.5)' },
  sheet: { borderTopLeftRadius: 32, borderTopRightRadius: 32, padding: SPACING.lg, width: '100%', maxWidth: 560 },
  handle: { width: 40, height: 5, borderRadius: 3, alignSelf: 'center', marginBottom: 20 },
  title: { textAlign: 'center', marginBottom: SPACING.md, fontWeight: 'bold' },

  stepperContainer: { alignItems: 'center', justifyContent: 'center', marginVertical: 8 },
  chevronBtn: { width: 64, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center' },
  dimmed: { opacity: 0.4 },
  valueBox: { minWidth: 100, height: 100, paddingHorizontal: SPACING.md, borderRadius: 24, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5 },
  valueText: { fontSize: 44, lineHeight: 52, fontWeight: '900', letterSpacing: 1 },

  presetsRow: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: 8, marginTop: SPACING.md, width: '100%' },
  presetChip: { flexGrow: 1, flexBasis: 56, paddingVertical: 10, borderRadius: 12, borderWidth: 1, alignItems: 'center', justifyContent: 'center' }
});
