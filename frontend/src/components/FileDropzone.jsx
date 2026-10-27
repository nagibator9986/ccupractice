import { useId, useRef, useState } from "react";
import { FileText, Loader2, UploadCloud } from "lucide-react";
import clsx from "clsx";
import { formatBytes } from "../utils/format.js";

// accept=".xlsx,.csv" and/or MIME entries ("application/pdf", "image/*").
function matchesAccept(file, accept) {
  const rules = String(accept || "")
    .split(",")
    .map((r) => r.trim().toLowerCase())
    .filter(Boolean);
  if (rules.length === 0) return true;
  const name = file.name.toLowerCase();
  const type = (file.type || "").toLowerCase();
  return rules.some((r) => {
    if (r.startsWith(".")) return name.endsWith(r);
    if (r.endsWith("/*")) return type.startsWith(r.slice(0, -1));
    return type === r;
  });
}

export default function FileDropzone({
  accept,
  onFile,
  file,
  onClear,
  hint,
  disabled = false,
  busy = false,
  maxSizeMb = 20,
  onError,
}) {
  const inputRef = useRef(null);
  const [dragging, setDragging] = useState(false);
  const [localError, setLocalError] = useState("");
  const errId = useId();
  const inert = disabled || busy;

  function reject(message) {
    setLocalError(message);
    onError?.(message);
  }

  function handleFiles(list) {
    const f = list?.[0];
    if (!f || inert) return;
    if (!matchesAccept(f, accept)) {
      const allowed = String(accept || "").split(",").map((a) => a.trim()).filter(Boolean).join(", ");
      reject(`Недопустимый формат файла. Разрешены: ${allowed}`);
      return;
    }
    if (f.size > maxSizeMb * 1024 * 1024) {
      reject(`Файл слишком большой (${formatBytes(f.size)}). Максимум ${maxSizeMb} МБ`);
      return;
    }
    setLocalError("");
    onFile?.(f);
  }

  function openPicker() {
    if (!inert) inputRef.current?.click();
  }

  const hiddenInput = (
    <input
      ref={inputRef}
      type="file"
      accept={accept}
      className="sr-only"
      tabIndex={-1}
      aria-hidden="true"
      disabled={inert}
      onChange={(e) => {
        handleFiles(e.target.files);
        // Reset so picking the same file twice (after "Убрать") still fires onChange.
        e.target.value = "";
      }}
    />
  );

  const error = localError && (
    <p id={errId} role="alert" className="mt-2 text-xs text-red-600">
      {localError}
    </p>
  );

  if (file) {
    return (
      <div>
        <div className="flex items-center gap-3 rounded-xl border border-charcoal-200 bg-white p-3">
          <span className="h-10 w-10 shrink-0 grid place-items-center rounded-lg bg-coral-50 text-coral-600" aria-hidden="true">
            {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <FileText className="h-5 w-5" />}
          </span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium text-charcoal-800" title={file.name}>
              {file.name}
            </div>
            <div className="text-xs text-charcoal-500">{formatBytes(file.size)}</div>
          </div>
          <div className="flex shrink-0 gap-1">
            <button type="button" className="btn-ghost btn-sm" onClick={openPicker} disabled={inert}>
              Заменить
            </button>
            <button type="button" className="btn-ghost btn-sm text-red-600 hover:text-red-700 hover:bg-red-50" onClick={onClear} disabled={inert}>
              Убрать
            </button>
          </div>
        </div>
        {hiddenInput}
        {error}
      </div>
    );
  }

  return (
    <div>
      <div
        role="button"
        tabIndex={inert ? -1 : 0}
        aria-disabled={inert || undefined}
        aria-describedby={localError ? errId : undefined}
        onClick={openPicker}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            openPicker();
          }
        }}
        onDragOver={(e) => {
          e.preventDefault();
          if (!inert) setDragging(true);
        }}
        onDragLeave={(e) => {
          // Ignore leave events fired when moving between children.
          if (!e.currentTarget.contains(e.relatedTarget)) setDragging(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          handleFiles(e.dataTransfer?.files);
        }}
        className={clsx(
          "flex flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed px-4 py-8 text-center transition",
          inert ? "cursor-not-allowed opacity-60 border-charcoal-200 bg-charcoal-50/50" : "cursor-pointer",
          !inert && dragging && "border-coral-400 bg-coral-50",
          !inert && !dragging && "border-charcoal-200 bg-charcoal-50/40 hover:border-coral-300 hover:bg-coral-50/40",
        )}
      >
        <span className="h-11 w-11 grid place-items-center rounded-full bg-white text-coral-600 ring-1 ring-charcoal-100 shadow-sm" aria-hidden="true">
          {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <UploadCloud className="h-5 w-5" />}
        </span>
        <p className="mt-2 text-sm font-medium text-charcoal-800">
          {busy ? "Загрузка…" : dragging ? "Отпустите файл здесь" : "Перетащите файл или нажмите для выбора"}
        </p>
        <p className="text-xs text-charcoal-500">
          {hint || [accept && `Форматы: ${accept}`, `до ${maxSizeMb} МБ`].filter(Boolean).join(" · ")}
        </p>
      </div>
      {hiddenInput}
      {error}
    </div>
  );
}
