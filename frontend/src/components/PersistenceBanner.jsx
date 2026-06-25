import { useEffect, useState } from "react";
import client from "../api/client.js";

// Safari/Firefox private modes and sandboxed iframes can throw on
// sessionStorage access — wrap so a thrown DOMException can't crash render.
const safeSession = {
  get(key) {
    try {
      return typeof window !== "undefined" ? window.sessionStorage.getItem(key) : null;
    } catch {
      return null;
    }
  },
  set(key, value) {
    try {
      if (typeof window !== "undefined") window.sessionStorage.setItem(key, value);
    } catch {
      /* ignore */
    }
  },
};

/**
 * Bright in-app banner shown on every admin page when the backend reports
 * that data is stored on ephemeral container storage (will be wiped on the
 * next redeploy). The backend computes this via `app/utils/persistence.py`
 * and surfaces it through `/api/health` — see `backend/docs/PERSISTENCE.md`
 * for the dashboard-side fix on Railway.
 *
 * The component dismisses itself if a session-storage flag is set (the admin
 * can hide it for the current tab), but it always re-checks on full reload
 * so the warning resurfaces after every login.
 */
export default function PersistenceBanner({ enabled = true }) {
  const [report, setReport] = useState(null);
  const [dismissed, setDismissed] = useState(
    () => safeSession.get("ccu_dismiss_persist") === "1",
  );

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    // Use the shared axios client so VITE_API_BASE_URL (split-origin deploys)
    // and the standard request interceptor are honoured. /api/health is
    // unauthenticated; the shared response interceptor whitelists it
    // implicitly via the unprotected status path.
    client
      .get("/health")
      .then((res) => {
        if (!cancelled && res.data && res.data.persistent === false) {
          setReport(res.data);
        }
      })
      .catch(() => {/* non-fatal */});
    return () => { cancelled = true; };
  }, [enabled]);

  if (!enabled || !report || dismissed) return null;

  const hints = report.persistence?.hints || [];

  return (
    <div className="rounded-2xl border border-coral-300 bg-coral-50 text-coral-900 p-4 mb-4 shadow-sm">
      <div className="flex items-start gap-3">
        <div className="text-2xl leading-none mt-1">⚠️</div>
        <div className="flex-1">
          <div className="font-semibold text-base">
            Внимание: данные хранятся на эфемерном диске контейнера
          </div>
          <p className="text-sm mt-1">
            Все договоры, партнёры, студенты и сгенерированные DOCX/PDF
            <b> будут стёрты при следующем деплое</b>. Это конфигурация Railway,
            а не баг приложения. Один раз настройте — и данные перестанут
            пропадать:
          </p>
          {hints.length > 0 && (
            <ul className="text-sm mt-2 list-disc pl-5 space-y-1">
              {hints.slice(0, 3).map((h, i) => (
                <li key={i}>{h}</li>
              ))}
            </ul>
          )}
          <div className="text-xs mt-3 opacity-75">
            Подробная инструкция — <code>backend/docs/PERSISTENCE.md</code>.
            После настройки на Railway этот баннер пропадёт автоматически.
          </div>
        </div>
        <button
          type="button"
          className="text-xs text-coral-700 hover:text-coral-900 underline shrink-0 mt-1"
          onClick={() => {
            safeSession.set("ccu_dismiss_persist", "1");
            setDismissed(true);
          }}
        >
          Скрыть до перезагрузки
        </button>
      </div>
    </div>
  );
}
