import { useEffect, useRef } from "react";

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

// Open dialogs, oldest first. A confirm opened from inside an edit modal must
// own Esc/Tab on its own: without the stack both document listeners fire and
// one Esc closes the confirm AND the modal underneath.
const stack = [];

// Ref-counted so a nested dialog closing doesn't unlock the page while the
// outer one is still open.
let scrollLocks = 0;
let prevOverflow = "";
function lockScroll() {
  if (scrollLocks === 0) {
    prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
  }
  scrollLocks += 1;
}
function unlockScroll() {
  scrollLocks = Math.max(0, scrollLocks - 1);
  if (scrollLocks === 0) document.body.style.overflow = prevOverflow;
}

/**
 * Shared dialog behaviour (Modal, mobile nav drawer): initial focus, Tab trap,
 * Esc, body scroll lock, focus restore.
 */
export default function useDialog(open, cardRef, onClose) {
  // Keep the latest onClose in a ref so the focus effect can depend ONLY on
  // `open`. Depending on `onClose` (callers pass an inline arrow that is a new
  // reference every render) re-ran the whole effect on every keystroke and the
  // focus-into-dialog call below stole focus back out of the input the user was
  // typing in — the caret jumped after a single character.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const token = {};
    stack.push(token);
    const prevFocus = document.activeElement;

    const card = cardRef.current;
    // Move focus INTO the dialog once, on open. An explicit [data-autofocus]
    // wins (confirm dialogs use it to pick the safe button); otherwise prefer
    // the first real form control so the user can start typing immediately —
    // focusing the header close button instead felt jarring. Falls back to any
    // focusable element, then the card itself. This runs only when `open`
    // flips (the effect depends on [open] alone), so it can never steal focus
    // back mid-typing.
    // (querySelector returns DOM order, not selector order — hence two lookups.)
    const firstField =
      card?.querySelector("[data-autofocus]") ||
      card?.querySelector("input:not([disabled]), select:not([disabled]), textarea:not([disabled])");
    (firstField || card?.querySelector(FOCUSABLE) || card)?.focus();

    const handler = (e) => {
      if (stack[stack.length - 1] !== token) return;
      if (e.key === "Escape") {
        onCloseRef.current?.();
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
    lockScroll();
    return () => {
      document.removeEventListener("keydown", handler);
      const i = stack.indexOf(token);
      if (i >= 0) stack.splice(i, 1);
      unlockScroll();
      // Restore focus to whatever opened the dialog.
      prevFocus?.focus?.();
    };
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
}
