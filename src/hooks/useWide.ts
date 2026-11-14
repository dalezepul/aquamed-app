import { useWindowDimensions, ViewStyle } from 'react-native';

/** Tablet / foldable / landscape: Android 16 ignores the portrait lock on large screens. */
export const WIDE_MIN_WIDTH = 700;
export const FORM_MAX_WIDTH = 600;
export const TWO_COLUMN_MAX_WIDTH = 1100;

export const useWide = () => useWindowDimensions().width >= WIDE_MIN_WIDTH;

/** Centered column capped at `maxWidth`; only applied on wide screens so phones stay pixel-identical. */
export const centered = (maxWidth: number): ViewStyle => ({ width: '100%', maxWidth, alignSelf: 'center' });
