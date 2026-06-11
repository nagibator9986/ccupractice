import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import toast from "react-hot-toast";
import BrandLogo from "../components/BrandLogo.jsx";
import StatusBadge from "../components/StatusBadge.jsx";
import { signingApi } from "../api/endpoints.js";
import { signBase64WithNCALayer, pingNCALayer } from "../utils/ncalayer.js";
import { formatDate, formatDateTime } from "../utils/format.js";

const ROLE_LABELS = {
  college: "Колледж",
  partner: "Предприятие",
  student: "Обучающийся",
};

export default function PublicSignPage() {
  const { token } = useParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [ncaAvailable, setNcaAvailable] = useState(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  async function load() {
    try {
      const res = await signingApi.publicView(token);
      setData(res);
    } catch (e) {
      const status = e.response?.status;
      const code = e.response?.data?.code;
      if (status === 410 && code === "expired") setError("Срок действия ссылки истёк.");
      else if (status === 410 && code === "revoked") setError("Ссылка отозвана администратором.");
      else if (status === 404) setError("Ссылка недействительна или не существует.");
      else setError(e.response?.data?.error || "Не удалось загрузить договор.");
    }
  }

  useEffect(() => {
    load();
  }, [token]); // eslint-disable-line

  useEffect(() => {
    let cancelled = false;
    let timeoutId = null;
    const probe = async () => {
      const ok = await pingNCALayer();
      if (cancelled) return;
      setNcaAvailable(ok);
      // If detected, stop polling; otherwise keep retrying.
      if (!ok) timeoutId = setTimeout(probe, 5000);
    };
    probe();
    return () => {
      cancelled = true;
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, []);

  async function sign() {
    setBusy(true);
    const t = toast.loading("Получаем документ для подписи…");
    try {
      const { payload_base64 } = await signingApi.publicPayload(token);
      toast.loading("Откройте NCALayer и подпишите документ…", { id: t });
      const cms = await signBase64WithNCALayer(payload_base64);
      toast.loading("Сохраняем подпись…", { id: t });
      const res = await signingApi.publicSubmit(token, cms);
      toast.success("Договор успешно подписан", { id: t });
      if (res?.warnings?.length) {
        res.warnings.forEach((w) => toast(w, { icon: "⚠️", duration: 6000 }));
      }
      setDone(true);
      load();
    } catch (e) {
      const msg = e.response?.data?.error || e.message || "Ошибка подписания";
      toast.error(msg, { id: t });
    } finally {
      setBusy(false);
    }
  }

  if (error) return <Wrapper><ErrorState message={error} /></Wrapper>;
  if (!data) return <Wrapper><div className="text-charcoal-500">Загрузка договора…</div></Wrapper>;

  const role = data.request.signer_role;
  const myStatus = data.signing_state[role]?.status || data.request.status;
  const alreadySigned = myStatus === "signed" || done;

  return (
    <Wrapper>
      <header className="card-brand p-8 mb-6 relative">
        <div className="absolute -right-20 -bottom-20 w-72 h-72 rounded-full bg-white/10 blur-3xl pointer-events-none" />
        <div className="absolute right-6 top-6 hidden sm:block opacity-90">
          <img src="/ccu-logo.png" alt="" className="h-20 w-20 object-contain drop-shadow-lg" />
        </div>
        <div className="flex items-center gap-3 mb-6 relative">
          <BrandLogo size={52} withWordmark variant="light" />
        </div>
        <span className="pill mb-3">⚖️ Электронное подписание ЭЦП</span>
        <h1 className="font-serif text-3xl md:text-4xl font-bold mt-2 leading-tight">
          Договор № {data.contract.number}
        </h1>
        <div className="opacity-90 mt-2">
          Подписать как: <span className="font-semibold">{data.request.signer_role_label}</span>
        </div>
        <div className="opacity-80 text-sm mt-1">
          Получатель: {data.request.recipient_name || "—"}
          {data.request.recipient_iin_or_bin && ` • ИИН/БИН: ${data.request.recipient_iin_or_bin}`}
        </div>
      </header>

      <div className="grid lg:grid-cols-3 gap-6">
        <section className="lg:col-span-2 space-y-4">
          <div className="card p-6">
            <h2 className="section-title mb-4">📋 Сведения о договоре</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Info label="Номер договора" value={data.contract.number} />
              <Info label="Дата договора" value={formatDate(data.contract.date)} />
              <Info label="Партнёр (предприятие)" value={data.contract.partner.name} />
              <Info label="БИН предприятия" value={data.contract.partner.bin} />
              <Info label="Руководитель" value={`${data.contract.partner.director_position || ""} ${data.contract.partner.director_full_name || ""}`} />
              <Info label="Юридический адрес" value={data.contract.partner.legal_address} />

              <Info label="Студент" value={data.contract.student.full_name} />
              <Info label="ИИН студента" value={data.contract.student.iin} />
              <Info label="Группа / специальность" value={`${data.contract.student.group_name || "—"} • ${data.contract.student.specialty || ""}`} />
              <Info
                label="Период практики"
                value={data.contract.student.practice_start
                  ? `${formatDate(data.contract.student.practice_start)} → ${formatDate(data.contract.student.practice_end)}`
                  : "—"}
              />
            </div>

            <div className="divider my-5" />
            <h3 className="font-semibold mb-3 text-charcoal-700">Документ</h3>
            <div className="flex flex-wrap gap-2">
              {data.download.docx && (
                <a className="btn-secondary" href={signingApi.publicDownloadUrl(token, "docx")} target="_blank" rel="noreferrer">📄 Скачать DOCX</a>
              )}
              {data.download.pdf && (
                <a className="btn-secondary" href={signingApi.publicDownloadUrl(token, "pdf")} target="_blank" rel="noreferrer">📕 Скачать PDF</a>
              )}
            </div>
            <p className="text-xs text-charcoal-500 mt-3">
              Внимательно прочитайте документ перед подписанием. Ваша ЭЦП криптографически
              привязывается к содержимому файла и не может быть подменена.
            </p>
          </div>

          <div className="card p-6">
            <h2 className="section-title mb-4">🔐 Электронная подпись</h2>
            <NCALayerBanner available={ncaAvailable} />
            {alreadySigned ? (
              <div className="mt-4 p-4 rounded-xl bg-emerald-50 ring-1 ring-emerald-100">
                <div className="font-semibold text-emerald-700 mb-1">✅ Договор подписан с вашей стороны</div>
                <div className="text-sm text-emerald-700/90">
                  Подпись сохранена. Спасибо! Ссылка останется активной для просмотра.
                </div>
              </div>
            ) : (
              <div className="mt-4 space-y-3">
                <ol className="list-decimal pl-5 text-sm text-charcoal-600 space-y-1">
                  <li>Убедитесь, что приложение <a className="link" href="https://pki.gov.kz/ncalayer/" target="_blank" rel="noreferrer">NCALayer</a> запущено.</li>
                  <li>Нажмите кнопку «Подписать ЭЦП».</li>
                  <li>В окне NCALayer выберите хранилище (PKCS12 / удостоверение / токен) и введите PIN.</li>
                </ol>
                <button
                  className="btn-primary w-full text-base py-3"
                  disabled={busy || !ncaAvailable}
                  onClick={sign}
                >
                  {busy ? "Подписываем…" : "Подписать ЭЦП"}
                </button>
                {!ncaAvailable && (
                  <button
                    className="btn-secondary w-full"
                    onClick={() => pingNCALayer().then((ok) => setNcaAvailable(ok))}
                  >
                    Проверить NCALayer повторно
                  </button>
                )}
              </div>
            )}
          </div>
        </section>

        <aside className="space-y-4">
          <div className="card p-6">
            <h3 className="section-title mb-4">Состояние подписания</h3>
            <ul className="space-y-3">
              {["college", "partner", "student"].map((r) => {
                const item = data.signing_state[r];
                const isMine = r === role;
                return (
                  <li
                    key={r}
                    className={`p-3 rounded-xl border ${isMine ? "border-coral-300 bg-coral-50/50" : "border-charcoal-100"}`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="font-semibold text-sm">
                        {ROLE_LABELS[r]} {isMine && <span className="chip ml-1">это вы</span>}
                      </div>
                      <PartyStatus value={item?.status || "pending"} />
                    </div>
                    {item?.recipient_name && (
                      <div className="text-xs text-charcoal-500 mt-1">{item.recipient_name}</div>
                    )}
                    {item?.signed_at && (
                      <div className="text-[11px] text-emerald-600 mt-0.5">✓ {formatDateTime(item.signed_at)}</div>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>

          <div className="card p-5">
            <div className="text-[11px] uppercase tracking-wide font-semibold text-charcoal-500 mb-2">
              Безопасность
            </div>
            <ul className="text-xs text-charcoal-600 space-y-1.5">
              <li>🔒 Ссылка одноразовая и привязана к одному получателю</li>
              <li>📅 Срок действия: до {formatDate(data.request.expires_at)}</li>
              <li>🆔 Подписант идентифицируется по сертификату НУЦ РК</li>
              <li>🧾 SHA-256 хэш файла фиксируется в момент подписи</li>
            </ul>
          </div>
        </aside>
      </div>

      <footer className="text-center text-xs text-charcoal-400 mt-10 flex flex-col items-center gap-2">
        <img src="/ccu-logo.png" alt="" className="h-10 w-10 opacity-60" />
        © {new Date().getFullYear()} College of Caspian University · CCU PRACTICUM
      </footer>
    </Wrapper>
  );
}

function Wrapper({ children }) {
  return (
    <div className="min-h-screen bg-gradient-to-br from-coral-50/50 via-white to-charcoal-50 py-6 px-4 md:py-10">
      <div className="max-w-5xl mx-auto">{children}</div>
    </div>
  );
}

function Info({ label, value }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide font-semibold text-charcoal-400">{label}</div>
      <div className="font-medium text-charcoal-800">{value || "—"}</div>
    </div>
  );
}

function PartyStatus({ value }) {
  const map = {
    pending: { label: "Ожидает", cls: "bg-charcoal-100 text-charcoal-600" },
    viewed: { label: "Просмотрено", cls: "bg-amber-100 text-amber-700" },
    signed: { label: "Подписано", cls: "bg-emerald-100 text-emerald-700" },
    revoked: { label: "Отозвано", cls: "bg-red-100 text-red-700" },
  };
  const it = map[value] || map.pending;
  return <span className={`badge ${it.cls}`}>{it.label}</span>;
}

function NCALayerBanner({ available }) {
  if (available === null)
    return <div className="text-xs px-3 py-2 rounded-xl bg-charcoal-50 text-charcoal-600">Проверяем NCALayer…</div>;
  if (available)
    return (
      <div className="text-xs px-3 py-2 rounded-xl bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100">
        ✓ NCALayer обнаружен на вашем устройстве — можно подписывать.
      </div>
    );
  return (
    <div className="text-xs px-3 py-2 rounded-xl bg-amber-50 text-amber-700 ring-1 ring-amber-100 space-y-1.5">
      <div>
        ⚠ NCALayer не обнаружен. Установите приложение НУЦ РК с{" "}
        <a className="link" href="https://pki.gov.kz/ncalayer/" target="_blank" rel="noreferrer">pki.gov.kz/ncalayer</a>
        {" "}и запустите его.
      </div>
      <div>
        Если приложение уже запущено, один раз откройте{" "}
        <a className="link" href="https://127.0.0.1:13579" target="_blank" rel="noreferrer">https://127.0.0.1:13579</a>
        {" "}и подтвердите сертификат NCALayer (защищённый сайт пускает подпись только
        к доверенному сертификату), затем нажмите «Проверить NCALayer повторно».
      </div>
    </div>
  );
}

function ErrorState({ message }) {
  return (
    <div className="card p-10 text-center">
      <div className="text-5xl mb-3">⚠️</div>
      <h1 className="font-serif text-2xl font-bold mb-2">Не удалось открыть договор</h1>
      <p className="text-charcoal-500">{message}</p>
      <p className="text-xs text-charcoal-400 mt-6">
        Свяжитесь с администратором колледжа для получения новой ссылки.
      </p>
    </div>
  );
}
