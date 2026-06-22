import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import toast from "react-hot-toast";
import BrandLogo from "../components/BrandLogo.jsx";
import { enrollmentsApi } from "../api/endpoints.js";
import { signBase64WithNCALayer, pingNCALayer } from "../utils/ncalayer.js";
import { formatDate, ruYears } from "../utils/format.js";

export default function EnrollmentSignPage() {
  const { token } = useParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [ncaAvailable, setNcaAvailable] = useState(null);
  const [signing, setSigning] = useState(null); // document key currently signing
  const [previewKey, setPreviewKey] = useState(null); // document key shown inline

  async function load() {
    try {
      const res = await enrollmentsApi.publicView(token);
      setData(res);
      if (res?.request?.status === "pending") {
        enrollmentsApi.publicMarkViewed(token).catch(() => {});
      }
    } catch (e) {
      const status = e.response?.status;
      const code = e.response?.data?.code;
      if (status === 410 && code === "expired") setError("Срок действия ссылки истёк.");
      else if (status === 410 && code === "revoked") setError("Ссылка отозвана администратором.");
      else if (status === 404) setError("Ссылка недействительна или не существует.");
      else setError(e.response?.data?.error || "Не удалось загрузить документы.");
    }
  }

  useEffect(() => { load(); }, [token]); // eslint-disable-line

  useEffect(() => {
    let cancelled = false;
    let timer = null;
    const probe = async () => {
      const ok = await pingNCALayer();
      if (cancelled) return;
      setNcaAvailable(ok);
      if (!ok) timer = setTimeout(probe, 5000);
    };
    probe();
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, []);

  async function sign(doc) {
    setSigning(doc.key);
    const t = toast.loading("Получаем документ для подписи…");
    try {
      const { payload_base64 } = await enrollmentsApi.publicPayload(token, doc.key);
      toast.loading("Откройте NCALayer и подпишите документ…", { id: t });
      const cms = await signBase64WithNCALayer(payload_base64);
      toast.loading("Сохраняем подпись…", { id: t });
      const res = await enrollmentsApi.publicSubmit(token, doc.key, cms);
      toast.success(`Подписано: ${doc.label}`, { id: t });
      if (res?.warnings?.length) res.warnings.forEach((w) => toast(w, { icon: "⚠️", duration: 6000 }));
      load();
    } catch (e) {
      toast.error(e.response?.data?.error || e.message || "Ошибка подписания", { id: t });
      // The server state may have changed (e.g. 409 "already signed" from a
      // duplicate tab / resent link / concurrent submit). Re-fetch so the badge
      // and "Подписать ЭЦП" button reflect reality instead of going stale.
      load();
    } finally {
      setSigning(null);
    }
  }

  if (error) return <Wrapper><ErrorState message={error} /></Wrapper>;
  if (!data) return <Wrapper><div className="text-charcoal-500">Загрузка документов…</div></Wrapper>;

  const { enrollment: en, documents, request } = data;
  const pending = documents.filter((d) => !d.signed);
  const hasDocs = documents.length > 0;
  // Only "all done" when there were documents to begin with — otherwise an empty
  // list (e.g. birth date cleared after the link was issued) would falsely show
  // the green "всё подписано" banner.
  const allDone = hasDocs && pending.length === 0;

  return (
    <Wrapper>
      <header className="card-brand p-8 mb-6 relative">
        <div className="absolute -right-20 -bottom-20 w-72 h-72 rounded-full bg-white/10 blur-3xl pointer-events-none" />
        <div className="flex items-center gap-3 mb-6 relative">
          <BrandLogo size={52} withWordmark variant="light" />
        </div>
        <span className="pill mb-3">⚖️ Электронное подписание ЭЦП</span>
        <h1 className="font-serif text-3xl md:text-4xl font-bold mt-2 leading-tight">
          Договор № {en.number || "—"}
        </h1>
        <div className="opacity-90 mt-2">
          Вы подписываете как: <span className="font-semibold">{request.signer_party_label}</span>
        </div>
      </header>

      <div className="grid lg:grid-cols-3 gap-6">
        <section className="lg:col-span-2 space-y-4">
          <div className="card p-6">
            <h2 className="section-title mb-4">📋 Сведения</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Info label="Колледж" value={en.college_name} />
              <Info label="Номер договора" value={en.number} />
              <Info label="Дата" value={formatDate(en.date)} />
              <Info label="Абитуриент" value={en.applicant_full_name} />
              <Info label="ИИН" value={en.applicant_iin} />
              <Info label="Специальность" value={en.specialty} />
              <Info label="Квалификация" value={en.qualification} />
              <Info label="Стоимость за год" value={en.tuition_year_amount ? `${en.tuition_year_amount.toLocaleString("ru-RU")} ₸` : null} />
            </div>
          </div>

          <div className="card p-6">
            <h2 className="section-title mb-4">🔐 Документы к подписанию</h2>
            <NCALayerBanner available={ncaAvailable} />
            <div className="mt-4 space-y-3">
              {documents.map((doc) => (
                <div key={doc.key} className="rounded-xl border border-charcoal-100 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="font-medium text-charcoal-800">{doc.label}</div>
                      <div className="text-[11px] text-charcoal-400 mt-0.5">Документ на двух языках — қазақша / на русском</div>
                    </div>
                    {doc.signed ? (
                      <span className="badge bg-emerald-100 text-emerald-700">✓ Подписано</span>
                    ) : (
                      <span className="badge bg-charcoal-100 text-charcoal-600">Ожидает подписи</span>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2 mt-3">
                    {doc.pdf && (
                      <button
                        className="btn-secondary text-xs"
                        onClick={() => setPreviewKey(previewKey === doc.key ? null : doc.key)}
                      >
                        {previewKey === doc.key ? "▲ Свернуть" : "👁 Просмотреть"}
                      </button>
                    )}
                    {doc.pdf && (
                      <a className="btn-secondary text-xs" href={enrollmentsApi.publicDownloadUrl(token, doc.key, "pdf")} target="_blank" rel="noreferrer">📕 PDF</a>
                    )}
                    {doc.docx && (
                      <a className="btn-secondary text-xs" href={enrollmentsApi.publicDownloadUrl(token, doc.key, "docx")} target="_blank" rel="noreferrer">📄 DOCX</a>
                    )}
                    {!doc.signed && (
                      <button
                        className="btn-primary text-xs"
                        disabled={!ncaAvailable || signing !== null}
                        onClick={() => sign(doc)}
                      >
                        {signing === doc.key ? "Подписываем…" : "Подписать ЭЦП"}
                      </button>
                    )}
                  </div>
                  {previewKey === doc.key && doc.pdf && (
                    <div className="mt-3 rounded-lg overflow-hidden ring-1 ring-charcoal-100 bg-charcoal-50">
                      <iframe
                        title={`Просмотр: ${doc.label}`}
                        src={enrollmentsApi.publicPreviewUrl(token, doc.key)}
                        className="w-full h-[70vh] bg-white"
                      />
                    </div>
                  )}
                  {!doc.pdf && doc.docx && (
                    <div className="mt-2 text-[11px] text-charcoal-400">
                      Предпросмотр недоступен — откройте DOCX, чтобы увидеть обе языковые версии.
                    </div>
                  )}
                </div>
              ))}
            </div>

            {!hasDocs && (
              <div className="mt-4 p-4 rounded-xl bg-amber-50 ring-1 ring-amber-100 text-amber-800 text-sm">
                Для этой ссылки сейчас нет документов к подписанию. Свяжитесь с администратором колледжа.
              </div>
            )}
            {allDone && (
              <div className="mt-4 p-4 rounded-xl bg-emerald-50 ring-1 ring-emerald-100">
                <div className="font-semibold text-emerald-700">✅ Все ваши документы подписаны</div>
                <div className="text-sm text-emerald-700/90">Спасибо! Подписи сохранены.</div>
              </div>
            )}
            {!ncaAvailable && !allDone && (
              <button className="btn-secondary w-full mt-3" onClick={() => pingNCALayer().then(setNcaAvailable)}>
                Проверить NCALayer повторно
              </button>
            )}
          </div>
        </section>

        <aside className="space-y-4">
          <div className="card p-6">
            <h3 className="section-title mb-3">Кто подписывает</h3>
            <ul className="text-sm text-charcoal-600 space-y-1.5">
              <li>👤 Возраст абитуриента: {data.applicant_age != null ? `${data.applicant_age} ${ruYears(data.applicant_age)}` : "—"}</li>
              <li>
                {data.applicant_age != null && data.applicant_age >= 16
                  ? "С 16 лет студент подписывает договор и согласие; родитель подписывает согласие."
                  : "До 16 лет оба документа подписывает законный представитель (родитель)."}
              </li>
            </ul>
          </div>
          <div className="card p-5">
            <div className="text-[11px] uppercase tracking-wide font-semibold text-charcoal-500 mb-2">Безопасность</div>
            <ul className="text-xs text-charcoal-600 space-y-1.5">
              <li>🔒 Ссылка одноразовая и привязана к одному получателю</li>
              <li>📅 Срок действия: до {formatDate(request.expires_at)}</li>
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

function NCALayerBanner({ available }) {
  if (available === null)
    return <div className="text-xs px-3 py-2 rounded-xl bg-charcoal-50 text-charcoal-600">Проверяем NCALayer…</div>;
  if (available)
    return (
      <div className="text-xs px-3 py-2 rounded-xl bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100">
        ✓ NCALayer обнаружен — можно подписывать.
      </div>
    );
  return (
    <div className="text-xs px-3 py-2 rounded-xl bg-amber-50 text-amber-700 ring-1 ring-amber-100 space-y-1.5">
      <div>
        ⚠ NCALayer не обнаружен. Установите приложение НУЦ РК с{" "}
        <a className="link" href="https://pki.gov.kz/ncalayer/" target="_blank" rel="noreferrer">pki.gov.kz/ncalayer</a> и запустите его.
      </div>
      <div>
        Если приложение запущено, один раз откройте{" "}
        <a className="link" href="https://127.0.0.1:13579" target="_blank" rel="noreferrer">https://127.0.0.1:13579</a>{" "}
        и подтвердите сертификат, затем нажмите «Проверить NCALayer повторно».
      </div>
    </div>
  );
}

function ErrorState({ message }) {
  return (
    <div className="card p-10 text-center">
      <div className="text-5xl mb-3">⚠️</div>
      <h1 className="font-serif text-2xl font-bold mb-2">Не удалось открыть документы</h1>
      <p className="text-charcoal-500">{message}</p>
      <p className="text-xs text-charcoal-400 mt-6">Свяжитесь с администратором колледжа для получения новой ссылки.</p>
    </div>
  );
}
