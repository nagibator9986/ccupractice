import { useEffect, useState } from "react";
import { Download, ExternalLink, FileX2, Loader2 } from "lucide-react";
import Modal from "../Modal.jsx";
import { contractsApi, errorText } from "../../api/endpoints.js";

/**
 * Large PDF preview of the contract. The PDF is fetched with the user's token
 * (an <iframe src="/api/…"> could not send it) and shown from a blob URL that
 * is revoked as soon as the dialog closes.
 */
export default function DocumentPreviewModal({ open, onClose, contractId, number, hasPdf, onDownload }) {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return undefined;
    if (!hasPdf) {
      setUrl("");
      setError("");
      return undefined;
    }
    let cancelled = false;
    let created = "";
    setLoading(true);
    setError("");
    setUrl("");
    contractsApi
      .previewUrl(contractId, "pdf")
      .then((u) => {
        if (cancelled) {
          URL.revokeObjectURL(u);
          return;
        }
        created = u;
        setUrl(u);
      })
      .catch(async (e) => {
        if (!cancelled) setError(await errorText(e, "Не удалось открыть PDF"));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
      if (created) URL.revokeObjectURL(created);
    };
  }, [open, contractId, hasPdf]);

  let body;
  if (!hasPdf) {
    body = (
      <Notice
        title="PDF-версии пока нет"
        text="Файл Word сформирован, но PDF не создался — на сервере может не работать конвертер (LibreOffice). Скачайте файл Word или попросите администратора проверить сервер, затем пересформируйте договор."
      />
    );
  } else if (error) {
    body = <Notice title="Не удалось показать документ" text={error} />;
  } else if (loading || !url) {
    body = (
      <div className="grid h-full min-h-[40vh] place-items-center text-sm text-charcoal-500" role="status">
        <span className="inline-flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          Загружаем документ…
        </span>
      </div>
    );
  } else {
    body = <iframe title={`Договор № ${number}`} src={url} className="h-full min-h-[60vh] w-full rounded-lg bg-charcoal-50" />;
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Договор № ${number}`}
      description="Предпросмотр PDF. На телефоне документ может показаться не целиком — откройте его в новой вкладке."
      size="full"
      bodyClassName="!p-2 sm:!p-3"
      footerLeft={
        url && (
          <a className="btn-secondary btn-sm max-sm:min-h-[44px]" href={url} target="_blank" rel="noreferrer">
            <ExternalLink className="h-4 w-4" aria-hidden="true" />
            Открыть в новой вкладке
          </a>
        )
      }
      footer={
        <>
          {hasPdf && onDownload && (
            <button type="button" className="btn-secondary" onClick={onDownload}>
              <Download className="h-4 w-4" aria-hidden="true" />
              Скачать PDF
            </button>
          )}
          <button type="button" className="btn-primary" onClick={onClose} data-autofocus>
            Закрыть
          </button>
        </>
      }
    >
      {body}
    </Modal>
  );
}

function Notice({ title, text }) {
  return (
    <div className="mx-auto flex h-full min-h-[40vh] max-w-md flex-col items-center justify-center px-4 text-center">
      <span className="mb-3 grid h-12 w-12 place-items-center rounded-2xl bg-charcoal-50 text-charcoal-400 ring-1 ring-charcoal-100" aria-hidden="true">
        <FileX2 className="h-6 w-6" />
      </span>
      <h3 className="text-base font-semibold text-charcoal-800">{title}</h3>
      <p className="mt-1 text-sm text-charcoal-500">{text}</p>
    </div>
  );
}
