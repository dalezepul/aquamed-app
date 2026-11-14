import { NativeModules, Platform } from 'react-native';
import en from './en.json';
import tr from './tr.json';

const translations: Record<string, any> = { en, tr };
let currentLocale: 'en' | 'tr' = 'tr';

export const setLocale = (locale: 'en' | 'tr') => { currentLocale = locale; };
export const getLocale = (): 'en' | 'tr' => currentLocale;
/**
 * Upper case in the app language: "Takip ediyorsun" → "TAKİP EDİYORSUN" (CSS-like textTransform
 * 'uppercase' drops the dotted İ). i → İ by hand too, in case the JS engine ships without locale data.
 */
export const upper = (s: string): string =>
  currentLocale === 'tr' ? s.replace(/i/g, 'İ').toLocaleUpperCase('tr-TR') : s.toLocaleUpperCase('en-US');

export const t = (key: string, params?: Record<string, any>): string => {
  const keys = key.split('.');
  
  // 1. Try to find in current locale
  let value: any = translations[currentLocale];
  for (const k of keys) {
    value = value?.[k];
    if (value === undefined) break;
  }

  // 2. Fallback to English if not found
  if (value === undefined && currentLocale !== 'en') {
    value = translations['en'];
    for (const k of keys) {
      value = value?.[k];
      if (value === undefined) break;
    }
  }

  // 3. Return defaultValue if provided, otherwise key if still not found
  if (value === undefined || typeof value !== 'string') {
    if (params && typeof params.defaultValue === 'string') {
      value = params.defaultValue;
    } else {
      if (__DEV__) console.warn(`[i18n] missing key: ${key}`);
      return key;
    }
  }

  // 4. Replace params
  if (params) {
    Object.entries(params).forEach(([k, v]) => {
      if (k !== 'defaultValue') {
        value = value.replace(new RegExp(`{{${k}}}`, 'g'), () => String(v)); // function: a "$&" in a name stays literal
      }
    });
  }

  return value;
};


export const initI18n = (savedLocale?: 'en' | 'tr') => {
  if (savedLocale) {
    currentLocale = savedLocale;
    return;
  }
  let locale: string = 'tr';
  try {
    if (Platform.OS === 'ios') {
      const settings = NativeModules.SettingsManager?.settings;
      locale = settings?.AppleLocale || settings?.AppleLanguages?.[0] || 'tr';
    } else if (Platform.OS === 'android') {
      locale = NativeModules.I18nManager?.localeIdentifier || 'tr';
    }
  } catch (e) {}
  const langCode = locale.split('_')[0].split('-')[0];
  currentLocale = (langCode === 'en' || langCode === 'tr') ? (langCode as 'en' | 'tr') : 'tr';
};
