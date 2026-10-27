import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import { TriangleAlert, CircleHelp } from "lucide-react";
import Modal from "./Modal.jsx";

const ConfirmContext = createContext(null);

/**
 * Promise-based replacement for window.confirm():
 *   const confirm = useConfirm();
 *   if (!(await confirm({ title: "Удалить?", tone: "danger", requireText: "DELETE" }))) return;
 * Esc / overlay / Отмена resolve false.
 */
export function ConfirmProvider({ children }) {
  const [dialog, setDialog] = useState(null); // { id, opts } | null
  const resolverRef = useRef(null);
  const seq = useRef(0);

  const settle = useCallback((result) => {
    const resolve = resolverRef.current;
    resolverRef.current = null;
    setDialog(null);
    resolve?.(result);
  }, []);

  // Stable identity: consumers put `confirm` in effect/callback deps.
  const confirm = useCallback((opts) => {
    // A second confirm while one is open cancels the first rather than
    // leaving its promise pending forever.
    resolverRef.current?.(false);
    const normalized = typeof opts === "string" ? { message: opts } : opts || {};
    return new Promise((resolve) => {
      resolverRef.current = resolve;
      seq.current += 1;
      setDialog({ id: seq.current, opts: normalized });
    });
  }, []);

  const value = useMemo(() => confirm, [confirm]);

  return (
    <ConfirmContext.Provider value={value}>
      {children}
      {/* key remounts the view per request so the typed text never leaks between dialogs */}
      {dialog && <ConfirmView key={dialog.id} opts={dialog.opts} onSettle={settle} />}
    </ConfirmContext.Provider>
  );
}

function ConfirmView({ opts, onSettle }) {
  const {
    title = "Подтвердите действие",
    message,
    confirmText = "Подтвердить",
    cancelText = "Отмена",
    tone = "default",
    requireText,
  } = opts;
  const [typed, setTyped] = useState("");
  const danger = tone === "danger";
  // trim(): mobile keyboards love to append a trailing space.
  const unlocked = !requireText || typed.trim() === requireText;
  const Icon = danger ? TriangleAlert : CircleHelp;

  const submit = () => {
    if (unlocked) onSettle(true);
  };

  // Safe-by-default focus: a destructive confirm without a typed gate focuses
  // "Отмена" so a stray Enter can't delete anything. With requireText the input
  // is the first form control and Modal focuses it on its own.
  const cancelAuto = danger && !requireText;
  const confirmAuto = !danger && !requireText;

  return (
    <Modal
      open
      onClose={() => onSettle(false)}
      title={title}
      size="sm"
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={() => onSettle(false)} data-autofocus={cancelAuto || undefined}>
            {cancelText}
          </button>
          <button
            type="button"
            className={danger ? "btn-danger" : "btn-primary"}
            onClick={submit}
            disabled={!unlocked}
            data-autofocus={confirmAuto || undefined}
          >
            {confirmText}
          </button>
        </>
      }
    >
      <div className="flex gap-3">
        <span
          className={`h-10 w-10 shrink-0 rounded-full grid place-items-center ${
            danger ? "bg-red-50 text-red-600" : "bg-coral-50 text-coral-600"
          }`}
          aria-hidden="true"
        >
          <Icon className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1 text-sm text-charcoal-700 leading-relaxed">
          {message && <div className="whitespace-pre-line">{message}</div>}
          {requireText && (
            <div className={message ? "mt-4" : ""}>
              <label className="label" htmlFor="confirm-require-text">
                Введите «{requireText}» для подтверждения
              </label>
              <input
                id="confirm-require-text"
                className="input"
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    submit();
                  }
                }}
                autoComplete="off"
                autoCapitalize="off"
                spellCheck={false}
                placeholder={requireText}
              />
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}

// Without a provider (isolated tests, storybook) degrade to the native dialog
// instead of crashing.
function nativeConfirm(opts) {
  const text = typeof opts === "string" ? opts : [opts?.title, typeof opts?.message === "string" ? opts.message : ""].filter(Boolean).join("\n\n");
  return Promise.resolve(window.confirm(text));
}

export function useConfirm() {
  return useContext(ConfirmContext) || nativeConfirm;
}

export default ConfirmProvider;
