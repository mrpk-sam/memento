import { hash, verify } from '@node-rs/argon2';
import { Pin } from '@memento/shared';

// argon2id with OWASP-recommended cost. A 4-digit PIN is weak on its own;
// the per-user, per-book attempt limit is what really protects it.
const OPTS = { memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

export async function hashPin(pin: string): Promise<string> {
  Pin.parse(pin);
  return hash(pin, OPTS);
}

export async function verifyPin(pinHash: string | null, pin: string): Promise<boolean> {
  if (!pinHash || !Pin.safeParse(pin).success) return false;
  try {
    return await verify(pinHash, pin);
  } catch {
    return false;
  }
}
