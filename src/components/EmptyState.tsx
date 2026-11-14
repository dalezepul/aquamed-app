import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { useTheme, SPACING } from '../constants/theme';
import { Typography } from './common/Typography';
import { Button } from './common/Button';

interface EmptyStateProps {
  iconName?: keyof typeof Ionicons.glyphMap;
  title: string;
  description?: string;
  /** Optional call to action under the text (e.g. "Add medication"). */
  action?: { title: string; onPress: () => void };
}

export const EmptyState: React.FC<EmptyStateProps> = ({ iconName, title, description, action }) => {
  const { COLORS: c } = useTheme();

  return (
    <View style={styles.container}>
      {iconName && <Ionicons name={iconName} size={60} color={c.textMuted} style={{ marginBottom: SPACING.md }} />}
      <Typography variant="subheader" color={c.textSecondary} style={styles.center}>
        {title}
      </Typography>
      {description && (
        <Typography variant="body" color={c.textSecondary} style={[styles.center, { marginTop: SPACING.sm }]}>
          {description}
        </Typography>
      )}
      {action && <Button title={action.title} onPress={action.onPress} style={styles.action} />}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: SPACING.xxl,
    paddingHorizontal: SPACING.lg,
  },
  center: { textAlign: 'center' },
  action: { marginTop: SPACING.lg, alignSelf: 'stretch' },
});
