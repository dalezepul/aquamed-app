import { Linking, Platform } from 'react-native';
import { t } from '../localization/i18n';

/**
 * Emergency-contact SMS/WhatsApp (Home "notify your contact" strip, escalation screen buttons,
 * Settings → emergency contact). Hidden after user testing: caregiver pairing notifications cover it.
 * Flip to true to bring all of it back; the code paths are kept.
 */
export const CONTACT_ALERT_ENABLED = false;

/**
 * Digits-only international form ("905321234567") for wa.me / whatsapp://.
 * Numbers without a country code are assumed Turkish: 0532… / 532… → 90532….
 */
export const toInternationalPhone = (phone: string): string => {
  const trimmed = phone.trim();
  const digits = trimmed.replace(/\D/g, '');
  if (trimmed.startsWith('+')) return digits;
  if (digits.startsWith('00')) return digits.slice(2);
  if (digits.startsWith('0')) return '90' + digits.slice(1);
  if (digits.length === 10 && digits.startsWith('5')) return '90' + digits; // TR mobile typed without the 0
  return digits;
};

/** Text sent to the emergency contact about a late dose. */
export const lateDoseMessage = (userName: string, medName: string, time: string): string =>
  t('contact_alert.message', { name: userName.trim() || t('contact_alert.default_name'), med: medName, time });

/** Opens the SMS app with the message filled in; the user still presses send. */
export const alertContactViaSms = (phone: string, message: string) => {
  const number = phone.replace(/[^\d+]/g, '');
  const sep = Platform.OS === 'ios' ? '&' : '?';
  return Linking.openURL(`sms:${number}${sep}body=${encodeURIComponent(message)}`);
};

/** Opens WhatsApp to the contact; falls back to wa.me (browser → app) if the app URL can't open. */
export const alertContactViaWhatsApp = async (phone: string, message: string) => {
  const intl = toInternationalPhone(phone);
  const text = encodeURIComponent(message);
  try {
    await Linking.openURL(`whatsapp://send?phone=${intl}&text=${text}`);
  } catch {
    await Linking.openURL(`https://wa.me/${intl}?text=${text}`);
  }
};
