import React from 'react';
import { Text, ActivityIndicator, StyleSheet, ViewStyle, TextStyle, StyleProp } from 'react-native';
import { useTheme, SPACING, touchSize } from '../../constants/theme';
import { AnimatedTouchable, HapticType } from './AnimatedTouchable';

interface ButtonProps {
  title: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'destructive';
  loading?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  textStyle?: TextStyle;
  hapticType?: HapticType;
  accessibilityLabel?: string;
  accessibilityHint?: string;
}

export const Button: React.FC<ButtonProps> = ({
  title,
  onPress,
  variant = 'primary',
  loading = false,
  disabled = false,
  style,
  textStyle,
  hapticType,
  accessibilityLabel,
  accessibilityHint,
}) => {
  const { COLORS: dynamicColors, isDark, isElderly, fontCap, TYPOGRAPHY } = useTheme();

  const backgroundColor =
    variant === 'secondary' ? (isDark ? dynamicColors.surface : dynamicColors.card)
    : variant === 'destructive' ? dynamicColors.error
    : dynamicColors.primary;

  const textColor = variant === 'secondary' ? dynamicColors.primary : dynamicColors.onPrimary;

  const resolvedHaptic: HapticType = hapticType
    ?? (variant === 'destructive' ? 'warning' : 'medium');

  return (
    <AnimatedTouchable
      onPress={onPress}
      disabled={disabled || loading}
      hapticType={resolvedHaptic}
      scaleDown={0.97}
      accessibilityLabel={accessibilityLabel ?? title}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: disabled || loading, busy: loading }}
      style={[
        styles.baseButton,
        { backgroundColor, minHeight: touchSize(isElderly) },
        variant === 'secondary' && { borderWidth: 1, borderColor: dynamicColors.primary },
        // Same colours at reduced opacity: stays legible in both themes.
        disabled && !loading && styles.disabled,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={textColor} size="small" />
      ) : (
        <Text
          maxFontSizeMultiplier={fontCap}
          style={[
            TYPOGRAPHY.body,
            styles.buttonText,
            { color: textColor },
            textStyle,
          ]}
        >
          {title}
        </Text>
      )}
    </AnimatedTouchable>
  );
};

const styles = StyleSheet.create({
  baseButton: {
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    minHeight: 48,
    paddingVertical: SPACING.md,
    borderRadius: SPACING.sm,
  },
  buttonText: {
    fontWeight: 'bold',
    textAlign: 'center',
  },
  disabled: {
    opacity: 0.45,
  },
});
