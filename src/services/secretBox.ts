import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

// Encrypts secrets the app must be able to read back (e.g. an AI provider's
// API key) before they're stored in the database. AES-256-GCM: a copy of the
// database alone doesn't reveal them, and tampering is detected.
//
// The encryption key comes from SECRETS_KEY (32 bytes, base64) if set, else
// is derived from JWT_SECRET — both live only in the server's environment.
// Changing that secret makes stored values unreadable (they must be re-entered).

const VERSION = 'v1';
const IV_BYTES = 12;
const KEY_BYTES = 32;

function boxKey(env: NodeJS.ProcessEnv = process.env): Buffer {
  if (env.SECRETS_KEY) {
    const k = Buffer.from(env.SECRETS_KEY, 'base64');
    if (k.length !== KEY_BYTES) throw new Error('SECRETS_KEY must be 32 bytes, base64-encoded');
    return k;
  }
  if (!env.JWT_SECRET) throw new Error('Set SECRETS_KEY or JWT_SECRET to store secrets');
  return createHash('sha256').update(`kindercore-secret-box:${env.JWT_SECRET}`).digest();
}

export function sealSecret(plain: string, env?: NodeJS.ProcessEnv): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', boxKey(env), iv);
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return [VERSION, iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), data.toString('base64url')].join(':');
}

/** The original secret, or null if it can't be read (wrong key, tampered, or not a sealed value). */
export function openSecret(sealed: string, env?: NodeJS.ProcessEnv): string | null {
  const [version, iv, tag, data] = sealed.split(':');
  if (version !== VERSION || !iv || !tag || data === undefined) return null;
  try {
    const decipher = createDecipheriv('aes-256-gcm', boxKey(env), Buffer.from(iv, 'base64url'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}
