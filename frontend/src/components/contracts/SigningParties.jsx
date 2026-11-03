import { useRef, useState } from "react";
import {
  ArrowLeftRight,
  CalendarClock,
  CircleAlert,
  CircleCheck,
  CircleDashed,
  CircleX,
  Clock,
  Eye,
  FileSearch,
  FileUp,
  Hourglass,
  Link2,
  MessageCircle,
  PenLine,
  RefreshCw,
  Share2,
  Send,
  Ban,
  UserRound,
} from "lucide-react";
import clsx from "clsx";
import SectionCard from "../SectionCard.jsx";
import CopyButton from "../CopyButton.jsx";
import { toneOf } from "../../utils/tones.js";
import { whatsappUrl } from "../../utils/format.js";
import MenuButton from "./MenuButton.jsx";
import SignMethodChip from "./SignMethodChip.jsx";
import {
  CAPACITY_REP,
  REP_REASON,
  REQUEST_STATE_META,
  ROLES,
  SIGN_METHOD_META,
  buildSignMessage,
  capacityOf,
  expiryText,
  fmtDateTime,
  methodOf,
  partyTitle,
  requestState,
  roleHint,
  signUrlOf,
} from "./contractFlow.js";

const STATE_ICON = {
  none: CircleDashed,
  pending: Clock,
  viewed: Eye,
  expired: CircleAlert,
  signed: CircleCheck,
  scan_wait: Hourglass,
  scan_pending: FileSearch,
  scan_rejected: CircleX,
};

function StateBadge({ state, role }) {
  let meta = REQUEST_STATE_META[state];
  // The college signs on this page, it never needs a link: "not signed" says it better.
  if (role === "college" && state === "none") meta = { label: "Не подписано", tone: "slate" };
  const Icon = STATE_ICON[state] || CircleDashed;
  return (
    <span className={clsx("badge", toneOf(meta.tone).badge)}>
      <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      {meta.label}
    </span>
  );
}

/** «ЭЦП | Бумага + скан» — the choice made when a link is created. */
function MethodPicker({ value, onChange, disabled, label }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-xl bg-charcoal-100/70 p-0.5">
      {Object.entries(SIGN_METHOD_META).map(([key, meta]) => {
        const on = value === key;
        return (
          <button
            key={key}
            type="button"
            role="radio"
            aria-checked={on}
            disabled={disabled}
            onClick={() => onChange(key)}
            className={clsx(
              "rounded-[10px] px-3 py-1.5 text-xs font-semibold transition max-sm:min-h-[40px] disabled:opacity-50",
              on ? "bg-white text-charcoal-900 shadow-sm ring-1 ring-charcoal-200" : "text-charcoal-500 hover:text-charcoal-800",
            )}
          >
            {meta.label}
          </button>
        );
      })}
    </div>
  );
}

