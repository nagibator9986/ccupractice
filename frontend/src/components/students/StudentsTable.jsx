import { useEffect, useRef } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ExternalLink, FilePlus2, FileText, Pencil, Trash2, TriangleAlert, Plus, GraduationCap } from "lucide-react";
import clsx from "clsx";
import StatusBadge from "../StatusBadge.jsx";
import RowActionsMenu from "./RowActionsMenu.jsx";
import { activeLms, fmtPeriod, groupLabelOf } from "./studentUtils.js";
import { TONES } from "../../utils/tones.js";

/* ───────────────────────── small shared pieces ───────────────────────── */

function RowCheckbox({ checked, indeterminate = false, onChange, label }) {
  const ref = useRef(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = !!indeterminate;
  }, [indeterminate]);
  return (
    <label className="-ml-2.5 inline-grid h-11 w-11 shrink-0 cursor-pointer place-items-center sm:-ml-1.5 sm:h-8 sm:w-8">
      <input
        ref={ref}
        type="checkbox"
        className="h-4 w-4 accent-coral-500"
        checked={checked}
        onChange={onChange}
        aria-label={label}
      />
    </label>
  );
}

function NameBlock({ s }) {
  return (
    <div className="min-w-0">
      <div className="font-semibold text-charcoal-900 leading-snug">{s.full_name}</div>
      <div className="mt-0.5 text-xs">
        {s.iin ? (
          <span className="tabular-nums text-charcoal-500">{s.iin}</span>
        ) : (
          <span className="badge !px-2 !py-0.5 !text-[11px] bg-amber-100 text-amber-800">
            <TriangleAlert className="h-3 w-3" aria-hidden="true" />
            нет ИИН
          </span>
        )}
      </div>
    </div>
  );
}

function GroupBlock({ s, withSpecialty = false }) {
  return (
    <div>
      <div className={clsx("whitespace-nowrap font-medium", !s.group_name && "text-charcoal-400")}>{groupLabelOf(s.group_name)}</div>
      {s.course ? <div className="text-xs text-charcoal-500">{s.course} курс</div> : null}
      {/* Below 2xl the «Специальность» column is hidden — show it under the group instead. */}
      {withSpecialty && s.specialty ? (
        <div className="mt-0.5 max-w-[11rem] text-[11px] leading-snug text-charcoal-500 2xl:hidden">{s.specialty}</div>
      ) : null}
    </div>
  );
}

function PartnerBlock({ s, isAdmin }) {
  if (!s.partner_id) return <span className="text-charcoal-400">—</span>;
  const to = isAdmin
    ? `/partners?edit=${s.partner_id}`
    : `/partners?q=${encodeURIComponent(s.partner_name || "")}`;
  return (
    <div className="flex items-start gap-1.5">
      <span className="min-w-0 leading-snug">{s.partner_name || `Предприятие №${s.partner_id}`}</span>
      <Link
        to={to}
        className="mt-0.5 shrink-0 rounded text-charcoal-400 hover:text-coral-600"
        aria-label={`Открыть предприятие: ${s.partner_name || s.partner_id}`}
        title="Открыть карточку предприятия"
      >
        <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
      </Link>
    </div>
  );
}

function PeriodBlock({ s }) {
  const period = fmtPeriod(s.practice_start, s.practice_end);
  if (!period) {
    return (
      <span className="badge !px-2 !py-0.5 !text-[11px] bg-amber-100 text-amber-800">
        <TriangleAlert className="h-3 w-3" aria-hidden="true" />
        не заданы
      </span>
    );
  }
  return <span className="whitespace-nowrap tabular-nums text-xs text-charcoal-700">{period}</span>;
}

function ContractBlock({ s, isAdmin }) {
  const c = s.contract;
  if (!c) {
    return (
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="text-xs text-charcoal-400">нет</span>
        {isAdmin && (
          <Link
            to={`/contracts?new=1&student_id=${s.id}`}
            className="btn-ghost btn-sm !px-2 text-coral-700"
            aria-label={`Создать договор: ${s.full_name}`}
          >
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            Создать
          </Link>
        )}
      </div>
    );
  }
  return (
    <div className="space-y-1">
      <Link
        to={`/contracts/${c.id}`}
        className="block text-xs font-semibold text-coral-700 hover:underline"
        title="Открыть договор"
      >
        {c.number ? `№ ${c.number}` : `Договор №${c.id} (без номера)`}
        {c.count > 1 && <span className="ml-1 font-normal text-charcoal-500">+{c.count - 1}</span>}
      </Link>
      <StatusBadge value={c.status} />
    </div>
  );
}

