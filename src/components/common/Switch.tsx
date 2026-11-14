import React, { useEffect } from 'react';
import { Pressable, StyleSheet, StyleProp, ViewStyle } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  interpolateColor,
} from 'react-native-reanimated';
import { useTheme } from '../../constants/theme';

interface SwitchProps {
  value: boolean;
  onValueChange: (value: boolean) => void;
  disabled?: boolean;
  accessibilityLabel?: string;
}

// Track is 26px (elderly: 34px) tall; hitSlop brings the touch target to 48px (56px) without changing layout.
const HIT_SLOP = { top: 11, bottom: 11, left: 4, right: 4 };
const HIT_SLOP_ELDERLY = { top: 11, bottom: 11, left: 6, right: 6 };

export const Switch: React.FC<SwitchProps> = ({
  value,
  onValueChange,
  disabled = false,
  accessibilityLabel,
}) => {
  const { COLORS: dynamicColors, isElderly } = useTheme();
  const travel = isElderly ? 28 : 20;

  const translateX = useSharedValue(value ? travel : 0);

  useEffect(() => {
    translateX.value = withSpring(value ? travel : 0, { damping: 15, stiffness: 220 });
  }, [value, travel]);

  const offTrack = dynamicColors.border;
  const onTrack = dynamicColors.primary;
  const offKnob = dynamicColors.white;
  const onKnob = dynamicColors.onPrimary;

  const animatedStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(translateX.value, [0, travel], [offTrack, onTrack]),
  }));

  const animatedKnobStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(translateX.value, [0, travel], [offKnob, onKnob]),
    transform: [{ translateX: translateX.value }],
  }));

  return (
    <Pressable
      onPress={() => !disabled && onValueChange(!value)}
      disabled={disabled}
      hitSlop={isElderly ? HIT_SLOP_ELDERLY : HIT_SLOP}
      accessibilityRole="switch"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ checked: value, disabled }}
      style={({ pressed }) => [
        styles.container,
        pressed && { opacity: 0.9 }
      ]}
    >
      <Animated.View style={[styles.track, isElderly && styles.trackLarge, animatedStyle, disabled && { opacity: 0.5 }]}>
        <Animated.View style={[styles.knob, isElderly && styles.knobLarge, animatedKnobStyle]} />
      </Animated.View>
    </Pressable>
  );
};

/**
 * A row (label on the left, switch on the right) where the whole row toggles and reads as one
 * switch to screen readers; at least 44 px tall.
 */
export const SwitchRow: React.FC<{
  value: boolean;
  onValueChange: (value: boolean) => void;
  label: string;
  style?: StyleProp<ViewStyle>;
  disabled?: boolean;
  children: React.ReactNode;
}> = ({ value, onValueChange, label, style, disabled, children }) => (
  <Pressable
    onPress={() => !disabled && onValueChange(!value)}
    disabled={disabled}
    accessibilityRole="switch"
    accessibilityLabel={label}
    accessibilityState={{ checked: value, disabled: !!disabled }}
    style={[styles.row, style]}
  >
    {children}
    <Switch value={value} onValueChange={onValueChange} disabled={disabled} accessibilityLabel={label} />
  </Pressable>
);

const styles = StyleSheet.create({
  row: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 12 },
  container: {
    borderRadius: 15,
  },
  track: {
    width: 46,
    height: 26,
    borderRadius: 13,
    padding: 3,
    justifyContent: 'center',
  },
  trackLarge: { width: 62, height: 34, borderRadius: 17, padding: 4 },
  knobLarge: { width: 26, height: 26, borderRadius: 13 },
  knob: {
    width: 20,
    height: 20,
    borderRadius: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.15,
    shadowRadius: 1.5,
    elevation: 2,
  },
});
