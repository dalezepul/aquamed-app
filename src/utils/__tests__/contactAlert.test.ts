import { toInternationalPhone } from '../contactAlert';

describe('toInternationalPhone', () => {
  it('turns a Turkish national number into 90…', () => {
    expect(toInternationalPhone('0532 123 45 67')).toBe('905321234567');
    expect(toInternationalPhone('(0532) 123-45-67')).toBe('905321234567');
    expect(toInternationalPhone('5321234567')).toBe('905321234567');
  });
  it('keeps an explicit country code, dropping + / 00 and spaces', () => {
    expect(toInternationalPhone('+90 532 123 45 67')).toBe('905321234567');
    expect(toInternationalPhone('+49 151 2345678')).toBe('491512345678');
    expect(toInternationalPhone('0049 151 2345678')).toBe('491512345678');
  });
});
