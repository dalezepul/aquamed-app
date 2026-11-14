// Lazy: the package's native modules throw on import where they don't exist (jest, Expo Go).
export const loadAdsLib = (): typeof import('react-native-google-mobile-ads') | null => {
  try {
    return require('react-native-google-mobile-ads');
  } catch {
    return null;
  }
};
