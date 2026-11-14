import React from 'react';
import { View, Pressable, Text, StyleSheet, useWindowDimensions } from 'react-native';
import { useTheme, touchSize } from '../../constants/theme';

export interface SegmentedOption<T> {
  value: T;
  label: string;
}

interface Props<T> {
  options: SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  /** Group name for screen readers. */
  label: string;
  columns?: number;
}

const GAP = 8;

// 2–4 columns by default; 5 or 6 options wrap as 3 + 2 / 3 + 3.
const defaultColumns = (n: number) => (n <= 4 ? Math.max(n, 2) : n % 4 === 0 ? 4 : 3);

/**
 * Fewest-cut column count: drop columns until the longest *word* fits a cell (labels may wrap
 * to two lines, but "Tab…" / "Yemekten ö…" must not happen on a 360 px phone with large text).
 * `rowWidth` ≈ the form's inner width; ~0.55 em per character is a rough average glyph width.
 */
export const fitColumns = (labels: string[], wanted: number, rowWidth: number, fontPx: number): number => {
  const longest = Math.max(0, ...labels.flatMap(l => l.split(/\s+/)).map(w => w.length));
  let cols = wanted;
  while (cols > 1 && rowWidth / cols - GAP - 16 < longest * fontPx * 0.55) cols--;
  return cols;
};

/** Equal-width single-choice grid (rounded rectangles, not pills). */
export function Segmented<T extends string | number>({ options, value, onChange, label, columns }: Props<T>) {
  const { COLORS, TYPOGRAPHY, isElderly, fontCap } = useTheme();
  const { fontScale, width } = useWindowDimensions();
  // Elderly mode or a large system font: long labels ("1 sa 30 dk", "Aralıklı") get 2 columns rather than shrunk or cut text.
  const auto = defaultColumns(options.length);
  const wanted = columns ?? ((isElderly || fontScale >= 1.3) && options.some(o => o.label.length > 6) ? Math.min(auto, 2) : auto);
  // Row ≈ screen minus screen + card padding (content column is capped on tablets).
  const fontPx = (TYPOGRAPHY.body.fontSize ?? 16) * Math.min(fontScale, fontCap);
  const cols = fitColumns(options.map(o => o.label), wanted, Math.min(width, 640) - 64, fontPx);

  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={label} style={styles.grid}>
      {options.map(o => {
        const selected = o.value === value;
        return (
          <View key={String(o.value)} style={[styles.cell, { width: `${100 / cols}%` }]}>
            <Pressable
              onPress={() => onChange(o.value)}
              accessibilityRole="radio"
              accessibilityLabel={o.label}
              accessibilityState={{ selected, checked: selected }}
              style={[
                styles.item,
                {
                  minHeight: touchSize(isElderly),
                  borderColor: selected ? COLORS.primary : COLORS.border,
                  borderWidth: selected ? 2 : 1,
                  backgroundColor: selected ? COLORS.primary + '26' : COLORS.card,
                },
              ]}
            >
              <Text
                numberOfLines={2}
                adjustsFontSizeToFit
                minimumFontScale={0.7}
                maxFontSizeMultiplier={fontCap}
                style={[TYPOGRAPHY.body, styles.text, { color: selected ? COLORS.primary : COLORS.text, fontWeight: selected ? '700' : '500' }]}
              >
                {o.label}
              </Text>
            </Pressable>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', margin: -GAP / 2 },
  cell: { padding: GAP / 2 },
  item: { borderRadius: 12, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  text: { textAlign: 'center' },
});
