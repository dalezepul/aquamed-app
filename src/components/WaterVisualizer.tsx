import React, { useEffect, useRef } from 'react';
import { View, StyleSheet } from 'react-native';
import Svg, { Circle, Defs, LinearGradient, Stop } from 'react-native-svg';
import Animated, { useSharedValue, useAnimatedProps, withTiming, Easing, SharedValue } from 'react-native-reanimated';

import { useTheme } from '../constants/theme';
import { Typography } from './common/Typography';
import { haptic } from '../utils/haptics';
import { t } from '../localization/i18n';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

interface WaterVisualizerProps {
  percentage: number;
  currentAmount: number;
  goalAmount: number;
}

const STROKE_WIDTH = 18;

/**
 * Progress ring with the percentage in the middle. (The translucent wave that used to fill
 * the ring washed out the number, so the centre is now plain card colour.)
 */
export const WaterVisualizer: React.FC<WaterVisualizerProps> = ({ percentage, currentAmount, goalAmount }) => {
  const { isDark, COLORS: c, isElderly, isLarge } = useTheme();
  const SIZE = isElderly ? 240 : 200;
  const RADIUS = (SIZE - STROKE_WIDTH) / 2;
  const CIRCUMFERENCE = RADIUS * 2 * Math.PI;
  const safePercentage = Number.isFinite(percentage) ? percentage : 0;

  const layer1Value = useSharedValue(0);
  const layer2Value = useSharedValue(0);
  const layer3Value = useSharedValue(0);
  const prevPercentage = useRef(safePercentage);

  useEffect(() => {
    const timing = { duration: 1200, easing: Easing.out(Easing.exp) };
    layer1Value.value = withTiming(Math.min(Math.max(safePercentage, 0), 100), timing);
    layer2Value.value = withTiming(Math.min(Math.max(safePercentage - 100, 0), 100), timing);
    layer3Value.value = withTiming(Math.min(Math.max(safePercentage - 200, 0), 100), timing);

    const prev = prevPercentage.current;
    if ([100, 200, 300].some(m => prev < m && safePercentage >= m)) haptic('success');
    prevPercentage.current = safePercentage;
  }, [safePercentage]);

  const ringProps = (v: SharedValue<number>) =>
    useAnimatedProps(() => ({ strokeDashoffset: CIRCUMFERENCE - (CIRCUMFERENCE * v.value) / 100 }));
  const props1 = ringProps(layer1Value);
  const props2 = ringProps(layer2Value);
  const props3 = ringProps(layer3Value);

  // A round line cap draws a dot even for a zero-length arc, so layers render only with progress.
  const layer = (show: boolean, grad: string, props: any) => show && (
    <AnimatedCircle
      cx={SIZE / 2}
      cy={SIZE / 2}
      r={RADIUS}
      stroke={`url(#${grad})`}
      strokeWidth={STROKE_WIDTH}
      strokeDasharray={CIRCUMFERENCE}
      animatedProps={props}
      strokeLinecap="round"
      fill="transparent"
      transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
    />
  );

  return (
    <View
      style={styles.container}
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={t('home.water_progress_a11y', { current: currentAmount, goal: goalAmount, percent: Math.round(safePercentage) })}
    >
      <Svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`}>
        <Defs>
          <LinearGradient id="grad1" x1="0%" y1="0%" x2="100%" y2="100%">
            <Stop offset="0%" stopColor={c.waterLayer1Start} />
            <Stop offset="100%" stopColor={c.waterLayer1End} />
          </LinearGradient>
          <LinearGradient id="grad2" x1="0%" y1="0%" x2="100%" y2="100%">
            <Stop offset="0%" stopColor={c.waterLayer2Start} />
            <Stop offset="100%" stopColor={c.waterLayer2End} />
          </LinearGradient>
          <LinearGradient id="grad3" x1="0%" y1="0%" x2="100%" y2="100%">
            <Stop offset="0%" stopColor={c.waterLayer3Start} />
            <Stop offset="100%" stopColor={c.waterLayer3End} />
          </LinearGradient>
        </Defs>

        <Circle
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={RADIUS}
          stroke={isDark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.06)'}
          strokeWidth={STROKE_WIDTH}
          fill="transparent"
        />
        {layer(safePercentage > 0, 'grad1', props1)}
        {layer(safePercentage > 100, 'grad2', props2)}
        {layer(safePercentage > 200, 'grad3', props3)}
      </Svg>

      <View style={styles.textOverlay}>
        <Typography variant="header" color={c.text} style={[styles.percentageText, isLarge && { fontSize: 46, lineHeight: 54 }]}>
          {t('common.percent', { value: Math.round(safePercentage) })}
        </Typography>
        <Typography variant="caption" color={c.textSecondary} style={styles.bold}>
          {t('home.water_of_goal', { current: currentAmount, goal: goalAmount })}
        </Typography>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { alignItems: 'center', justifyContent: 'center' },
  textOverlay: { position: 'absolute', alignItems: 'center', justifyContent: 'center' },
  percentageText: { fontSize: 38, fontWeight: '900' },
  bold: { fontWeight: '700' },
});
