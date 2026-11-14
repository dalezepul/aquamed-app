import React, { useEffect, useState } from 'react';
import { View, ScrollView, StyleSheet, TouchableOpacity } from 'react-native';
import { useNavigation } from '@react-navigation/native';

import { useTheme, touchSize } from '../../constants/theme';
import { t } from '../../localization/i18n';
import { Typography } from '../common/Typography';
import { Pair, isPairingActive, watchPairs, getNicknames, displayName } from '../../services/pairing';

/**
 * Home, 'self' mode: "Ben" | "<takma ad>" chips when this user also follows someone.
 * Renders nothing (and never touches Firebase) for users who don't use pairing.
 */
export const CareProfileSwitch: React.FC = () => {
  const navigation = useNavigation<any>();
  const { COLORS, isElderly } = useTheme();
  const [pairs, setPairs] = useState<Pair[]>([]);
  const [nicks, setNicks] = useState<Record<string, string>>({});

  useEffect(() => {
    let stop: (() => void) | undefined;
    let dead = false;
    isPairingActive().then(on => {
      if (on && !dead) stop = watchPairs(p => setPairs(p.asCaregiver), e => console.warn('[care] switch', e));
    });
    return () => { dead = true; stop?.(); };
  }, []);
  useEffect(() => { if (pairs.length) getNicknames().then(setNicks); }, [pairs]);

  if (!pairs.length) return null;
  const chip = [styles.chip, { minHeight: touchSize(isElderly), borderColor: COLORS.border, backgroundColor: COLORS.card }];
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row} accessibilityRole="tablist" accessibilityLabel={t('care.switch_label')}>
      <View style={[...chip, { backgroundColor: COLORS.primary, borderColor: COLORS.primary }]} accessibilityRole="tab" accessibilityState={{ selected: true }}>
        <Typography style={styles.label} color={COLORS.onPrimary}>{t('care.me')}</Typography>
      </View>
      {pairs.map(p => {
        const name = displayName(p, nicks);
        return (
          <TouchableOpacity key={p.id} style={chip} onPress={() => navigation.navigate('CareHome', { pairId: p.id })}
            accessibilityRole="tab" accessibilityState={{ selected: false }} accessibilityLabel={t('care.open_person', { name })}>
            <Typography style={styles.label}>{name}</Typography>
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  row: { gap: 8, paddingVertical: 4 },
  chip: { paddingHorizontal: 18, borderRadius: 14, borderWidth: 1, justifyContent: 'center' },
  label: { fontWeight: '700' },
});
