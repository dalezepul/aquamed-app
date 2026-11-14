// Home-screen widgets are Android-only (index.android.tsx). Web, iOS and jest get no-ops.
// Keep this file .tsx like index.android.tsx: Metro tries every platform variant of one extension
// before the next extension, so an index.ts here beat index.android.tsx and the Android bundle
// shipped these no-ops (no widget task handler → widgets stayed transparent).
export function registerWidgets() {}
export async function refreshWidgets(): Promise<void> {}
