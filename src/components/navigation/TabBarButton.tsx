import React, { useEffect } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import type { BottomTabBarButtonProps } from '@react-navigation/bottom-tabs';
import Animated, { useSharedValue, useAnimatedStyle, withSpring, withTiming } from 'react-native-reanimated';
import { useTheme } from '../../constants/theme';

const PILL_W = 64;
const PILL_H = 32;
// The tab's icon box (uikit, regular) is 28 px tall under the button's 5 px padding: centre the pill on it.
const PILL_TOP = 5 + 28 / 2 - PILL_H / 2;

/**
 * Bottom tab button without the Android ripple (it spilled over the bar's top edge): the active tab
 * gets a Material 3 style pill behind its icon that springs open; pressing tints/shrinks the pill only.
 */
export const TabBarButton: React.FC<BottomTabBarButtonProps> = ({ children, style, onPress, onLongPress, href: _href, android_ripple: _r, pressOpacity: _o, hoverEffect: _h, ref: _ref, ...rest }) => {
  const { COLORS } = useTheme();
  const selected = !!(rest['aria-selected'] ?? rest.accessibilityState?.selected);
  const open = useSharedValue(selected ? 1 : 0);
  const pressed = useSharedValue(0);

  useEffect(() => {
    open.value = withSpring(selected ? 1 : 0, { damping: 14, stiffness: 180 });
  }, [selected]);

  const pill = useAnimatedStyle(() => ({
    width: PILL_W * (0.4 + 0.6 * open.value),
    opacity: Math.max(open.value, pressed.value * 0.8),
    transform: [{ scale: 1 - pressed.value * 0.06 }],
  }));
  const press = useAnimatedStyle(() => ({ opacity: pressed.value * 0.12 }));

  return (
    <Pressable
      {...rest}
      role="tab"
      accessibilityRole="tab"
      accessibilityState={{ selected }}
      onPress={onPress}
      onLongPress={onLongPress}
      onPressIn={() => { pressed.value = withTiming(1, { duration: 90 }); }}
      onPressOut={() => { pressed.value = withTiming(0, { duration: 220 }); }}
      style={style}
    >
      <View style={styles.pillSlot} pointerEvents="none">
        <Animated.View style={[styles.pill, { backgroundColor: COLORS.primary + '2E' }, pill]}>
          <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: COLORS.primary }, press]} />
        </Animated.View>
      </View>
      {children}
    </Pressable>
  );
};

const styles = StyleSheet.create({
  pillSlot: { position: 'absolute', left: 0, right: 0, top: PILL_TOP, alignItems: 'center' },
  pill: { height: PILL_H, borderRadius: PILL_H / 2, overflow: 'hidden' },
});
