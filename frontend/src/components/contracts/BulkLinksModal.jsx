import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { FileSpreadsheet, Info, MessageCircle, TriangleAlert } from "lucide-react";
import toast from "react-hot-toast";
import Modal from "../Modal.jsx";
import CopyButton from "../CopyButton.jsx";
import { Pagination } from "../Pagination.jsx";
import usePagination from "../../hooks/usePagination.js";
import { errorText, signingApi } from "../../api/endpoints.js";
import { plural, whatsappUrl } from "../../utils/format.js";
import { ROLE_TITLE, buildSignMessage, expiryText, signUrlOf } from "./contractFlow.js";

function LinkRow({ link, number, studentName }) {
  const url = signUrlOf(link);
  const message = buildSignMessage({
    name: link.recipient_name,
    number,
    studentName,
    url,
    expiresAt: link.expires_at,
  });
  return (
    <li className="flex flex-col gap-2 py-2.5 sm:flex-row sm:items-center">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
          <span className="font-medium text-charcoal-800">{ROLE_TITLE[link.signer_role] || link.signer_role}</span>
          {link.recipient_name && <span className="truncate text-charcoal-600">{link.recipient_name}</span>}
          <span className={link.is_new ? "badge bg-emerald-100 text-emerald-700" : "badge bg-charcoal-100 text-charcoal-600"}>
            {link.is_new ? "Новая ссылка" : "Уже была выдана"}
          </span>
        </div>
        {link.expires_at && <div className="mt-0.5 text-xs text-charcoal-500">Действует {expiryText(link)}</div>}
      </div>
      <div className="flex flex-wrap gap-2">
        <CopyButton text={url} label="Ссылка" copiedLabel="Скопирована" className="max-sm:min-h-[44px]" />
        <CopyButton text={message} label="Текст" copiedLabel="Скопирован" className="max-sm:min-h-[44px]" />
        <a
          href={whatsappUrl(link.recipient_phone, message)}
          target="_blank"
          rel="noreferrer"
          className="btn-secondary btn-sm max-sm:min-h-[44px]"
          title={link.recipient_phone ? "Открыть чат WhatsApp с готовым текстом" : "Телефон не указан — контакт придётся выбрать в WhatsApp самому"}
        >
          <MessageCircle className="h-4 w-4" aria-hidden="true" />
          WhatsApp
        </a>
      </div>
    </li>
  );
}

/**
 * Result of "Отправить на подпись": the live links per contract with copy and
 * WhatsApp buttons, plus the Excel export. Nothing is sent by the platform.
 * result = { new_links, items: [{ contract_id, number, student_name, group_name, status, reason, links }] }
 */
export default function BulkLinksModal({ result, onClose }) {
  const [exporting, setExporting] = useState(false);
  const items = useMemo(() => result?.items || [], [result]);
  const withLinks = useMemo(() => items.filter((i) => (i.links || []).length > 0), [items]);
  const skipped = useMemo(() => items.filter((i) => !(i.links || []).length), [items]);
  const pg = usePagination(withLinks, 25, result);
  const linksTotal = withLinks.reduce((n, i) => n + i.links.length, 0);

  async function exportExcel() {
    setExporting(true);
    try {
      await signingApi.exportLinks(withLinks.map((i) => i.contract_id));
    } catch (e) {
      toast.error(await errorText(e, "Не удалось скачать список ссылок"));
    } finally {
      setExporting(false);
    }
  }

  return (
    <Modal
      open={!!result}
      onClose={onClose}
      title="Ссылки на подпись"
      description={
        result
          ? `${linksTotal} ${plural(linksTotal, "ссылка", "ссылки", "ссылок")} для ${withLinks.length} ${plural(withLinks.length, "договора", "договоров", "договоров")}` +
            (result.new_links ? `, из них новых: ${result.new_links}` : "")
          : undefined
      }
      size="lg"
      footerLeft={
        withLinks.length > 0 && (
          <button type="button" className="btn-secondary" onClick={exportExcel} disabled={exporting}>
            <FileSpreadsheet className="h-4 w-4" aria-hidden="true" />
            {exporting ? "Готовим файл…" : "Скачать ссылки (Excel)"}
          </button>
        )
      }
      footer={
        <button type="button" className="btn-primary" onClick={onClose} data-autofocus>
          Готово
        </button>
      }
    >
      {result && (
        <div className="space-y-4">
          <p className="flex gap-2 rounded-xl bg-blue-50 px-3.5 py-3 text-sm text-blue-900 ring-1 ring-blue-100">
            <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>
              Платформа ничего не рассылает сама. Скопируйте ссылку или откройте WhatsApp с готовым текстом — либо скачайте
              Excel со всеми ссылками и текстами сообщений и разошлите оттуда.
            </span>
          </p>

          {skipped.length > 0 && (
            <div className="rounded-xl bg-amber-50 px-3.5 py-3 text-sm text-amber-900 ring-1 ring-amber-200">
              <div className="flex items-center gap-2 font-semibold">
                <TriangleAlert className="h-4 w-4 shrink-0" aria-hidden="true" />
                Без ссылок: {skipped.length}
              </div>
              <ul className="mt-1.5 space-y-0.5">
                {skipped.map((i) => (
                  <li key={i.contract_id}>
                    <Link to={`/contracts/${i.contract_id}`} className="link font-medium">
                      {i.number || `№ ${i.contract_id}`}
                    </Link>
                    {i.student_name ? ` · ${i.student_name}` : ""} — {i.reason || "нет активных ссылок"}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <ul className="space-y-3">
            {pg.pageItems.map((i) => (
              <li key={i.contract_id} className="rounded-xl ring-1 ring-charcoal-100">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-t-xl bg-charcoal-50 px-3.5 py-2.5">
                  <Link to={`/contracts/${i.contract_id}`} className="link text-sm font-semibold">
                    № {i.number}
                  </Link>
                  <span className="text-sm text-charcoal-700">{i.student_name}</span>
                  {i.group_name && <span className="text-xs text-charcoal-500">{i.group_name}</span>}
                </div>
                <ul className="divide-y divide-charcoal-100 px-3.5">
                  {i.links.map((l) => (
                    <LinkRow key={l.id ?? l.token} link={l} number={i.number} studentName={i.student_name} />
                  ))}
                </ul>
              </li>
            ))}
          </ul>
          <Pagination
            page={pg.page}
            totalPages={pg.totalPages}
            total={pg.total}
            pageSize={pg.pageSize}
            onPage={pg.setPage}
            onPageSize={pg.setPageSize}
          />
        </div>
      )}
    </Modal>
  );
}
