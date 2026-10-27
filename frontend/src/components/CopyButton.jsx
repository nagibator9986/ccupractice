import { useEffect, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";
import toast from "react-hot-toast";
import clsx from "clsx";

// Clipboard API needs a secure context + user gesture; the textarea path covers
// http:// intranet deployments and older Safari.
async function copyText(text) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      /* permission denied -> try the legacy path */
    }
  }
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.setAttribute("readonly", "");
  ta.style.position = "fixed";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  ta.select();
  try {
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    ta.remove();
  }
}

export default function CopyButton({
  text,
  label = "Копировать",
  copiedLabel = "Скопировано",
  className,
  iconOnly = false,
}) {
  const [copied, setCopied] = useState(false);
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);

  async function onClick() {
    const ok = await copyText(String(text ?? ""));
    if (!ok) {
      toast.error("Не удалось скопировать");
      return;
    }
    setCopied(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 1800);
  }

  const current = copied ? copiedLabel : label;
  const Icon = copied ? Check : Copy;
  return (
    <button
      type="button"
      onClick={onClick}
      className={clsx(iconOnly ? "btn-ghost btn-sm btn-icon" : "btn-secondary btn-sm", copied && "!text-emerald-700", className)}
      aria-label={iconOnly ? current : undefined}
      title={iconOnly ? current : undefined}
    >
      <Icon className="h-4 w-4" aria-hidden="true" />
      {!iconOnly && current}
      {/* Announce the state change for screen-reader users in icon-only mode too. */}
      <span className="sr-only" role="status">
        {copied ? copiedLabel : ""}
      </span>
    </button>
  );
}
