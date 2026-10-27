import { Link } from "react-router-dom";
import { Check } from "lucide-react";
import clsx from "clsx";
import SectionCard from "../SectionCard.jsx";

/** Empty system: the three steps in the order the practice is organised. */
export default function GettingStarted({ partners, students, contracts, isAdmin }) {
  const steps = [
    { key: "partners", done: partners > 0, title: "Добавьте предприятия", text: "Базы практики и их реквизиты", to: "/partners", cta: "Партнёры" },
    { key: "students", done: students > 0, title: "Загрузите студентов", text: "Списки групп из Excel одним файлом", to: "/groups?import=1", cta: "Загрузить" },
    { key: "contracts", done: contracts > 0, title: "Оформите договоры", text: "Для группы целиком — и отправьте на подпись", to: "/groups", cta: "К группам" },
  ];
  return (
    <SectionCard title="С чего начать" description="Практика оформляется в три шага">
      <ol className="grid gap-2 sm:grid-cols-3">
        {steps.map((s, i) => (
          <li key={s.key} className={clsx("rounded-xl border p-3.5", s.done ? "border-emerald-200 bg-emerald-50/40" : "border-charcoal-100")}>
            <div className="flex items-center gap-2">
              <span
                className={clsx(
                  "grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs font-bold",
                  s.done ? "bg-emerald-500 text-white" : "bg-charcoal-100 text-charcoal-600",
                )}
                aria-hidden="true"
              >
                {s.done ? <Check className="h-3.5 w-3.5" /> : i + 1}
              </span>
              <h3 className="text-sm font-semibold text-charcoal-900">{s.title}</h3>
              {s.done && <span className="sr-only">— выполнено</span>}
            </div>
            <p className="mt-1.5 text-xs text-charcoal-500">{s.text}</p>
            {isAdmin && !s.done && (
              <Link to={s.to} className="btn-secondary btn-sm mt-2.5">
                {s.cta}
              </Link>
            )}
          </li>
        ))}
      </ol>
    </SectionCard>
  );
}
