import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import PageHeader from "../components/PageHeader.jsx";
import StatusBadge from "../components/StatusBadge.jsx";
import { contractsApi, partnersApi, studentsApi } from "../api/endpoints.js";
import { formatDate } from "../utils/format.js";
import { useAuth } from "../context/AuthContext.jsx";

export default function DashboardPage() {
  const { user } = useAuth();
  const [stats, setStats] = useState({ partners: 0, students: 0, contracts: 0, signed: 0, drafts: 0 });
  const [recent, setRecent] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const [p, s, c] = await Promise.all([
          partnersApi.list(),
          studentsApi.list(),
          contractsApi.list(),
        ]);
        const signed = c.items.filter((i) => ["signed", "scan_uploaded", "completed"].includes(i.status)).length;
        const drafts = c.items.filter((i) => ["draft", "generated", "sent"].includes(i.status)).length;
        setStats({ partners: p.total, students: s.total, contracts: c.total, signed, drafts });
        setRecent(c.items.slice(0, 6));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const cards = [
    {
      label: "Партнёры",
      sub: "База предприятий",
      value: stats.partners,
      to: "/partners",
      icon: <IconPartners />,
      style: "from-coral-500 to-coral-700",
    },
    {
      label: "Студенты",
      sub: "Реестр обучающихся",
      value: stats.students,
      to: "/students",
      icon: <IconStudents />,
      style: "from-charcoal-700 to-charcoal-900",
    },
    {
      label: "Договоры",
      sub: "Всего в системе",
      value: stats.contracts,
      to: "/contracts",
      icon: <IconContracts />,
      style: "from-coral-400 to-coral-600",
    },
    {
      label: "Подписаны ЭЦП",
      sub: "Завершённый документооборот",
      value: stats.signed,
      to: "/contracts?status=signed",
      icon: <IconSigned />,
      style: "from-emerald-500 to-emerald-700",
    },
  ];

  const hour = new Date().getHours();
  const greeting = hour < 6 ? "Доброй ночи" : hour < 12 ? "Доброе утро" : hour < 18 ? "Добрый день" : "Добрый вечер";

  return (
    <div>
      {/* Hero banner */}
      <div className="card-charcoal p-7 md:p-9 mb-7 relative overflow-hidden">
        <div className="absolute -right-12 -top-12 w-80 h-80 rounded-full bg-coral-500/15 blur-3xl pointer-events-none" />
        <div className="absolute right-8 bottom-4 opacity-90 hidden md:block">
          <img src="/ccu-logo.png" alt="" className="h-40 w-40 object-contain drop-shadow-xl" />
        </div>
        <div className="relative max-w-2xl">
          <span className="pill mb-3">CCU PRACTICUM · {new Date().toLocaleDateString("ru-RU", { day: "2-digit", month: "long", year: "numeric" })}</span>
          <h1 className="font-serif text-3xl md:text-4xl font-bold leading-tight">
            {greeting}, {user?.full_name?.split(" ")[0] || ""}
          </h1>
          <p className="text-white/85 mt-2 text-sm md:text-base">
            Обзор цифрового документооборота: партнёры, студенты, договоры и подписанные ЭЦП документы Колледжа Каспийского университета.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-8">
        {cards.map((c) => (
          <Link
            key={c.label}
            to={c.to}
            className={`group rounded-2xl p-5 bg-gradient-to-br ${c.style} text-white shadow-soft hover:shadow-lg transition relative overflow-hidden`}
          >
            <div className="absolute -right-6 -bottom-6 opacity-10 text-white">
              <div className="h-32 w-32">{c.icon}</div>
            </div>
            <div className="text-xs uppercase tracking-[0.16em] opacity-80">{c.sub}</div>
            <div className="text-sm/none mt-1 font-medium opacity-95">{c.label}</div>
            <div className="text-4xl font-extrabold mt-3">{loading ? "—" : c.value}</div>
            <div className="absolute right-4 top-4 text-white/40 group-hover:text-white/70 transition">
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M7 17L17 7M9 7h8v8" />
              </svg>
            </div>
          </Link>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <section className="card p-6 lg:col-span-2">
          <div className="flex items-center justify-between mb-4">
            <h2 className="section-title">📄 Последние договоры</h2>
            <Link to="/contracts" className="link text-sm">
              Все договоры →
            </Link>
          </div>
          {recent.length === 0 ? (
            <div className="py-12 text-center">
              <div className="text-5xl mb-2">📋</div>
              <p className="text-charcoal-500 text-sm">Договоров пока нет. Создайте первый, выбрав партнёра и студента.</p>
              <Link to="/contracts" className="btn-primary mt-4 inline-flex">+ Новый договор</Link>
            </div>
          ) : (
            <div className="overflow-x-auto -mx-2">
              <table className="table-default">
                <thead>
                  <tr>
                    <th>№</th>
                    <th>Партнёр</th>
                    <th>Студент</th>
                    <th>Группа</th>
                    <th>Дата</th>
                    <th>Статус</th>
                  </tr>
                </thead>
                <tbody>
                  {recent.map((c) => (
                    <tr key={c.id}>
                      <td className="font-semibold">
                        <Link to={`/contracts/${c.id}`} className="text-coral-600 hover:underline">{c.number}</Link>
                      </td>
                      <td>{c.partner_name}</td>
                      <td>{c.student_name}</td>
                      <td>{c.student_group || "—"}</td>
                      <td>{formatDate(c.contract_date)}</td>
                      <td><StatusBadge value={c.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <aside className="space-y-4">
          <div className="card p-6">
            <h3 className="section-title mb-3">⚡ Быстрые действия</h3>
            <div className="space-y-2">
              <Link to="/partners" className="btn-secondary w-full justify-between">
                <span>Добавить партнёра</span>
                <span>→</span>
              </Link>
              <Link to="/students" className="btn-secondary w-full justify-between">
                <span>Добавить студента</span>
                <span>→</span>
              </Link>
              <Link to="/contracts" className="btn-primary w-full justify-between">
                <span>+ Новый договор</span>
                <span>→</span>
              </Link>
            </div>
          </div>

          <div className="card p-6">
            <h3 className="section-title mb-2">🎓 О платформе</h3>
            <p className="text-xs text-charcoal-500 leading-relaxed">
              CCU PRACTICUM — единая платформа Колледжа Каспийского университета для
              цифрового документооборота профессиональной практики: реестры партнёров и студентов,
              автоматическое формирование договоров, подписание ЭЦП всеми тремя сторонами через NCALayer
              и защищённый электронный архив.
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}

function IconPartners() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor"><path d="M3 21h7M14 21h7M3 21V10l4-2 4 2v11M14 21V8l4-2 3 2v13" stroke="white" strokeWidth="2" fill="none" /></svg>
  );
}
function IconStudents() {
  return (
    <svg viewBox="0 0 24 24"><path d="M12 14l9-5-9-5-9 5 9 5z" stroke="white" strokeWidth="2" fill="none" /></svg>
  );
}
function IconContracts() {
  return (
    <svg viewBox="0 0 24 24"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z M14 3v5h5" stroke="white" strokeWidth="2" fill="none" /></svg>
  );
}
function IconSigned() {
  return (
    <svg viewBox="0 0 24 24"><path d="M12 2l9 4v6c0 5-4 9-9 10C7 21 3 17 3 12V6l9-4z M9 12l2 2 4-4" stroke="white" strokeWidth="2" fill="none" /></svg>
  );
}
