import { Link } from "react-router-dom";
import { Building2, ChevronRight, FilePlus2, FolderOpen, Upload, UsersRound } from "lucide-react";
import SectionCard from "../SectionCard.jsx";

// Write actions only for admins; viewers get read-only shortcuts.
const ADMIN_ACTIONS = [
  { to: "/groups?import=1", label: "Загрузить студентов из Excel", Icon: Upload },
  { to: "/contracts?new=1", label: "Новый договор", Icon: FilePlus2 },
  { to: "/partners?new=1", label: "Добавить партнёра", Icon: Building2 },
];
const VIEWER_ACTIONS = [
  { to: "/groups", label: "Группы", Icon: UsersRound },
  { to: "/contracts", label: "Договоры", Icon: FolderOpen },
  { to: "/partners", label: "Партнёры", Icon: Building2 },
];

export default function QuickActions({ isAdmin }) {
  const actions = isAdmin ? ADMIN_ACTIONS : VIEWER_ACTIONS;
  return (
    <SectionCard title="Быстрые действия">
      <ul className="space-y-1.5">
        {actions.map(({ to, label, Icon }) => (
          <li key={to}>
            <Link
              to={to}
              className="group flex min-h-[44px] items-center gap-3 rounded-xl border border-charcoal-100 px-3 py-2 text-sm font-medium text-charcoal-800 transition hover:border-coral-300 hover:bg-coral-50/40"
            >
              <Icon className="h-4 w-4 shrink-0 text-coral-600" aria-hidden="true" />
              <span className="flex-1">{label}</span>
              <ChevronRight className="h-4 w-4 text-charcoal-300 group-hover:text-coral-500" aria-hidden="true" />
            </Link>
          </li>
        ))}
      </ul>
    </SectionCard>
  );
}
