import { useEffect, useState, useCallback } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import toast from "react-hot-toast";
import PageHeader from "../components/PageHeader.jsx";
import { TextField, SelectField, TextArea } from "../components/Field.jsx";
import SpecialtyPicker from "../components/SpecialtyPicker.jsx";
import VerificationBadge from "../components/VerificationBadge.jsx";
import { enrollmentsApi, specialtiesApi } from "../api/endpoints.js";
import { formatDate, formatDateTime, ruYears } from "../utils/format.js";
import { useAuth } from "../context/AuthContext.jsx";
import { StatusPill, whoSigns } from "./EnrollmentsPage.jsx";
import { signBase64WithNCALayer, pingNCALayer } from "../utils/ncalayer.js";

// Compare two ФИО strings semantically — collapse any whitespace run (including
// non-breaking spaces from ЭЦП CNs), NFKC-normalize, casefold. Used to decide
// whether to hide the "CN сертификата ЭЦП" audit line when it matches the
// director ФИО from settings — the raw NCALayer CN often carries NBSP that
// would spuriously trigger the fallback line if compared naively.
const normFio = (v) =>
  (v || "")
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase("ru");

const EDITABLE = [
  "number", "contract_date",
  "applicant_full_name", "applicant_iin", "applicant_birth_date", "applicant_gender",
  "applicant_id_doc_type", "applicant_id_doc_number", "applicant_id_doc_issued_by", "applicant_id_doc_issued_date",
  "applicant_address_city", "applicant_address_district", "applicant_address_street", "applicant_address_house",
  "applicant_phone", "applicant_home_phone", "applicant_email",
  "parent_full_name", "parent_relation", "parent_iin", "parent_id_doc_number", "parent_id_doc_issued_by",
  "parent_address", "parent_phone", "parent_email",
  "specialty", "specialty_code", "qualification", "education_base", "study_form", "course",
  "tuition_year_amount", "notes",
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
  const [collegeInfo, setCollegeInfo] = useState(null);
  // Distinguishes "still loading" (null) from "loaded, but settings blank"
  // ({} with empty fields) so college fallback fields don't flash cert-CN
  // between mount and the /college-info response arriving.
  const [collegeInfoLoaded, setCollegeInfoLoaded] = useState(false);
  const [ncaAvailable, setNcaAvailable] = useState(null);
  const [collegeSigning, setCollegeSigning] = useState(false);

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

  const loadCollegeInfo = useCallback(async () => {
    if (!isAdmin) return;
    try {
      const info = await enrollmentsApi.collegeInfo(id);
      setCollegeInfo(info);
    } catch {
      // Sentinel: loaded, but empty/failed — lets the UI show the "settings
      // incomplete" hint instead of the "still loading" flicker.
      setCollegeInfo((prev) => prev ?? {});
    } finally {
      setCollegeInfoLoaded(true);
    }
  }, [id, isAdmin]);

  useEffect(() => { loadCollegeInfo(); }, [loadCollegeInfo]);

  useEffect(() => {
    if (!isAdmin) return undefined;
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
  }, [isAdmin]);

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

  async function signCollege() {
    if (collegeSigning) return;
    setCollegeSigning(true);
    const t = toast.loading("Проверка NCALayer…");
    let signedOk = 0;
    let failedDoc = null;
    try {
      // Sign every document the college is responsible for and hasn't yet
      // signed. Existing student/parent signatures on those documents are
      // preserved by the backend — this only appends a college-side row.
      const collegeDocs = (item.required_matrix || {}).college || [];
      const docsToSign = collegeDocs.filter((key) => {
        const alreadyCollege = (item.signatures || []).some(
          (s) => s.document === key && s.signer_party === "college",
        );
        return !alreadyCollege;
      });
      if (docsToSign.length === 0) {
        toast.success("Все документы колледжа уже подписаны", { id: t });
        return;
      }
      for (const doc of docsToSign) {
        failedDoc = item.documents?.[doc]?.label || doc;
        toast.loading(`Получаем ${failedDoc}…`, { id: t });
        const { payload_base64, document_label } = await enrollmentsApi.collegePayload(id, doc);
        toast.loading(`Откройте NCALayer и подпишите: ${document_label}`, { id: t });
        const cms = await signBase64WithNCALayer(payload_base64);
        toast.loading(`Сохраняем подпись: ${document_label}`, { id: t });
        const res = await enrollmentsApi.collegeSign(id, doc, cms);
        if (res?.warnings?.length) res.warnings.forEach((w) => toast(w, { icon: "⚠️", duration: 6000 }));
        signedOk += 1;
        failedDoc = null;
      }
      toast.success(`Колледж подписал: ${docsToSign.length} документ(-а)`, { id: t });
    } catch (e) {
      const errMsg = e.response?.data?.error || e.message || "Ошибка подписания";
      if (signedOk > 0) {
        toast.error(
          `Подписано ${signedOk}, ошибка на "${failedDoc}": ${errMsg}. Продолжите подписание оставшихся документов.`,
          { id: t, duration: 8000 },
        );
      } else {
        toast.error(errMsg, { id: t });
      }
    } finally {
      // Always refresh — even mid-loop failures leave partial state that the
      // UI should reflect (the button label will show the remaining count).
      await load();
      await loadCollegeInfo();
      setCollegeSigning(false);
    }
  }

  async function downloadCertificate() {
    try {
      await enrollmentsApi.downloadCertificate(id, item.number);
      toast.success("Сертификат подписания скачан");
    } catch (e) {
      toast.error(e.response?.data?.error || "Не удалось сформировать сертификат");
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
            {(item.signatures_count > 0) && (
              <button
                className="btn-secondary"
                onClick={downloadCertificate}
                title="Скачать PDF со списком подписантов и QR-кодом для проверки. Не модифицирует подписанные документы."
              >
                📑 Сертификат подписания
              </button>
            )}
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
        {item.source_lms_contract_id && (
          <Link
            to={`/lms-contracts/${item.source_lms_contract_id}`}
            className="badge bg-coral-100 text-coral-700 hover:bg-coral-200 transition"
            title="Перейти к связанному LMS-договору"
          >
            LMS-договор № {item.source_lms_contract_number || item.source_lms_contract_id} →
          </Link>
        )}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="xl:col-span-2 space-y-6">
          <Section title="Договор">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <TextField label="№ договора" value={form.number} onChange={(v) => set("number", v)} disabled={!isAdmin} />
              <TextField label="Дата договора" type="date" value={form.contract_date} onChange={(v) => set("contract_date", v)} disabled={!isAdmin} />
              <SelectField label="База образования" value={form.education_base} onChange={(v) => set("education_base", v)} options={[{ value: "9", label: "После 9 класса" }, { value: "11", label: "После 11 класса" }]} disabled={!isAdmin} />
            </div>
            <div className="mt-3 rounded-xl bg-coral-50/40 ring-1 ring-coral-100 px-3 py-2 text-xs text-charcoal-600">
              💡 «Договор о подключении к Caspian Digital» (ЛМС) теперь оформляется отдельно — в разделе <b>LMS-договоры</b>. Доступен только студентам с флагом «Грантник».
            </div>
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
                        const label = p === "parent" ? "Родитель" : p === "college" ? "Колледж" : "Студент";
                        return (
                          <div key={p} className="flex items-center justify-between text-[11px]">
                            <span className="text-charcoal-500">{label}</span>
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

          {isAdmin && (matrix.college || []).length > 0 && (
            <Section
              title="Подпись колледжа"
              extra={
                ncaAvailable === false
                  ? <span className="badge bg-red-100 text-red-700">NCALayer offline</span>
                  : ncaAvailable === true
                    ? <span className="badge bg-emerald-100 text-emerald-700">NCALayer online</span>
                    : <span className="badge bg-charcoal-100 text-charcoal-600">Проверка…</span>
              }
            >
              <p className="text-xs text-charcoal-500 mb-3">
                Директор подписывает ЭЦП сразу все документы колледжа (договор + согласие).
                Данные подписанта подтягиваются автоматически из настроек колледжа.
              </p>
              <div className="rounded-xl bg-coral-50/60 ring-1 ring-coral-100 p-3 mb-3">
                <div className="text-[11px] uppercase tracking-wide font-semibold text-charcoal-500 mb-1">Подписант</div>
                <div className="font-medium text-sm">{collegeInfo?.director_full_name || "—"}</div>
                <div className="text-[11px] text-charcoal-500 mt-0.5">
                  {collegeInfo?.college_name || "—"} · БИН {collegeInfo?.college_bin || "—"}
                </div>
                {collegeInfo?.director_basis && (
                  <div className="text-[11px] text-charcoal-500">Основание: {collegeInfo.director_basis}</div>
                )}
                {!collegeInfo?.director_full_name && (
                  <div className="text-[11px] text-red-600 mt-1">
                    Заполните ФИО директора в <Link to="/settings" className="underline">Настройках колледжа</Link>.
                  </div>
                )}
              </div>
              {(() => {
                const collegeDocs = matrix.college || [];
                const remaining = collegeDocs.filter((k) => !(item.signatures || []).some((s) => s.document === k && s.signer_party === "college"));
                const doneCount = collegeDocs.length - remaining.length;
                return (
                  <>
                    <div className="text-xs text-charcoal-600 mb-2">
                      Готово: <b>{doneCount}</b> из <b>{collegeDocs.length}</b>
                    </div>
                    <div className="space-y-1 mb-3">
                      {collegeDocs.map((k) => {
                        const isDone = doneCount > 0 && !remaining.includes(k);
                        const meta = item.documents?.[k] || {};
                        return (
                          <div key={k} className="flex items-center justify-between text-[11px]">
                            <span className="text-charcoal-600">{meta.label || k}</span>
                            <span className={isDone ? "text-emerald-600 font-semibold" : "text-charcoal-400"}>
                              {isDone ? "✓ подписано" : "ожидает"}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                    <button
                      className="btn-primary w-full"
                      onClick={signCollege}
                      disabled={
                        collegeSigning ||
                        !ncaAvailable ||
                        !collegeInfo?.director_full_name ||
                        remaining.length === 0 ||
                        !collegeDocs.every((k) => item.documents?.[k]?.docx)
                      }
                    >
                      {collegeSigning
                        ? "Подписание…"
                        : remaining.length === 0
                          ? "Всё подписано"
                          : `Подписать ЭЦП (${remaining.length})`}
                    </button>
                    {!collegeDocs.every((k) => item.documents?.[k]?.docx) && (
                      <div className="text-[11px] text-charcoal-500 mt-2">
                        Сначала сформируйте документы.
                      </div>
                    )}
                  </>
                );
              })()}
            </Section>
          )}

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

          {(() => {
            const collegeSigsRaw = (item.signatures || []).filter((s) => s.signer_party === "college");
            if (collegeSigsRaw.length === 0) return null;
            // Explicit sort — the "последняя подпись" tail below indexes the
            // last element, which is only correct on a sorted array.
            const collegeSigs = [...collegeSigsRaw].sort(
              (a, b) => (a.created_at || "").localeCompare(b.created_at || ""),
            );
            const orgName = collegeInfo?.college_name || "Каспийский общественный университет";
            const orgBin = collegeInfo?.college_bin || "";
            const orgAddr = collegeInfo?.college_address || "";
            const basis = collegeInfo?.director_basis || "";
            // Prefer the authoritative director ФИО from CollegeSettings — the
            // ЭЦП certificate's CN sometimes carries only Kazakh given-name +
            // patronymic without a surname. While collegeInfo hasn't resolved
            // yet, show "…" (loading placeholder) instead of flashing the
            // cert CN then switching to the settings ФИО on next tick.
            const certName = collegeSigs[0].signer_full_name || "";
            const director = collegeInfo?.director_full_name
              || (collegeInfoLoaded ? (certName || "—") : "…");
            return (
              <Section
                title="Подпись организации"
                extra={<span className="badge bg-emerald-100 text-emerald-700">✓ ЭЦП колледжа</span>}
              >
                <div className="rounded-2xl bg-gradient-to-br from-coral-50 to-white ring-2 ring-coral-200 p-4 relative">
                  <div className="absolute top-3 right-3 rotate-[8deg] border-2 border-emerald-500 text-emerald-600 text-[10px] font-bold uppercase tracking-wider rounded px-2 py-1 opacity-80 select-none">
                    Подписано ЭЦП
                  </div>
                  <div className="text-[10px] uppercase tracking-wider font-bold text-coral-700 mb-1">Организация</div>
                  <div className="font-bold text-sm text-charcoal-700">{orgName}</div>
                  {orgBin && <div className="text-[11px] text-charcoal-500 mt-0.5">БИН {orgBin}</div>}
                  {orgAddr && <div className="text-[11px] text-charcoal-500">{orgAddr}</div>}
                  <div className="border-t border-coral-200 mt-3 pt-3">
                    <div className="text-[10px] uppercase tracking-wider font-bold text-coral-700 mb-1">Директор</div>
                    <div className="font-semibold text-sm text-charcoal-700">{director}</div>
                    {basis && <div className="text-[11px] text-charcoal-500 mt-0.5">Действует на основании: {basis}</div>}
                  </div>
                  <div className="border-t border-coral-200 mt-3 pt-3 text-[11px] text-charcoal-600">
                    Подписал документ(ов): <b>{collegeSigs.length}</b> из <b>{(matrix.college || []).length}</b>
                    {collegeSigs.length > 0 && collegeSigs[0].created_at && (
                      <> · последняя подпись: {formatDateTime(collegeSigs[collegeSigs.length - 1].created_at)}</>
                    )}
                  </div>
                </div>
              </Section>
            );
          })()}

          <Section
            title={`Подписи (${(item.signatures || []).length})`}
            extra={
              item.is_fully_signed
                ? <span className="badge bg-emerald-100 text-emerald-700">✓ Все стороны</span>
                : <span className="badge bg-amber-100 text-amber-700">Ожидаются</span>
            }
          >
            {(item.signatures || []).length === 0 ? (
              <div className="text-sm text-charcoal-500">Подписей пока нет.</div>
            ) : (
              <ul className="space-y-3">
                {[...item.signatures].sort((a, b) => (a.created_at || "").localeCompare(b.created_at || "")).map((s) => {
                  const isCollege = s.signer_party === "college";
                  const isParent  = s.signer_party === "parent";
                  const isStudent = s.signer_party === "student";
                  const orgName = isCollege ? (collegeInfo?.college_name || "Колледж") : null;
                  // Authoritative ФИО per party — the enrollment form / college
                  // settings hold the FULL name (surname + given name +
                  // patronymic), while an ЭЦП certificate CN often carries only
                  // a partial form (e.g. Kazakh "АНУАШ ДҮЙСЕНБЕКҰЛЫ" — no
                  // surname, or a Russian cert with surname + patronymic only,
                  // as with the parent example that motivated this fix).
                  // Prefer the authoritative form; surface the CN as an audit
                  // line when it differs.
                  const certName = s.signer_full_name || "";
                  const authoritativeName = isCollege
                    ? (collegeInfo?.director_full_name || "")
                    : isParent
                      ? (item.parent_full_name || "")
                      : isStudent
                        ? (item.applicant_full_name || "")
                        : "";
                  // While collegeInfo is still loading, don't briefly flash the
                  // cert CN as the director name — show "…" placeholder.
                  const isStillLoadingCollege = isCollege && !collegeInfoLoaded;
                  const displayName = authoritativeName
                    || (isStillLoadingCollege ? "…" : (certName || "—"));
                  return (
                    <li key={s.id} className="rounded-xl bg-white ring-1 ring-charcoal-100 p-3 shadow-sm">
                      <div className="flex items-center justify-between gap-2 mb-2">
                        <span className={`badge ${isCollege ? "bg-coral-100 text-coral-700" : "bg-charcoal-100 text-charcoal-700"}`}>
                          {s.signer_party_label}
                        </span>
                        <VerificationBadge level={s.verification_level} className="text-[10px]" />
                      </div>
                      <div className="text-sm font-semibold text-charcoal-700">{s.document_label}</div>
                      {isCollege && orgName && (
                        <div className="mt-2 text-xs text-charcoal-600">
                          <div className="text-[10px] uppercase tracking-wide text-charcoal-400">Организация</div>
                          <div className="font-medium">{orgName}</div>
                          {collegeInfo?.college_bin && (
                            <div className="text-[11px] text-charcoal-500">БИН: {collegeInfo.college_bin}</div>
                          )}
                        </div>
                      )}
                      <div className="mt-2 text-xs text-charcoal-700">
                        <div className="text-[10px] uppercase tracking-wide text-charcoal-400">
                          {isCollege ? "Директор" : "Подписант"}
                        </div>
                        <div className="font-medium">{displayName}</div>
                        <div className="text-[11px] text-charcoal-500">ИИН: {s.signer_iin_or_bin || "—"}</div>
                      </div>
                      <div className="mt-2 text-[11px] text-charcoal-400">
                        {formatDateTime(s.created_at)}
                        {s.signer_serial && <> · сертификат …{String(s.signer_serial).slice(-8).toUpperCase()}</>}
                      </div>
                    </li>
                  );
                })}
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