/** The paper part of a row: what the signer has uploaded and what the college does about it. */
function ScanBox({ state, req, signed, isAdmin, busy, onView, onAccept, onReject }) {
  const scan = req?.scan || {};
  if (signed) {
    if (!isAdmin || !scan.has_file) return null;
    return (
      <div className="mt-2 flex flex-wrap items-center gap-2 rounded-xl bg-teal-50 px-3 py-2 text-sm text-teal-900 ring-1 ring-teal-100">
        <CircleCheck className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span className="min-w-0 flex-1">Скан принят{scan.reviewed_at ? ` ${fmtDateTime(scan.reviewed_at)}` : ""} — он стал подписью стороны.</span>
        <button type="button" className="btn-secondary btn-sm max-sm:min-h-[44px]" onClick={() => onView(req)}>
          <Eye className="h-4 w-4" aria-hidden="true" />
          Открыть скан
        </button>
      </div>
    );
  }
  if (state === "scan_pending") {
    return (
      <div className="mt-2 rounded-xl bg-blue-50 px-3 py-2.5 text-sm text-blue-900 ring-1 ring-blue-200" role="status">
        <div className="flex items-start gap-2">
          <FileSearch className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <div className="font-semibold">Скан загружен {fmtDateTime(scan.uploaded_at)}</div>
            <div className="text-xs text-blue-800">
              Это ещё не подпись: скан станет ею после того, как вы его примете.
              {scan.name ? ` Файл: ${scan.name}.` : ""}
            </div>
          </div>
        </div>
        {isAdmin && (
          <div className="mt-2.5 flex flex-wrap gap-2">
            <button type="button" className="btn-secondary btn-sm max-sm:min-h-[44px]" onClick={() => onView(req)}>
              <Eye className="h-4 w-4" aria-hidden="true" />
              Открыть скан
            </button>
            <button type="button" className="btn-success btn-sm max-sm:min-h-[44px]" onClick={() => onAccept(req)} disabled={busy}>
              <CircleCheck className="h-4 w-4" aria-hidden="true" />
              Принять
            </button>
            <button type="button" className="btn-secondary btn-sm !text-red-700 max-sm:min-h-[44px]" onClick={() => onReject(req)} disabled={busy}>
              <CircleX className="h-4 w-4" aria-hidden="true" />
              Отклонить
            </button>
          </div>
        )}
      </div>
    );
  }
  // A rejected scan keeps its reason on screen even when the link has expired meanwhile.
  if (state === "scan_rejected" || (state === "expired" && scan.review === "rejected")) {
    return (
      <div className="mt-2 rounded-xl bg-red-50 px-3 py-2.5 text-sm text-red-900 ring-1 ring-red-200" role="status">
        <div className="flex items-start gap-2">
          <CircleX className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <div className="font-semibold">Скан отклонён{scan.reviewed_at ? ` ${fmtDateTime(scan.reviewed_at)}` : ""}</div>
            {scan.review_note && <div className="mt-0.5 break-words text-xs">Причина, которую увидел подписант: «{scan.review_note}»</div>}
            <div className="mt-0.5 text-xs text-red-800">
              {state === "expired"
                ? "Срок ссылки истёк — продлите её, чтобы подписант мог загрузить новый скан."
                : "Ждём новый скан — подписант может загрузить его по той же ссылке."}
            </div>
          </div>
        </div>
        {isAdmin && scan.has_file && (
          <div className="mt-2">
            <button type="button" className="btn-secondary btn-sm max-sm:min-h-[44px]" onClick={() => onView(req)}>
              <Eye className="h-4 w-4" aria-hidden="true" />
              Открыть отклонённый скан
            </button>
          </div>
        )}
      </div>
    );
  }
  if (state === "scan_wait") {
    return (
      <div className="mt-2 flex items-start gap-2 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900 ring-1 ring-amber-100">
        <Hourglass className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        <span className="min-w-0">
          Ждём скан от подписанта. Он скачивает договор по ссылке, подписывает на бумаге и загружает фото или PDF.
        </span>
      </div>
    );
  }
  return null;
}

