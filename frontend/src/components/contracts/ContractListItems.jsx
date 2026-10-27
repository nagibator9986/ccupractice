import { memo } from "react";
import { Link } from "react-router-dom";
import { CircleCheck, FilePlus2, Link2, Loader2, Send } from "lucide-react";
import StatusBadge from "../StatusBadge.jsx";
import { formatDate } from "../../utils/format.js";
import SignatureDots from "./SignatureDots.jsx";
import NextActionChip from "./NextActionChip.jsx";

// The one obvious button per row — what the contract is waiting for.
const QUICK = {
  generate: { label: "Сформировать", icon: FilePlus2, cls: "btn-primary" },
  invite: { label: "Создать ссылки", icon: Send, cls: "btn-primary" },
  await_signatures: { label: "Ссылки", icon: Link2, cls: "btn-secondary" },
  complete: { label: "Завершить", icon: CircleCheck, cls: "btn-success" },
};

// In the card the chip would repeat the button text — show it only when it adds something.
const CHIP_REPEATS_BUTTON = new Set(["generate", "invite", "complete"]);

export function periodText(c) {
  if (!c.practice_start && !c.practice_end) return "—";
  return `${formatDate(c.practice_start)} — ${formatDate(c.practice_end)}`;
}

function QuickButton({ c, isAdmin, busy, onQuick, className = "", small = true }) {
  const q = isAdmin ? QUICK[c.next_action] : null;
  if (!q) return null;
  const Icon = busy ? Loader2 : q.icon;
  return (
    <button
      type="button"
      className={`${q.cls} ${small ? "btn-sm" : ""} whitespace-nowrap ${className}`}
      onClick={() => onQuick(c)}
      disabled={busy}
      title={c.next_action === "invite" ? "Создать ссылки на подпись для предприятия и студента" : undefined}
    >
      <Icon className={busy ? "h-4 w-4 animate-spin" : "h-4 w-4"} aria-hidden="true" />
      {q.label}
    </button>
  );
}

function RowCheckbox({ c, selected, onToggle }) {
  return (
    <input
      type="checkbox"
      className="h-4 w-4 accent-coral-500"
      checked={selected}
      onChange={() => onToggle(c.id)}
      aria-label={`Выбрать договор № ${c.number}`}
    />
  );
}

/** Table row (xl and up). */
export const ContractRow = memo(function ContractRow({ c, selected, onToggle, isAdmin, busy, onQuick }) {
  return (
    <tr className={selected ? "!bg-coral-50/60" : undefined}>
      {isAdmin && (
        <td className="w-10">
          <RowCheckbox c={c} selected={selected} onToggle={onToggle} />
        </td>
      )}
      <td className="whitespace-nowrap">
        <Link to={`/contracts/${c.id}`} className="font-semibold text-coral-600 hover:underline">
          {c.number}
        </Link>
        <div className="text-xs text-charcoal-500">{formatDate(c.contract_date)}</div>
      </td>
      <td className="min-w-[9rem]">
        <Link to={`/contracts/${c.id}`} className="font-medium text-charcoal-900 hover:text-coral-600 hover:underline">
          {c.student_name}
        </Link>
        <div className="text-xs text-charcoal-500">{c.student_group || "без группы"}</div>
      </td>
      <td className="min-w-[8rem] max-w-[12rem]">{c.partner_name}</td>
      <td className="hidden whitespace-nowrap text-xs text-charcoal-600 2xl:table-cell">{periodText(c)}</td>
      <td>
        <StatusBadge value={c.status} />
      </td>
      <td>
        <SignatureDots signedRoles={c.signed_roles} invitedRoles={c.invited_roles} />
      </td>
      <td>
        <NextActionChip action={c.next_action} />
      </td>
      <td className="whitespace-nowrap text-right">
        <QuickButton c={c} isAdmin={isAdmin} busy={busy} onQuick={onQuick} />
      </td>
    </tr>
  );
});

/** Stacked card (below xl). */
export const ContractCard = memo(function ContractCard({ c, selected, onToggle, isAdmin, busy, onQuick }) {
  const quick = isAdmin && QUICK[c.next_action];
  const showChip = !(quick && CHIP_REPEATS_BUTTON.has(c.next_action));
  return (
    <li className={`card p-4 ${selected ? "ring-2 ring-coral-300" : ""}`}>
      <div className="flex items-start gap-3">
        {isAdmin && (
          <span className="grid h-11 w-8 shrink-0 place-items-center">
            <RowCheckbox c={c} selected={selected} onToggle={onToggle} />
          </span>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Link to={`/contracts/${c.id}`} className="font-semibold text-coral-600 hover:underline">
              № {c.number}
            </Link>
            <StatusBadge value={c.status} />
          </div>
          <Link to={`/contracts/${c.id}`} className="mt-1.5 block font-medium text-charcoal-900">
            {c.student_name}
          </Link>
          <div className="text-xs text-charcoal-500">{c.student_group || "без группы"}</div>
          <div className="mt-1 text-sm text-charcoal-700">{c.partner_name}</div>
          <div className="text-xs text-charcoal-500">Практика: {periodText(c)}</div>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <SignatureDots signedRoles={c.signed_roles} invitedRoles={c.invited_roles} />
            {showChip && <NextActionChip action={c.next_action} />}
          </div>
          <div className="mt-3 flex gap-2">
            <Link to={`/contracts/${c.id}`} className="btn-secondary flex-1">
              Открыть
            </Link>
            <QuickButton c={c} isAdmin={isAdmin} busy={busy} onQuick={onQuick} className="flex-1" small={false} />
          </div>
        </div>
      </div>
    </li>
  );
});
