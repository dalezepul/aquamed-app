jest.mock('../../localization/i18n', () => ({ t: (k: string, p?: object) => `${k} ${JSON.stringify(p ?? {})}` }));

import { pairPlusBy, pairPlusActive, inviteLink, inviteMessage, parsePairLink, INVITE_URL } from '../pairing';

describe('Plus gate: either side opens the pair', () => {
  it('prefers the patient, else the caregiver, else refuses', () => {
    expect(pairPlusBy(true, false)).toBe('patient');
    expect(pairPlusBy(true, true)).toBe('patient');
    expect(pairPlusBy(false, true)).toBe('caregiver');
    expect(pairPlusBy(false, false)).toBeNull();
  });

  it('pauses only when neither side has Plus; old pairs without flags keep running', () => {
    expect(pairPlusActive({ patientPlus: true, caregiverPlus: false })).toBe(true);
    expect(pairPlusActive({ patientPlus: false, caregiverPlus: true })).toBe(true);
    expect(pairPlusActive({ patientPlus: false, caregiverPlus: false })).toBe(false);
    expect(pairPlusActive({ patientPlus: false })).toBe(false);
    expect(pairPlusActive({})).toBe(true);
  });
});

describe('WhatsApp invite', () => {
  it('links to the web page with the code as ?kod=', () => {
    expect(inviteLink('12345678')).toBe('https://dalezepul.github.io/aquamed-gizlilik/davet/?kod=12345678');
    expect(inviteLink('00000042').startsWith(INVITE_URL)).toBe(true);
  });

  it('passes the link and the readable code to the text', () => {
    const msg = inviteMessage('12345678');
    expect(msg).toContain('pairing.share_message');
    expect(msg).toContain('?kod=12345678');
    expect(msg).toContain('1234 5678');
  });
});

describe('invite deep link', () => {
  it('reads the code from app, test-app, bare-path and web links', () => {
    expect(parsePairLink('aquamed://pair?code=12345678')).toBe('12345678');
    expect(parsePairLink('aquamed-test://pair?code=00000001')).toBe('00000001');
    expect(parsePairLink('aquamed://pair/?code=12345678&utm=wa')).toBe('12345678');
    expect(parsePairLink('aquamed://pair?x=1&code=1234%205678')).toBe('12345678');
    expect(parsePairLink('pair?code=12345678')).toBe('12345678');
    expect(parsePairLink(inviteLink('87654321'))).toBe('87654321');
  });

  it('ignores other links and bad codes', () => {
    expect(parsePairLink(null)).toBeNull();
    expect(parsePairLink('aquamed://caregivers')).toBeNull();
    expect(parsePairLink('aquamed://caregivers?code=12345678')).toBeNull();
    expect(parsePairLink('aquamed://repair?code=12345678')).toBeNull();
    expect(parsePairLink('aquamed://pair?code=1234')).toBeNull();
    expect(parsePairLink('aquamed://pair?code=123456789')).toBeNull();
    expect(parsePairLink('aquamed://pair?code=abcdefgh')).toBeNull();
    expect(parsePairLink('aquamed://pair')).toBeNull();
  });
});
