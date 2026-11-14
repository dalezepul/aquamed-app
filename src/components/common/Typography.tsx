import React from 'react';
import { Text, TextProps, TextStyle, StyleProp } from 'react-native';
import { useTheme, TYPOGRAPHY } from '../../constants/theme';

type TextVariant = keyof typeof TYPOGRAPHY;

interface TypographyProps extends TextProps {
  children: React.ReactNode;
  variant?: TextVariant;
  style?: StyleProp<TextStyle>;
  color?: string;
}

export const Typography: React.FC<TypographyProps> = ({
  children,
  variant = 'body',
  style,
  color,
  // Respect the system font size, but cap it so layouts don't break.
  maxFontSizeMultiplier = 1.6,
  ...rest
}) => {
  const { COLORS: dynamicColors, TYPOGRAPHY: dynamicTypography, fontCap } = useTheme();
  // The large view is already ~25% larger; a lower cap keeps both scalings from stacking into overflow.
  maxFontSizeMultiplier = Math.min(maxFontSizeMultiplier ?? fontCap, fontCap);
  const isHeading = variant === 'header' || variant === 'subheader';

  return (
    <Text
      accessibilityRole={isHeading ? 'header' : undefined}
      maxFontSizeMultiplier={maxFontSizeMultiplier}
      {...rest}
      style={[
        dynamicTypography[variant],
        { color: color || dynamicColors.text },
        style,
      ]}
    >
      {children}
    </Text>
  );
};
