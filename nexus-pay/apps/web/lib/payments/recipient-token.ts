import { createHmac, timingSafeEqual } from "node:crypto";
import { getServerEnv } from "@/lib/env";

const TOKEN_VERSION = 1;
const MAX_TOKEN_LENGTH = 1024;

export interface RecipientClaims {
  userId: string;
  username: string;
  displayName: string;
  issuedAt: number;
  expiresAt: number;
}

interface TokenPayload {
  v: 1;
  sub: string;
  un: string;
  dn: string;
  iat: number;
  exp: number;
}

export function signRecipientToken(input: {
  userId: string;
  username: string;
  displayName: string;
}): string {
  const now = Math.floor(Date.now() / 1000);
  const payload: TokenPayload = {
    v: TOKEN_VERSION,
    sub: input.userId,
    un: input.username,
    dn: input.displayName,
    iat: now,
    exp: now + getServerEnv().RECIPIENT_TOKEN_TTL_MINUTES * 60,
  };
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${encoded}.${sign(encoded)}`;
}

export function verifyRecipientToken(token: string): RecipientClaims | null {
  if (!token || token.length > MAX_TOKEN_LENGTH) return null;
  const separator = token.lastIndexOf(".");
  if (separator <= 0 || separator === token.length - 1) return null;

  const encoded = token.slice(0, separator);
  const signature = token.slice(separator + 1);
  if (!safeHexEqual(signature, sign(encoded))) return null;

  let payload: unknown;
  try {
    payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  } catch {
    return null;
  }

  if (!isTokenPayload(payload)) return null;
  const now = Math.floor(Date.now() / 1000);
  if (payload.exp <= now || payload.iat > now + 60) return null;
  if (payload.exp - payload.iat > 24 * 60 * 60) return null;

  return {
    userId: payload.sub,
    username: payload.un,
    displayName: payload.dn,
    issuedAt: payload.iat,
    expiresAt: payload.exp,
  };
}

function sign(encoded: string): string {
  return createHmac("sha256", `${getServerEnv().AUTH_SECRET}:recipient-token:v1`)
    .update(encoded)
    .digest("hex");
}

function safeHexEqual(left: string, right: string): boolean {
  if (!/^[0-9a-f]{64}$/i.test(left) || !/^[0-9a-f]{64}$/i.test(right)) return false;
  const leftBuffer = Buffer.from(left, "hex");
  const rightBuffer = Buffer.from(right, "hex");
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function isTokenPayload(value: unknown): value is TokenPayload {
  if (!value || typeof value !== "object") return false;
  const payload = value as Record<string, unknown>;
  return (
    payload.v === TOKEN_VERSION &&
    typeof payload.sub === "string" &&
    payload.sub.length > 0 &&
    payload.sub.length <= 64 &&
    typeof payload.un === "string" &&
    /^[a-z0-9_]{3,24}$/.test(payload.un) &&
    typeof payload.dn === "string" &&
    payload.dn.length > 0 &&
    payload.dn.length <= 60 &&
    typeof payload.iat === "number" &&
    Number.isInteger(payload.iat) &&
    typeof payload.exp === "number" &&
    Number.isInteger(payload.exp)
  );
}
