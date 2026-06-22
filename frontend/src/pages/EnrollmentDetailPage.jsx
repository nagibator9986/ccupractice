import { useEffect, useState, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import PageHeader from "../components/PageHeader.jsx";
import { TextField, SelectField, TextArea } from "../components/Field.jsx";
import SpecialtyPicker from "../components/SpecialtyPicker.jsx";
import { enrollmentsApi, specialtiesApi } from "../api/endpoints.js";
import { formatDate, formatDateTime, ruYears } from "../utils/format.js";
import { useAuth } from "../context/AuthContext.jsx";
import { StatusPill, whoSigns } from "./EnrollmentsPage.jsx";

const EDITABLE = [
  "number", "contract_date",
  "applicant_full_name", "applicant_iin", "applicant_birth_date", "applicant_gender",
  "applicant_id_doc_type", "applicant_id_doc_number", "applicant_id_doc_issued_by", "applicant_id_doc_issued_date",
  "applicant_address_city", "applicant_address_district", "applicant_address_street", "applicant_address_house",
  "applicant_phone", "applicant_home_phone", "applicant_email",
  "parent_full_name", "parent_relation", "parent_iin", "parent_id_doc_number", "parent_id_doc_issued_by",
  "parent_address", "parent_phone", "parent_email",
  "specialty", "specialty_code", "qualification", "education_base", "study_form", "course",
  "tuition_year_amount", "include_lms", "notes",
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

export default function EnrollmentDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { isAdmin } = useAuth();
  const [item, setItem] = useState(null);
  const [form, setForm] = useState(null);
  const [requests, setRequests] = useState([]);
  const [specialties, setSpecialties] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  useEffect(() => {
    specialtiesApi
      .list({ active: 1 })
      .then((d) => setSpecialties(d.items))
      .catch(() => {/* picker just falls back to free-text */});
  }, []);

  const load = useCallback(async () => {
    try {
      const { item } = await enrollmentsApi.get(id);
      setItem(item);
      const f = {};
      EDITABLE.forEach((k) => { f[k] = item[k] ?? ""; });
      setForm(f);
      if (isAdmin) {
        try {
          const r = await enrollmentsApi.listRequests(id);
          setRequests(r.items);
        } catch { /* non-fatal */ }
      }
    } catch (e) {
      const s = e.response?.status;
      if (s === 404) setError("Договор не найден.");
      else setError(e.response?.data?.error || "Не удалось загрузить договор.");
    }
  }, [id, isAdmin]);

  // Refresh item + signing links WITHOUT touching `form`, so signing-side actions
  // (invite/revoke/resend) never silently discard the admin's unsaved field edits.
  const refresh = useCallback(async () => {
    try {
      const { item } = await enrollmentsApi.get(id);
      setItem(item);
      if (isAdmin) {
        try { const r = await enrollmentsApi.listRequests(id); setRequests(r.items); }
        catch { /* non-fatal */ }
      }
    } catch { /* non-fatal */ }
  }, [id, isAdmin]);

  useEffect(() => { load(); }, [load]);

  async function save() {
    setBusy(true);
    try {
      const { item } = await enrollmentsApi.update(id, form);
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
      // Persist the visible edits FIRST so the backend renders the documents from
      // the current on-screen values (generate reads the persisted row), and so
      // the follow-up state sync doesn't silently discard unsaved changes.
      const { item: saved } = await enrollmentsApi.update(id, form);
      setItem(saved);
      const { item } = await enrollmentsApi.generate(id, force ? { force: true } : {});
      setItem(item);
      const f = {};
      EDITABLE.forEach((k) => { f[k] = item[k] ?? ""; });
      setForm(f);
      toast.success("Документы сформированы");
      if (isAdmin) {
        try { const r = await enrollmentsApi.listRequests(id); setRequests(r.items); }
        catch { /* non-fatal */ }
      }
    } catch (e) {
      if (e.response?.data?.code === "has_signatures") {
        if (window.confirm("Документы уже подписываются/подписаны. Перегенерация сбросит существующие подписи. Продолжить?")) {
          return generate(true);
        }
      } else {
        toast.error(e.response?.data?.error || "Не удалось сформировать документы");
      }
    } finally {
      setBusy(false);
    }
  }

  async function invite(force = false) {
    setBusy(true);
    try {
      const res = await enrollmentsApi.invite(id, force ? { force: true } : {});
      if (!res.items.length) toast("Активные ссылки уже существуют", { icon: "ℹ️" });
      else toast.success(`Создано ссылок: ${res.items.length}`);
      refresh();
    } catch (e) {
      toast.error(e.response?.data?.error || "Не удалось создать ссылки");
    } finally {
      setBusy(false);
    }
  }

  async function revoke(rid) {
    try { await enrollmentsApi.revoke(rid); toast.success("Ссылка отозвана"); refresh(); }
    catch (e) { toast.error(e.response?.data?.error || "Ошибка"); }
  }
  async function resend(rid) {
    try { await enrollmentsApi.resend(rid); toast.success("Ссылка перевыпущена"); refresh(); }
    catch (e) { toast.error(e.response?.data?.error || "Ошибка"); }
  }

  async function remove() {
    if (!window.confirm("Удалить договор и связанные файлы?")) return;
    try { await enrollmentsApi.remove(id); toast.success("Удалено"); navigate("/enrollments"); }
    catch (e) { toast.error(e.response?.data?.error || "Не удалось удалить"); }
  }

  function copyLink(url) {
    navigator.clipboard?.writeText(url).then(
      () => toast.success("Ссылка скопирована"),
      () => toast.error("Не удалось скопировать"),
    );
  }

  async function download(doc, fmt) {
    try {
      await enrollmentsApi.downloadDoc(id, doc, fmt, `${item.number || id}_${doc}.${fmt}`);
    } catch {
      toast.error("Не удалось скачать файл");
    }
  }

  if (error) return <div className="card p-8 text-center text-charcoal-500">{error}</div>;
  if (!item || !form) return <div className="text-charcoal-500">Загрузка…</div>;

  const matrix = item.required_matrix || {};
  // Derive from the server's relevant-documents map so the LMS contract appears
  // only when it's enabled for this enrollment.
  const docKeys = Object.keys(item.documents || { contract: 1, consent: 1 });

  return (
    <div>
      <PageHeader
        title={`Договор ${item.number || ""}`}
        description={`${item.applicant_full_name} · ${whoSigns(item.applicant_age)}`}
        actions={
          <div className="flex flex-wrap gap-2">
            {isAdmin && <button className="btn-primary" onClick={save} disabled={busy}>Сохранить</button>}
            {isAdmin && <button className="btn-secondary" onClick={() => generate()} disabled={busy}>Сформировать документы</button>}
            {isAdmin && <button className="btn-ghost text-red-600" onClick={remove} disabled={busy}>Удалить</button>}
          </div>
        }
      />

      <div className="flex flex-wrap items-center gap-3 mb-5">
        <StatusPill status={item.status} label={item.status_label} />
        <span className="text-sm text-charcoal-500">
          Возраст: {item.applicant_age != null ? `${item.applicant_age} ${ruYears(item.applicant_age)}` : "—"}
        </span>
        {item.is_fully_signed && <span className="badge bg-emerald-100 text-emerald-700">✓ Полностью подписан</span>}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="xl:col-span-2 space-y-6">
          <Section title="Договор">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <TextField label="№ договора" value={form.number} onChange={(v) => set("number", v)} disabled={!isAdmin} />
              <TextField label="Дата договора" type="date" value={form.contract_date} onChange={(v) => set("contract_date", v)} disabled={!isAdmin} />
              <SelectField label="База образования" value={form.education_base} onChange={(v) => set("education_base", v)} options={[{ value: "9", label: "После 9 класса" }, { value: "11", label: "После 11 класса" }]} disabled={!isAdmin} />
            </div>
            <label className="flex items-center gap-2 mt-3 text-sm text-charcoal-700 cursor-pointer">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-charcoal-300 text-coral-600 focus:ring-coral-500"
                checked={!!form.include_lms}
                disabled={!isAdmin}
                onChange={(e) => set("include_lms", e.target.checked)}
              />
              Включить «Договор о подключении к Caspian Digital»
              <span className="text-[11px] text-charcoal-400">— после изменения нажмите «Сформировать документы»</span>
            </label>
          </Section>

          <Section title="Абитуриент (обучающийся)">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <TextField label="ФИО" value={form.applicant_full_name} onChange={(v) => set("applicant_full_name", v)} disabled={!isAdmin} />
              <TextField label="ИИН" value={form.applicant_iin} onChange={(v) => set("applicant_iin", v)} disabled={!isAdmin} />
              <TextField label="Дата рождения" type="date" value={form.applicant_birth_date} onChange={(v) => set("applicant_birth_date", v)} disabled={!isAdmin} hint="Определяет подписанта" />
              <SelectField label="Пол" value={form.applicant_gender} onChange={(v) => set("applicant_gender", v)} options={[{ value: "М", label: "Мужской" }, { value: "Ж", label: "Женский" }]} disabled={!isAdmin} />
              <SelectField label="Документ" value={form.applicant_id_doc_type} onChange={(v) => set("applicant_id_doc_type", v)} options={[{ value: "удостоверение личности", label: "Удостоверение личности" }, { value: "свидетельство о рождении", label: "Свидетельство о рождении" }]} placeholder="—" disabled={!isAdmin} />
              <TextField label="№ документа" value={form.applicant_id_doc_number} onChange={(v) => set("applicant_id_doc_number", v)} disabled={!isAdmin} />
              <TextField label="Кем выдан" value={form.applicant_id_doc_issued_by} onChange={(v) => set("applicant_id_doc_issued_by", v)} disabled={!isAdmin} />
              <TextField label="Дата выдачи" type="date" value={form.applicant_id_doc_issued_date} onChange={(v) => set("applicant_id_doc_issued_date", v)} disabled={!isAdmin} />
              <TextField label="Телефон (сот.)" value={form.applicant_phone} onChange={(v) => set("applicant_phone", v)} disabled={!isAdmin} />
              <TextField label="Телефон (дом.)" value={form.applicant_home_phone} onChange={(v) => set("applicant_home_phone", v)} disabled={!isAdmin} />
              <TextField label="Email" value={form.applicant_email} onChange={(v) => set("applicant_email", v)} disabled={!isAdmin} />
            </div>
            <div className="text-[11px] uppercase tracking-wide font-semibold text-charcoal-400 mt-4 mb-2">Адрес регистрации</div>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <TextField label="Город" value={form.applicant_address_city} onChange={(v) => set("applicant_address_city", v)} disabled={!isAdmin} />
              <TextField label="Район" value={form.applicant_address_district} onChange={(v) => set("applicant_address_district", v)} disabled={!isAdmin} />
              <TextField label="Улица" value={form.applicant_address_street} onChange={(v) => set("applicant_address_street", v)} disabled={!isAdmin} />
              <TextField label="Дом" value={form.applicant_address_house} onChange={(v) => set("applicant_address_house", v)} disabled={!isAdmin} />
            </div>
          </Section>

          <Section title="Законный представитель (родитель)">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <TextField label="ФИО" value={form.parent_full_name} onChange={(v) => set("parent_full_name", v)} disabled={!isAdmin} />
              <TextField label="Кем приходится" value={form.parent_relation} onChange={(v) => set("parent_relation", v)} disabled={!isAdmin} hint="мать / отец / опекун" />
              <TextField label="ИИН" value={form.parent_iin} onChange={(v) => set("parent_iin", v)} disabled={!isAdmin} />
              <TextField label="№ удостоверения" value={form.parent_id_doc_number} onChange={(v) => set("parent_id_doc_number", v)} disabled={!isAdmin} />
              <TextField label="Кем выдано" value={form.parent_id_doc_issued_by} onChange={(v) => set("parent_id_doc_issued_by", v)} disabled={!isAdmin} />
              <TextField label="Телефон" value={form.parent_phone} onChange={(v) => set("parent_phone", v)} disabled={!isAdmin} />
              <TextField label="Email" value={form.parent_email} onChange={(v) => set("parent_email", v)} disabled={!isAdmin} />
              <TextField label="Адрес" value={form.parent_address} onChange={(v) => set("parent_address", v)} disabled={!isAdmin} span={2} />
            </div>
          </Section>

          <Section title="Программа и оплата">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <SpecialtyPicker
                span={3}
                disabled={!isAdmin}
                specialties={specialties}
                specialty={form.specialty}
                code={form.specialty_code}
                qualification={form.qualification}
                onPick={(name, code, qualification) =>
                  setForm((f) => ({ ...f, specialty: name, specialty_code: code, qualification }))
                }
              />
              <TextField label="Специальность" value={form.specialty} onChange={(v) => set("specialty", v)} disabled={!isAdmin} />
              <TextField label="Код специальности" value={form.specialty_code} onChange={(v) => set("specialty_code", v)} disabled={!isAdmin} />
              <TextField label="Квалификация" value={form.qualification} onChange={(v) => set("qualification", v)} disabled={!isAdmin} />
              <TextField label="Форма обучения" value={form.study_form} onChange={(v) => set("study_form", v)} disabled={!isAdmin} />
              <TextField label="Курс" type="number" value={form.course} onChange={(v) => set("course", v)} disabled={!isAdmin} />
              <TextField label="Стоимость за год (тг)" type="number" value={form.tuition_year_amount} onChange={(v) => set("tuition_year_amount", v)} disabled={!isAdmin} />
            </div>
            <div className="mt-4">
              <TextArea label="Примечания" value={form.notes} onChange={(v) => set("notes", v)} disabled={!isAdmin} />
            </div>
          </Section>
        </div>

        <div className="space-y-6">
          <Section title="Документы">
            <div className="space-y-3">
              {docKeys.map((doc) => {
                const meta = item.documents?.[doc] || {};
                const parties = Object.entries(matrix).filter(([, docs]) => docs.includes(doc)).map(([p]) => p);
                return (
                  <div key={doc} className="rounded-xl border border-charcoal-100 p-3">
                    <div className="font-medium text-sm">{meta.label}</div>
                    <div className="flex flex-wrap gap-2 mt-2">
                      {meta.docx && <button className="btn-secondary text-xs" onClick={() => download(doc, "docx")}>DOCX</button>}
                      {meta.pdf && <button className="btn-secondary text-xs" onClick={() => download(doc, "pdf")}>PDF</button>}
                      {!meta.docx && <span className="text-xs text-charcoal-400">Не сформирован</span>}
                    </div>
                    <div className="mt-2 space-y-1">
                      {parties.length === 0 && <div className="text-[11px] text-charcoal-400">Укажите дату рождения</div>}
                      {parties.map((p) => {
                        const signed = (item.signatures || []).some((s) => s.document === doc && s.signer_party === p);
                        return (
                          <div key={p} className="flex items-center justify-between text-[11px]">
                            <span className="text-charcoal-500">{p === "parent" ? "Родитель" : "Студент"}</span>
                            <span className={signed ? "text-emerald-600 font-semibold" : "text-charcoal-400"}>
                              {signed ? "✓ подписано" : "ожидает"}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </Section>

          {isAdmin && (
            <Section
              title="Подписание (ЭЦП)"
              extra={
                <div className="flex gap-2">
                  <button className="btn-primary text-xs" onClick={() => invite()} disabled={busy}>Пригласить</button>
                  {requests.length > 0 && (
                    <button className="btn-secondary text-xs" onClick={() => invite(true)} disabled={busy}>Перевыпустить</button>
                  )}
                </div>
              }
            >
              {requests.length === 0 ? (
                <div className="text-sm text-charcoal-500">
                  Ссылок ещё нет. Сформируйте документы, заполните дату рождения и нажмите «Пригласить».
                </div>
              ) : (
                <div className="space-y-3">
                  {requests.map((r) => (
                    <div key={r.id} className="rounded-xl border border-charcoal-100 p-3">
                      <div className="flex items-center justify-between">
                        <div className="text-sm font-medium">{r.signer_party_label}</div>
                        <StatusReq status={r.status} />
                      </div>
                      <div className="text-[11px] text-charcoal-500 mt-1">
                        {r.recipient_name || "—"} · до {formatDate(r.expires_at)}
                        {r.signed_at && <> · подписано {formatDateTime(r.signed_at)}</>}
                      </div>
                      {r.sign_url && r.status !== "revoked" && (
                        <div className="flex items-center gap-2 mt-2">
                          <input className="input text-[11px] flex-1" readOnly value={r.sign_url} />
                          <button className="btn-secondary text-xs" onClick={() => copyLink(r.sign_url)}>Копировать</button>
                        </div>
                      )}
                      <div className="flex gap-2 mt-2">
                        {r.status !== "signed" && r.status !== "revoked" && (
                          <button className="btn-ghost text-xs text-red-600" onClick={() => revoke(r.id)}>Отозвать</button>
                        )}
                        {r.status !== "signed" && (
                          <button className="btn-ghost text-xs" onClick={() => resend(r.id)}>Перевыпустить</button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Section>
          )}

          <Section title="Подписи">
            {(item.signatures || []).length === 0 ? (
              <div className="text-sm text-charcoal-500">Подписей пока нет.</div>
            ) : (
              <ul className="space-y-2 text-sm">
                {item.signatures.map((s) => (
                  <li key={s.id} className="rounded-lg bg-charcoal-50 p-2.5">
                    <div className="font-medium">{s.document_label}</div>
                    <div className="text-xs text-charcoal-600">
                      {s.signer_party_label}: {s.signer_full_name || "—"} (ИИН {s.signer_iin_or_bin || "—"})
                    </div>
                    <div className="text-[11px] text-charcoal-400">{formatDateTime(s.created_at)}</div>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </div>
      </div>
    </div>
  );
}

function StatusReq({ status }) {
  const map = {
    pending: { label: "Ожидает", cls: "bg-charcoal-100 text-charcoal-600" },
    viewed: { label: "Просмотрено", cls: "bg-amber-100 text-amber-700" },
    signed: { label: "Подписано", cls: "bg-emerald-100 text-emerald-700" },
    revoked: { label: "Отозвано", cls: "bg-red-100 text-red-700" },
  };
  const it = map[status] || map.pending;
  return <span className={`badge ${it.cls}`}>{it.label}</span>;
}
