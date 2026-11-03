import { useEffect, useId, useRef, useState } from "react";
import toast from "react-hot-toast";
import {
  Camera,
  CircleCheck,
  CircleX,
  Download,
  ExternalLink,
  FileText,
  Loader2,
  Plus,
  Printer,
  Send,
  TriangleAlert,
  UploadCloud,
  X,
} from "lucide-react";
import clsx from "clsx";
import { signingApi } from "../../api/endpoints.js";
import { formatBytes, formatDateTime } from "../../utils/format.js";
import {
  SCAN_ACCEPT,
  SCAN_MAX_IMAGES,
  SCAN_MAX_MB,
  mergeScanFiles,
  scanKind,
  uploadErrorIsStale,
  uploadErrorText,
  utcIso,
} from "./scanUtils.js";

// Phones and tablets: show a dedicated «Сфотографировать» button next to the file picker.
function useCoarsePointer() {
  const [coarse] = useState(() => {
    try {
      return Boolean(window.matchMedia?.("(pointer: coarse)").matches);
    } catch {
      return false;
    }
  });
  return coarse;
}

// Preview URL of a chosen photo, revoked when the row goes away.
function useObjectUrl(file, enabled) {
  const [url, setUrl] = useState(null);
  useEffect(() => {
    if (!enabled || !file) {
      setUrl(null);
      return undefined;
    }
    const u = URL.createObjectURL(file);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [file, enabled]);
  return url;
}

function Step({ n, title, children, last = false }) {
  return (
    <li className="relative flex gap-3">
      {!last && <span className="absolute left-4 top-9 -ml-px h-[calc(100%-1.5rem)] w-px bg-charcoal-200" aria-hidden="true" />}
      <span
        className="relative z-10 grid h-8 w-8 shrink-0 place-items-center rounded-full bg-coral-500 text-sm font-bold text-white"
        aria-hidden="true"
      >
        {n}
      </span>
      <div className="min-w-0 flex-1 pb-1">
        <h3 className="flex min-h-8 items-center text-[15px] font-semibold leading-snug text-charcoal-900">
          <span>
            <span className="sr-only">Шаг {n}. </span>
            {title}
          </span>
        </h3>
        <div className="mt-1 space-y-2.5 text-sm leading-relaxed text-charcoal-600">{children}</div>
      </div>
    </li>
  );
}

function FileRow({ file, index, total, onRemove, disabled }) {
  const kind = scanKind(file);
  const preview = useObjectUrl(file, kind === "image");
  return (
    <li className="flex items-center gap-3 rounded-xl border border-charcoal-200 bg-white p-2.5">
      <span className="grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-lg bg-coral-50 text-coral-600" aria-hidden="true">
        {preview ? <img src={preview} alt="" className="h-full w-full object-cover" /> : <FileText className="h-5 w-5" />}
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-charcoal-800" title={file.name}>
          {file.name}
        </div>
        <div className="text-xs text-charcoal-500">
          {kind === "pdf" ? "PDF" : total > 1 ? `Страница ${index + 1}` : "Фото"} · {formatBytes(file.size)}
        </div>
      </div>
      <button
        type="button"
        className="grid h-11 w-11 shrink-0 place-items-center rounded-xl text-charcoal-500 transition hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
        onClick={onRemove}
        disabled={disabled}
        aria-label={`Убрать файл ${file.name}`}
      >
        <X className="h-5 w-5" aria-hidden="true" />
      </button>
    </li>
  );
}

/** Step 3: choose files -> «Отправить на проверку». The chosen list is always valid for the server. */
function UploadStep({ token, replacing, onCancelReplace, onChanged }) {
  const [files, setFiles] = useState([]);
  const [problems, setProblems] = useState([]); // sentences about files that were left out
  const [serverError, setServerError] = useState("");
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const pickRef = useRef(null);
  const cameraRef = useRef(null);
  const coarse = useCoarsePointer();
  const hintId = useId();
  const errId = useId();

  const hasPdf = files.some((f) => scanKind(f) === "pdf");

  function add(list) {
    if (busy) return;
    const incoming = Array.from(list || []);
    if (incoming.length === 0) return;
    const res = mergeScanFiles(files, incoming);
    setFiles(res.files);
    setProblems(res.errors);
    setServerError("");
  }

  function remove(i) {
    setFiles((cur) => cur.filter((_, idx) => idx !== i));
    setProblems([]);
    setServerError("");
  }

  async function submit() {
    if (busy || files.length === 0) return;
    setBusy(true);
    setServerError("");
    try {
      const res = await signingApi.uploadScan(token, files);
      toast.success("Скан отправлен на проверку");
      setFiles([]);
      setProblems([]);
      setBusy(false);
      onChanged?.(res?.scan);
    } catch (e) {
      setServerError(uploadErrorText(e));
      setBusy(false);
      // The page's picture of this link is outdated (signed elsewhere, switched to ЭЦП…): refresh it.
      if (uploadErrorIsStale(e)) onChanged?.();
    }
  }

  const input = (ref, extra) => (
    <input
      ref={ref}
      type="file"
      className="sr-only"
      tabIndex={-1}
      aria-hidden="true"
      disabled={busy}
      onChange={(e) => {
        add(e.target.files);
        e.target.value = ""; // picking the same file again must fire onChange
      }}
      {...extra}
    />
  );

  return (
    <div className="space-y-3">
      {replacing && (
        <div className="flex items-start justify-between gap-3 rounded-xl bg-amber-50 px-3 py-2.5 text-sm text-amber-900 ring-1 ring-amber-100">
          <span>Новый скан заменит тот, что вы отправили раньше.</span>
          <button type="button" className="link shrink-0 font-medium" onClick={onCancelReplace} disabled={busy}>
            Отмена
          </button>
        </div>
      )}

      {files.length > 0 && (
        <ul className="space-y-2" aria-label="Выбранные файлы">
          {files.map((f, i) => (
            <FileRow key={`${f.name}-${f.size}-${f.lastModified}`} file={f} index={i} total={files.length} onRemove={() => remove(i)} disabled={busy} />
          ))}
        </ul>
      )}

      {files.length === 0 ? (
        <div className="space-y-2">
          <button
            type="button"
            onClick={() => pickRef.current?.click()}
            disabled={busy}
            onDragOver={(e) => {
              e.preventDefault();
              if (!busy) setDragging(true);
            }}
            onDragLeave={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget)) setDragging(false);
            }}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              add(e.dataTransfer?.files);
            }}
            className={clsx(
              "flex w-full flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed px-4 py-7 text-center transition",
              dragging ? "border-coral-400 bg-coral-50" : "border-charcoal-300 bg-charcoal-50/40 hover:border-coral-300 hover:bg-coral-50/40",
            )}
          >
            <span className="grid h-11 w-11 place-items-center rounded-full bg-white text-coral-600 shadow-sm ring-1 ring-charcoal-100" aria-hidden="true">
              <UploadCloud className="h-5 w-5" />
            </span>
            <span className="mt-1.5 text-sm font-semibold text-charcoal-800">
              {dragging ? "Отпустите файлы здесь" : coarse ? "Выбрать фото или файл" : "Выбрать файлы или перетащить сюда"}
            </span>
            <span className="text-xs text-charcoal-500">PDF или фото страниц (JPG, PNG)</span>
          </button>
          {coarse && (
            <button type="button" className="btn-secondary w-full" onClick={() => cameraRef.current?.click()} disabled={busy}>
              <Camera className="h-4 w-4" aria-hidden="true" />
              Сфотографировать страницу
            </button>
          )}
        </div>
      ) : (
        !hasPdf &&
        files.length < SCAN_MAX_IMAGES && (
          <div className={clsx("grid gap-2", coarse && "grid-cols-2")}>
            <button type="button" className="btn-secondary w-full" onClick={() => pickRef.current?.click()} disabled={busy}>
              <Plus className="h-4 w-4" aria-hidden="true" />
              Добавить страницу
            </button>
            {coarse && (
              <button type="button" className="btn-secondary w-full" onClick={() => cameraRef.current?.click()} disabled={busy}>
                <Camera className="h-4 w-4" aria-hidden="true" />
                Сфотографировать
              </button>
            )}
          </div>
        )
      )}

      {input(pickRef, { multiple: true, accept: SCAN_ACCEPT })}
      {coarse && input(cameraRef, { accept: "image/*", capture: "environment" })}

      <p className="text-xs leading-relaxed text-charcoal-500">
        Один PDF-файл или до {SCAN_MAX_IMAGES} фото страниц по порядку (JPG, PNG). Каждый файл — до {SCAN_MAX_MB} МБ.
        Следите, чтобы текст и подпись на снимке были чёткими.
      </p>

      {problems.length > 0 && (
        <div id={errId} role="alert" className="space-y-1 rounded-xl bg-amber-50 px-3 py-2.5 text-sm text-amber-900 ring-1 ring-amber-100">
          {problems.map((p) => (
            <p key={p} className="flex items-start gap-2">
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <span>{p}</span>
            </p>
          ))}
        </div>
      )}

      {serverError && (
        <div role="alert" className="flex items-start gap-2 rounded-xl bg-red-50 px-3 py-2.5 text-sm text-red-800 ring-1 ring-red-200">
          <CircleX className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{serverError}</span>
        </div>
      )}

      <div>
        <button
          type="button"
          className="btn-primary w-full py-3.5 text-base"
          onClick={submit}
          disabled={busy || files.length === 0}
          aria-describedby={hintId}
        >
          {busy ? <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" /> : <Send className="h-5 w-5" aria-hidden="true" />}
          {busy ? "Отправляем…" : "Отправить на проверку"}
        </button>
        <p id={hintId} className="mt-2 text-xs text-charcoal-500" role={busy ? "status" : undefined}>
          {busy
            ? "Не закрывайте страницу, пока идёт отправка — с телефона это может занять минуту."
            : files.length === 0
              ? "Сначала выберите файл или сфотографируйте подписанный договор."
              : "После отправки колледж проверит скан и вы увидите результат на этой странице."}
        </p>
      </div>
    </div>
  );
}

