export const POSTER_PREFERENCE = 'tubelock_allow_18plus';

export function syncPosterPreferenceCookie(enabled) {
  document.cookie = `${POSTER_PREFERENCE}=${enabled ? '1' : '0'}; Path=/; Max-Age=${enabled ? 31536000 : 0}; SameSite=Lax${location.protocol === 'https:' ? '; Secure' : ''}`;
}

export function savePosterPreference(enabled) {
  localStorage.setItem(POSTER_PREFERENCE, enabled ? '1' : '0');
  syncPosterPreferenceCookie(enabled);
  window.dispatchEvent(new Event('tubelock_18plus_changed'));
}
