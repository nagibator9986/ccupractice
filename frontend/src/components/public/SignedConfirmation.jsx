import { CircleCheck, Download } from "lucide-react";
import { signingApi } from "../../api/endpoints.js";
import { formatDate, formatDateTime } from "../../utils/format.js";
import { stepLabel } from "./SigningProgress.jsx";

/**
 * Large success state shown instead of the "ready to sign" banner once this
 * signer's ЭЦП is stored. `waitingRoles` = parties that have not signed yet.
 */
export default function SignedConfirmation({ token, signedAt, waitingRoles = [], hasPdf, hasDocx, expiresAt }) {
  const everyoneSigned = waitingRoles.length === 0;
  return (
    <section className="card mb-4 sm:mb-5 p-5 sm:p-7 ring-1 ring-emerald-200" role="status" aria-label="Договор подписан">
      <div className="flex flex-col gap-5 md:flex-row md:items-start md:justify-between">
        <div className="flex gap-4">
          <span className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-emerald-50 text-emerald-600" aria-hidden="true">
            <CircleCheck className="h-8 w-8" />
          </span>
          <div className="min-w-0">
            <h2 className="font-serif text-2xl font-bold leading-tight text-charcoal-900">Договор подписан с вашей стороны</h2>
            <p className="mt-1 text-sm text-charcoal-600">
              {signedAt ? <>Подпись сохранена {formatDateTime(signedAt)}. </> : "Подпись сохранена. "}
              Спасибо — больше ничего делать не нужно.
            </p>
            <div className="mt-3 rounded-xl bg-charcoal-50 px-3.5 py-3 text-sm text-charcoal-700">
              <div className="font-semibold text-charcoal-900">Что дальше</div>
              <p className="mt-0.5">
                {everyoneSigned
                  ? "Все три стороны подписали договор. Колледж оформит итоговый комплект документов."
                  : `Остальные стороны подписывают независимо от вас. Ожидаем: ${waitingRoles.map(stepLabel).join(", ")}. Колледж свяжется с вами, если потребуется.`}
              </p>
            </div>
          </div>
        </div>

        <div className="grid shrink-0 gap-2 sm:grid-cols-2 md:w-60 md:grid-cols-1">
          {hasPdf && (
            <a className="btn-primary" href={signingApi.publicDownloadUrl(token, "pdf")} download>
              <Download className="h-4 w-4" aria-hidden="true" />
              Скачать PDF с листом подписей
            </a>
          )}
          {hasDocx && (
            <a className="btn-secondary" href={signingApi.publicDownloadUrl(token, "docx")} download>
              <Download className="h-4 w-4" aria-hidden="true" />
              Скачать DOCX
            </a>
          )}
        </div>
      </div>
      {expiresAt && (
        <p className="mt-4 text-xs text-charcoal-500">
          Ссылка остаётся доступной для просмотра и скачивания до {formatDate(expiresAt)}.
        </p>
      )}
    </section>
  );
}
