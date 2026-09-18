'use client';

import { PublicClientApplication } from '@azure/msal-browser';

let msalInstance = null;
let initPromise = null;

export const loginRequest = {
  scopes: ['Files.ReadWrite', 'User.Read', 'offline_access'],
};

/**
 * Initialize MSAL dynamically in the browser
 */
export async function getMsalInstance() {
  if (typeof window === 'undefined') return null;

  if (msalInstance) {
    if (initPromise) await initPromise;
    return msalInstance;
  }

  // Fetch client ID & tenant ID from our Next.js API
  let clientId = 'e7b7cf60-63af-4151-b44c-3472c5268c11';
  let tenantId = '2036bd18-2405-46fa-8caa-627e96966415';

  try {
    const res = await fetch('/api/auth/config');
    if (res.ok) {
      const data = await res.json();
      if (data.clientId) clientId = data.clientId;
      if (data.tenantId) tenantId = data.tenantId;
    }
  } catch (err) {
    console.warn('[msAuth] Using fallback auth config:', err);
  }

  const msalConfig = {
    auth: {
      clientId,
      authority: `https://login.microsoftonline.com/${tenantId}`,
      redirectUri: window.location.origin,
    },
    cache: {
      cacheLocation: 'localStorage',
      storeAuthStateInCookie: true,
    },
  };

  msalInstance = new PublicClientApplication(msalConfig);
  initPromise = (async () => {
    await msalInstance.initialize();
    const result = await msalInstance.handleRedirectPromise();
    if (result) {
      console.log('[msAuth] Logged in as:', result.account.username);
    }
  })();

  await initPromise;
  return msalInstance;
}

/**
 * Interactive Login (Popup or Redirect fallback)
 */
export async function login() {
  const msal = await getMsalInstance();
  if (!msal) return null;

  try {
    const res = await msal.loginPopup({
      ...loginRequest,
      prompt: 'select_account',
    });
    return res.account;
  } catch (err) {
    console.warn('[msAuth] Popup login failed, trying redirect:', err);
    await msal.loginRedirect({
      ...loginRequest,
      redirectStartPage: `${window.location.origin}/sync`,
    });
    return null;
  }
}

/**
 * Logout
 */
export async function logout() {
  const msal = await getMsalInstance();
  if (!msal) return;

  const accounts = msal.getAllAccounts();
  if (accounts.length > 0) {
    await msal.logoutPopup({ account: accounts[0] });
  }
}

/**
 * Get Access Token silently or prompt login
 */
export async function getAccessToken() {
  const msal = await getMsalInstance();
  if (!msal) return null;

  const accounts = msal.getAllAccounts();
  if (accounts.length === 0) {
    const account = await login();
    if (!account) return null;
  }

  const currentAccount = msal.getAllAccounts()[0];

  try {
    const tokenResponse = await msal.acquireTokenSilent({
      ...loginRequest,
      account: currentAccount,
    });
    return tokenResponse.accessToken;
  } catch (error) {
    console.warn('[msAuth] Silent token acquisition failed, requesting interactive:', error);
    try {
      const interactiveRes = await msal.acquireTokenPopup({
        ...loginRequest,
        account: currentAccount,
      });
      return interactiveRes.accessToken;
    } catch (popupErr) {
      console.error('[msAuth] Token acquisition failed:', popupErr);
      return null;
    }
  }
}

/**
 * Check authentication status and remaining token validity
 */
export async function checkTokenStatus() {
  const msal = await getMsalInstance();
  if (!msal) {
    return {
      isLoggedIn: false,
      username: '',
      timeLeftMin: 0,
      statusText: 'ยังไม่ได้เข้าสู่ระบบ',
      type: 'error',
    };
  }

  const accounts = msal.getAllAccounts();
  if (accounts.length === 0) {
    return {
      isLoggedIn: false,
      username: '',
      timeLeftMin: 0,
      statusText: 'ยังไม่ได้เข้าสู่ระบบ Microsoft',
      type: 'error',
    };
  }

  try {
    const tokenResponse = await msal.acquireTokenSilent({
      ...loginRequest,
      account: accounts[0],
    });

    const expiresOn = tokenResponse.expiresOn ? new Date(tokenResponse.expiresOn).getTime() : 0;
    const timeLeftMs = expiresOn - Date.now();
    const timeLeftMin = Math.max(0, Math.round(timeLeftMs / 60000));

    return {
      isLoggedIn: true,
      account: accounts[0],
      username: accounts[0].username,
      accessToken: tokenResponse.accessToken,
      expiresOn,
      timeLeftMin,
      statusText: `พร้อมใช้งาน (เหลือ ~${timeLeftMin} นาที)`,
      type: 'success',
    };
  } catch {
    return {
      isLoggedIn: true,
      account: accounts[0],
      username: accounts[0].username,
      timeLeftMin: 0,
      statusText: 'Token หมดอายุ (จำเป็นต้องเข้าสู่ระบบใหม่)',
      type: 'warning',
    };
  }
}
