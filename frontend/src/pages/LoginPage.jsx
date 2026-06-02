import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import { useAuth } from "../context/AuthContext.jsx";
import BrandLogo from "../components/BrandLogo.jsx";

export default function LoginPage() {
  const { login, user } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("admin@ccu.kz");
  const [password, setPassword] = useState("admin123");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (user) navigate("/", { replace: true });
  }, [user, navigate]);

  async function onSubmit(e) {
    e.preventDefault();
    const trimmed = email.trim();
    if (!trimmed || !password) {
      toast.error("Введите email и пароль");
      return;
    }
    setLoading(true);
    try {
      await login(trimmed, password);
      toast.success("Добро пожаловать!");
      navigate("/", { replace: true });
    } catch (err) {
      const status = err.response?.status;
      const msg = err.response?.data?.error;
      if (!err.response) {
        toast.error("Не удалось связаться с сервером");
      } else if (status === 401) {
        toast.error(msg || "Неверные учётные данные");
      } else {
        toast.error(msg || "Ошибка входа");
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen grid lg:grid-cols-[1.05fr_1fr] bg-white">
      {/* Brand panel */}
      <aside className="relative hidden lg:flex flex-col justify-between p-14 text-white overflow-hidden">
        <div
          className="absolute inset-0 -z-10"
          style={{
            backgroundImage:
              "radial-gradient(80% 80% at 15% 0%, #e85a3f 0%, #b53b1f 55%, #46484b 100%)",
          }}
        />
        {/* Decorative blob */}
        <div className="absolute -right-32 -bottom-32 w-[480px] h-[480px] rounded-full bg-white/5 blur-3xl" aria-hidden />
        <div className="absolute -right-10 top-1/3 w-72 h-72 rounded-full bg-coral-300/20 blur-2xl" aria-hidden />

        <div className="flex items-center gap-3">
          <BrandLogo size={64} withWordmark variant="light" />
        </div>

        <div className="max-w-md space-y-6">
          <span className="pill">⚖️ Цифровой документооборот</span>
          <h1 className="font-serif text-4xl xl:text-5xl font-bold leading-tight">
            Договоры профессиональной практики со скоростью клика
          </h1>
          <p className="text-white/85 text-base leading-relaxed">
            CCU PRACTICUM — единая платформа Колледжа Каспийского университета: реестры
            партнёров и студентов, автоматическая генерация договоров и подписание ЭЦП
            всеми тремя сторонами через NCALayer.
          </p>
          <ul className="space-y-2.5 text-sm text-white/95">
            <Feature>Автоматическое формирование Word и PDF</Feature>
            <Feature>Подписание ЭЦП колледжем, предприятием и студентом</Feature>
            <Feature>Защищённые одноразовые ссылки для партнёров</Feature>
            <Feature>Единый электронный архив договоров</Feature>
          </ul>
        </div>

        <div className="flex items-center justify-between text-xs text-white/60">
          <span>© {new Date().getFullYear()} College of Caspian University</span>
          <span>Almaty · Kazakhstan</span>
        </div>
      </aside>

      {/* Login form */}
      <section className="relative flex items-center justify-center px-4 py-10 sm:p-12 bg-gradient-to-br from-coral-50/40 via-white to-charcoal-50/60">
        <div className="absolute inset-0 bg-dotted opacity-50 pointer-events-none" />
        <div className="relative w-full max-w-md">
          <div className="lg:hidden flex justify-center mb-6">
            <BrandLogo size={64} withWordmark />
          </div>

          <div className="card-elev p-8">
            <div className="mb-7">
              <span className="chip">Вход в систему</span>
              <h2 className="font-serif text-3xl font-bold mt-3 text-charcoal-900">С возвращением</h2>
              <p className="text-charcoal-500 text-sm mt-1.5">
                Войдите, чтобы управлять договорами практики
              </p>
            </div>
            <form onSubmit={onSubmit} className="space-y-4">
              <div>
                <label className="label">Электронная почта</label>
                <div className="relative">
                  <input
                    type="email"
                    className="input pl-10"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    autoFocus
                    placeholder="you@ccu.kz"
                  />
                  <MailIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-charcoal-400" />
                </div>
              </div>
              <div>
                <label className="label">Пароль</label>
                <div className="relative">
                  <input
                    type="password"
                    className="input pl-10"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    placeholder="••••••••"
                  />
                  <LockIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-charcoal-400" />
                </div>
              </div>
              <button type="submit" className="btn-primary w-full mt-2 text-base py-3" disabled={loading}>
                {loading ? "Вход…" : "Войти в CCU PRACTICUM"}
              </button>
            </form>

            <div className="mt-6 text-xs text-center text-charcoal-500 space-y-1">
              <div className="text-charcoal-400 uppercase tracking-wider font-semibold text-[10px]">Демо-учётные записи</div>
              <div className="font-mono text-charcoal-600">
                admin@ccu.kz / admin123
              </div>
              <div className="font-mono text-charcoal-600">
                viewer@ccu.kz / viewer123
              </div>
            </div>
          </div>

          <div className="text-[11px] text-charcoal-400 mt-6 text-center leading-relaxed">
            Подписание выполняется через{" "}
            <a className="link" href="https://pki.gov.kz/ncalayer/" target="_blank" rel="noreferrer">
              NCALayer
            </a>
            . Установите приложение НУЦ РК перед использованием ЭЦП.
          </div>
        </div>
      </section>
    </div>
  );
}

function Feature({ children }) {
  return (
    <li className="flex items-start gap-2.5">
      <span className="mt-0.5 h-5 w-5 rounded-full bg-white/15 grid place-items-center text-[10px]">✓</span>
      <span>{children}</span>
    </li>
  );
}

function MailIcon(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M3 7l9 6 9-6" />
    </svg>
  );
}

function LockIcon(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <rect x="4" y="11" width="16" height="10" rx="2" />
      <path d="M8 11V8a4 4 0 1 1 8 0v3" />
    </svg>
  );
}
