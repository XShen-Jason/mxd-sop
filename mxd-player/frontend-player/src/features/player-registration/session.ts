const SESSION_STORAGE_KEY = 'mxd-player-session-token';

export function readSessionToken() {
  try {
    return window.sessionStorage.getItem(SESSION_STORAGE_KEY) ?? '';
  } catch {
    return '';
  }
}

export function writeSessionToken(token: string) {
  try {
    window.sessionStorage.setItem(SESSION_STORAGE_KEY, token);
  } catch {
    // Storage may be unavailable in a restricted browser context.
  }
}

export function clearSessionToken() {
  try {
    window.sessionStorage.removeItem(SESSION_STORAGE_KEY);
  } catch {
    // Storage may be unavailable in a restricted browser context.
  }
}
