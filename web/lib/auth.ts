import { cookies } from "next/headers";
import type { CurrentUser } from "./types";

export const SESSION_COOKIE = process.env.SESSION_COOKIE || "erp_realsoft_session";

interface JwtClaims {
  sub?: string;
  role?: string;
  exp?: number;
}

/** Decode a JWT payload WITHOUT verifying the signature (the backend verifies it
 * on every API call). Used only to read sub/role/exp for UI gating. */
export function decodeJwt(token: string): JwtClaims | null {
  try {
    const part = token.split(".")[1];
    if (!part) return null;
    const json = Buffer.from(part.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
    return JSON.parse(json) as JwtClaims;
  } catch {
    return null;
  }
}

export function isExpired(claims: JwtClaims | null): boolean {
  if (!claims || !claims.exp) return true;
  return claims.exp * 1000 <= Date.now();
}

/** Read the session JWT from the HttpOnly cookie (server-side only). */
export function getSessionToken(): string | null {
  return cookies().get(SESSION_COOKIE)?.value ?? null;
}

/** Resolve the current user from the cookie, or null if missing/expired. */
export function getCurrentUser(): CurrentUser | null {
  const token = getSessionToken();
  if (!token) return null;
  const claims = decodeJwt(token);
  if (!claims || isExpired(claims)) return null;
  return { username: claims.sub || "user", role: claims.role || "user" };
}
