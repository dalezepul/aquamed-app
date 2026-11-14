import React, { useEffect, useRef, useState } from 'react';
import { Modal, View, ScrollView, Text, StyleSheet, AccessibilityInfo, Platform, useWindowDimensions } from 'react-native';
import Animated, { ZoomIn, useReducedMotion } from 'react-native-reanimated';
import { useTheme, SPACING } from '../../constants/theme';
import { t } from '../../localization/i18n';
import { setDialogHost, DialogRequest } from '../../utils/confirm';
import { Typography } from './Typography';
import { Card } from './Card';
import { Button } from './Button';

/**
 * Renders confirm()/notify() dialogs in the app's theme. Mount once, inside the providers.
 * Calls arriving while a dialog is open are queued and shown one after another.
 */
export const DialogHost: React.FC = () => {
  const { COLORS, TYPOGRAPHY, isElderly, fontCap } = useTheme();
  const reduceMotion = useReducedMotion();
  const { height } = useWindowDimensions();
  const [queue, setQueue] = useState<(DialogRequest & { id: number })[]>([]);
  const nextId = useRef(0);
  const titleRef = useRef<Text>(null);
  const current = queue[0];

  useEffect(() => {
    setDialogHost(req => setQueue(q => [...q, { ...req, id: nextId.current++ }]));
    return () => setDialogHost(null);
  }, []);

  // Move screen-reader focus to the title of each new dialog.
  useEffect(() => {
    if (!current || Platform.OS === 'web') return;
    const id = setTimeout(() => titleRef.current && AccessibilityInfo.sendAccessibilityEvent(titleRef.current, 'focus'), 150);
    return () => clearTimeout(id);
  }, [current?.id]);

  const close = (confirmed: boolean, choice?: number) => {
    if (!current) return;
    current.resolve(confirmed, choice);
    // Guard against a double tap dropping the next queued dialog.
    setQueue(q => (q[0]?.id === current.id ? q.slice(1) : q));
  };

  const isConfirm = current?.confirmText !== undefined;

  return (
    <Modal
      visible={!!current}
      transparent
      animationType={reduceMotion ? 'none' : 'fade'}
      statusBarTranslucent
      onRequestClose={() => close(false)}
    >
      <View style={[styles.backdrop, { backgroundColor: COLORS.black + '80' }]}>
        {current && (
          <Animated.View key={current.id} entering={reduceMotion ? undefined : ZoomIn.duration(180)} style={styles.boxWrap}>
            <Card style={styles.box}>
              <View accessibilityViewIsModal>
                <Text
                  ref={titleRef}
                  accessibilityRole="header"
                  maxFontSizeMultiplier={fontCap}
                  style={[TYPOGRAPHY.subheader, styles.title, { color: COLORS.text }]}
                >
                  {current.title}
                </Text>
                <ScrollView style={{ maxHeight: height * 0.6 }} contentContainerStyle={styles.messageContent}>
                  <Typography color={COLORS.textSecondary}>{current.message}</Typography>
                </ScrollView>
                {current.choices ? (
                  <View style={[styles.buttons, styles.buttonsColumn]}>
                    {current.choices.map((label, i) => (
                      <Button key={label} title={label} variant={i === 0 ? 'primary' : 'secondary'} onPress={() => close(true, i)} />
                    ))}
                  </View>
                ) : (
                <View style={[styles.buttons, isElderly && styles.buttonsStacked]}>
                  {isConfirm && (
                    <Button title={t('common.cancel')} variant="secondary" onPress={() => close(false)} style={!isElderly && styles.flex1} />
                  )}
                  <Button
                    title={current.confirmText ?? t('common.ok')}
                    variant={current.destructive ? 'destructive' : 'primary'}
                    onPress={() => close(true)}
                    style={!isElderly && styles.flex1}
                  />
                </View>
                )}
              </View>
            </Card>
          </Animated.View>
        )}
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: SPACING.md },
  boxWrap: { width: '100%', maxWidth: 440 },
  box: { padding: SPACING.lg },
  title: { marginBottom: SPACING.sm },
  messageContent: { paddingBottom: SPACING.xs },
  buttons: { flexDirection: 'row', gap: SPACING.sm, marginTop: SPACING.lg },
  // Elderly mode: full-width buttons, confirm on top.
  buttonsStacked: { flexDirection: 'column-reverse' },
  buttonsColumn: { flexDirection: 'column' },
  flex1: { flex: 1 },
});
