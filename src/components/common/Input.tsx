import React from 'react';
import { TextInput, StyleSheet, View, Text, TextInputProps, StyleProp, ViewStyle, TextStyle, PixelRatio } from 'react-native';
import { useTheme, SPACING, touchSize } from '../../constants/theme';

interface InputProps extends TextInputProps {
  label?: string;
  error?: string;
  containerStyle?: StyleProp<ViewStyle>;
  inputStyle?: StyleProp<TextStyle>;
}

export const Input: React.FC<InputProps> = ({
  label,
  error,
  containerStyle,
  inputStyle,
  accessibilityLabel,
  accessibilityHint,
  ...rest
}) => {
  const { COLORS: dynamicColors, isElderly, fontCap, TYPOGRAPHY } = useTheme();
  const multiline = !!rest.multiline;
  const { minHeight, padV, lineHeight } = inputBox(StyleSheet.flatten(inputStyle) ?? {}, TYPOGRAPHY.body.fontSize, Math.min(PixelRatio.getFontScale(), fontCap), touchSize(isElderly), multiline);
  return (
    <View style={[styles.container, containerStyle]}>
      {label && (
        <Text maxFontSizeMultiplier={fontCap} style={[TYPOGRAPHY.caption, { color: dynamicColors.textSecondary, marginBottom: 6 }]}>
          {label}
        </Text>
      )}
      <TextInput
        style={[
          styles.input,
          TYPOGRAPHY.body,
          {
            borderColor: error ? dynamicColors.error : dynamicColors.border,
            backgroundColor: dynamicColors.card,
            color: dynamicColors.text,
            paddingHorizontal: SPACING.md,
            borderRadius: SPACING.sm,
            includeFontPadding: true, // keeps the dot of İ and the tails of ş/ç/ğ inside the box
          },
          inputStyle,
          // Last, so a caller's inputStyle (often a TYPOGRAPHY spread) can't bring back a single-line
          // lineHeight or a fixed height: on Android both clip the glyphs (Samsung One UI font worst).
          { paddingVertical: padV, minHeight, height: undefined, lineHeight, textAlignVertical: multiline ? 'top' : 'center' },
        ]}
        placeholderTextColor={dynamicColors.gray}
        maxFontSizeMultiplier={fontCap}
        accessibilityLabel={accessibilityLabel ?? label}
        accessibilityHint={error ? [error, accessibilityHint].filter(Boolean).join('. ') : accessibilityHint}
        {...rest}
      />
      {error && (
        <Text
          maxFontSizeMultiplier={fontCap}
          accessibilityLiveRegion="polite"
          style={[TYPOGRAPHY.caption, { color: dynamicColors.error, marginTop: SPACING.xs }]}
        >
          {error}
        </Text>
      )}
    </View>
  );
};

/**
 * Box size from the text the user will actually see (font × system scale, capped like the text)
 * instead of the native measurement, which left text cramped on Samsung / large fonts.
 * `own` is the caller's flattened inputStyle: its fontSize, paddingVertical and minHeight count.
 */
export const inputBox = (own: TextStyle, bodyFont: number, scale: number, touch: number, multiline: boolean) => {
  const fontSize = typeof own.fontSize === 'number' ? own.fontSize : bodyFont;
  const px = fontSize * scale; // on-screen glyph size
  const line = Math.ceil(px * 1.5);
  const padV = typeof own.paddingVertical === 'number' ? own.paddingVertical : Math.min(16, Math.max(10, Math.round(px * 0.55)));
  const ownMin = typeof own.minHeight === 'number' ? own.minHeight : 0;
  return {
    padV,
    // Notes/descriptions: room for four lines (grows further on native).
    minHeight: Math.max(touch, ownMin, (multiline ? line * 4 : line) + 2 * padV),
    // Single line: none (Android shifts/clips); multiline sets its own (RN scales lineHeight itself).
    lineHeight: multiline ? Math.ceil(fontSize * 1.5) : undefined,
  };
};

const styles = StyleSheet.create({
  container: {
    marginBottom: SPACING.md,
  },
  input: {
    borderWidth: 1,
    minHeight: 48,
  },
});
