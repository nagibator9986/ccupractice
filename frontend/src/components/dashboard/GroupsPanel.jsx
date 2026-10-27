import { Link } from "react-router-dom";
import { Upload, UsersRound } from "lucide-react";
import SectionCard from "../SectionCard.jsx";
import EmptyState from "../EmptyState.jsx";
import ProgressBar from "../ProgressBar.jsx";
import { plural } from "../../utils/format.js";
import { GROUP_NONE_LABEL, groupQuery, topGroups } from "./dashboardLogic.js";

const GRID = "md:grid-cols-[minmax(0,2fr)_72px_minmax(0,3fr)_auto]";

/** Top groups by remaining work: students, signed share and a way in. Responsive list, no sideways scroll. */
export default function GroupsPanel({ groups, isAdmin }) {
  const rows = topGroups(groups, 8);
  const total = (groups || []).length;
  return (
    <SectionCard
      padded={false}
      title="Группы"
      description={total > rows.length ? `Показаны ${rows.length} из ${total}` : undefined}
      actions={
        <Link to="/groups" className="link text-sm">
          Все группы
        </Link>
      }
    >
      {rows.length === 0 ? (
        <EmptyState
          compact
          icon={UsersRound}
          title="Групп пока нет"
          description="Группы появляются, когда в системе есть студенты."
          action={
            isAdmin ? (
              <Link to="/groups?import=1" className="btn-primary">
                <Upload className="h-4 w-4" aria-hidden="true" />
                Загрузить студентов из Excel
              </Link>
            ) : null
          }
        />
      ) : (
        <div>
          <div className={`hidden gap-3 border-b border-charcoal-100 bg-charcoal-50/60 px-5 py-2 text-[10px] font-semibold uppercase tracking-wider text-charcoal-500 md:grid ${GRID}`}>
            <span>Группа</span>
            <span>Студентов</span>
            <span>Подписано договоров</span>
            <span className="sr-only">Действия</span>
          </div>
          <ul className="divide-y divide-charcoal-100">
            {rows.map((g) => {
              const label = g.name || GROUP_NONE_LABEL;
              const q = groupQuery(g.name);
              return (
                <li key={g.name || "__none__"} className={`grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5 px-4 py-3 sm:px-5 md:gap-3 ${GRID}`}>
                  <div className="min-w-0">
                    <Link to={`/students?group=${q}`} className="block truncate text-sm font-semibold text-charcoal-900 hover:text-coral-600">
                      {label}
                    </Link>
                    <div className="truncate text-xs text-charcoal-500">
                      <span className="md:hidden">
                        {g.students} {plural(g.students, "студент", "студента", "студентов")}
                        {g.specialty ? " · " : ""}
                      </span>
                      {g.specialty}
                    </div>
                  </div>
                  <div className="hidden text-sm tabular-nums text-charcoal-700 md:block">{g.students}</div>
                  <div className="col-span-2 min-w-0 md:col-span-1">
                    <ProgressBar
                      value={g.fully_signed}
                      max={g.students}
                      tone="emerald"
                      height="sm"
                      label={`Подписано договоров в группе ${label}`}
                    />
                    <div className="mt-1 flex flex-wrap gap-x-3 text-[11px] text-charcoal-500">
                      <span>
                        {g.fully_signed} из {g.students} подписано
                      </span>
                      {g.without_contract > 0 && (
                        <span className="font-medium text-amber-700">без договора: {g.without_contract}</span>
                      )}
                    </div>
                  </div>
                  <Link
                    to={`/contracts?group=${q}`}
                    className="btn-ghost btn-sm col-start-2 row-start-1 justify-self-end md:col-start-auto md:row-start-auto"
                    aria-label={`Договоры группы ${label}`}
                  >
                    Договоры
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </SectionCard>
  );
}
