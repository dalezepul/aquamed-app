import React, { useEffect, useRef } from 'react';
import { Platform, Pressable, PressableProps, StyleSheet, ViewStyle, GestureResponderEvent } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
} from 'react-native-reanimated';
import { haptic, HapticType } from '../../utils/haptics';
import { useTheme, touchSize } from '../../constants/theme';

export 
interface AnimatedTouchableProps extends Omit<PressableProps, 'style' | 'children' | 'onPress' | 'disabled'> {
  children: React.ReactNode;
  onPress?: () => void;
  style?: ViewStyle | ViewStyle[] | any;
  disabled?: boolean;
  hapticType?: HapticType;
  scaleDown?: number;
  /** Holding the button keeps calling onPress (steppers). */
  repeatOnLongPress?: boolean;
}

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

const triggerHaptic = haptic;

export const AnimatedTouchable: React.FC<AnimatedTouchableProps> = ({
  children,
  onPress,
  style,
  disabled = false,
  hapticType = 'light',
  scaleDown = 0.96,
  repeatOnLongPress = false,
  accessibilityRole = 'button',
  accessibilityState,
  onPressIn,
  onPressOut,
  ...rest
}) => {
  const { isElderly } = useTheme();
  const scale = useSharedValue(1);
  const repeatTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const onPressRef = useRef(onPress);
  onPressRef.current = onPress;

  const stopRepeat = () => {
    if (repeatTimer.current) clearInterval(repeatTimer.current);
    repeatTimer.current = null;
  };
  useEffect(() => stopRepeat, []);
  useEffect(() => { if (disabled) stopRepeat(); }, [disabled]);

  const animatedStyle = useAnimatedStyle(() => {
    return {
      transform: [{ scale: scale.value }],
    };
  });

  const handlePressIn = (e: GestureResponderEvent) => {
    if (disabled) return;
    scale.value = withSpring(scaleDown, { damping: 15, stiffness: 400 });
    triggerHaptic(hapticType);
    onPressIn?.(e);
  };

  const handlePressOut = (e: GestureResponderEvent) => {
    stopRepeat();
    scale.value = withSpring(1, { damping: 12, stiffness: 200 });
    onPressOut?.(e);
  };

  return (
    <AnimatedPressable
      {...rest}
      onPress={onPress}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      onLongPress={repeatOnLongPress
        ? () => {
            stopRepeat();
            onPressRef.current?.();
            repeatTimer.current = setInterval(() => onPressRef.current?.(), 150);
          }
        : rest.onLongPress}
      disabled={disabled}
      accessibilityRole={accessibilityRole}
      accessibilityState={{ disabled, ...accessibilityState }}
      style={[styles.touchable, { minHeight: touchSize(isElderly) }, style, animatedStyle]}
    >
      {children}
    </AnimatedPressable>
  );
};

export { triggerHaptic };
export type { HapticType };

const styles = StyleSheet.create({
  touchable: {
    minHeight: 48,
    alignItems: 'stretch',
    justifyContent: 'center',
  },
});
