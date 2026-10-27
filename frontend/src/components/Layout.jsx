import { useEffect, useRef, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import {
  Archive,
  Building2,
  Database,
  ExternalLink,
  FileSignature,
  GraduationCap,
  LayoutDashboard,
  LogOut,
  Menu,
  MonitorSmartphone,
  ScrollText,
  Settings,
  ShieldCheck,
  Users,
  X,
} from "lucide-react";
import clsx from "clsx";
import { useAuth } from "../context/AuthContext.jsx";
import useDialog from "../hooks/useDialog.js";
import { initials } from "../utils/format.js";
import BrandLogo from "./BrandLogo.jsx";
import PersistenceBanner from "./PersistenceBanner.jsx";

// `/groups` is registered by another change; the link is intentionally here already.
const NAV_SECTIONS = [
  {
    label: "Практика",
    items: [
      { to: "/", label: "Дашборд", icon: LayoutDashboard, end: true },
      { to: "/groups", label: "Группы", icon: Users, chip: "Новое" },
      { to: "/students", label: "Студенты", icon: GraduationCap },
      { to: "/partners", label: "Партнёры", icon: Building2 },
      { to: "/contracts", label: "Договоры практики", icon: FileSignature },
    ],
  },
  {
    label: "Договоры со студентами",
    items: [
      { to: "/enrollments", label: "Договоры со студентами", icon: ScrollText },
      { to: "/lms-contracts", label: "LMS-договоры", icon: MonitorSmartphone, chip: "Грантники" },
    ],
  },
  {
    label: "Система",
    items: [
      { to: "/archive", label: "Электронный архив", icon: Archive },
      { to: "/data", label: "Данные", icon: Database, adminOnly: true },
      { to: "/settings", label: "Настройки", icon: Settings, adminOnly: true },
    ],
  },
];

function NavItem({ item, onNavigate }) {
  const Icon = item.icon;
  return (
    <NavLink
      to={item.to}
      end={item.end}
      onClick={onNavigate}
      className={({ isActive }) =>
        clsx(
          "group relative flex items-center gap-3 rounded-lg px-3 min-h-[44px] lg:min-h-[38px] text-sm font-medium transition-colors",
          isActive
            ? "bg-coral-50 text-coral-700"
            : "text-charcoal-600 hover:bg-charcoal-50 hover:text-charcoal-900",
        )
      }
    >
      {({ isActive }) => (
        <>
          <span
            className={clsx(
              "absolute left-0 top-2 bottom-2 w-[3px] rounded-full bg-coral-500 transition-opacity",
              isActive ? "opacity-100" : "opacity-0",
            )}
            aria-hidden="true"
          />
          <Icon
            className={clsx(
              "h-[18px] w-[18px] shrink-0 transition-colors",
              isActive ? "text-coral-600" : "text-charcoal-400 group-hover:text-charcoal-600",
            )}
            aria-hidden="true"
          />
          <span className="truncate">{item.label}</span>
          {item.chip && (
            <span
              className={clsx(
                "ml-auto shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                isActive ? "bg-white text-coral-700" : "bg-coral-100 text-coral-700",
              )}
            >
              {item.chip}
            </span>
          )}
        </>
      )}
    </NavLink>
  );
}

// Shared by the desktop sidebar and the mobile drawer so the two never drift.
function SidebarBody({ isAdmin, user, onLogout, onNavigate, onClose }) {
  return (
    <>
      <div className="flex items-center justify-between gap-2 px-5 h-16 shrink-0 border-b border-charcoal-100">
        <BrandLogo size={36} withWordmark />
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="h-11 w-11 -mr-2 grid place-items-center rounded-lg text-charcoal-500 hover:bg-charcoal-100"
            aria-label="Закрыть меню"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        )}
      </div>

      <nav className="flex-1 min-h-0 overflow-y-auto px-3 py-4 space-y-5" aria-label="Основная навигация">
        {NAV_SECTIONS.map((section) => {
          const items = section.items.filter((n) => !n.adminOnly || isAdmin);
          if (items.length === 0) return null;
          return (
            <div key={section.label}>
              <div className="px-3 mb-1.5 text-[10px] uppercase tracking-[0.16em] font-bold text-charcoal-400">
                {section.label}
              </div>
              <div className="space-y-0.5">
                {items.map((n) => (
                  <NavItem key={n.to} item={n} onNavigate={onNavigate} />
                ))}
              </div>
            </div>
          );
        })}
      </nav>

      {/* Dropped on short screens so it never squeezes the navigation. */}
      <div className="mx-3 mb-3 hidden rounded-xl bg-charcoal-50/70 p-3 ring-1 ring-charcoal-100 [@media(min-height:760px)]:block">
        <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-charcoal-700">
          <ShieldCheck className="h-3.5 w-3.5 text-coral-600" aria-hidden="true" />
          NCALayer
        </div>
        <p className="mt-1 text-xs leading-snug text-charcoal-500">
          Подписание ЭЦП работает через приложение НУЦ РК.
        </p>
        <a
          className="mt-1.5 inline-flex items-center gap-1 text-[11px] font-semibold link"
          href="https://pki.gov.kz/ncalayer/"
          target="_blank"
          rel="noreferrer"
        >
          Скачать
          <ExternalLink className="h-3 w-3" aria-hidden="true" />
        </a>
      </div>

      <div className="shrink-0 border-t border-charcoal-100 bg-white p-3">
        <div className="flex items-center gap-3 px-1 pb-3">
          <div
            className="h-9 w-9 shrink-0 rounded-full bg-gradient-to-br from-coral-400 to-coral-600 text-white grid place-items-center text-xs font-bold"
            aria-hidden="true"
          >
            {initials(user?.full_name) || "U"}
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold text-charcoal-800">{user?.full_name}</div>
            <div className="flex items-center gap-1.5 truncate text-xs text-charcoal-500">
              <span
                className={clsx(
                  "inline-block h-1.5 w-1.5 rounded-full",
                  user?.role === "admin" ? "bg-coral-500" : "bg-charcoal-400",
                )}
                aria-hidden="true"
              />
              {user?.role === "admin" ? "Администратор" : "Просмотр"}
            </div>
          </div>
        </div>
        <button type="button" onClick={onLogout} className="btn-secondary w-full btn-sm !min-h-[40px]">
          <LogOut className="h-4 w-4" aria-hidden="true" />
          Выйти
        </button>
      </div>
    </>
  );
}

