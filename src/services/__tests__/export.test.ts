import { escapeCsvValue } from '../exportService';

describe('escapeCsvValue', () => {
  it('quotes and doubles inner quotes', () => {
    expect(escapeCsvValue('a "b"')).toBe('"a ""b"""');
  });
  it('neutralises formula injection', () => {
    expect(escapeCsvValue('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(escapeCsvValue('+1')).toBe(`"'+1"`);
  });
  it('keeps Turkish text and empty values', () => {
    expect(escapeCsvValue('İlaç ğüşöç')).toBe('"İlaç ğüşöç"');
    expect(escapeCsvValue(undefined)).toBe('""');
  });
});
