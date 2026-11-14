import React from 'react';
import { View, ViewStyle, StyleProp } from 'react-native';
import { useTheme, SPACING, SHADOWS } from '../../constants/theme';

interface CardProps {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}

// No overflow:'hidden' here: on iOS it clips the card's own shadow.
export const Card: React.FC<CardProps> = ({ children, style }) => {
  const { isDark, COLORS: dynamicColors } = useTheme();

  return (
    <View
      style={[
        {
          backgroundColor: dynamicColors.card,
          padding: SPACING.md,
          borderRadius: 24,
          borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.02)',
          borderWidth: 1,
        },
        !isDark && SHADOWS.md, // Dynamic shadows only for light mode
        isDark && { elevation: 0 },
        style,
      ]}
    >
      {children}
    </View>
  );
};
