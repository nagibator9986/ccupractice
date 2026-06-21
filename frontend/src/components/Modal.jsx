import { useEffect, useRef } from "react";

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export default function Modal({ open, onClose, title, children, footer, size = "lg" }) {
  const cardRef = useRef(null);
  const prevFocus = useRef(null);

  useEffect(() => {
    if (!open) return;
    prevFocus.current = document.activeElement;

    const card = cardRef.current;
    (card?.querySelector(FOCUSABLE) || card)?.focus();

    const handler = (e) => {
      if (e.key === "Escape") {
        onClose?.();
        return;
      }
      // Trap Tab inside the dialog so focus can't escape to the inert page
      // behind the overlay (aria-modal="true" promises exactly that).
      if (e.key === "Tab" && card) {
        const nodes = Array.from(card.querySelectorAll(FOCUSABLE)).filter(
          (el) => el.offsetParent !== null,
        );
        if (nodes.length === 0) {
          e.preventDefault();
          card.focus();
          return;
        }
        const first = nodes[0];
        const last = nodes[nodes.length - 1];
        const active = document.activeElement;
        if (e.shiftKey && (active === first || active === card)) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && active === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    document.addEventListener("keydown", handler);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", handler);
      document.body.style.overflow = "";
      // Restore focus to whatever opened the modal.
      prevFocus.current?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;
  const widths = { sm: "max-w-md", md: "max-w-xl", lg: "max-w-3xl", xl: "max-w-5xl" };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-charcoal-900/50 backdrop-blur-sm animate-[fadeIn_120ms_ease-out]"
      onClick={(e) => {
        // Click on the overlay (not bubbled from card) closes the modal
        if (e.target === e.currentTarget) onClose?.();
      }}
      role="dialog"
      aria-modal="true"
    >
      <div
        ref={cardRef}
        tabIndex={-1}
        className={`card-elev w-full ${widths[size]} max-h-[90vh] flex flex-col animate-[slideUp_180ms_ease-out] outline-none`}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between px-6 py-4 border-b border-charcoal-100">
          <h2 className="font-serif font-semibold text-lg text-charcoal-900">{title}</h2>
          <button
            onClick={onClose}
            className="h-8 w-8 grid place-items-center rounded-lg text-charcoal-400 hover:text-charcoal-700 hover:bg-charcoal-100 transition"
            aria-label="Закрыть"
          >
            ✕
          </button>
        </header>
        <div className="flex-1 overflow-y-auto px-6 py-5">{children}</div>
        {footer && (
          <footer className="px-6 py-4 border-t border-charcoal-100 flex justify-end gap-2 bg-charcoal-50/40 rounded-b-3xl">
            {footer}
          </footer>
        )}
      </div>
    </div>
  );
}
