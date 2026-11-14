import React from 'react';
import { StyleSheet, TouchableOpacity, ViewStyle } from 'react-native';

import { useTheme, SHADOWS } from '../constants/theme';
import { Typography } from './common/Typography';
import { t } from '../localization/i18n';
import { triggerHaptic } from './common/AnimatedTouchable';

interface QuickAddButtonProps {
  onAdd: (amount: number) => void;
  amount: number;
  disabled?: boolean;
  style?: ViewStyle;
}

export const QuickAddButton: React.FC<QuickAddButtonProps> = ({ onAdd, amount, disabled = false, style }) => {
  const { COLORS: c } = useTheme();

  return (
    <TouchableOpacity
      onPress={() => { triggerHaptic('medium'); onAdd(amount); }}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      accessibilityLabel={t('home.quick_add_a11y', { amount })}
      style={[styles.button, { backgroundColor: c.primary, shadowColor: c.primary, opacity: disabled ? 0.4 : 1 }, SHADOWS.sm, style]}
    >
      <Typography style={styles.buttonText} color={c.onPrimary}>{t('home.amount_ml', { amount })}</Typography>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  button: {
    flex: 1,
    minHeight: 52,
    paddingHorizontal: 4,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonText: { fontWeight: '700', fontSize: 17 },
});