function PartyRow({
  role,
  contract,
  req,
  signature,
  state,
  isAdmin,
  busyKey,
  ncaAvailable,
  onInvite,
  onShare,
  onExtend,
  onResend,
  onRevoke,
  onSignCollege,
  onViewScan,
  onAcceptScan,
  onRejectScan,
  onAdminUpload,
  onSetMethod,
}) {
  const busy = !!busyKey;
  const fileRef = useRef(null);
  const signed = state === "signed";
  const hasLink = !!req && state !== "none" && state !== "signed";
  const capacity = capacityOf({ role, req, signature, contract });
  const rep = capacity === CAPACITY_REP;
  const method = methodOf({ role, req, signature, contract });
  const paper = method === "scan";

  // Method of a NEW link: the student card decides for the student, ЭЦП for the others.
  const defaultMethod = role === "student" && contract.student_sign_method === "scan" ? "scan" : "ecp";
  const [picked, setPicked] = useState(null);
  const pickedMethod = picked ?? defaultMethod;

  const url = signUrlOf(req);
  const message = hasLink
    ? buildSignMessage({
        name: req.recipient_name,
        number: contract.number,
        studentName: contract.student_name,
        url,
        expiresAt: req.expires_at,
        method: req.method,
        capacity: req.signer_capacity,
      })
    : "";

  const personName = signature?.signer_full_name || req?.recipient_name || "";
  const title = partyTitle(role, capacity);
  const scanPending = state === "scan_pending";
  const otherMethod = req?.method === "scan" ? "ecp" : "scan";

  function onFiles(e) {
    const files = Array.from(e.target.files || []);
    e.target.value = "";
    if (files.length) onAdminUpload(req, files);
  }

  const menuItems = hasLink
    ? [
        { key: "extend", label: "Продлить на 30 дней (адрес прежний)", icon: CalendarClock, onClick: () => onExtend(req) },
        {
          key: "method",
          label: scanPending
            ? "Сменить способ — сначала решите по скану"
            : otherMethod === "scan"
            ? "Сменить способ: подписать на бумаге (скан)"
            : "Сменить способ: подписать ЭЦП",
          icon: ArrowLeftRight,
          disabled: scanPending,
          onClick: () => onSetMethod(req, otherMethod),
        },
        {
          key: "upload",
          label: "Загрузить скан за подписанта",
          icon: FileUp,
          onClick: () => fileRef.current?.click(),
        },
        { key: "resend", label: "Новая ссылка (старая перестанет работать)", icon: RefreshCw, divider: true, onClick: () => onResend(req) },
        { key: "revoke", label: "Отозвать ссылку", icon: Ban, danger: true, onClick: () => onRevoke(req) },
      ]
    : [];

  return (
    <li className="flex flex-col gap-3 py-4">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-semibold text-charcoal-900">
            {title}
            {rep && personName ? <span className="font-medium text-charcoal-700"> — {personName}</span> : null}
          </span>
          <StateBadge state={state} role={role} />
          <SignMethodChip method={method} />
        </div>
        {rep && (
          <div className="mt-0.5 text-xs font-medium text-amber-800">
            Подписывает за студента «{contract.student_name}» — {REP_REASON}
          </div>
        )}
        <div className="mt-0.5 text-xs text-charcoal-500">{roleHint(role, capacity, method)}</div>
        {!rep && personName && (
          <div className="mt-1 flex items-center gap-1.5 text-sm text-charcoal-700">
            <UserRound className="h-3.5 w-3.5 shrink-0 text-charcoal-400" aria-hidden="true" />
            {personName}
          </div>
        )}
        {signed ? (
          <div className="mt-0.5 text-xs text-emerald-700">
            Подписано {fmtDateTime(signature?.created_at || req?.signed_at)}
            {signature?.channel === "scan" ? " — по скану, который принял колледж" : ""}
          </div>
        ) : (
          req &&
          state !== "none" &&
          state !== "scan_pending" && (
            <div className={clsx("mt-0.5 flex items-center gap-1.5 text-xs", state === "expired" ? "text-red-700" : "text-charcoal-500")}>
              <CalendarClock className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              Ссылка действует {expiryText(req)}
            </div>
          )
        )}
        {isAdmin && state === "none" && role !== "college" && paper && !signed && (
          <div className="mt-0.5 text-xs text-teal-800">
            По умолчанию будет создана ссылка для загрузки скана — способ можно выбрать ниже.
          </div>
        )}
        <ScanBox
          state={state}
          req={req}
          signed={signed}
          isAdmin={isAdmin}
          busy={busy}
          onView={onViewScan}
          onAccept={onAcceptScan}
          onReject={onRejectScan}
        />
      </div>

      {isAdmin && !signed && (
        <div className="flex flex-wrap items-center gap-2">
          {hasLink && (
            <>
              <button type="button" className="btn-secondary btn-sm max-sm:min-h-[44px]" onClick={() => onShare(req)}>
                <Share2 className="h-4 w-4" aria-hidden="true" />
                Поделиться
              </button>
              <CopyButton text={url} label="Копировать ссылку" copiedLabel="Скопирована" className="max-sm:min-h-[44px]" />
              <a
                className="btn-secondary btn-sm max-sm:min-h-[44px]"
                href={whatsappUrl(req.recipient_phone, message)}
                target="_blank"
                rel="noreferrer"
                title={req.recipient_phone ? "Открыть WhatsApp с номером получателя" : "Номер не указан — контакт придётся выбрать в WhatsApp самому"}
              >
                <MessageCircle className="h-4 w-4" aria-hidden="true" />
                WhatsApp
              </a>
              {paper && !scanPending && (
                <button
                  type="button"
                  className="btn-secondary btn-sm max-sm:min-h-[44px]"
                  onClick={() => fileRef.current?.click()}
                  disabled={busy}
                  title="Бумагу прислали другим путём (WhatsApp, почта) — прикрепите скан сами"
                >
                  <FileUp className="h-4 w-4" aria-hidden="true" />
                  Загрузить скан за подписанта
                </button>
              )}
              <MenuButton
                label={`Другие действия: ${title}`}
                className="btn-secondary btn-sm btn-icon max-sm:!h-11 max-sm:!w-11"
                items={menuItems}
                disabled={busy}
              />
              <input
                ref={fileRef}
                type="file"
                multiple
                accept=".pdf,image/jpeg,image/png"
                className="sr-only"
                tabIndex={-1}
                aria-hidden="true"
                onChange={onFiles}
              />
            </>
          )}
          {!hasLink && role !== "college" && contract.docx_path && (
            <>
              <button
                type="button"
                className="btn-secondary btn-sm max-sm:min-h-[44px]"
                onClick={() => onInvite([role], { [role]: pickedMethod })}
                disabled={busy}
              >
                <Link2 className="h-4 w-4" aria-hidden="true" />
                Создать ссылку
              </button>
              <MethodPicker value={pickedMethod} onChange={setPicked} disabled={busy} label={`Способ подписания: ${title}`} />
            </>
          )}
          {role === "college" && (
            <button
              type="button"
              className="btn-primary btn-sm max-sm:min-h-[44px]"
              onClick={onSignCollege}
              disabled={busy || !contract.docx_path || ncaAvailable === false}
              title={
                !contract.docx_path
                  ? "Сначала сформируйте договор"
                  : ncaAvailable === false
                  ? "NCALayer не запущен"
                  : "Откроется NCALayer для подписи ЭЦП директора"
              }
            >
              <PenLine className="h-4 w-4" aria-hidden="true" />
              Подписать здесь
            </button>
          )}
        </div>
      )}
    </li>
  );
}