function MobileDrawer({ open, onClose, children }) {
  const panelRef = useRef(null);
  // Same focus trap / Esc / scroll lock as Modal; restores focus to the hamburger.
  useDialog(open, panelRef, onClose);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 lg:hidden">
      <div
        className="absolute inset-0 bg-charcoal-900/50 backdrop-blur-sm animate-[fadeIn_150ms_ease-out]"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        ref={panelRef}
        id="mobile-nav"
        role="dialog"
        aria-modal="true"
        aria-label="Меню навигации"
        tabIndex={-1}
        className="absolute inset-y-0 left-0 flex w-[86vw] max-w-[20rem] flex-col bg-white shadow-2xl outline-none animate-[drawerIn_200ms_ease-out]"
      >
        {children}
      </div>
    </div>
  );
}

export default function Layout() {
  const { user, logout, isAdmin } = useAuth();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Close on route change (covers back/forward and programmatic navigation).
  useEffect(() => {
    setDrawerOpen(false);
  }, [pathname]);

  // Resizing to desktop with the drawer open would leave body scroll locked
  // behind an invisible (lg:hidden) overlay.
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const onChange = (e) => {
      if (e.matches) setDrawerOpen(false);
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  function handleLogout() {
    logout();
    navigate("/login");
  }

  return (
    <div className="min-h-screen flex bg-gradient-to-br from-coral-50/30 via-white to-charcoal-50/60">
      {/* Desktop sidebar: pinned to the viewport so the user block / logout stay reachable on long pages. */}
      <aside className="hidden lg:flex lg:sticky lg:top-0 lg:h-screen self-start w-64 xl:w-72 shrink-0 flex-col bg-white border-r border-charcoal-100/80">
        <SidebarBody isAdmin={isAdmin} user={user} onLogout={handleLogout} />
      </aside>

      <MobileDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)}>
        <SidebarBody
          isAdmin={isAdmin}
          user={user}
          onLogout={handleLogout}
          onNavigate={() => setDrawerOpen(false)}
          onClose={() => setDrawerOpen(false)}
        />
      </MobileDrawer>

      <main className="flex-1 min-w-0 flex flex-col">
        <header className="lg:hidden sticky top-0 z-30 flex h-14 items-center gap-1 border-b border-charcoal-100 bg-white/90 px-2 backdrop-blur">
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            className="h-11 w-11 grid place-items-center rounded-lg text-charcoal-700 hover:bg-charcoal-100"
            aria-label="Открыть меню"
            aria-expanded={drawerOpen}
            aria-controls="mobile-nav"
          >
            <Menu className="h-5 w-5" aria-hidden="true" />
          </button>
          <BrandLogo size={32} withWordmark />
          <div
            className="ml-auto mr-2 h-8 w-8 rounded-full bg-gradient-to-br from-coral-400 to-coral-600 text-white grid place-items-center text-[11px] font-bold"
            title={user?.full_name}
            aria-hidden="true"
          >
            {initials(user?.full_name) || "U"}
          </div>
        </header>

        <div className="flex-1 w-full max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 py-5 lg:py-8">
          {/* Surfaces a coral alert when /api/health reports the platform is
              running on ephemeral container storage (data will vanish on next
              redeploy). Only the admin sees it — viewers can't fix it. */}
          <PersistenceBanner enabled={isAdmin} />
          <Outlet />
        </div>
        <footer className="px-4 sm:px-8 py-5 text-center text-[11px] text-charcoal-400">
          © {new Date().getFullYear()} College of Caspian University · CCU PRACTICUM
        </footer>
      </main>
    </div>
  );
}