function ScanFileLink({ token, children, className = "btn-secondary w-full" }) {
  return (
    <a className={className} href={signingApi.publicScanFileUrl(token)} target="_blank" rel="noreferrer">
      <ExternalLink className="h-4 w-4" aria-hidden="true" />
      {children}
    </a>
  );
}

function PendingCard({ token, scan, onReplace }) {
  return (
    <div className="space-y-4">
      <div className="rounded-xl bg-emerald-50 p-4 ring-1 ring-emerald-100" role="status">
        <div className="flex items-start gap-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-white text-emerald-600 ring-1 ring-emerald-100" aria-hidden="true">
            <CircleCheck className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <h3 className="text-[15px] font-semibold leading-snug text-emerald-900">
              Скан отправлен{scan?.uploaded_at ? <> {formatDateTime(utcIso(scan.uploaded_at))}</> : null}
            </h3>
            <p className="mt-1 text-sm leading-relaxed text-emerald-900/90">
              Колледж проверит его — вы увидите результат здесь.
            </p>
          </div>
        </div>
      </div>

      <div className="rounded-xl bg-charcoal-50 px-3.5 py-3 text-sm text-charcoal-700">
        <div className="font-semibold text-charcoal-900">Что дальше</div>
        <ol className="mt-1 list-decimal space-y-1 pl-5 text-charcoal-600">
          <li>Сотрудник колледжа смотрит ваш скан.</li>
          <li>Если всё в порядке — договор считается подписанным с вашей стороны.</li>
          <li>Если есть замечания — здесь появится причина, и вы сможете загрузить скан заново.</li>
        </ol>
        <p className="mt-2 text-xs text-charcoal-500">Пока колледж не принял скан, подпись не засчитывается — больше ничего делать не нужно.</p>
      </div>

      <div className="grid gap-2">
        {scan?.has_file !== false && <ScanFileLink token={token}>Посмотреть загруженный скан</ScanFileLink>}
        <button type="button" className="btn-ghost w-full" onClick={onReplace}>
          Заменить скан
        </button>
      </div>
    </div>
  );
}

