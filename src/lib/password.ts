import {
  randomBytes,
  scrypt as scryptCb,
  timingSafeEqual,
  type ScryptOptions,
} from "node:crypto";

/**
 * Hand-rolled promise wrapper rather than `promisify`, because promisify resolves to the
 * no-options overload and drops the cost parameters we need to pass.
 */
function scrypt(
  password: string,
  salt: Buffer,
  keylen: number,
  options: ScryptOptions,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCb(password, salt, keylen, options, (error, derivedKey) => {
      if (error) reject(error);
      else resolve(derivedKey);
    });
  });
}

/**
 * Password hashing on Node's built-in scrypt.
 *
 * scrypt rather than argon2 deliberately: argon2 means a native module, and native modules
 * are the thing that breaks a Vercel deploy at the worst moment. scrypt is memory-hard, in
 * the standard library, and available on every runtime this app will ever see.
 *
 * Stored format: scrypt$N$r$p$<salt-b64>$<hash-b64>. The parameters travel with the hash, so
 * they can be raised later without invalidating existing passwords.
 */
const PARAMS = { N: 16384, r: 8, p: 1, keyLength: 64 } as const;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = (await scrypt(password.normalize("NFKC"), salt, PARAMS.keyLength, {
    N: PARAMS.N,
    r: PARAMS.r,
    p: PARAMS.p,
    // scrypt's default maxmem is too small for N=16384; give it room.
    maxmem: 64 * 1024 * 1024,
  })) as Buffer;

  return [
    "scrypt",
    PARAMS.N,
    PARAMS.r,
    PARAMS.p,
    salt.toString("base64"),
    derived.toString("base64"),
  ].join("$");
}

export async function verifyPassword(
  password: string,
  stored: string | null | undefined,
): Promise<boolean> {
  if (!stored) return false;

  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;

  const [, nRaw, rRaw, pRaw, saltB64, hashB64] = parts;
  const N = Number.parseInt(nRaw, 10);
  const r = Number.parseInt(rRaw, 10);
  const p = Number.parseInt(pRaw, 10);
  if (!N || !r || !p) return false;

  let salt: Buffer;
  let expected: Buffer;
  try {
    salt = Buffer.from(saltB64, "base64");
    expected = Buffer.from(hashB64, "base64");
  } catch {
    return false;
  }
  if (expected.length === 0) return false;

  let derived: Buffer;
  try {
    derived = (await scrypt(password.normalize("NFKC"), salt, expected.length, {
      N,
      r,
      p,
      maxmem: 256 * 1024 * 1024,
    })) as Buffer;
  } catch {
    return false;
  }

  return derived.length === expected.length && timingSafeEqual(derived, expected);
}

/** Minimum bar for a password we set on someone's behalf or accept from an invite link. */
export function validatePasswordStrength(password: string): string | null {
  if (password.length < 10) return "Password must be at least 10 characters.";
  if (password.length > 200) return "Password must be under 200 characters.";
  if (!/[a-zA-Z]/.test(password)) return "Password must contain a letter.";
  if (!/[0-9]/.test(password)) return "Password must contain a number.";
  return null;
}
