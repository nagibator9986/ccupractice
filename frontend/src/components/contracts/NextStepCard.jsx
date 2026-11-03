import { ArrowDown, FileCheck2, FileSearch, PenLine } from "lucide-react";
import clsx from "clsx";
import { toneOf } from "../../utils/tones.js";
import { NEXT_ACTION_ICON } from "./NextActionChip.jsx";
import {
  CAPACITY_REP,
  NEXT_ACTION_META,
  ROLES,
  capacityOf,
  daysLeft,
  expiryText,
  fmtDateTime,
  hasPendingScan,
  methodOf,
  partyTitle,
  requestState,
} from "./contractFlow.js";

// What a still-missing party looks like in the "waiting" card.
function waitingLine(role, req, isAdmin, contract) {
  const invitedRoles = contract.invited_roles || [];
  const paper = methodOf({ role, req, contract }) === "scan";
  if (!isAdmin) {
    // A viewer has no links, only the summary: the student's own method is the one thing known.
    if (invitedRoles.includes(role)) {
      return { text: paper ? "ссылка выдана, ждём подпись на бумаге — скан подписанного договора" : "ссылка выдана, ждём подпись", tone: "amber" };
    }
    return { text: "ссылка ещё не выдана", tone: "slate" };
  }
  if (role === "college") {
    return { text: "подписывается здесь, в блоке «Подписи сторон»", tone: "slate" };
  }
  const st = requestState(req);
  if (st === "none") {
    return {
      text: paper ? "ссылка не создана (подпишет на бумаге)" : "ссылка не создана",
      tone: "red",
      remind: "Создайте ссылку",
    };
  }
  if (st === "expired") return { text: `срок ссылки истёк`, tone: "red", remind: "Продлите ссылку" };
  if (st === "scan_pending") return { text: "скан загружен, ждёт вашей проверки", tone: "amber" };
  const left = daysLeft(req.expires_at);
  const soon = left != null && left <= 5;
  if (st === "scan_rejected") {
    return {
      text: `скан отклонён${req.scan?.review_note ? ` («${req.scan.review_note}»)` : ""}, ждём новый — ссылка действует ${expiryText(req)}`,
      tone: "red",
      remind: soon ? "Скоро истекает — продлите" : "Ждём новый скан",
    };
  }
  if (st === "scan_wait") {
    const viewed = req.status === "viewed" ? "открыл(а) ссылку, " : "";
    return {
      text: `на бумаге, ${viewed}скан ещё не загружен, ссылка действует ${expiryText(req)}`,
      tone: soon ? "amber" : "slate",
      remind: soon ? "Скоро истекает — продлите" : undefined,
    };
  }
  const base = st === "viewed" ? "открыл(а) ссылку, но ещё не подписал(а)" : "ссылка выдана";
  const text = `${base}, действует ${expiryText(req)}`;
  if (soon) return { text, tone: "amber", remind: "Скоро истекает — продлите" };
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
  onReviewScan,
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
    if (contract.student_signer === CAPACITY_REP) {
      text += " Студент младше 16 лет — ссылка адресована его законному представителю.";
    }
    if (contract.student_sign_method === "scan") {
      text += " Студент подписывает на бумаге: ему создастся ссылка для загрузки скана, а вы проверите скан.";
    }
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
  } else if (action === "review_scan") {
    const waiting = requests.filter((r) => hasPendingScan(r));
    const names = waiting.map((r) => partyTitle(r.signer_role, capacityOf({ role: r.signer_role, req: r, contract })));
    title = names.length ? `Проверьте скан: ${names.join(", ")}` : "Скан ждёт проверки";
    text =
      "Подписант загрузил скан бумажного договора. Скан станет подписью, только когда вы откроете его и примете — или отклоните с причиной, которую увидит подписант.";
    if (!isAdmin) text = "Подписант загрузил скан бумажного договора. Решение принимает администратор колледжа.";
    extra =
      waiting.length > 0 ? (
        <ul className="mt-3 space-y-1.5">
          {waiting.map((r) => (
            <li key={r.id} className="flex flex-wrap items-baseline gap-x-2 text-sm">
              <span className="font-semibold text-charcoal-800">
                {partyTitle(r.signer_role, capacityOf({ role: r.signer_role, req: r, contract }))}:
              </span>
              <span className="text-charcoal-600">
                скан загружен {fmtDateTime(r.scan?.uploaded_at)}
                {r.recipient_name ? ` · ${r.recipient_name}` : ""}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        contract.scans_to_review > 1 && <p className="mt-2 text-sm text-charcoal-600">Сканов на проверке: {contract.scans_to_review}.</p>
      );
    buttons = isAdmin && (
      <>
        <button type="button" className="btn-primary" onClick={onReviewScan} disabled={busy || waiting.length === 0}>
          <FileSearch className="h-4 w-4" aria-hidden="true" />
          Открыть и проверить скан
        </button>
        <button type="button" className="btn-secondary" onClick={onGoParties}>
          <ArrowDown className="h-4 w-4" aria-hidden="true" />
          Подписи сторон
        </button>
      </>
    );
  } else if (action === "await_signatures") {
    const reqByRole = (r) => requests.find((x) => x.signer_role === r && x.status !== "revoked");
    const label = (r) => partyTitle(r, capacityOf({ role: r, req: reqByRole(r), contract }));
    title = `Ждём подписи: ${pending.map(label).join(", ")}`;
    text =
      signed.length > 0
        ? `Уже подписали: ${signed.map((r) => partyTitle(r, capacityOf({ role: r, req: reqByRole(r), contract }))).join(", ")}.`
        : "Ссылки выданы — договор ждёт подписей.";
    extra = (
      <ul className="mt-3 space-y-1.5">
        {pending.map((r) => {
          const w = waitingLine(r, reqByRole(r), isAdmin, contract);
          return (
            <li key={r} className="flex flex-wrap items-baseline gap-x-2 text-sm">
              <span className="font-semibold text-charcoal-800">{label(r)}:</span>
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
