import { resolveHapticLevel, HAPTIC_METHODS, hapticMethodKey } from '../haptics';

import tr from '../../localization/tr.json';
import en from '../../localization/en.json';

/** Looks a dotted key ("a.b.c") up in a translation file. */
const lookup = (json: any, key: string) => key.split('.').reduce((o, k) => o?.[k], json);

describe('haptics settings', () => {
  it('defaults to off until the user picks; a saved choice is kept', () => {
    expect(resolveHapticLevel({})).toBe('off');
    expect(resolveHapticLevel({ haptics: true })).toBe('off'); // old default save, never chosen
    expect(resolveHapticLevel({ haptics: true, hapticLevel: 'light' })).toBe('light');
    expect(resolveHapticLevel({ haptics: false, hapticLevel: 'light' })).toBe('off');
    expect(resolveHapticLevel({ hapticLevel: 'custom', hapticCustom: 'vibrate:5' })).toBe('custom');
    expect(resolveHapticLevel({ hapticLevel: 'custom' })).toBe('off'); // custom without a method
  });

  it('every method has a label', () => {
    for (const id of HAPTIC_METHODS) {
      expect(lookup(tr, hapticMethodKey(id))).toEqual(expect.any(String));
      expect(lookup(en, hapticMethodKey(id))).toEqual(expect.any(String));
    }
  });
});