function RejectedAlert({ token, scan }) {
  const note = (scan?.review_note || "").trim();
  return (
    <div role="alert" className="rounded-xl bg-red-50 p-4 ring-1 ring-red-200">
      <div className="flex items-start gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-white text-red-600 ring-1 ring-red-200" aria-hidden="true">
          <CircleX className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <h3 className="text-[15px] font-semibold leading-snug text-red-900">Скан не принят</h3>
          <p className="mt-1 text-sm leading-relaxed text-red-900">
            {note ? (
              <>
                Причина: <span className="whitespace-pre-line break-words font-medium">{note}</span>
              </>
            ) : (
              "Причина не указана — уточните её в колледже."
            )}
          </p>
          <p className="mt-2 text-sm text-red-900/90">Что делать: исправьте это и загрузите новый скан или фото ниже (шаг 3).</p>
          {scan?.has_file && (
            <div className="mt-3">
              <ScanFileLink token={token} className="btn-secondary btn-sm">Посмотреть отправленный скан</ScanFileLink>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * The signer's block for a link issued for «signing on paper». Numbered steps:
 * download -> print and sign by hand -> upload a scan/photo. State comes from
 * `scan.review`: null (form) · pending (sent, waiting for the college) · rejected (reason + form).
 * `onChanged(scan?)` tells the page to refresh after an upload.
 */
export default function ScanSignPanel({ token, scan, capacity, recipientName, docReady, hasPdf, hasDocx, onChanged }) {
  const review = scan?.review || null;
  const [replacing, setReplacing] = useState(false);
  const isRep = capacity === "legal_representative";

  // The college answered while the form was open — drop the "replace" mode.
  useEffect(() => {
    setReplacing(false);
  }, [review]);

  const showSent = review === "pending" && !replacing;

  return (
    <section id="sign" className="card scroll-mt-4 space-y-4 p-4 sm:p-5" aria-label="Подписание на бумаге">
      <div className="flex items-center gap-2.5">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-coral-50 text-coral-600" aria-hidden="true">
          <Printer className="h-[18px] w-[18px]" />
        </span>
        <h2 className="text-base font-semibold text-charcoal-900">Подписание на бумаге</h2>
      </div>

      {!docReady ? (
        <div className="flex items-start gap-2 rounded-xl bg-amber-50 px-3 py-2.5 text-sm text-amber-900 ring-1 ring-amber-100" role="status">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          Документ ещё не готов — обратитесь в колледж, приславший ссылку.
        </div>
      ) : showSent ? (
        <PendingCard token={token} scan={scan} onReplace={() => setReplacing(true)} />
      ) : (
        <>
          {review === "rejected" && <RejectedAlert token={token} scan={scan} />}
          <ol className="space-y-3">
            <Step n={1} title="Скачайте договор">
              <p>Сохраните файл на телефон или компьютер.</p>
              {hasPdf ? (
                <a className="btn-secondary w-full" href={signingApi.publicDownloadUrl(token, "pdf")} download>
                  <Download className="h-4 w-4" aria-hidden="true" />
                  Скачать договор (PDF)
                </a>
              ) : (
                hasDocx && (
                  <a className="btn-secondary w-full" href={signingApi.publicDownloadUrl(token, "docx")} download>
                    <Download className="h-4 w-4" aria-hidden="true" />
                    Скачать договор (DOCX)
                  </a>
                )
              )}
            </Step>
            <Step n={2} title="Распечатайте и подпишите от руки">
              {isRep ? (
                <p>
                  Договор подписывает законный представитель
                  {recipientName ? <> — <span className="font-medium text-charcoal-800">{recipientName}</span></> : null}.
                </p>
              ) : null}
              <p>Распечатайте все страницы и поставьте подпись ручкой там, где указаны ваши данные.</p>
            </Step>
            <Step n={3} title="Загрузите скан или фото подписанного договора" last>
              <UploadStep token={token} replacing={replacing} onCancelReplace={() => setReplacing(false)} onChanged={onChanged} />
            </Step>
          </ol>
        </>
      )}
    </section>
  );
}
