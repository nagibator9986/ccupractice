import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import toast from "react-hot-toast";
import PageHeader from "../components/PageHeader.jsx";
import { TextField, SelectField, TextArea } from "../components/Field.jsx";
import VerificationBadge from "../components/VerificationBadge.jsx";
import { lmsContractsApi } from "../api/endpoints.js";
import { formatDate, formatDateTime } from "../utils/format.js";
import { useAuth } from "../context/AuthContext.jsx";
import { StatusPill } from "./EnrollmentsPage.jsx";

const EDITABLE = [
  "number", "contract_date",
  "applicant_full_name", "applicant_iin", "applicant_birth_date",
  "applicant_id_doc_number", "applicant_id_doc_issued_by", "applicant_id_doc_issued_date",
  "applicant_address_city", "applicant_address_district", "applicant_address_street", "applicant_address_house",
  "applicant_phone", "applicant_home_phone", "applicant_email",
  "parent_full_name", "parent_relation", "parent_iin",
  "parent_address", "parent_phone", "parent_email",
  "specialty", "specialty_code", "qualification", "education_base", "study_form", "course",
  "grant_order_number", "grant_order_date", "funding_source",
  "notes",
];

function Section({ title, children, extra }) {
  return (
    <div className="card p-5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-semibold">{title}</h2>
        {extra}
      </div>
      {children}
    </div>
  );
}

