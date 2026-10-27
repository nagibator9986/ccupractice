import { useMemo } from "react";
import { ExternalLink, Info, Mail, MessageCircle, Send, TriangleAlert } from "lucide-react";
import Modal from "../Modal.jsx";
import CopyButton from "../CopyButton.jsx";
import { whatsappUrl, formatPhone } from "../../utils/format.js";
import {
  ROLE_TITLE,
  buildSignMessage,
  daysLeft,
  expiryText,
  signUrlOf,
} from "./contractFlow.js";

/**
 * Everything needed to hand one signing link to its recipient.
 * The platform sends NOTHING by itself: this dialog only prepares the link, the
 * text and the buttons that open the clerk's own messenger / mail client.
 *
 * request: item of signingApi.listRequests / invite / resend / bulkInvite
 *          ({ token, sign_url, signer_role, recipient_name, recipient_email,
 *             recipient_phone, expires_at, expired }).
 */
export default function ShareLinkModal({ request, contractNumber, studentName, onClose }) {
  const open = !!request;
  const url = signUrlOf(request);
  const message = useMemo(
    () =>
      request
        ? buildSignMessage({
            name: request.recipient_name,
            number: contractNumber,
            studentName,
            url,
            expiresAt: request.expires_at,
          })
        : "",
    [request, contractNumber, studentName, url],
  );

  const left = request ? daysLeft(request.expires_at) : null;
  const expired = request ? request.expired || (left != null && left < 0) : false;
  const phone = request?.recipient_phone || "";
  const subject = `Договор практики № ${contractNumber} — на подпись`;
  const mailHref = request?.recipient_email
    ? `mailto:${request.recipient_email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(message)}`
    : null;
  const telegramHref = `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(
    message.replace(url, "").replace(/\s+Ссылка:\s*/, " ").trim(),
  )}`;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Ссылка на подпись"
      description={
        request ? `${ROLE_TITLE[request.signer_role] || "Получатель"}${request.recipient_name ? ` — ${request.recipient_name}` : ""}` : undefined
      }
      size="md"
      footer={
        <button type="button" className="btn-secondary" onClick={onClose} data-autofocus>
          Закрыть
        </button>
      }
    >
      {request && (
        <div className="space-y-5">
          {expired && (
            <div className="flex gap-2 rounded-xl bg-red-50 px-3.5 py-3 text-sm text-red-800 ring-1 ring-red-200" role="alert">
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <span>Срок этой ссылки истёк — получатель не сможет по ней подписать. Продлите её или выпустите новую.</span>
            </div>
          )}

          <div>
            <label className="label" htmlFor="share-link-url">
              Ссылка для подписания
            </label>
            <div className="flex flex-col gap-2 sm:flex-row">
              <input
                id="share-link-url"
                className="input flex-1 font-mono text-xs"
                readOnly
                value={url}
                onClick={(e) => e.target.select()}
              />
              <div className="flex gap-2">
                <CopyButton text={url} label="Копировать ссылку" className="flex-1 sm:flex-none max-sm:min-h-[44px]" />
                <a href={url} target="_blank" rel="noreferrer" className="btn-ghost btn-sm max-sm:min-h-[44px]" title="Откроется страница подписания, как её видит получатель">
                  <ExternalLink className="h-4 w-4" aria-hidden="true" />
                  Открыть
                </a>
              </div>
            </div>
            <p className="mt-1.5 text-xs text-charcoal-500">
              {request.expires_at
                ? `Действует ${expiryText(request)}. После подписания ссылка закрывается.`
                : "После подписания ссылка закрывается."}
            </p>
          </div>

          <div>
            <div className="label">Текст сообщения</div>
            <p className="whitespace-pre-line break-words rounded-xl bg-charcoal-50 px-3.5 py-3 text-sm leading-relaxed text-charcoal-700 ring-1 ring-charcoal-100">
              {message}
            </p>
            <div className="mt-2">
              <CopyButton text={message} label="Копировать текст" className="max-sm:min-h-[44px]" />
            </div>
          </div>

          <div>
            <div className="label">Отправить через</div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              <a href={whatsappUrl(phone, message)} target="_blank" rel="noreferrer" className="btn-secondary">
                <MessageCircle className="h-4 w-4" aria-hidden="true" />
                WhatsApp
              </a>
              <a href={telegramHref} target="_blank" rel="noreferrer" className="btn-secondary">
                <Send className="h-4 w-4" aria-hidden="true" />
                Telegram
              </a>
              {mailHref ? (
                <a href={mailHref} className="btn-secondary">
                  <Mail className="h-4 w-4" aria-hidden="true" />
                  Эл. почта
                </a>
              ) : (
                <span className="btn-secondary !cursor-not-allowed opacity-50" aria-disabled="true" title="Адрес электронной почты получателя не указан">
                  <Mail className="h-4 w-4" aria-hidden="true" />
                  Эл. почта
                </span>
              )}
            </div>
            <p className="mt-2 flex gap-1.5 text-xs text-charcoal-500">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span>
                {phone
                  ? `WhatsApp откроется с номером ${formatPhone(phone)}. `
                  : "Номер телефона получателя не указан — в WhatsApp выберите контакт сами. "}
                Платформа ничего не отправляет автоматически: сообщение уйдёт только после того, как вы нажмёте «Отправить» в самом мессенджере.
              </span>
            </p>
          </div>
        </div>
      )}
    </Modal>
  );
}
