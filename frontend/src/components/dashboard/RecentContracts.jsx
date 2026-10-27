import { Link } from "react-router-dom";
import { FileText } from "lucide-react";
import SectionCard from "../SectionCard.jsx";
import EmptyState from "../EmptyState.jsx";
import StatusBadge from "../StatusBadge.jsx";
import { formatDate } from "../../utils/format.js";

/** Last contracts, compact enough for a narrow column and a phone. */
export default function RecentContracts({ items, isAdmin }) {
  const list = items || [];
  return (
    <SectionCard
      padded={false}
      title="Последние договоры"
      actions={
        <Link to="/contracts" className="link text-sm">
          Все договоры
        </Link>
      }
    >
      {list.length === 0 ? (
        <EmptyState
          compact
          icon={FileText}
          title="Договоров пока нет"
          description={isAdmin ? "Оформите первый договор — для группы целиком или для одного студента." : "Когда появятся договоры, они будут показаны здесь."}
          action={
            isAdmin ? (
              <Link to="/groups" className="btn-primary">
                Оформить договоры
              </Link>
            ) : null
          }
        />
      ) : (
        <ul className="divide-y divide-charcoal-100">
          {list.map((c) => (
            <li key={c.id}>
              <Link to={`/contracts/${c.id}`} className="block px-4 py-3 transition hover:bg-coral-50/40 sm:px-5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold text-coral-600">№ {c.number}</span>
                  <StatusBadge value={c.status} />
                </div>
                <div className="mt-1 truncate text-sm text-charcoal-800">{c.student_name}</div>
                <div className="truncate text-xs text-charcoal-500">
                  {[c.partner_name, c.student_group, formatDate(c.contract_date)].filter(Boolean).join(" · ")}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}
