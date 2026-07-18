import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

const apiUrl = process.env.API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3101';
const cookieName = process.env.SESSION_COOKIE_NAME ?? 'kh_session';

export type SessionUser = {
  id: string;
  email: string;
  displayName: string;
  isSystemAdmin: boolean;
};

export type SessionPayload = {
  user: SessionUser;
  memberships: Array<{ workspaceId: string; role: string }>;
};

export async function getSession(): Promise<SessionPayload | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(cookieName)?.value;
  if (!token) {
    return null;
  }

  const response = await fetch(`${apiUrl}/api/v1/auth/session`, {
    headers: {
      Cookie: `${cookieName}=${token}`,
    },
    cache: 'no-store',
  });

  if (!response.ok) {
    return null;
  }

  return (await response.json()) as SessionPayload;
}

export async function requireSession(): Promise<SessionPayload> {
  const session = await getSession();
  if (!session) {
    redirect('/login');
  }
  return session;
}

export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const cookieStore = await cookies();
  const token = cookieStore.get(cookieName)?.value;
  const headers = new Headers(init.headers);
  if (token) {
    headers.set('Cookie', `${cookieName}=${token}`);
  }
  if (init.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  return fetch(`${apiUrl}${path}`, {
    ...init,
    headers,
    cache: 'no-store',
  });
}
