import { Alert, Platform } from 'react-native';
import { t } from '../localization/i18n';

export interface DialogRequest {
  title: string;
  message: string;
  /** Omitted for notify(): single "OK" button. */
  confirmText?: string;
  destructive?: boolean;
  /** choose(): one full-width button per entry, first is primary; resolve gets its index. */
  choices?: string[];
  resolve: (confirmed: boolean, choice?: number) => void;
}

// Set by <DialogHost/> while mounted; null in tests or before the app renders.
let show: ((req: DialogRequest) => void) | null = null;
export const setDialogHost = (fn: typeof show) => { show = fn; };

/**
 * Themed yes/no dialog (see components/common/DialogHost), works on web too.
 * Resolves true when the user confirms; back button / dismiss counts as cancel.
 */
export const confirm = (title: string, message: string, confirmText = t('common.ok'), destructive = false): Promise<boolean> =>
  new Promise(resolve => {
    if (show) return show({ title, message, confirmText, destructive, resolve });
    // Fallback when the host isn't mounted; Alert is a no-op on web, so treat as cancel there.
    if (Platform.OS === 'web') return resolve(false);
    Alert.alert(
      title,
      message,
      [
        { text: t('common.cancel'), style: 'cancel', onPress: () => resolve(false) },
        { text: confirmText, style: destructive ? 'destructive' : 'default', onPress: () => resolve(true) },
      ],
      { cancelable: true, onDismiss: () => resolve(false) }
    );
  });

/** One-button message, themed like confirm(). */
export const notify = (title: string, message: string) => {
  if (show) return show({ title, message, resolve: () => {} });
  Alert.alert(title, message);
};

/** Themed dialog with several options. Resolves the tapped option's index, -1 on back/dismiss. */
export const choose = (title: string, message: string, choices: string[]): Promise<number> =>
  new Promise(resolve => {
    if (show) return show({ title, message, choices, resolve: (_ok, i) => resolve(i ?? -1) });
    if (Platform.OS === 'web') return resolve(-1);
    Alert.alert(title, message, choices.map((text, i) => ({ text, onPress: () => resolve(i) })), { cancelable: true, onDismiss: () => resolve(-1) });
  });
