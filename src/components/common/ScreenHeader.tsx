import React from 'react';
import { View, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme, SPACING } from '../../constants/theme';
import { t } from '../../localization/i18n';
import { Typography } from './Typography';

interface ScreenHeaderProps {
  title: string;
  onBackPress?: () => void;
  rightButtonIcon?: keyof typeof Ionicons.glyphMap;
  onRightButtonPress?: () => void;
  rightButtonAccessibilityLabel?: string;
}

export const ScreenHeader: React.FC<ScreenHeaderProps> = ({
  title,
  onBackPress,
  rightButtonIcon,
  onRightButtonPress,
  rightButtonAccessibilityLabel,
}) => {
  const { COLORS: dynamicColors } = useTheme();

  return (
    <View style={[styles.headerContainer, { backgroundColor: dynamicColors.card, borderBottomColor: dynamicColors.border }]}>
      <View style={styles.side}>
        {onBackPress && (
          <TouchableOpacity
            onPress={onBackPress}
            style={styles.iconButton}
            accessibilityRole="button"
            accessibilityLabel={t('common.back')}
          >
            <Ionicons name="arrow-back" size={24} color={dynamicColors.text} />
          </TouchableOpacity>
        )}
      </View>
      <Typography variant="subheader" numberOfLines={2} style={[styles.title, { color: dynamicColors.text }]}>{title}</Typography>
      <View style={[styles.side, styles.right]}>
        {rightButtonIcon && onRightButtonPress && (
          <TouchableOpacity
            onPress={onRightButtonPress}
            style={styles.iconButton}
            accessibilityRole="button"
            accessibilityLabel={rightButtonAccessibilityLabel}
          >
            <Ionicons name={rightButtonIcon} size={24} color={dynamicColors.primary} />
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  headerContainer: {
    flexDirection: 'row',
    minHeight: 64,
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: SPACING.sm,
    paddingVertical: SPACING.sm,
    borderBottomWidth: 1,
  },
  side: {
    width: 48,
  },
  right: {
    alignItems: 'flex-end',
  },
  iconButton: {
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    flex: 1,
    textAlign: 'center',
    fontWeight: 'bold',
  },
});
