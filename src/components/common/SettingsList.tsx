import React from 'react';
import { View, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme, SPACING, touchSize } from '../../constants/theme';
import { Typography } from './Typography';
import { Card } from './Card';
import { Switch } from './Switch';
import { upper } from '../../localization/i18n';

// Grouped settings list (as on Data & privacy): small uppercase label, then a card of compact rows split by hairlines.
// The label is upper-cased in the app language (textTransform would print "TAKIP" for "Takip").
export const SettingsSection: React.FC<{ title: string; children: React.ReactNode; danger?: boolean }> = ({ title, children, danger }) => {
  const { COLORS } = useTheme();
  const items = React.Children.toArray(children);
  const rows = items.map((child, i) => (
    <React.Fragment key={i}>
      {i > 0 && <View style={[styles.divider, { backgroundColor: COLORS.border }]} />}
      {child}
    </React.Fragment>
  ));
  return (
    <>
      <Typography variant="caption" color={COLORS.textSecondary} style={styles.section} accessibilityRole="header">{upper(title)}</Typography>
      {danger
        ? <View style={[styles.danger, { borderColor: COLORS.error }]}>{rows}</View>
        : <Card style={styles.card}>{rows}</Card>}
    </>
  );
};

interface RowProps {
  icon: keyof typeof Ionicons.glyphMap;
  tint?: string;
  title: string;
  subtitle?: string;
  value?: string;
  onPress?: () => void;
  right?: React.ReactNode;
  danger?: boolean;
  disabled?: boolean;
  accessibilityLabel?: string;
}

export const SettingsRow: React.FC<RowProps> = ({ icon, tint, title, subtitle, value, onPress, right, danger, disabled, accessibilityLabel }) => {
  const { COLORS, isElderly } = useTheme();
  const color = danger ? COLORS.error : tint ?? COLORS.primary;
  const body = (
    <>
      {danger
        ? <Ionicons name={icon} size={20} color={color} />
        : (
          <View style={[styles.iconBox, { backgroundColor: color + '22' }]}>
            <Ionicons name={icon} size={20} color={color} />
          </View>
        )}
      <View style={styles.flex1}>
        <Typography color={danger ? COLORS.error : undefined} style={danger ? styles.bold : undefined}>{title}</Typography>
        {subtitle ? <Typography variant="caption" color={COLORS.textSecondary}>{subtitle}</Typography> : null}
        {/* Elderly mode: large type leaves no room beside the title, so the value goes underneath. */}
        {value && isElderly ? <Typography color={COLORS.textSecondary}>{value}</Typography> : null}
      </View>
      {value && !isElderly ? <Typography color={COLORS.textSecondary} style={styles.value}>{value}</Typography> : null}
      {right ?? (onPress && !danger ? <Ionicons name="chevron-forward" size={18} color={COLORS.textSecondary} /> : null)}
    </>
  );
  const rowStyle = [styles.row, { minHeight: Math.max(52, touchSize(isElderly)) }];
  // A switch on the right: the whole row toggles it (the 46×26 px switch alone is a small target).
  const sw = React.isValidElement<React.ComponentProps<typeof Switch>>(right) && right.type === Switch ? right.props : null;
  if (sw && !onPress) return (
    <TouchableOpacity
      style={rowStyle}
      onPress={() => sw.onValueChange(!sw.value)}
      disabled={disabled || sw.disabled}
      accessibilityRole="switch"
      accessibilityLabel={accessibilityLabel ?? sw.accessibilityLabel ?? title}
      accessibilityHint={subtitle}
      accessibilityState={{ checked: sw.value, disabled: !!(disabled || sw.disabled) }}
    >
      {body}
    </TouchableOpacity>
  );
  return onPress ? (
    <TouchableOpacity
      style={rowStyle}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? (value ? `${title}, ${value}` : title)}
      accessibilityHint={subtitle}
      accessibilityState={{ disabled: !!disabled }}
    >
      {body}
    </TouchableOpacity>
  ) : (
    <View style={rowStyle} accessible={!right} accessibilityLabel={accessibilityLabel}>{body}</View>
  );
};

const styles = StyleSheet.create({
  card: { marginBottom: SPACING.md, paddingVertical: 4 },
  section: { marginTop: SPACING.sm, marginBottom: 6, marginLeft: 4, letterSpacing: 0.5 },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 6, gap: 12 },
  iconBox: { width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  divider: { height: StyleSheet.hairlineWidth },
  flex1: { flex: 1 },
  // Capped so a long value ("Gece Mavisi") wraps itself instead of breaking the title mid-word.
  value: { maxWidth: '45%', textAlign: 'right' },
  bold: { fontWeight: '700' },
  danger: { marginBottom: SPACING.md, paddingHorizontal: 14, paddingVertical: 2, borderWidth: 1, borderRadius: 14 },
});
