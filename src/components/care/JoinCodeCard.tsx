import React, { useEffect, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { useNavigation } from '@react-navigation/native';

import { t } from '../../localization/i18n';
import { useTheme } from '../../constants/theme';
import { Input } from '../common/Input';
import { Button } from '../common/Button';
import { Typography } from '../common/Typography';
import { confirm, notify } from '../../utils/confirm';
import { usePlus } from '../../services/entitlement';
import { Pair, CODE_DIGITS, isValidCode, joinWithCode, pairPlusActive } from '../../services/pairing';

export const pairingErrorText = (e: any) => {
  switch (e?.message) {
    case 'invalid': return t('pairing.err_invalid');
    case 'expired': return t('pairing.err_expired');
    case 'self': return t('pairing.err_self');
    case 'already': return t('pairing.err_already');
    case 'limit': return t('pairing.err_limit');
    case 'paused': return t('pairing.paused');
    default: return t('pairing.err_generic');
  }
};

// Code from an invite link (AppNavigator → setPendingJoinCode): fills every mounted card, and cards mounted later.
let pendingCode = '';
const codeListeners = new Set<(c: string) => void>();
export const setPendingJoinCode = (code: string) => { pendingCode = code; codeListeners.forEach(l => l(code)); };

/** "Plus ended, pairing paused" line for a pair nobody pays for any more (see pairPlusActive). */
export const PairPausedNote: React.FC<{ pair: Pair }> = ({ pair }) => {
  const { COLORS } = useTheme();
  if (pairPlusActive(pair)) return null;
  return <Typography variant="caption" color={COLORS.warning} style={styles.note}>{t('pairing.paused')}</Typography>;
};

/** 8-digit code field + "Eşleş": follow someone (Yakınlar, CareHome's empty state, CareSettings). */
export const JoinCodeCard: React.FC<{ autoFocus?: boolean; primary?: boolean; onJoined?: (pair: Pair) => void }> = ({ autoFocus, primary, onJoined }) => {
  const navigation = useNavigation<any>();
  const plus = usePlus();
  const [code, setCode] = useState(pendingCode);
  const [busy, setBusy] = useState(false);
  // Refused for want of Plus: buying it (Paywall) retries the same code; an expired one gets the usual "ask for a new code".
  const [waitingPlus, setWaitingPlus] = useState(false);
  useEffect(() => { codeListeners.add(setCode); return () => { codeListeners.delete(setCode); }; }, []);

  const join = async () => {
    setBusy(true);
    setWaitingPlus(false);
    pendingCode = '';
    try {
      const pair = await joinWithCode(code.trim());
      setCode('');
      notify(t('pairing.title'), t('pairing.joined', { name: pair.patientName || t('pairing.unnamed_patient') }));
      onJoined?.(pair);
    } catch (e: any) {
      if (e?.message === 'plus_required') {
        setWaitingPlus(true);
        const name = e.patientName || t('pairing.unnamed_patient');
        if (await confirm(t('pairing.plus_needed_title'), t('pairing.plus_needed', { name }), t('pairing.plus_needed_cta'))) navigation.navigate('Paywall');
      } else {
        notify(t('pairing.title'), pairingErrorText(e));
      }
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => { if (plus && waitingPlus && isValidCode(code)) join(); }, [plus]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <View style={styles.block}>
      <Input
        label={t('pairing.code_label')}
        placeholder="12345678"
        keyboardType="number-pad"
        maxLength={CODE_DIGITS + 1}
        value={code}
        autoFocus={autoFocus}
        onChangeText={v => setCode(v.replace(/\D/g, ''))}
        onSubmitEditing={() => { if (isValidCode(code) && !busy) join(); }}
        returnKeyType="done"
      />
      <Button title={t('pairing.join')} onPress={join} loading={busy} disabled={busy || !isValidCode(code)} variant={primary ? 'primary' : 'secondary'} />
    </View>
  );
};

const styles = StyleSheet.create({
  block: { paddingVertical: 8 },
  note: { marginTop: 6 },
});
