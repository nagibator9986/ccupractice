import { useEffect, useState } from "react";
import { CircleCheck, CircleX, Download, ExternalLink, FileX2, Loader2, TriangleAlert } from "lucide-react";
import toast from "react-hot-toast";
import Modal from "../Modal.jsx";
import { TextArea } from "../Field.jsx";
import { errorText, signingApi } from "../../api/endpoints.js";
import { fmtDateTime } from "./contractFlow.js";

/**
 * The scan a party uploaded, in a large viewer. The file is fetched with the admin's token
 * (an <iframe src="/api/…"> could not send it) and shown from an object URL that is revoked
 * as soon as the dialog closes.
 *
 * request   — item of signingApi.listRequests (has `scan`), or null (= closed)
 * partyLabel— «Предприятие» / «Законный представитель» …
 * canDecide — admin: show «Принять» / «Отклонить» while the scan is pending
 */
export function ScanViewModal({ request, partyLabel, contractNumber, canDecide, busy, onClose, onAccept, onReject }) {
  const open = !!request;
  const requestId = request?.id;
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open || !requestId) return undefined;
    let cancelled = false;
    let created = "";
    setLoading(true);
    setError("");
    setUrl("");
    signingApi
      .previewScan(requestId)
      .then((u) => {
        if (cancelled) {
          URL.revokeObjectURL(u);
          return;
        }
        created = u;
        setUrl(u);
      })
      .catch(async (e) => {
        if (!cancelled) setError(await errorText(e, "Не удалось открыть скан"));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
      if (created) URL.revokeObjectURL(created);
    };
  }, [open, requestId]);

  async function download() {
    try {
      await signingApi.downloadScan(requestId, `Скан_${contractNumber || requestId}_${request.signer_role}.pdf`);
    } catch (e) {
      toast.error(await errorText(e, "Не удалось скачать скан"));
    }
  }

  const scan = request?.scan || {};
  const pending = scan.review === "pending" && (request?.status === "pending" || request?.status === "viewed");
  const decide = canDecide && pending;

  let body;
  if (error) {
    body = (
      <div className="mx-auto flex h-full min-h-[40vh] max-w-md flex-col items-center justify-center px-4 text-center">
        <span className="mb-3 grid h-12 w-12 place-items-center rounded-2xl bg-charcoal-50 text-charcoal-400 ring-1 ring-charcoal-100" aria-hidden="true">
          <FileX2 className="h-6 w-6" />
        </span>
        <h3 className="text-base font-semibold text-charcoal-800">Не удалось показать скан</h3>
        <p className="mt-1 text-sm text-charcoal-500">{error}</p>
      </div>
    );
  } else if (loading || !url) {
    body = (
      <div className="grid h-full min-h-[40vh] place-items-center text-sm text-charcoal-500" role="status">
        <span className="inline-flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          Загружаем скан…
        </span>
      </div>
    );
  } else {
    body = <iframe title={`Скан: ${partyLabel}`} src={url} className="h-full min-h-[55vh] w-full flex-1 rounded-lg bg-charcoal-50" />;
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Скан договора № ${contractNumber ?? ""}`}
      description={request ? `${partyLabel}${request.recipient_name ? ` — ${request.recipient_name}` : ""}` : undefined}
      size="full"
      bodyClassName="!p-2 sm:!p-3 flex flex-col gap-2"
      footerLeft={
        request && (
          <>
            <button type="button" className="btn-secondary btn-sm max-sm:min-h-[44px]" onClick={download}>
              <Download className="h-4 w-4" aria-hidden="true" />
              Скачать
            </button>
            {url && (
              <a className="btn-secondary btn-sm max-sm:min-h-[44px]" href={url} target="_blank" rel="noreferrer">
                <ExternalLink className="h-4 w-4" aria-hidden="true" />
                Открыть в новой вкладке
              </a>
            )}
          </>
        )
      }
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onClose} data-autofocus={!decide || undefined}>
            Закрыть
          </button>
          {decide && (
            <>
              <button type="button" className="btn-secondary !text-red-700" onClick={() => onReject(request)} disabled={busy}>
                <CircleX className="h-4 w-4" aria-hidden="true" />
                Отклонить
              </button>
              <button type="button" className="btn-success" onClick={() => onAccept(request)} disabled={busy}>
                <CircleCheck className="h-4 w-4" aria-hidden="true" />
                {busy ? "Принимаем…" : "Принять скан"}
              </button>
            </>
          )}
        </>
      }
    >
      {request && (
        <div className="rounded-lg bg-charcoal-50 px-3 py-2 text-xs text-charcoal-600 ring-1 ring-charcoal-100">
          {scan.uploaded_at ? `Загружен ${fmtDateTime(scan.uploaded_at)}` : "Скан загружен"}
          {scan.name ? ` · ${scan.name}` : ""}
          {pending && canDecide && " · Сверьте подписи и печати с договором, затем примите или отклоните скан."}
          {scan.review === "accepted" && " · Скан принят — это подпись стороны."}
          {scan.review === "rejected" && ` · Скан отклонён${scan.review_note ? `: ${scan.review_note}` : ""}`}
        </div>
      )}
      {body}
    </Modal>
  );
}

const QUICK_REASONS = [
  "На скане нет подписи",
  "Подписаны не все страницы",
  "Плохое качество, текст не читается",
  "Загружен не тот документ",
];

/**
 * «Отклонить скан»: the reason is REQUIRED (the signer reads it on their page and uploads again).
 * onSubmit(note) must throw / return false on failure so the dialog stays open.
 */
export function RejectScanModal(props) {
  if (!props.request) return null;
  return <RejectBody key={props.request.id} {...props} />;
}

function RejectBody({ request, partyLabel, busy, onClose, onSubmit }) {
  const [note, setNote] = useState("");
  const [touched, setTouched] = useState(false);
  const trimmed = note.trim();
  const tooShort = trimmed.length < 3;
  const error = touched && tooShort ? "Напишите причину отказа — её увидит подписант (не короче 3 символов)" : undefined;

  function addReason(text) {
    setNote((prev) => {
      const base = prev.trim();
      if (base.includes(text)) return prev;
      return base ? `${base}. ${text}` : text;
    });
  }

  function submit() {
    setTouched(true);
    if (tooShort || busy) return;
    onSubmit(request, trimmed);
  }

  return (
    <Modal
      open
      onClose={busy ? undefined : onClose}
      title="Отклонить скан"
      description={`${partyLabel}${request.recipient_name ? ` — ${request.recipient_name}` : ""}`}
      size="md"
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onClose} disabled={busy}>
            Отмена
          </button>
          <button type="button" className="btn-danger" onClick={submit} disabled={busy}>
            {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
            {busy ? "Отклоняем…" : "Отклонить скан"}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="flex gap-2 rounded-xl bg-amber-50 px-3.5 py-3 text-sm text-amber-900 ring-1 ring-amber-100">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>
            Подписант увидит эту причину на своей странице и сможет загрузить скан заново. Ссылка останется рабочей.
          </span>
        </p>
        <TextArea
          label="Причина отказа"
          required
          rows={4}
          value={note}
          onChange={setNote}
          onBlur={() => setTouched(true)}
          error={error}
          maxLength={500}
          placeholder="Например: на втором листе нет подписи"
          data-autofocus
        />
        <div>
          <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-charcoal-400">Быстрый выбор</div>
          <div className="flex flex-wrap gap-2">
            {QUICK_REASONS.map((r) => (
              <button key={r} type="button" className="chip max-sm:min-h-[40px]" onClick={() => addReason(r)}>
                {r}
              </button>
            ))}
          </div>
        </div>
      </div>
    </Modal>
  );
}
