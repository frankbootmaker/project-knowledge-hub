'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

const apiUrl = process.env.API_URL ?? 'http://localhost:3101';
const cookieName = process.env.SESSION_COOKIE_NAME ?? 'kh_session';

export async function logoutAction() {
  const cookieStore = await cookies();
  const token = cookieStore.get(cookieName)?.value;
  if (token) {
    await fetch(`${apiUrl}/api/v1/auth/logout`, {
      method: 'POST',
      headers: {
        Cookie: `${cookieName}=${token}`,
        Origin: process.env.WEB_URL ?? 'http://localhost:3100',
      },
    });
  }
  cookieStore.delete(cookieName);
  redirect('/login');
}
