/**
 * Single-password CRM auth. Session is a short HMAC-signed cookie value — no DB
 * session table, no extra dependency beyond bcryptjs for the password hash.
 */
import crypto from "crypto";
import bcrypt from "bcryptjs";
import { cookies } from "next/headers";

const COOKIE = "reges_ops";
const MAX_AGE = 60 * 60 * 12; // 12h

function secret(): string {
  return process.env.SESSION_SECRET || "insecure-dev-secret-change-me";
}

/** Verify a submitted password against CRM_PASSWORD_HASH (preferred) or CRM_PASSWORD. */
export function verifyPassword(pw: string): boolean {
  const hash = process.env.CRM_PASSWORD_HASH;
  if (hash && hash.startsWith("$2")) {
    try {
      return bcrypt.compareSync(pw, hash);
    } catch {
      return false;
    }
  }
  const plain = process.env.CRM_PASSWORD || "changeme";
  // constant-time compare
  const a = Buffer.from(pw);
  const b = Buffer.from(plain);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function sign(payload: string): string {
  const mac = crypto.createHmac("sha256", secret()).update(payload).digest("hex");
  return `${payload}.${mac}`;
}

function verify(token: string | undefined): boolean {
  if (!token) return false;
  const idx = token.lastIndexOf(".");
  if (idx < 0) return false;
  const payload = token.slice(0, idx);
  const mac = token.slice(idx + 1);
  const expected = crypto.createHmac("sha256", secret()).update(payload).digest("hex");
  if (mac.length !== expected.length) return false;
  if (!crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) return false;
  const exp = Number(payload.split(":")[1] || 0);
  return exp > Date.now();
}

export function createSession(): void {
  const exp = Date.now() + MAX_AGE * 1000;
  const token = sign(`reges:${exp}`);
  cookies().set(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: MAX_AGE,
  });
}

export function destroySession(): void {
  cookies().set(COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
}

export function isAuthed(): boolean {
  return verify(cookies().get(COOKIE)?.value);
}
