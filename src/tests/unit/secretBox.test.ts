import { describe, it, expect } from 'vitest';
import { openSecret, sealSecret } from '../../services/secretBox.js';

// API keys saved in Settings are stored encrypted with a key that lives only
// in the server's environment.

const ENV = { JWT_SECRET: 'server-secret-one' };

describe('Secret box — stored API keys', () => {
  it('reads back what it stored, and the stored form doesn’t show the secret', () => {
    const sealed = sealSecret('sk-very-secret-1234', ENV);
    expect(sealed).not.toContain('very-secret');
    expect(openSecret(sealed, ENV)).toBe('sk-very-secret-1234');
    expect(sealSecret('sk-very-secret-1234', ENV)).not.toBe(sealed); // a fresh random IV every time
  });

  it('can’t be read with a different server secret, or once tampered with', () => {
    const sealed = sealSecret('sk-very-secret-1234', ENV);
    expect(openSecret(sealed, { JWT_SECRET: 'another-server' })).toBeNull();
    const [v, iv, tag, data] = sealed.split(':');
    // Change the first character: every bit of it is real data (the last one can be padding).
    const flipped = (data.startsWith('A') ? 'B' : 'A') + data.slice(1);
    expect(openSecret([v, iv, tag, flipped].join(':'), ENV)).toBeNull();
    expect(openSecret('not-a-sealed-value', ENV)).toBeNull();
  });

  it('uses SECRETS_KEY when set', () => {
    const env = { SECRETS_KEY: Buffer.alloc(32, 7).toString('base64'), JWT_SECRET: 'ignored' };
    const sealed = sealSecret('k', env);
    expect(openSecret(sealed, { SECRETS_KEY: env.SECRETS_KEY })).toBe('k');
    expect(() => sealSecret('k', { SECRETS_KEY: 'short' })).toThrow('32 bytes');
  });
});
