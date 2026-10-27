import { Link } from "react-router-dom";
import { ArrowRight, FilePlus2, FolderOpen, UsersRound, Upload } from "lucide-react";

const CTA_ICONS = { upload: Upload, contracts: FilePlus2, groups: UsersRound, open: FolderOpen };

function greetingFor(date) {
  const h = date.getHours();
  if (h < 6) return "Доброй ночи";
  if (h < 12) return "Доброе утро";
  if (h < 18) return "Добрый день";
  return "Добрый вечер";
}

// Russian full names are «Фамилия Имя Отчество»: greet by the first name when there is one.
export function firstNameOf(fullName) {
  const parts = String(fullName || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "";
  return parts.length >= 2 ? parts[1] : parts[0];
}

/** Compact greeting row: date, one-line state of the practice, one primary action. */
export default function DashboardHero({ fullName, summary, cta, now = new Date() }) {
  const name = firstNameOf(fullName);
  const rawDate = now.toLocaleDateString("ru-RU", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  // "понедельник, 26 октября 2026 г." -> "Понедельник, 26 октября 2026"
  const dateLabel = rawDate.replace(/\s*г\.?$/, "").replace(/^./, (c) => c.toUpperCase());
  const Icon = cta ? CTA_ICONS[cta.icon] || ArrowRight : null;
  return (
    <section className="card mb-5 flex flex-col gap-4 p-4 sm:p-5 md:flex-row md:items-center md:justify-between" aria-label="Приветствие">
      <div className="min-w-0">
        <div className="text-xs font-medium text-charcoal-400">{dateLabel}</div>
        <h1 className="mt-1 font-serif text-2xl font-bold leading-tight text-charcoal-900 md:text-3xl">
          {greetingFor(now)}
          {name ? `, ${name}` : ""}
        </h1>
        {summary && <p className="mt-1.5 max-w-2xl text-sm text-charcoal-600">{summary}</p>}
      </div>
      {cta && (
        <Link to={cta.to} className="btn-primary shrink-0 self-stretch md:self-auto">
          <Icon className="h-4 w-4" aria-hidden="true" />
          {cta.label}
        </Link>
      )}
    </section>
  );
}
