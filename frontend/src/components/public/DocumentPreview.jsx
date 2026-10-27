import { useState } from "react";
import { Download, ExternalLink, FileText, FileX } from "lucide-react";
import { signingApi } from "../../api/endpoints.js";
import { Skeleton } from "../Skeleton.jsx";

// iPhone / iPad Safari embeds a PDF as a single (first) page. A hint is enough
// here; the open-in-new-tab button is always shown regardless.
function isIOSLike() {
  if (typeof navigator === "undefined") return false;
  try {
    const ua = navigator.userAgent || "";
    return /iPad|iPhone|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  } catch {
    return false;
  }
}

function pdfEmbeddable() {
  if (typeof navigator === "undefined") return true;
  // `false` only when the browser reports it has no built-in PDF viewer.
  return navigator.pdfViewerEnabled !== false;
}

/**
 * The visual centre of the signing page: the signer must be able to READ the
 * document before putting an ЭЦП on it. PDF inline when it exists, always with
 * open / download buttons next to it (mobile Safari often cannot embed PDFs).
 *
 * `revision` changes whenever a signature is added so the embedded PDF (which
 * carries the signature annex) is fetched again.
 */
export default function DocumentPreview({ token, hasPdf, hasDocx, revision = 0 }) {
  const [loaded, setLoaded] = useState(false);
  const previewUrl = signingApi.publicPreviewUrl(token);
  const src = `${previewUrl}&v=${revision}`;
  const embed = hasPdf && pdfEmbeddable();
  const ios = embed && isIOSLike();

  return (
    <section className="card overflow-hidden" aria-label="Текст договора">
      <header className="flex flex-wrap items-center justify-between gap-3 px-4 sm:px-5 py-3.5 border-b border-charcoal-100">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="h-9 w-9 shrink-0 grid place-items-center rounded-xl bg-coral-50 text-coral-600" aria-hidden="true">
            <FileText className="h-[18px] w-[18px]" />
          </span>
          <div className="min-w-0">
            <h2 className="text-base font-semibold leading-snug text-charcoal-900">Текст договора</h2>
            <p className="text-xs text-charcoal-500">Прочитайте документ полностью перед подписанием</p>
          </div>
        </div>
        <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto">
          {hasPdf && (
            <a className="btn-secondary" href={src} target="_blank" rel="noreferrer">
              <ExternalLink className="h-4 w-4" aria-hidden="true" />
              Открыть PDF
            </a>
          )}
          {hasPdf && (
            <a className="btn-secondary" href={signingApi.publicDownloadUrl(token, "pdf")} download>
              <Download className="h-4 w-4" aria-hidden="true" />
              Скачать PDF
            </a>
          )}
          {hasDocx && (
            <a className="btn-secondary" href={signingApi.publicDownloadUrl(token, "docx")} download>
              <Download className="h-4 w-4" aria-hidden="true" />
              Скачать DOCX
            </a>
          )}
        </div>
      </header>

      {embed ? (
        <>
          <div className="relative h-[70vh] min-h-[420px] bg-charcoal-50 lg:h-[78vh]">
            {!loaded && (
              <div className="absolute inset-0 p-4 space-y-3" aria-hidden="true">
                <Skeleton className="h-5 w-1/3" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-5/6" />
                <Skeleton className="h-4 w-2/3" />
              </div>
            )}
            <iframe
              key={revision}
              title="Договор практики (PDF)"
              src={src}
              className="relative h-full w-full border-0"
              onLoad={() => setLoaded(true)}
            />
          </div>
          <p className="px-4 sm:px-5 py-3 text-xs text-charcoal-500 border-t border-charcoal-100">
            {ios
              ? "На iPhone и iPad в окне виден только первый лист — нажмите «Открыть PDF», чтобы прочитать весь документ."
              : "Документ не отображается? Нажмите «Открыть PDF» или скачайте файл."}
          </p>
        </>
      ) : (
        <div className="flex flex-col items-center px-4 py-10 text-center">
          <span className="mb-3 grid h-12 w-12 place-items-center rounded-2xl bg-charcoal-50 text-charcoal-400 ring-1 ring-charcoal-100" aria-hidden="true">
            <FileX className="h-6 w-6" />
          </span>
          <h3 className="text-base font-semibold text-charcoal-800">Просмотр в браузере недоступен</h3>
          <p className="mt-1 max-w-md text-sm text-charcoal-500">
            {hasPdf
              ? "Ваш браузер не показывает PDF внутри страницы. Откройте файл кнопкой выше."
              : hasDocx
                ? "PDF-версия договора не сформирована. Скачайте DOCX и прочитайте документ перед подписанием."
                : "Файл договора ещё не сформирован. Обратитесь в колледж."}
          </p>
        </div>
      )}
    </section>
  );
}
