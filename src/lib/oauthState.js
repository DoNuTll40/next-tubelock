import { cookies } from 'next/headers';
import { generateSessionToken } from './sessionUtils';

export function safeReturnUrl(value, requestUrl, fallback = '/') {
  const base = new URL(requestUrl);
  if (value?.startsWith('/')) {
    const target = new URL(value, base);
    if (target.origin === base.origin) return target;
  }
  return new URL(fallback, base);
}

export async function createOAuthState(provider, returnTo, requestUrl) {
  const state = generateSessionToken();
  const target = safeReturnUrl(returnTo, requestUrl);
  (await cookies()).set(`tubelock_oauth_${provider}`, JSON.stringify({
    state,
    returnTo: target.pathname + target.search + target.hash,
  }), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 600,
    path: '/',
  });
  return state;
}

export async function consumeOAuthState(provider, state, requestUrl) {
  const cookieStore = await cookies();
  const name = `tubelock_oauth_${provider}`;
  const value = cookieStore.get(name)?.value;
  if (!value || !state) return null;

  let saved;
  try {
    saved = JSON.parse(value);
  } catch {
    return null;
  }
  if (saved?.state !== state) return null;
  cookieStore.delete(name);
  return safeReturnUrl(saved.returnTo, requestUrl);
}