export default function LmsContractDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { isAdmin } = useAuth();
  const [item, setItem] = useState(null);
  const [form, setForm] = useState(null);
  const [requests, setRequests] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const load = useCallback(async () => {
    try {
      const { item } = await lmsContractsApi.get(id);
      setItem(item);
      const f = {};
      EDITABLE.forEach((k) => { f[k] = item[k] ?? ""; });
      setForm(f);
      if (isAdmin) {
        try {
          const r = await lmsContractsApi.listRequests(id);
          setRequests(r.items);
        } catch { /* non-fatal */ }
      }
    } catch (e) {
      const s = e.response?.status;
      if (s === 404) setError("LMS-договор не найден.");
      else setError(e.response?.data?.error || "Не удалось загрузить договор.");
    }
  }, [id, isAdmin]);

  const refresh = useCallback(async () => {
    try {
      const { item } = await lmsContractsApi.get(id);
      setItem(item);
      if (isAdmin) {
        try { const r = await lmsContractsApi.listRequests(id); setRequests(r.items); }
        catch { /* non-fatal */ }
      }
    } catch { /* non-fatal */ }
  }, [id, isAdmin]);

  useEffect(() => { load(); }, [load]);

  async function save() {
    setBusy(true);
    try {
      const { item } = await lmsContractsApi.update(id, form);
      setItem(item);
      toast.success("Сохранено");
    } catch (e) {
      toast.error(e.response?.data?.error || "Не удалось сохранить");
    } finally {
      setBusy(false);
    }
  }

  async function generate(force = false) {
    setBusy(true);
    try {
      await lmsContractsApi.update(id, form);
      const { item } = await lmsContractsApi.generate(id, force ? { force: true } : {});
      setItem(item);
      toast.success(force ? "Документ перегенерирован" : "Документ сформирован");
      refresh();
    } catch (e) {
      const code = e.response?.data?.code;
      if (code === "has_signatures") {
        if (window.confirm(
          "Документ уже подписан или на подписании. Перегенерация СБРОСИТ все подписи. Продолжить?"
        )) return generate(true);
      } else {
        toast.error(e.response?.data?.error || "Не удалось сформировать");
      }
    } finally {
      setBusy(false);
    }
  }

  async function invite(force = false) {
    setBusy(true);
    try {
      const data = await lmsContractsApi.invite(id, force ? { force: true } : {});
      if (data.items?.length) toast.success("Ссылка на подписание создана");
      else toast(data.note || "Активная ссылка уже существует", { icon: "ℹ️" });
      refresh();
    } catch (e) {
      toast.error(e.response?.data?.error || "Не удалось пригласить на подписание");
    } finally {
      setBusy(false);
    }
  }

  async function revoke(rid) {
    if (!window.confirm("Отозвать ссылку?")) return;
    try {
      await lmsContractsApi.revoke(rid);
      toast.success("Ссылка отозвана");
      refresh();
    } catch (e) {
      toast.error(e.response?.data?.error || "Не удалось отозвать");
    }
  }

  async function resend(rid) {
    try {
      await lmsContractsApi.resend(rid);
      toast.success("Ссылка перевыпущена");
      refresh();
    } catch (e) {
      toast.error(e.response?.data?.error || "Не удалось перевыпустить");
    }
  }

  async function removeLms() {
    if (!window.confirm("Удалить LMS-договор? Это действие необратимо.")) return;
    try {
      await lmsContractsApi.remove(id);
      toast.success("Удалено");
      navigate("/lms-contracts");
    } catch (e) {
      toast.error(e.response?.data?.error || "Не удалось удалить");
    }
  }

  if (error) {
    return (
      <div className="container mx-auto py-8">
        <div className="card p-6 text-center">
          <div className="text-charcoal-600">{error}</div>
          <Link to="/lms-contracts" className="link mt-4 inline-block">← К списку</Link>
        </div>
      </div>
    );
  }
  if (!item || !form) {
    return <div className="container mx-auto py-8 text-center text-charcoal-500">Загрузка…</div>;
  }

  const signerPartyLabel = item.signer_party_label || "Подписант ещё не определён (укажите дату рождения)";
  // Absolute URL so admin can copy/share it (display + click target both
  // work even when the SPA is mounted under a path-prefix).
  const verifyUrlAbs = item.verify_code
    ? `${window.location.origin}/verify/${item.verify_code}`
    : null;
  // Has a generated file? Tolerate either shape — the backend now exposes
  // raw `docx_path` AND the structured `document.docx` boolean.
  const hasDocx = !!(item.docx_path || item.document?.docx);

  return (
    <div>
      <PageHeader
        title={`LMS-договор № ${item.number || "—"}`}
        subtitle={item.applicant_full_name}
        right={
          <div className="flex items-center gap-2">
            <StatusPill status={item.status} label={item.status_label} />
            <span className="chip-coral">LMS · только грантники</span>
          </div>
        }
      />

      {item.source_enrollment && (
        <div className="rounded-xl bg-coral-50/40 ring-1 ring-coral-100 px-3 py-2 mb-4 text-xs text-charcoal-600">
          ↩ Связан с зачислением{" "}
          <Link to={`/enrollments/${item.source_enrollment.id}`} className="link">
            № {item.source_enrollment.number || `ОУ-${item.source_enrollment.id}`}
          </Link>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 flex flex-col gap-4">
          <Section
            title="Основные сведения"
            extra={
              isAdmin && (
                <div className="flex gap-2">
                  <button className="btn btn-secondary" onClick={save} disabled={busy}>Сохранить</button>
                  <button className="btn btn-primary" onClick={() => generate(false)} disabled={busy}>
                    {hasDocx ? "Пересформировать" : "Сформировать"}
                  </button>
                </div>
              )
            }
          >
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <TextField label="Номер" value={form.number} onChange={(v) => set("number", v)} disabled={!isAdmin} />
              <TextField label="Дата договора" type="date" value={form.contract_date} onChange={(v) => set("contract_date", v)} disabled={!isAdmin} />
              <SelectField
                label="Источник финансирования"
                value={form.funding_source}
                onChange={(v) => set("funding_source", v)}
                disabled={!isAdmin}
                options={[
                  { value: "госзаказ", label: "Государственный образовательный заказ" },
                  { value: "грант", label: "Образовательный грант" },
                ]}
              />
              <TextField label="Приказ о зачислении" value={form.grant_order_number} onChange={(v) => set("grant_order_number", v)} disabled={!isAdmin} />
              <TextField label="Дата приказа" type="date" value={form.grant_order_date} onChange={(v) => set("grant_order_date", v)} disabled={!isAdmin} />
              <TextField label="Курс" type="number" value={form.course} onChange={(v) => set("course", v)} disabled={!isAdmin} />
            </div>
          </Section>

          <Section title="Студент-грантник">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <TextField label="ФИО" value={form.applicant_full_name} onChange={(v) => set("applicant_full_name", v)} disabled={!isAdmin} />
              <TextField label="ИИН" value={form.applicant_iin} onChange={(v) => set("applicant_iin", v)} disabled={!isAdmin} />
              <TextField label="Дата рождения" type="date" value={form.applicant_birth_date} onChange={(v) => set("applicant_birth_date", v)} disabled={!isAdmin} hint="Определяет подписанта" />
              <TextField label="№ удостоверения" value={form.applicant_id_doc_number} onChange={(v) => set("applicant_id_doc_number", v)} disabled={!isAdmin} />
              <TextField label="Кем выдано" value={form.applicant_id_doc_issued_by} onChange={(v) => set("applicant_id_doc_issued_by", v)} disabled={!isAdmin} />
              <TextField label="Дата выдачи" type="date" value={form.applicant_id_doc_issued_date} onChange={(v) => set("applicant_id_doc_issued_date", v)} disabled={!isAdmin} />
              <TextField label="Город" value={form.applicant_address_city} onChange={(v) => set("applicant_address_city", v)} disabled={!isAdmin} />
              <TextField label="Район" value={form.applicant_address_district} onChange={(v) => set("applicant_address_district", v)} disabled={!isAdmin} />
              <TextField label="Улица" value={form.applicant_address_street} onChange={(v) => set("applicant_address_street", v)} disabled={!isAdmin} />
              <TextField label="Дом" value={form.applicant_address_house} onChange={(v) => set("applicant_address_house", v)} disabled={!isAdmin} />
              <TextField label="Телефон (моб.)" value={form.applicant_phone} onChange={(v) => set("applicant_phone", v)} disabled={!isAdmin} />
              <TextField label="Email" value={form.applicant_email} onChange={(v) => set("applicant_email", v)} disabled={!isAdmin} />
              <TextField label="Специальность" value={form.specialty} onChange={(v) => set("specialty", v)} disabled={!isAdmin} />
              <TextField label="Код специальности" value={form.specialty_code} onChange={(v) => set("specialty_code", v)} disabled={!isAdmin} />
              <TextField label="Квалификация" value={form.qualification} onChange={(v) => set("qualification", v)} disabled={!isAdmin} />
            </div>
          </Section>

          {item.applicant_age != null && item.applicant_age < 16 && (
            <Section title="Законный представитель (родитель)">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <TextField label="ФИО родителя" value={form.parent_full_name} onChange={(v) => set("parent_full_name", v)} disabled={!isAdmin} />
                <TextField label="ИИН родителя" value={form.parent_iin} onChange={(v) => set("parent_iin", v)} disabled={!isAdmin} />
                <TextField label="Кем приходится" value={form.parent_relation} onChange={(v) => set("parent_relation", v)} disabled={!isAdmin} />
                <TextField label="Телефон" value={form.parent_phone} onChange={(v) => set("parent_phone", v)} disabled={!isAdmin} />
                <TextField label="Email" value={form.parent_email} onChange={(v) => set("parent_email", v)} disabled={!isAdmin} />
                <div className="md:col-span-3">
                  <TextField label="Адрес" value={form.parent_address} onChange={(v) => set("parent_address", v)} disabled={!isAdmin} />
                </div>
              </div>
            </Section>
          )}

          <Section title="Примечания">
            <TextArea value={form.notes} onChange={(v) => set("notes", v)} disabled={!isAdmin} rows={3} />
          </Section>
        </div>

        <div className="flex flex-col gap-4">
          <Section title="Документ">
            <div className="space-y-2 text-sm">
              <div className="font-medium">{item.document?.label}</div>
              <div className="text-xs text-charcoal-500">Подписант: {signerPartyLabel}</div>
              <div className="flex flex-wrap gap-2 pt-2">
                {item.document?.docx ? (
                  <button
                    className="btn btn-secondary"
                    onClick={() => lmsContractsApi.downloadDoc(item.id, "docx", `LMS_${item.number || item.id}.docx`)}
                  >📄 Скачать DOCX</button>
                ) : (
                  <span className="text-xs text-charcoal-400">Файл ещё не сформирован</span>
                )}
                {item.document?.pdf && (
                  <button
                    className="btn btn-secondary"
                    onClick={() => lmsContractsApi.downloadDoc(item.id, "pdf", `LMS_${item.number || item.id}.pdf`)}
                  >📕 Скачать PDF</button>
                )}
              </div>
              {verifyUrlAbs && (
                <div className="text-xs text-charcoal-500 mt-2">
                  <div className="font-semibold text-charcoal-600 mb-1">Публичная проверка</div>
                  <div className="flex items-center gap-2">
                    <a className="link break-all" href={verifyUrlAbs} target="_blank" rel="noreferrer">{verifyUrlAbs}</a>
                    <button
                      type="button"
                      className="btn btn-text text-[11px] shrink-0"
                      onClick={() => {
                        navigator.clipboard.writeText(verifyUrlAbs);
                        toast.success("Ссылка скопирована");
                      }}
                    >Скопировать</button>
                  </div>
                </div>
              )}
            </div>
          </Section>

          <Section
            title="Подписание ЭЦП"
            extra={isAdmin && hasDocx && (
              <button className="btn btn-primary text-sm" onClick={() => invite(false)} disabled={busy}>
                Пригласить
              </button>
            )}
          >
            {!hasDocx ? (
              <div className="text-sm text-charcoal-500">Сначала сформируйте документ.</div>
            ) : !item.signer_party ? (
              <div className="text-sm text-coral-700">Укажите дату рождения студента — от неё зависит подписант.</div>
            ) : (
              <div className="space-y-3">
                {(item.signatures || []).map((s, i) => (
                  <div key={i} className="rounded-xl bg-emerald-50/60 ring-1 ring-emerald-200 p-3">
                    <div className="flex items-center justify-between">
                      <div className="font-medium text-emerald-900">{s.signer_party_label}: {s.signer_full_name}</div>
                      <VerificationBadge level={s.verification_level} />
                    </div>
                    <div className="text-xs text-emerald-800/80 mt-1">
                      ИИН {s.signer_iin_or_bin || "—"} · {formatDateTime(s.created_at)}
                    </div>
                  </div>
                ))}
                {requests.map((r) => (
                  <div key={r.id} className="rounded-xl ring-1 ring-charcoal-200 p-3 text-sm">
                    <div className="flex items-center justify-between">
                      <div className="font-medium">{r.signer_party_label}</div>
                      <span className={`badge ${r.status === "signed" ? "bg-emerald-100 text-emerald-800" : r.status === "viewed" ? "bg-blue-100 text-blue-800" : r.status === "revoked" ? "bg-charcoal-100 text-charcoal-600" : "bg-amber-100 text-amber-800"}`}>
                        {r.status}
                      </span>
                    </div>
                    <div className="text-xs text-charcoal-500 mt-1 break-all">
                      {r.sign_url || `/lms-sign/${r.token}`}
                    </div>
                    {isAdmin && (
                      <div className="flex gap-2 mt-2">
                        <button className="btn btn-text text-xs" onClick={() => navigator.clipboard.writeText(r.sign_url || `${window.location.origin}/lms-sign/${r.token}`)}>Копировать</button>
                        {r.status !== "signed" && r.status !== "revoked" && (
                          <>
                            <button className="btn btn-text text-xs" onClick={() => resend(r.id)}>Перевыпустить</button>
                            <button className="btn btn-text text-xs text-red-600" onClick={() => revoke(r.id)}>Отозвать</button>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </Section>

          {isAdmin && (
            <Section title="Опасная зона">
              <button className="btn btn-danger w-full" onClick={removeLms}>Удалить договор</button>
              <div className="text-xs text-charcoal-500 mt-2">
                Удаление сотрёт договор, его подписи и файлы DOCX/PDF.
              </div>
            </Section>
          )}
        </div>
      </div>
    </div>
  );
}