function GrantBlock({ s, isAdmin, busy, onToggle }) {
  const lms = activeLms(s);
  const chip = s.is_grant_student ? (
    <span className={clsx("badge !px-2 !py-0.5 !text-[11px]", TONES.coral.badge)}>
      <GraduationCap className="h-3 w-3" aria-hidden="true" />
      Грантник
    </span>
  ) : (
    <span className="text-xs text-charcoal-400">—</span>
  );
  return (
    <div className="space-y-1">
      {isAdmin ? (
        <label
          className="inline-flex cursor-pointer select-none items-center gap-2"
          title={
            s.is_grant_student && lms
              ? `Отметку нельзя снять: есть незавершённый LMS-договор ${lms.number || `LMS-${lms.id}`}. Завершите или удалите договор.`
              : "Перевести в категорию грантников / снять отметку"
          }
        >
          <input
            type="checkbox"
            className="h-4 w-4 accent-coral-500"
            checked={!!s.is_grant_student}
            disabled={busy || (s.is_grant_student && !!lms)}
            onChange={() => onToggle(s)}
            aria-label={`Грантник: ${s.full_name}`}
          />
          {chip}
        </label>
      ) : (
        chip
      )}
      {/* Makes the invisible link visible: this is why the student is absent
          from the LMS create-picker and why the card refuses to be deleted. */}
      {s.lms_contract && (
        <div>
          <Link
            to={`/lms-contracts/${s.lms_contract.id}`}
            className="text-xs font-semibold text-coral-700 hover:underline"
            title={
              s.lms_contract.is_active
                ? "Договор не завершён: студент скрыт из мастера создания и карточку нельзя удалить"
                : "Договор завершён, но карточку нельзя удалить, пока он существует"
            }
          >
            LMS: {s.lms_contract.number || `LMS-${s.lms_contract.id} (без номера)`}
            <span className="block text-[11px] font-normal text-charcoal-500">
              {s.lms_contract.status_label || s.lms_contract.status}
            </span>
          </Link>
          {/* The applicant block on the contract is an editable snapshot, so it
              can name someone else entirely — say so here. */}
          {s.lms_contract.applicant_matches === false && (
            <span
              className="mt-1 flex items-start gap-1 rounded-md bg-red-50 px-1.5 py-1 text-[11px] font-semibold text-red-700 ring-1 ring-red-200"
              title="ФИО в договоре не совпадает с карточкой студента — договор, скорее всего, привязан не к тому студенту"
            >
              <TriangleAlert className="mt-px h-3 w-3 shrink-0" aria-hidden="true" />
              <span>в договоре: {s.lms_contract.applicant_full_name || "—"}</span>
            </span>
          )}
        </div>
      )}
    </div>
  );
}

function RowActions({ s, onEdit, onDelete }) {
  const navigate = useNavigate();
  const lms = activeLms(s);
  const items = [];
  if (s.contract) {
    items.push({ key: "contract", label: "Открыть договор практики", icon: FileText, onClick: () => navigate(`/contracts/${s.contract.id}`) });
  } else {
    items.push({ key: "new-contract", label: "Создать договор практики", icon: FilePlus2, onClick: () => navigate(`/contracts?new=1&student_id=${s.id}`) });
  }
  if (s.is_grant_student) {
    items.push(
      lms
        ? { key: "lms", label: "Открыть LMS-договор", icon: FileText, onClick: () => navigate(`/lms-contracts/${lms.id}`) }
        : { key: "lms-new", label: "Создать LMS-договор", icon: FilePlus2, onClick: () => navigate(`/lms-contracts?create=${s.id}`) },
    );
  }
  items.push({ key: "delete", label: "Удалить студента", icon: Trash2, tone: "danger", onClick: () => onDelete(s) });
  return (
    <div className="flex items-center justify-end gap-0.5">
      <button
        type="button"
        className="btn-ghost btn-icon btn-sm"
        onClick={() => onEdit(s)}
        aria-label={`Редактировать: ${s.full_name}`}
        title="Редактировать"
      >
        <Pencil className="h-4 w-4" aria-hidden="true" />
      </button>
      <RowActionsMenu items={items} label={`Другие действия: ${s.full_name}`} />
    </div>
  );
}

/* ─────────────────────────────── desktop ─────────────────────────────── */

