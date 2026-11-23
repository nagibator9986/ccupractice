import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { sectionLockApi } from "../api/endpoints.js";
import { useAuth } from "./AuthContext.jsx";
import { SECTION_LOCKED_EVENT, clearSectionToken, setSectionToken } from "../utils/sectionToken.js";

/**
 * State of the password lock on «Договоры со студентами» and «LMS-договоры».
 * The server is the one that enforces it (423 on every call); this only drives what the user sees:
 * the lock icons in the menu and the password screen that replaces the section.
 */
const SectionLockContext = createContext(null);

export function SectionLockProvider({ children }) {
  const { user } = useAuth();
  const [ready, setReady] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [unlocked, setUnlocked] = useState(false);

  useEffect(() => {
    if (!user) {
      clearSectionToken();
      setEnabled(false);
      setUnlocked(false);
      setReady(false);
      return undefined;
    }
    let cancelled = false;
    sectionLockApi
      .status()
      .then((s) => {
        if (cancelled) return;
        setEnabled(!!s.enabled);
        setUnlocked(!s.enabled || !!s.unlocked);
        if (s.enabled && !s.unlocked) clearSectionToken();
      })
      .catch(() => {
        // Cannot tell: stay on the safe side, the server decides anyway.
        if (cancelled) return;
        setEnabled(true);
        setUnlocked(false);
      })
      .finally(() => !cancelled && setReady(true));
    return () => {
      cancelled = true;
    };
  }, [user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // A request answered 423: the token expired, or the password was changed on the server.
  useEffect(() => {
    const relock = () => setUnlocked(false);
    window.addEventListener(SECTION_LOCKED_EVENT, relock);
    return () => window.removeEventListener(SECTION_LOCKED_EVENT, relock);
  }, []);

  /** Throws the axios error on a wrong password so the form can show the server's message. */
  const unlock = useCallback(async (password) => {
    const res = await sectionLockApi.unlock(password);
    if (res.enabled === false) {
      setEnabled(false);
    } else {
      setSectionToken(res.token);
    }
    setUnlocked(true);
  }, []);

  const lock = useCallback(() => {
    clearSectionToken();
    setUnlocked(false);
  }, []);

  const value = useMemo(
    () => ({ ready, enabled, unlocked, locked: enabled && !unlocked, unlock, lock }),
    [ready, enabled, unlocked, unlock, lock],
  );
  return <SectionLockContext.Provider value={value}>{children}</SectionLockContext.Provider>;
}

export function useSectionLock() {
  const ctx = useContext(SectionLockContext);
  if (!ctx) throw new Error("useSectionLock must be used inside <SectionLockProvider>");
  return ctx;
}
