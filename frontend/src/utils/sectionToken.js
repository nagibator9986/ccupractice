// The unlock token of the password-protected sections lives in sessionStorage: it dies with the
// browser tab, so closing the tab locks the sections again. Every access is wrapped — private
// modes and blocked site data throw on storage access.
const KEY = "ccu_section_unlock";

export const SECTION_LOCKED_EVENT = "ccu:section-locked";

export function getSectionToken() {
  try {
    return typeof window !== "undefined" ? window.sessionStorage.getItem(KEY) : null;
  } catch {
    return null;
  }
}

export function setSectionToken(token) {
  try {
    if (typeof window !== "undefined") window.sessionStorage.setItem(KEY, token);
  } catch {
    /* ignore: the section simply asks for the password again */
  }
}

export function clearSectionToken() {
  try {
    if (typeof window !== "undefined") window.sessionStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