export function StudentsTable({
  rows,
  isAdmin,
  selected,
  onToggle,
  allOnPage,
  someOnPage,
  onTogglePage,
  onEdit,
  onDelete,
  onToggleGrant,
  grantBusy,
  busy,
}) {
  return (
    <div
      className={clsx("hidden max-h-[72vh] overflow-auto md:block", busy && "opacity-60 transition-opacity")}
      aria-busy={busy || undefined}
    >
      <table className="table-default table-compact table-sticky">
        <thead>
          <tr>
            <th className="sticky left-0 z-20 min-w-[14rem]">
              <div className="flex items-center gap-2">
                {isAdmin && (
                  <RowCheckbox
                    checked={allOnPage}
                    indeterminate={!allOnPage && someOnPage}
                    onChange={onTogglePage}
                    label="Выбрать всех на странице"
                  />
                )}
                ФИО
              </div>
            </th>
            <th>Группа</th>
            <th className="hidden 2xl:table-cell">Специальность</th>
            <th>Предприятие</th>
            <th>Практика</th>
            <th>Договор</th>
            <th>Грант</th>
            {isAdmin && (
              <th className="sticky right-0 z-20 text-right">
                <span className="sr-only">Действия</span>
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {rows.map((s) => {
            const isSel = selected.has(s.id);
            return (
              <tr key={s.id} className={clsx("group", isSel && "bg-coral-50/50")}>
                <td className={clsx("sticky left-0 z-[5] min-w-[14rem]", isSel ? "bg-[#fef6f4]" : "bg-white group-hover:bg-[#fef6f4]")}>
                  <div className="flex items-start gap-2">
                    {isAdmin && (
                      <RowCheckbox checked={isSel} onChange={() => onToggle(s.id)} label={`Выбрать: ${s.full_name}`} />
                    )}
                    <NameBlock s={s} />
                  </div>
                </td>
                <td><GroupBlock s={s} withSpecialty /></td>
                <td className="hidden max-w-[14rem] text-xs leading-snug text-charcoal-600 2xl:table-cell">
                  {s.specialty || <span className="text-charcoal-400">—</span>}
                </td>
                <td className="max-w-[14rem] text-sm"><PartnerBlock s={s} isAdmin={isAdmin} /></td>
                <td><PeriodBlock s={s} /></td>
                <td><ContractBlock s={s} isAdmin={isAdmin} /></td>
                <td><GrantBlock s={s} isAdmin={isAdmin} busy={grantBusy === s.id} onToggle={onToggleGrant} /></td>
                {isAdmin && (
                  <td
                    className={clsx(
                      "sticky right-0 z-[5] whitespace-nowrap shadow-[-8px_0_8px_-8px_rgba(15,23,42,0.12)]",
                      isSel ? "bg-[#fef6f4]" : "bg-white group-hover:bg-[#fef6f4]",
                    )}
                  >
                    <RowActions s={s} onEdit={onEdit} onDelete={onDelete} />
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* ──────────────────────────────── mobile ─────────────────────────────── */

function Line({ label, children }) {
  return (
    <div className="flex items-start gap-3 text-sm">
      <span className="w-[6.75rem] shrink-0 pt-0.5 text-[10px] font-semibold uppercase tracking-wide text-charcoal-400">
        {label}
      </span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

export function StudentCards({ rows, isAdmin, selected, onToggle, onEdit, onDelete, onToggleGrant, grantBusy, busy }) {
  return (
    <ul className={clsx("divide-y divide-charcoal-100 md:hidden", busy && "opacity-60 transition-opacity")} aria-busy={busy || undefined}>
      {rows.map((s) => {
        const isSel = selected.has(s.id);
        return (
          <li key={s.id} className={clsx("px-3.5 py-3", isSel && "bg-coral-50/50")}>
            <div className="flex items-start gap-2">
              {isAdmin && (
                <RowCheckbox checked={isSel} onChange={() => onToggle(s.id)} label={`Выбрать: ${s.full_name}`} />
              )}
              <div className="min-w-0 flex-1">
                <NameBlock s={s} />
              </div>
              {isAdmin && <RowActions s={s} onEdit={onEdit} onDelete={onDelete} />}
            </div>
            <div className={clsx("mt-2.5 space-y-1.5", isAdmin && "pl-[2.1rem]")}>
              <Line label="Группа">
                <span className={clsx("font-medium", !s.group_name && "text-charcoal-400")}>{groupLabelOf(s.group_name)}</span>
                {s.course ? <span className="text-charcoal-500"> · {s.course} курс</span> : null}
              </Line>
              {s.specialty && <Line label="Специальность"><span className="text-xs text-charcoal-600">{s.specialty}</span></Line>}
              <Line label="Предприятие"><PartnerBlock s={s} isAdmin={isAdmin} /></Line>
              <Line label="Практика"><PeriodBlock s={s} /></Line>
              <Line label="Договор"><ContractBlock s={s} isAdmin={isAdmin} /></Line>
              {(s.is_grant_student || s.lms_contract || isAdmin) && (
                <Line label="Грант"><GrantBlock s={s} isAdmin={isAdmin} busy={grantBusy === s.id} onToggle={onToggleGrant} /></Line>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
