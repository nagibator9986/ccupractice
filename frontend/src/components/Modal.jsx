import { useId, useRef } from "react";
import { X } from "lucide-react";
import clsx from "clsx";
import useDialog from "../hooks/useDialog.js";

// Full class strings so Tailwind's JIT can see them.
const SIZES = {
  sm: "sm:max-w-md",
  md: "sm:max-w-xl",
  lg: "sm:max-w-3xl",
  xl: "sm:max-w-5xl",
  "2xl": "sm:max-w-6xl",
  full: "sm:max-w-[calc(100vw-2rem)] sm:h-[calc(100vh-2rem)] sm:max-h-[calc(100vh-2rem)]",
};

/**
 * Dialog on >=640px, bottom sheet below. Focus trap / Esc / scroll lock live in
 * useDialog (ref-based onClose — see the comment there before touching it).
 * Put `data-autofocus` on an element to choose what gets focus on open.
 */
export default function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  footerLeft,
  size = "lg",
  bodyClassName,
}) {
  const cardRef = useRef(null);
  // Remember where the press STARTED: selecting text in an input and releasing
  // the mouse over the overlay fires a click on the overlay and used to close
  // the dialog (and lose the user's edits).
  const pressedOverlay = useRef(false);
  const titleId = useId();
  const descId = useId();
  useDialog(open, cardRef, onClose);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4 bg-charcoal-900/50 backdrop-blur-sm animate-[fadeIn_120ms_ease-out]"
      onMouseDown={(e) => {
        pressedOverlay.current = e.target === e.currentTarget;
      }}
      onClick={(e) => {
        // Click on the overlay (not bubbled from card) closes the modal
        if (e.target === e.currentTarget && pressedOverlay.current) onClose?.();
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby={title ? titleId : undefined}
      aria-describedby={description ? descId : undefined}
    >
      <div
        ref={cardRef}
        tabIndex={-1}
        className={clsx(
          "card-elev w-full flex flex-col outline-none",
          "max-h-[92vh] rounded-b-none sm:rounded-b-3xl",
          size !== "full" && "sm:max-h-[90vh]",
          "animate-[sheetUp_220ms_ease-out] sm:animate-[slideUp_180ms_ease-out]",
          SIZES[size] || SIZES.lg,
        )}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Grab-handle affordance for the sheet; decorative. */}
        <div className="sm:hidden pt-2 flex justify-center" aria-hidden="true">
          <span className="h-1 w-10 rounded-full bg-charcoal-200" />
        </div>
        <header className="flex items-start justify-between gap-3 px-4 sm:px-6 py-3 sm:py-4 border-b border-charcoal-100">
          <div className="min-w-0">
            <h2 id={titleId} className="font-serif font-semibold text-lg text-charcoal-900 leading-snug">
              {title}
            </h2>
            {description && (
              <p id={descId} className="mt-0.5 text-sm text-charcoal-500">
                {description}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="h-11 w-11 sm:h-9 sm:w-9 -mr-2 sm:mr-0 shrink-0 grid place-items-center rounded-lg text-charcoal-400 hover:text-charcoal-700 hover:bg-charcoal-100 transition"
            aria-label="Закрыть"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </header>
        <div className={clsx("flex-1 overflow-y-auto px-4 sm:px-6 py-4 sm:py-5", bodyClassName)}>
          {children}
        </div>
        {(footer || footerLeft) && (
          <footer className="px-4 sm:px-6 py-3 sm:py-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] border-t border-charcoal-100 flex flex-wrap items-center gap-2 bg-charcoal-50/40 sm:rounded-b-3xl">
            {footerLeft && <div className="mr-auto flex flex-wrap items-center gap-2">{footerLeft}</div>}
            {footer && <div className="ml-auto flex flex-wrap justify-end gap-2">{footer}</div>}
          </footer>
        )}
      </div>
    </div>
  );
}
