import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext.jsx";
import BrandLogo from "./BrandLogo.jsx";
import clsx from "clsx";

const NAV = [
  { to: "/", label: "Дашборд", icon: DashboardIcon, end: true },
  { to: "/partners", label: "Партнёры", icon: PartnersIcon },
  { to: "/students", label: "Студенты", icon: StudentsIcon },
  { to: "/contracts", label: "Договоры практики", icon: ContractsIcon },
  { to: "/enrollments", label: "Договоры со студентами", icon: EnrollmentIcon },
  { to: "/archive", label: "Электронный архив", icon: ArchiveIcon },
  { to: "/settings", label: "Настройки", icon: SettingsIcon, adminOnly: true },
];

export default function Layout() {
  const { user, logout, isAdmin } = useAuth();
  const navigate = useNavigate();

  return (
    <div className="min-h-screen flex bg-gradient-to-br from-coral-50/30 via-white to-charcoal-50/60">
      <aside className="w-72 hidden lg:flex flex-col bg-white border-r border-charcoal-100/80 relative">
        {/* Brand strip */}
        <div className="absolute left-0 top-0 bottom-0 w-1 bg-gradient-to-b from-coral-500 via-coral-600 to-charcoal-700" />

        <div className="px-6 pt-6 pb-5 border-b border-charcoal-100">
          <BrandLogo size={52} withWordmark />
        </div>

        <nav className="flex-1 px-3 py-5 space-y-1">
          <div className="px-3 mb-2 text-[10px] uppercase tracking-[0.18em] font-bold text-charcoal-400">
            Меню
          </div>
          {NAV.filter((n) => !n.adminOnly || isAdmin).map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.end}
              className={({ isActive }) =>
                clsx(
                  "group flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition relative",
                  isActive
                    ? "bg-gradient-to-r from-coral-500 to-coral-600 text-white shadow-[0_8px_18px_-10px_rgba(232,90,63,0.55)]"
                    : "text-charcoal-600 hover:bg-charcoal-50",
                )
              }
            >
              {({ isActive }) => (
                <>
                  <span
                    className={clsx(
                      "h-8 w-8 rounded-lg grid place-items-center transition",
                      isActive
                        ? "bg-white/20 text-white"
                        : "bg-charcoal-50 text-charcoal-500 group-hover:bg-white group-hover:text-coral-600",
                    )}
                  >
                    <n.icon className="h-4 w-4" />
                  </span>
                  <span>{n.label}</span>
                  {isActive && (
                    <span className="absolute right-3 h-1.5 w-1.5 rounded-full bg-white" />
                  )}
                </>
              )}
            </NavLink>
          ))}
        </nav>

        <div className="mx-3 mb-3 rounded-xl bg-gradient-to-br from-coral-50 to-charcoal-50 p-4 ring-1 ring-charcoal-100">
          <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-widest text-coral-700">
            <span className="h-1.5 w-1.5 rounded-full bg-coral-500" /> NCALayer
          </div>
          <p className="text-xs text-charcoal-600 mt-1.5 leading-snug">
            Подписание ЭЦП работает через приложение НУЦ РК.
          </p>
          <a
            className="text-[11px] link font-semibold mt-1.5 inline-block"
            href="https://pki.gov.kz/ncalayer/"
            target="_blank"
            rel="noreferrer"
          >
            Скачать ↗
          </a>
        </div>

        <div className="px-4 py-4 border-t border-charcoal-100 bg-white">
          <div className="flex items-center gap-3 mb-3">
            <div className="h-10 w-10 rounded-full bg-gradient-to-br from-coral-400 to-coral-600 text-white grid place-items-center font-bold ring-2 ring-coral-100 shadow-sm">
              {(user?.full_name?.[0] || "U").toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold truncate text-charcoal-800">{user?.full_name}</div>
              <div className="text-xs text-charcoal-500 truncate flex items-center gap-1.5">
                <span
                  className={clsx(
                    "inline-block h-1.5 w-1.5 rounded-full",
                    user?.role === "admin" ? "bg-coral-500" : "bg-charcoal-400",
                  )}
                />
                {user?.role === "admin" ? "Администратор" : "Просмотр"}
              </div>
            </div>
          </div>
          <button
            onClick={() => {
              logout();
              navigate("/login");
            }}
            className="btn-secondary w-full"
          >
            Выйти
          </button>
        </div>
      </aside>

      <main className="flex-1 min-w-0 overflow-y-auto">
        <header className="lg:hidden flex items-center justify-between px-4 py-3 bg-white border-b border-charcoal-100">
          <BrandLogo size={40} withWordmark />
          <button onClick={logout} className="btn-ghost text-xs">Выйти</button>
        </header>
        <div className="px-4 sm:px-8 py-6 lg:py-10 max-w-[1400px] mx-auto">
          <Outlet />
        </div>
        <footer className="px-4 sm:px-8 py-6 text-center text-[11px] text-charcoal-400">
          © {new Date().getFullYear()} College of Caspian University · CCU PRACTICUM
        </footer>
      </main>
    </div>
  );
}

function DashboardIcon(p) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <rect x="3" y="3" width="7" height="9" rx="1.5" />
      <rect x="14" y="3" width="7" height="5" rx="1.5" />
      <rect x="14" y="12" width="7" height="9" rx="1.5" />
      <rect x="3" y="16" width="7" height="5" rx="1.5" />
    </svg>
  );
}
function PartnersIcon(p) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <path d="M3 21h7M14 21h7M3 21V10l4-2 4 2v11M14 21V8l4-2 3 2v13" />
      <path d="M6 13h1M6 16h1M17 11h.5M17 14h.5" />
    </svg>
  );
}
function StudentsIcon(p) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <path d="M12 14l9-5-9-5-9 5 9 5z" />
      <path d="M12 14v6M7 11.5V16c1.5 1.2 3.2 2 5 2s3.5-.8 5-2v-4.5" />
    </svg>
  );
}
function ContractsIcon(p) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5" />
      <path d="M9 13h6M9 17h4" />
    </svg>
  );
}
function EnrollmentIcon(p) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <path d="M22 10L12 5 2 10l10 5 10-5z" />
      <path d="M6 12v5c0 1 2.7 2.5 6 2.5s6-1.5 6-2.5v-5" />
      <path d="M12 15v4" />
    </svg>
  );
}
function ArchiveIcon(p) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <rect x="3" y="4" width="18" height="4" rx="1" />
      <path d="M5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8" />
      <path d="M10 13h4" />
    </svg>
  );
}
function SettingsIcon(p) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 0 1-4 0v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 0 1 0-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3h0a1.7 1.7 0 0 0 1-1.5V3a2 2 0 0 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8v0a1.7 1.7 0 0 0 1.5 1H21a2 2 0 0 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
    </svg>
  );
}
