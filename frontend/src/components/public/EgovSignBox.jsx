import { useCallback, useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";
import { Loader2, QrCode, RefreshCw, Smartphone, TriangleAlert } from "lucide-react";
import { errorText, signingApi } from "../../api/endpoints.js";

const POLL_MS = 2000;

function deviceKind() {
  const ua = typeof navigator === "undefined" ? "" : navigator.userAgent || "";
  if (/iPhone|iPad|iPod/i.test(ua)) return "ios";
  if (/Android/i.test(ua)) return "android";
  return "desktop";
}

// The server speaks UTC; an ISO string without a zone would be read as local time.
const parseUtc = (iso) => new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(iso) ? iso : `${iso}Z`).getTime();

function useCountdown(expiresAt) {
  const [left, setLeft] = useState(null);
  useEffect(() => {
    if (!expiresAt) {
      setLeft(null);
      return undefined;
    }
    const tick = () => setLeft(Math.max(0, Math.round((parseUtc(expiresAt) - Date.now()) / 1000)));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [expiresAt]);
  return left;
}

const mmss = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

/**
 * Sign through the eGov mobile app: server makes a one-time session, we show a QR
 * (desktop) or an «open the app» button (phone) and poll until the app has PUT the
 * signature back. The signature itself never passes through this page.
 */
export default function EgovSignBox({ token, enabled, onSigned, disabled = false }) {
  const device = deviceKind();
  const [session, setSession] = useState(null); // start response
  const [state, setState] = useState("idle"); // idle | starting | waiting | failed | expired
  const [error, setError] = useState("");
  const [opened, setOpened] = useState(false);
  const pollRef = useRef(null);
  const onSignedRef = useRef(onSigned);
  onSignedRef.current = onSigned;
  const left = useCountdown(state === "waiting" ? session?.session?.expires_at : null);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);
  useEffect(() => stopPolling, [stopPolling]);

  const start = useCallback(async () => {
    stopPolling();
    setState("starting");
    setError("");
    setOpened(false);
    try {
      const res = await signingApi.egovStart(token);
      setSession(res);
      setState("waiting");
      const sid = res.session.id;
      pollRef.current = setInterval(async () => {
        try {
          const st = await signingApi.egovStatus(token, sid);
          const status = st.session?.status;
          if (status === "opened") setOpened(true);
          if (status === "signed" || st.request_status === "signed") {
            stopPolling();
            toast.success("Договор подписан через eGov mobile");
            onSignedRef.current?.();
          } else if (status === "failed") {
            stopPolling();
            setError(st.session?.error || "Подпись не принята.");
            setState("failed");
          } else if (status === "expired" || status === "cancelled") {
            stopPolling();
            setState("expired");
          }
        } catch {
          /* transient network error — the next tick retries */
        }
      }, POLL_MS);
    } catch (e) {
      setError(await errorText(e, "Не удалось начать подписание через eGov mobile"));
      setState("failed");
    }
  }, [token, stopPolling]);

  if (!enabled) return null;

  const link = device === "ios" ? session?.deep_links?.ios : session?.deep_links?.android;

  return (
    <div className="space-y-3">
      {state === "idle" && (
        <>
          <button type="button" className="btn-primary w-full py-3.5 text-base" onClick={start} disabled={disabled}>
            <Smartphone className="h-5 w-5" aria-hidden="true" />
            Подписать через eGov mobile
          </button>
          <p className="text-xs text-charcoal-500">
            {device === "desktop"
              ? "Появится QR-код: отсканируйте его приложением eGov mobile на телефоне и подтвердите подпись PIN-кодом или биометрией. Ключ ЭЦП на компьютере не нужен."
              : "Откроется приложение eGov mobile — подтвердите подпись PIN-кодом или биометрией. Ключ ЭЦП и NCALayer не нужны."}
          </p>
        </>
      )}

      {state === "starting" && (
        <div className="flex items-center gap-2 rounded-xl bg-charcoal-50 px-3 py-3 text-sm text-charcoal-600" role="status">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          Готовим документ для подписи…
        </div>
      )}

      {state === "waiting" && session && (
        <div className="space-y-3 rounded-xl border border-coral-200 bg-coral-50/40 p-3.5" role="status" aria-live="polite">
          {device === "desktop" ? (
            <>
              <div className="flex justify-center">
                <img
                  src={session.qr_png}
                  alt="QR-код для подписи в приложении eGov mobile"
                  className="h-48 w-48 rounded-lg bg-white p-2 ring-1 ring-charcoal-100"
                />
              </div>
              <ol className="list-decimal space-y-1 pl-5 text-sm text-charcoal-700">
                <li>Откройте на телефоне приложение <b>eGov mobile</b>.</li>
                <li>Наведите камеру на QR-код (сканер QR в приложении).</li>
                <li>Проверьте документ и подтвердите подпись PIN-кодом или биометрией.</li>
              </ol>
            </>
          ) : (
            <>
              <a href={link} className="btn-primary w-full py-3.5 text-base" onClick={() => setOpened(true)}>
                <Smartphone className="h-5 w-5" aria-hidden="true" />
                Открыть eGov mobile
              </a>
              <p className="text-sm text-charcoal-700">
                Приложение покажет договор — подтвердите подпись PIN-кодом или биометрией и вернитесь на эту страницу.
                Если приложения нет, ссылка предложит его установить.
              </p>
            </>
          )}
          <div className="flex items-center justify-between gap-2 text-xs text-charcoal-500">
            <span className="inline-flex items-center gap-1.5">
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
              {opened ? "Приложение открыто — ждём подтверждения…" : "Ждём, пока вы откроете подпись в приложении…"}
            </span>
            {left != null && (
              <span className="tabular-nums">{left > 0 ? `действует ${mmss(left)}` : "время почти вышло"}</span>
            )}
          </div>
          {session.https === false && (
            <p className="flex items-start gap-1.5 rounded-lg bg-amber-50 px-2.5 py-2 text-xs text-amber-900">
              <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              Страница открыта не по защищённому адресу (HTTPS) — приложение eGov mobile может отказаться подписывать.
            </p>
          )}
          <button type="button" className="btn-ghost btn-sm" onClick={start}>
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
            Создать новый QR-код
          </button>
        </div>
      )}

      {(state === "failed" || state === "expired") && (
        <div className="space-y-2.5 rounded-xl bg-amber-50 px-3.5 py-3 text-sm text-amber-900 ring-1 ring-amber-100" role="alert">
          <div className="flex items-start gap-2 font-medium">
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            {state === "expired" ? "Время на подпись вышло." : "Подпись не выполнена."}
          </div>
          {error && <p className="text-xs leading-relaxed">{error}</p>}
          <button type="button" className="btn-secondary w-full sm:w-auto" onClick={start} disabled={disabled}>
            <QrCode className="h-4 w-4" aria-hidden="true" />
            Попробовать ещё раз
          </button>
        </div>
      )}
    </div>
  );
}
