// Web (and anything without native Firebase): crash reporting is a no-op.
// Native builds resolve crash.native.ts instead, so @react-native-firebase is never bundled for web.
export const recordError = (_e: unknown, _context: string): void => {};
export const log = (_msg: string): void => {};
