import { inputBox } from '../Input';

describe('inputBox (text field sizing)', () => {
  it('single line: a caller lineHeight never survives, box fits font × scale × 1.5 + padding', () => {
    for (const scale of [1, 1.3, 1.6]) {
      for (const fontSize of [16, 20, 22, 40]) {
        const b = inputBox({ fontSize, lineHeight: fontSize + 2 }, 16, scale, 48, false);
        expect(b.lineHeight).toBeUndefined();
        expect(b.minHeight).toBeGreaterThanOrEqual(fontSize * scale * 1.5 + 2 * b.padV);
        expect(b.minHeight).toBeGreaterThanOrEqual(48);
      }
    }
  });

  it('respects caller padding and minHeight, never shrinks below the touch size', () => {
    expect(inputBox({ paddingVertical: 6, fontSize: 40 }, 16, 1, 56, false)).toEqual({ padV: 6, minHeight: 72, lineHeight: undefined });
    expect(inputBox({ minHeight: 120 }, 16, 1, 48, false).minHeight).toBe(120);
    expect(inputBox({}, 16, 1, 56, false).minHeight).toBe(56);
  });

  it('multiline keeps its own lineHeight and room for four lines', () => {
    const b = inputBox({}, 16, 1.3, 48, true);
    expect(b.lineHeight).toBe(24);
    expect(b.minHeight).toBeGreaterThanOrEqual(Math.ceil(16 * 1.3 * 1.5) * 4 + 2 * b.padV);
  });
});
