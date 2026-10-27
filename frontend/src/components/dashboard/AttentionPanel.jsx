import { Link } from "react-router-dom";
import { ChevronRight, CircleCheck, FileClock, GraduationCap, Handshake, Send, TimerOff, TriangleAlert } from "lucide-react";
import SectionCard from "../SectionCard.jsx";
import EmptyState from "../EmptyState.jsx";

const ICONS = {
  timer: TimerOff,
  send: Send,
  draft: FileClock,
  partner: Handshake,
  students: GraduationCap,
};

function AttentionGroup({ group }) {
  const Icon = ICONS[group.icon] || TriangleAlert;
  const more = group.moreCount ?? Math.max(group.total - group.items.length, 0);
  return (
    <li className="py-3.5 first:pt-0 last:pb-0">
      <div className="flex items-start gap-2.5">
        <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-amber-50 text-amber-600" aria-hidden="true">
          <Icon className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <h3 className="text-sm font-semibold text-charcoal-900">{group.title}</h3>
            <span className="badge bg-amber-100 text-amber-800 !py-0.5">
              {group.total}
              {group.capped ? "+" : ""}
            </span>
          </div>
          <p className="text-xs text-charcoal-500">{group.hint}</p>
          <ul className="mt-2 space-y-1">
            {group.items.map((it) => (
              <li key={it.key}>
                <Link
                  to={it.to}
                  className="group flex min-h-[44px] items-center justify-between gap-2 rounded-xl px-2.5 py-1.5 transition hover:bg-amber-50/70 sm:min-h-0"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-charcoal-800">{it.primary}</span>
                    <span className="block text-xs text-charcoal-500">{it.secondary}</span>
                  </span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-charcoal-300 group-hover:text-coral-500" aria-hidden="true" />
                </Link>
              </li>
            ))}
          </ul>
          {more > 0 && group.moreTo && (
            <Link to={group.moreTo} className="link mt-1 inline-flex px-2.5 text-xs font-medium">
              и ещё {more}
              {group.capped ? "+" : ""} — показать все
            </Link>
          )}
        </div>
      </div>
    </li>
  );
}

/**
 * «Требует внимания». Amber when there is something to do, a friendly all-clear
 * otherwise. `groups` comes from buildAttentionGroups().
 */
export default function AttentionPanel({ groups }) {
  if (groups.length === 0) {
    return (
      <SectionCard title="Требует внимания">
        <EmptyState
          compact
          icon={CircleCheck}
          title="Всё в порядке"
          description="Нет просроченных ссылок, зависших договоров и неполных данных."
        />
      </SectionCard>
    );
  }
  return (
    <SectionCard
      tone="amber"
      icon={TriangleAlert}
      title="Требует внимания"
      description="Что стоит сделать в первую очередь"
    >
      <ul className="divide-y divide-charcoal-100">
        {groups.map((g) => (
          <AttentionGroup key={g.key} group={g} />
        ))}
      </ul>
    </SectionCard>
  );
}
