import { hash, verify } from "@node-rs/argon2";

const ARGON2_OPTIONS = {
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
  outputLen: 32,
};

export async function hashPassword(password: string): Promise<string> {
  return hash(password, ARGON2_OPTIONS);
}

export async function verifyPassword(password: string, passwordHash: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}

/**
 * A valid Argon2id hash used to equalise roughly the cost of a login attempt
 * for unknown accounts. The derived password is intentionally unknown.
 */
export const DUMMY_PASSWORD_HASH =
  "$argon2id$v=19$m=19456,t=2,p=1$obUcztHYcrOgoagMzk7vhA$s2z9gfjU4LzxkxOBALpxg4BHveAND6U5A7M73NpSxmg";
