import { ArrowDown, FileCheck2, PenLine } from "lucide-react";
import clsx from "clsx";
import { toneOf } from "../../utils/tones.js";
import { NEXT_ACTION_ICON } from "./NextActionChip.jsx";
import {
  NEXT_ACTION_META,
  ROLES,
  ROLE_TITLE,
  daysLeft,
  expiryText,
  requestState,
} from "./contractFlow.js";

// What a still-missing party looks like in the "waiting" card.
function waitingLine(role, req, isAdmin, invitedRoles) {
  if (!isAdmin) {
    return invitedRoles.includes(role)
      ? { text: "ссылка выдана, ждём подпись", tone: "amber" }
      : { text: "ссылка ещё не выдана", tone: "slate" };
  }
  if (role === "college") {
    return { text: "подписывается здесь, в блоке «Подписи сторон»", tone: "slate" };
  }
  const st = requestState(req);
  if (st === "none") return { text: "ссылка не создана", tone: "red", remind: "Создайте ссылку" };
  if (st === "expired") return { text: `срок ссылки истёк`, tone: "red", remind: "Продлите ссылку" };
  const left = daysLeft(req.expires_at);
  const base = st === "viewed" ? "открыл(а) ссылку, но ещё не подписал(а)" : "ссылка выдана";
  const text = `${base}, действует ${expiryText(req)}`;
  if (left != null && left <= 5) return { text, tone: "amber", remind: "Скоро истекает — продлите" };
  return { text, tone: "slate" };
}

const TONE_TEXT = { red: "text-red-700", amber: "text-amber-700", slate: "text-charcoal-600" };

/**
 * The ONE thing to do with this contract, driven by `contract.next_action`.
 * Viewers see the same card without buttons.
 */
export default function NextStepCard({
  contract,
  requests = [],
  isAdmin,
  busyKey,
  ncaAvailable,
  onGenerate,
  onInvite,
  onComplete,
  onSignCollege,
  onGoParties,
  onGoScan,
}) {
  const action = contract.next_action;
  const meta = NEXT_ACTION_META[action] || NEXT_ACTION_META.generate;
  const tone = toneOf(meta.tone);
  const Icon = NEXT_ACTION_ICON[action] || FileCheck2;
  const busy = !!busyKey;
  const signed = contract.signed_roles || [];
  const pending = ROLES.filter((r) => !signed.includes(r));
  const hasFile = !!contract.docx_path;
  const criticalGaps = contract.readiness?.critical || 0;

  let title;
  let text;
  let buttons = null;
  let extra = null;

  if (action === "generate") {
    title = hasFile ? "Сформируйте договор заново" : "Сформируйте договор";
    text =
      "Данные студента и предприятия подставятся в шаблон — получится файл Word и PDF, который можно отправлять на подпись.";
    if (criticalGaps > 0) {
      text += ` Сейчас не хватает обязательных данных (${criticalGaps}) — заполните их по списку ниже.`;
    }
    buttons = isAdmin && (
      <button type="button" className="btn-primary" onClick={onGenerate} disabled={busy}>
        {busyKey === "generate" ? "Формируем…" : "Сформировать договор"}
      </button>
    );
  } else if (action === "invite") {
    title = "Отправьте договор на подпись";
    text =
      "Для предприятия и студента создадутся личные ссылки. Платформа ничего не рассылает сама — ссылки вы отправите через WhatsApp, почту или Telegram. Подпись колледжа ставится здесь же, на этой странице.";
    buttons = isAdmin && (
      <>
        <button type="button" className="btn-primary" onClick={() => onInvite(["partner", "student"])} disabled={busy}>
          {busyKey === "invite" ? "Создаём ссылки…" : "Создать ссылки предприятию и студенту"}
        </button>
        <button type="button" className="btn-secondary" onClick={onSignCollege} disabled={busy || ncaAvailable === false} title={ncaAvailable === false ? "NCALayer не запущен — запустите его и подтвердите сертификат" : undefined}>
          <PenLine className="h-4 w-4" aria-hidden="true" />
          Подписать за колледж
        </button>
      </>
    );
  } else if (action === "await_signatures") {
    title = `Ждём подписи: ${pending.map((r) => ROLE_TITLE[r]).join(", ")}`;
    text =
      signed.length > 0
        ? `Уже подписали: ${signed.map((r) => ROLE_TITLE[r]).join(", ")}.`
        : "Ссылки выданы — договор ждёт подписей.";
    const reqByRole = (r) => requests.find((x) => x.signer_role === r && x.status !== "revoked");
    extra = (
      <ul className="mt-3 space-y-1.5">
        {pending.map((r) => {
          const w = waitingLine(r, reqByRole(r), isAdmin, contract.invited_roles || []);
          return (
            <li key={r} className="flex flex-wrap items-baseline gap-x-2 text-sm">
              <span className="font-semibold text-charcoal-800">{ROLE_TITLE[r]}:</span>
              <span className={TONE_TEXT[w.tone]}>{w.text}</span>
              {w.remind && <span className="badge bg-amber-100 text-amber-800">{w.remind}</span>}
            </li>
          );
        })}
      </ul>
    );
    buttons = isAdmin && (
      <>
        {pending.includes("college") && (
          <button type="button" className="btn-primary" onClick={onSignCollege} disabled={busy || ncaAvailable === false} title={ncaAvailable === false ? "NCALayer не запущен — запустите его и подтвердите сертификат" : undefined}>
            <PenLine className="h-4 w-4" aria-hidden="true" />
            Подписать за колледж
          </button>
        )}
        <button type="button" className={pending.includes("college") ? "btn-secondary" : "btn-primary"} onClick={onGoParties}>
          <ArrowDown className="h-4 w-4" aria-hidden="true" />
          Ссылки и напоминания
        </button>
      </>
    );
  } else if (action === "complete") {
    title = "Все подписи собраны — завершите договор";
    text = contract.signed_scan_path
      ? "Скан подписанного договора загружен. Осталось отметить договор завершённым."
      : "Если на бумаге есть подписанный оригинал, можно загрузить его скан (необязательно). Затем отметьте договор завершённым.";
    buttons = isAdmin && (
      <>
        <button type="button" className="btn-success" onClick={onComplete} disabled={busy}>
          {busyKey === "status" ? "Сохраняем…" : "Завершить договор"}
        </button>
        {!contract.signed_scan_path && (
          <button type="button" className="btn-secondary" onClick={onGoScan}>
            Загрузить скан
          </button>
        )}
      </>
    );
  } else {
    title = "Договор завершён";
    text = "Все стороны подписали, договор закрыт. Файлы и отчёт о подписях можно скачать ниже.";
  }

  return (
    <section className={clsx("card flex flex-col gap-4 p-4 ring-1 sm:flex-row sm:items-start sm:p-5", tone.ring)} aria-label="Следующий шаг">
      <span className={clsx("grid h-11 w-11 shrink-0 place-items-center rounded-xl", tone.soft)} aria-hidden="true">
        <Icon className="h-5 w-5" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-charcoal-500">Следующий шаг</div>
        <h2 className="mt-0.5 font-serif text-lg font-bold leading-snug text-charcoal-900 sm:text-xl">{title}</h2>
        <p className="mt-1 max-w-3xl text-sm leading-relaxed text-charcoal-600">{text}</p>
        {extra}
        {buttons && <div className="mt-4 flex flex-wrap gap-2">{buttons}</div>}
      </div>
    </section>
  );
}
