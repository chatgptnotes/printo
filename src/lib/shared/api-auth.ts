import { NextRequest, NextResponse } from 'next/server';
import jwt from 'jsonwebtoken';

export function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (secret) return secret;
  if (process.env.NODE_ENV === 'production') {
    throw new Error('JWT_SECRET environment variable is required in production');
  }
  return 'your-secret-key-change-this';
}

export interface AuthUser {
  userId: number;
  email: string;
}

/** Verify JWT from auth-token cookie. Returns decoded user or null. */
export function verifyAuth(request: NextRequest): AuthUser | null {
  const token = request.cookies.get('auth-token')?.value;
  if (!token) return null;

  try {
    return jwt.verify(token, getJwtSecret()) as AuthUser;
  } catch {
    return null;
  }
}

const INTERNAL_SERVICE_USER: AuthUser = { userId: -1, email: 'internal-service@sabi.ae' };

/**
 * Verify the X-Internal-Secret header for route-to-route calls. Lets the
 * background fetch dispatched by /bid-decision survive past the originating
 * user's JWT expiry. Requires INTERNAL_API_SECRET to be set in the environment.
 */
export function verifyInternalAuth(request: NextRequest): AuthUser | null {
  const secret = process.env.INTERNAL_API_SECRET;
  if (!secret) return null;
  const provided = request.headers.get('x-internal-secret');
  if (provided && provided === secret) return INTERNAL_SERVICE_USER;
  return null;
}

/** Guard for API routes. Returns AuthUser or a 401 response. */
export function requireAuth(request: NextRequest): AuthUser | NextResponse {
  const user = verifyAuth(request) ?? verifyInternalAuth(request);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return user;
}
