import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import toast from "react-hot-toast";
import BrandLogo from "../components/BrandLogo.jsx";
import { lmsContractsApi } from "../api/endpoints.js";
import { pingNCALayer, signBase64WithNCALayer } from "../utils/ncalayer.js";
import { formatDate } from "../utils/format.js";

export default function LmsSignPage() {
  const { token } = useParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [ncaAvailable, setNcaAvailable] = useState(null);
  const [signing, setSigning] = useState(false);
  const [preview, setPreview] = useState(false);

  async function load() {
    try {
      const res = await lmsContractsApi.publicView(token);
      setData(res);
      if (res?.request?.status === "pending") {
        lmsContractsApi.publicMarkViewed(token).catch(() => {});
      }
    } catch (e) {
      const status = e.response?.status;
      const code = e.response?.data?.code;
      if (status === 410 && code === "expired") setError("Срок действия ссылки истёк.");
      else if (status === 410 && code === "revoked") setError("Ссылка отозвана администратором.");
      else if (status === 404) setError("Ссылка недействительна или не существует.");
      else setError(e.response?.data?.error || "Не удалось загрузить документ.");
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

  async function sign() {
    setSigning(true);
    try {
      const payload = await lmsContractsApi.publicPayload(token);
      const cms = await signBase64WithNCALayer(payload.payload_base64);
      const res = await lmsContractsApi.publicSubmit(token, cms);
      if (res?.warnings?.length) {
        res.warnings.forEach((w) => toast(w, { icon: "⚠️", duration: 6000 }));
      }
      toast.success("Документ подписан");
      load();
    } catch (e) {
      const msg = e.response?.data?.error || e.message || "Не удалось подписать";
      toast.error(msg);
    } finally {
      setSigning(false);
    }
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <div className="card max-w-md text-center p-8">
          <BrandLogo className="mx-auto mb-4 h-12" />
          <h1 className="text-xl font-semibold mb-2">Ссылка недоступна</h1>
          <p className="text-charcoal-600">{error}</p>
        </div>
      </div>
    );
  }
  if (!data) {
    return <div className="min-h-screen flex items-center justify-center text-charcoal-500">Загрузка…</div>;
  }

  const { request: req, lms, document: doc, signatures } = data;
  const alreadySigned = !!doc?.signed;

  return (
    <div className="min-h-screen bg-gradient-to-br from-coral-50/40 to-white">
      <div className="container mx-auto max-w-4xl py-10 px-4">
        <div className="flex items-center justify-between mb-6">
          <BrandLogo className="h-10" />
          <span className="chip-coral">LMS · Caspian Digital</span>
        </div>

        <div className="card p-6 mb-4">
          <div className="text-xs text-charcoal-500 uppercase tracking-wide">{doc?.label}</div>
          <h1 className="text-2xl font-semibold mt-1">
            № {lms.number || "—"}
            <span className="text-charcoal-500 text-base font-normal ml-2">
              от {formatDate(lms.date) || "—"}
            </span>
          </h1>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4 text-sm">
            <div>
              <div className="text-charcoal-500">Колледж</div>
              <div className="font-medium">{lms.college_name}</div>
            </div>
            <div>
              <div className="text-charcoal-500">Студент</div>
              <div className="font-medium">{lms.applicant_full_name}</div>
              <div className="text-xs text-charcoal-500">ИИН {lms.applicant_iin || "—"}</div>
            </div>
            <div>
              <div className="text-charcoal-500">Специальность</div>
              <div className="font-medium">{lms.specialty || "—"}</div>
              {lms.qualification && <div className="text-xs text-charcoal-500">{lms.qualification}</div>}
            </div>
            <div>
              <div className="text-charcoal-500">Финансирование</div>
              <div className="font-medium">{lms.funding_source || "госзаказ"}</div>
              {lms.grant_order_number && (
                <div className="text-xs text-charcoal-500">Приказ № {lms.grant_order_number}</div>
              )}
            </div>
          </div>
        </div>

        <div className="card p-6 mb-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-xs text-charcoal-500 uppercase tracking-wide">Подписант</div>
              <div className="font-medium">{req.signer_party_label}</div>
              {req.recipient_name && (
                <div className="text-xs text-charcoal-500 mt-1">Ожидаемый подписант: {req.recipient_name}</div>
              )}
            </div>
            <span className={`badge ${alreadySigned ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}`}>
              {alreadySigned ? "✓ подписан" : "ожидает подписи"}
            </span>
          </div>

          {!alreadySigned && (
            <div className="mt-5 space-y-3">
              <div className="text-sm text-charcoal-600">
                Перед подписанием просмотрите документ. Подписание выполняется через NCALayer (ЭЦП НУЦ РК).
              </div>
              <div className="flex flex-wrap gap-2">
                <button className="btn btn-secondary" onClick={() => setPreview((p) => !p)}>
                  {preview ? "Скрыть предпросмотр" : "👁 Предпросмотр PDF"}
                </button>
                {doc?.pdf && (
                  <a className="btn btn-secondary" href={lmsContractsApi.publicDownloadUrl(token, "pdf")} target="_blank" rel="noreferrer">
                    📕 Скачать PDF
                  </a>
                )}
                {doc?.docx && (
                  <a className="btn btn-secondary" href={lmsContractsApi.publicDownloadUrl(token, "docx")} target="_blank" rel="noreferrer">
                    📄 Скачать DOCX
                  </a>
                )}
              </div>

              {preview && doc?.pdf && (
                <iframe
                  title="Предпросмотр документа"
                  className="w-full h-[60vh] rounded-xl ring-1 ring-charcoal-200 mt-3"
                  src={lmsContractsApi.publicPreviewUrl(token)}
                />
              )}

              <div className="pt-2">
                {ncaAvailable === false && (
                  <div className="rounded-xl bg-amber-50 ring-1 ring-amber-200 px-3 py-2 text-sm text-amber-900 mb-3">
                    ⚠ NCALayer не обнаружен. Установите и запустите{" "}
                    <a className="link" href="https://pki.gov.kz/ncalayer/" target="_blank" rel="noreferrer">NCALayer</a>,
                    затем нажмите «Подписать ЭЦП».
                  </div>
                )}
                <button
                  className="btn btn-primary w-full text-base py-3"
                  disabled={signing}
                  onClick={sign}
                >
                  {signing ? "Подписываем…" : "✍ Подписать ЭЦП"}
                </button>
              </div>
            </div>
          )}

          {alreadySigned && (
            <div className="mt-4 rounded-xl bg-emerald-50 ring-1 ring-emerald-200 p-4 text-sm text-emerald-900">
              ✓ Документ подписан. Вы можете закрыть страницу.
            </div>
          )}
        </div>

        {signatures?.length > 0 && (
          <div className="card p-6">
            <div className="font-semibold mb-3">Подписи</div>
            <div className="space-y-2">
              {signatures.map((s, i) => (
                <div key={i} className="text-sm flex items-center justify-between border-b border-charcoal-100 pb-2 last:border-0">
                  <div>
                    <div className="font-medium">{s.signer_full_name}</div>
                    <div className="text-xs text-charcoal-500">{s.signer_party}</div>
                  </div>
                  <div className="text-xs text-charcoal-500">{formatDate(s.created_at)}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="text-center text-xs text-charcoal-400 mt-6">
          CCU PRACTICUM · College of Caspian University · Электронная подпись ЭЦП НУЦ РК
        </div>
      </div>
    </div>
  );
}
