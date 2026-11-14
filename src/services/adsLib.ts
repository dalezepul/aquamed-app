// Web: react-native-google-mobile-ads has no web build, so it must not even be bundled there.
// Native builds resolve adsLib.native.ts instead.
export const loadAdsLib = (): typeof import('react-native-google-mobile-ads') | null => null;
