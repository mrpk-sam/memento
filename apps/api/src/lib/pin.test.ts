import { describe, expect, it } from 'vitest';
import { hashPin, verifyPin } from './pin.js';

describe('PIN hashing', () => {
  it('verifies the right PIN and rejects others', async () => {
    const h = await hashPin('4821');
    expect(h).toMatch(/^\$argon2id\$/);
    expect(h).not.toContain('4821');
    expect(await verifyPin(h, '4821')).toBe(true);
    expect(await verifyPin(h, '4820')).toBe(false);
  });

  it('salts each hash', async () => {
    expect(await hashPin('1234')).not.toBe(await hashPin('1234'));
  });

  it('rejects malformed PINs without throwing', async () => {
    const h = await hashPin('0000');
    for (const bad of ['', '000', '00000', 'abcd', ' 0000']) expect(await verifyPin(h, bad)).toBe(false);
  });

  it('refuses when no PIN has been set', async () => {
    expect(await verifyPin(null, '1234')).toBe(false);
  });

  it('refuses to hash an invalid PIN', async () => {
    await expect(hashPin('12a4')).rejects.toThrow();
  });
});