/**
 * One row per party (college · partner · student / legal representative): who, how
 * (ЭЦП or paper + scan), where it stands, and — for the admin — everything to do with the
 * signing link and with the scans that wait for the college's decision.
 * `isAdmin=false` shows status only (the viewer never sees tokens or scans).
 */
export default function SigningParties({
  contract,
  requests = [],
  isAdmin,
  busyKey,
  ncaAvailable,
  onInvite,
  onShare,
  onExtend,
  onResend,
  onRevoke,
  onSignCollege,
  onViewScan,
  onAcceptScan,
  onRejectScan,
  onAdminUpload,
  onSetMethod,
}) {
  const busy = !!busyKey;
  const signedRoles = contract.signed_roles || [];
  const allSigned = ROLES.every((r) => signedRoles.includes(r));

  const rows = ROLES.map((role) => {
    const signature = (contract.signatures || []).find((s) => s.signer_role === role) || null;
    // Newest non-revoked link of the role (the API lists newest first).
    const req = requests.find((r) => r.signer_role === role && r.status !== "revoked") || null;
    let state;
    if (signedRoles.includes(role)) state = "signed";
    else if (isAdmin) state = requestState(req);
    else state = (contract.invited_roles || []).includes(role) ? "pending" : "none";
    return { role, signature, req, state };
  });

  // A viewer has no links, only the summary: say that a scan is waiting, even if not whose.
  const viewerScans = !isAdmin ? contract.scans_to_review || 0 : 0;

  const header = isAdmin && !allSigned && (
    <>
      <button
        type="button"
        className={contract.next_action === "invite" ? "btn-primary btn-sm max-sm:min-h-[44px]" : "btn-secondary btn-sm max-sm:min-h-[44px]"}
        onClick={() => onInvite(["partner", "student"])}
        disabled={busy || !contract.docx_path}
        title={
          contract.student_sign_method === "scan"
            ? "Способ для студента — бумага и скан (так задано в карточке студента); предприятию — ЭЦП"
            : undefined
        }
      >
        <Send className="h-4 w-4" aria-hidden="true" />
        Отправить партнёру и студенту
      </button>
      <button type="button" className="btn-secondary btn-sm max-sm:min-h-[44px]" onClick={() => onInvite(["college", "partner", "student"])} disabled={busy || !contract.docx_path}>
        Отправить всем
      </button>
    </>
  );

  return (
    <div id="signing-parties" className="scroll-mt-20">
      <SectionCard
        title="Подписи сторон"
        icon={PenLine}
        description={
          isAdmin
            ? "Ссылки создаются здесь, а отправляете их вы — через WhatsApp, почту или Telegram. Кто не может подписать ЭЦП, подписывает на бумаге и загружает скан."
            : "Кто уже подписал договор и от кого ещё ждём подпись."
        }
        actions={header || undefined}
      >
        {isAdmin && !contract.docx_path && (
          <div className="mb-3 rounded-xl bg-amber-50 px-3.5 py-2.5 text-sm text-amber-800 ring-1 ring-amber-100">
            Сначала сформируйте договор — тогда можно будет создать ссылки на подпись.
          </div>
        )}
        {viewerScans > 0 && (
          <div className="mb-3 flex items-start gap-2 rounded-xl bg-blue-50 px-3.5 py-2.5 text-sm text-blue-900 ring-1 ring-blue-100">
            <FileSearch className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>
              {viewerScans === 1 ? "Один скан бумажного договора ждёт проверки" : `Сканов бумажного договора ждут проверки: ${viewerScans}`}
              — решение принимает администратор колледжа.
            </span>
          </div>
        )}
        <ul className="divide-y divide-charcoal-100">
          {rows.map((r) => (
            <PartyRow
              key={r.role}
              role={r.role}
              contract={contract}
              req={r.req}
              signature={r.signature}
              state={r.state}
              isAdmin={isAdmin}
              busyKey={busyKey}
              ncaAvailable={ncaAvailable}
              onInvite={onInvite}
              onShare={onShare}
              onExtend={onExtend}
              onResend={onResend}
              onRevoke={onRevoke}
              onSignCollege={onSignCollege}
              onViewScan={onViewScan}
              onAcceptScan={onAcceptScan}
              onRejectScan={onRejectScan}
              onAdminUpload={onAdminUpload}
              onSetMethod={onSetMethod}
            />
          ))}
        </ul>
      </SectionCard>
    </div>
  );
}
