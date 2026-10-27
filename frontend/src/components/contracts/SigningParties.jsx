import {
  CalendarClock,
  CircleAlert,
  CircleCheck,
  CircleDashed,
  Clock,
  Eye,
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
import {
  REQUEST_STATE_META,
  ROLES,
  ROLE_HINT,
  ROLE_TITLE,
  buildSignMessage,
  expiryText,
  fmtDateTime,
  requestState,
  signUrlOf,
} from "./contractFlow.js";

const STATE_ICON = {
  none: CircleDashed,
  pending: Clock,
  viewed: Eye,
  expired: CircleAlert,
  signed: CircleCheck,
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
}) {
  const busy = !!busyKey;
  const signed = state === "signed";
  const hasLink = !!req && state !== "none" && state !== "signed";
  const url = signUrlOf(req);
  const message = hasLink
    ? buildSignMessage({
        name: req.recipient_name,
        number: contract.number,
        studentName: contract.student_name,
        url,
        expiresAt: req.expires_at,
      })
    : "";

  return (
    <li className="flex flex-col gap-3 py-4">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-semibold text-charcoal-900">{ROLE_TITLE[role]}</span>
          <StateBadge state={state} role={role} />
        </div>
        <div className="mt-0.5 text-xs text-charcoal-500">{ROLE_HINT[role]}</div>
        {(signature?.signer_full_name || req?.recipient_name) && (
          <div className="mt-1 flex items-center gap-1.5 text-sm text-charcoal-700">
            <UserRound className="h-3.5 w-3.5 shrink-0 text-charcoal-400" aria-hidden="true" />
            {signature?.signer_full_name || req.recipient_name}
          </div>
        )}
        {signed ? (
          <div className="mt-0.5 text-xs text-emerald-700">
            Подписано {fmtDateTime(signature?.created_at || req?.signed_at)}
          </div>
        ) : (
          req &&
          state !== "none" && (
            <div className={clsx("mt-0.5 flex items-center gap-1.5 text-xs", state === "expired" ? "text-red-700" : "text-charcoal-500")}>
              <CalendarClock className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              Ссылка действует {expiryText(req)}
            </div>
          )
        )}
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
              <MenuButton
                label={`Другие действия: ${ROLE_TITLE[role]}`}
                className="btn-secondary btn-sm btn-icon max-sm:!h-11 max-sm:!w-11"
                items={[
                  { key: "extend", label: "Продлить на 30 дней (адрес прежний)", icon: CalendarClock, onClick: () => onExtend(req) },
                  { key: "resend", label: "Новая ссылка (старая перестанет работать)", icon: RefreshCw, onClick: () => onResend(req) },
                  { key: "revoke", label: "Отозвать ссылку", icon: Ban, danger: true, divider: true, onClick: () => onRevoke(req) },
                ]}
                disabled={busy}
              />
            </>
          )}
          {!hasLink && role !== "college" && contract.docx_path && (
            <button type="button" className="btn-secondary btn-sm max-sm:min-h-[44px]" onClick={() => onInvite([role])} disabled={busy}>
              <Link2 className="h-4 w-4" aria-hidden="true" />
              Создать ссылку
            </button>
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
 * One row per party (college · partner · student): who, where it stands,
 * and — for the admin — everything to do with the signing link.
 * `isAdmin=false` shows status only (the viewer never sees tokens).
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

  const header = isAdmin && !allSigned && (
    <>
      <button
        type="button"
        className={contract.next_action === "invite" ? "btn-primary btn-sm max-sm:min-h-[44px]" : "btn-secondary btn-sm max-sm:min-h-[44px]"}
        onClick={() => onInvite(["partner", "student"])}
        disabled={busy || !contract.docx_path}
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
            ? "Ссылки создаются здесь, а отправляете их вы — через WhatsApp, почту или Telegram."
            : "Кто уже подписал договор и от кого ещё ждём подпись."
        }
        actions={header || undefined}
      >
        {isAdmin && !contract.docx_path && (
          <div className="mb-3 rounded-xl bg-amber-50 px-3.5 py-2.5 text-sm text-amber-800 ring-1 ring-amber-100">
            Сначала сформируйте договор — тогда можно будет создать ссылки на подпись.
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
            />
          ))}
        </ul>
      </SectionCard>
    </div>
  );
}
