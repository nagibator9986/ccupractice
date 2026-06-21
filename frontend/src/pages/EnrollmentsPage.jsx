import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import toast from "react-hot-toast";
import PageHeader from "../components/PageHeader.jsx";
import Modal from "../components/Modal.jsx";
import { TextField, SelectField } from "../components/Field.jsx";
import { enrollmentsApi } from "../api/endpoints.js";
import { formatDate, ruYears } from "../utils/format.js";
import { useAuth } from "../context/AuthContext.jsx";

const STATUS_LABELS = {
  draft: "Черновик",
  generated: "Сформирован",
  sent: "Отправлен на подпись",
  signed: "Подписан",
  completed: "Завершён",
};
const STATUS_CLS = {
  draft: "bg-slate-100 text-slate-700",
  generated: "bg-blue-100 text-blue-700",
  sent: "bg-indigo-100 text-indigo-700",
  signed: "bg-emerald-100 text-emerald-700",
  completed: "bg-green-100 text-green-700",
};

export function StatusPill({ status, label }) {
  return (
    <span className={`badge ${STATUS_CLS[status] || "bg-slate-100 text-slate-700"}`}>
      {label || STATUS_LABELS[status] || status}
    </span>
  );
}

export function whoSigns(age) {
  if (age == null) return "укажите дату рождения";
  return age >= 16
    ? "≥16: студент + родитель (согласие)"
    : "<16: родитель (оба документа)";
}

const emptyDraft = (number, today) => ({
  number,
  contract_date: today,
  applicant_full_name: "",
  applicant_iin: "",
  applicant_birth_date: "",
  applicant_gender: "",
  applicant_phone: "",
  applicant_email: "",
  specialty: "",
  specialty_code: "",
  qualification: "",
  education_base: "9",
  tuition_year_amount: "",
  parent_full_name: "",
  parent_phone: "",
  parent_email: "",
});

export default function EnrollmentsPage() {
  const { isAdmin } = useAuth();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [creating, setCreating] = useState(null);

  async function load() {
    setLoading(true);
    try {
      const data = await enrollmentsApi.list({ q, status });
      setItems(data.items);
    } catch (e) {
      const s = e.response?.status;
      if (s !== 401 && s !== 422)
        toast.error(e.response?.data?.error || "Не удалось загрузить договоры");
      setItems([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [q, status]); // eslint-disable-line

  async function openNew() {
    const today = new Date().toISOString().slice(0, 10);
    let number = "";
    try {
      const res = await enrollmentsApi.suggestNumber(new Date().getFullYear());
      number = res.number;
    } catch {
      /* suggestion is optional */
    }
    setCreating(emptyDraft(number, today));
  }

  async function createOne() {
    if (!creating.applicant_full_name.trim()) {
      toast.error("Укажите ФИО абитуриента");
      return;
    }
    try {
      const data = await enrollmentsApi.create(creating);
      toast.success(`Договор ${data.item.number || ""} создан`);
      setCreating(null);
      load();
    } catch (e) {
      toast.error(e.response?.data?.error || "Не удалось создать договор");
    }
  }

  // Parse YYYY-MM-DD as local calendar components (not UTC) so the preview age
  // matches the backend's timezone-free arithmetic exactly near birthday edges.
  const computedAge = (() => {
    if (!creating?.applicant_birth_date) return null;
    const bp = creating.applicant_birth_date.split("-").map(Number);
    if (bp.length !== 3 || bp.some(Number.isNaN)) return null;
    const [by, bm, bd] = bp;
    let ry, rm, rd;
    if (creating.contract_date) {
      const rp = creating.contract_date.split("-").map(Number);
      if (rp.length !== 3 || rp.some(Number.isNaN)) return null;
      [ry, rm, rd] = rp;
    } else {
      const now = new Date();
      [ry, rm, rd] = [now.getFullYear(), now.getMonth() + 1, now.getDate()];
    }
    if (ry < by || (ry === by && (rm < bm || (rm === bm && rd < bd)))) return null;
    let a = ry - by;
    if (rm < bm || (rm === bm && rd < bd)) a--;
    return a;
  })();

  return (
    <div>
      <PageHeader
        title="Договоры со студентами"
        description="Договоры на оказание образовательных услуг и согласия на обработку персональных данных с подписанием ЭЦП. Подписант определяется возрастом: до 16 лет — родитель, с 16 — студент (родитель подписывает согласие)."
        actions={
          isAdmin && (
            <button onClick={openNew} className="btn-primary">
              + Новый договор
            </button>
          )
        }
      />

      <div className="card p-4 mb-4 grid grid-cols-1 md:grid-cols-3 gap-3">
        <input
          className="input md:col-span-2"
          placeholder="Поиск: №, ФИО, ИИН, специальность…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <select className="input" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">Любой статус</option>
          {Object.entries(STATUS_LABELS).map(([v, l]) => (
            <option key={v} value={v}>{l}</option>
          ))}
        </select>
      </div>

      <div className="card overflow-x-auto">
        <table className="table-default">
          <thead>
            <tr>
              <th>№ договора</th>
              <th>Дата</th>
              <th>Абитуриент</th>
              <th>ИИН</th>
              <th>Специальность</th>
              <th>Кто подписывает</th>
              <th>Статус</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={8} className="text-center py-6 text-slate-500">Загрузка…</td></tr>
            ) : items.length === 0 ? (
              <tr><td colSpan={8} className="text-center py-6 text-slate-500">Договоров пока нет.</td></tr>
            ) : (
              items.map((e) => (
                <tr key={e.id}>
                  <td>
                    <Link to={`/enrollments/${e.id}`} className="font-semibold text-coral-600 hover:underline">
                      {e.number || "—"}
                    </Link>
                  </td>
                  <td>{formatDate(e.contract_date)}</td>
                  <td>{e.applicant_full_name}</td>
                  <td className="text-sm">{e.applicant_iin || "—"}</td>
                  <td className="text-sm">{e.specialty || "—"}</td>
                  <td className="text-xs text-charcoal-500">
                    {e.applicant_age != null ? `${e.applicant_age} ${ruYears(e.applicant_age)} — ` : ""}
                    {whoSigns(e.applicant_age)}
                  </td>
                  <td><StatusPill status={e.status} label={e.status_label} /></td>
                  <td><Link to={`/enrollments/${e.id}`} className="btn-secondary">Открыть</Link></td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <Modal
        open={!!creating}
        onClose={() => setCreating(null)}
        title="Новый договор со студентом"
        size="lg"
        footer={
          <>
            <button className="btn-secondary" onClick={() => setCreating(null)}>Отмена</button>
            <button className="btn-primary" onClick={createOne}>Создать</button>
          </>
        }
      >
        {creating && (
          <div className="space-y-5">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <TextField label="№ договора" value={creating.number} onChange={(v) => setCreating({ ...creating, number: v })} hint="Можно изменить" />
              <TextField label="Дата договора" type="date" value={creating.contract_date} onChange={(v) => setCreating({ ...creating, contract_date: v })} />
              <div className="col-span-1 flex items-end">
                <div className="text-xs text-charcoal-500">
                  {computedAge != null ? `Возраст: ${computedAge} ${ruYears(computedAge)}` : "Возраст: —"}<br />
                  <span className="text-charcoal-400">{whoSigns(computedAge)}</span>
                </div>
              </div>
            </div>

            <div>
              <div className="text-[11px] uppercase tracking-wide font-semibold text-charcoal-400 mb-2">Абитуриент</div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <TextField label="ФИО *" value={creating.applicant_full_name} onChange={(v) => setCreating({ ...creating, applicant_full_name: v })} />
                <TextField label="ИИН" value={creating.applicant_iin} onChange={(v) => setCreating({ ...creating, applicant_iin: v })} />
                <TextField label="Дата рождения" type="date" value={creating.applicant_birth_date} onChange={(v) => setCreating({ ...creating, applicant_birth_date: v })} />
                <SelectField label="Пол" value={creating.applicant_gender} onChange={(v) => setCreating({ ...creating, applicant_gender: v })} options={[{ value: "М", label: "Мужской" }, { value: "Ж", label: "Женский" }]} placeholder="—" />
                <TextField label="Телефон" value={creating.applicant_phone} onChange={(v) => setCreating({ ...creating, applicant_phone: v })} />
                <TextField label="Email" value={creating.applicant_email} onChange={(v) => setCreating({ ...creating, applicant_email: v })} />
              </div>
            </div>

            <div>
              <div className="text-[11px] uppercase tracking-wide font-semibold text-charcoal-400 mb-2">Программа и оплата</div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <TextField label="Специальность" value={creating.specialty} onChange={(v) => setCreating({ ...creating, specialty: v })} />
                <TextField label="Код специальности" value={creating.specialty_code} onChange={(v) => setCreating({ ...creating, specialty_code: v })} />
                <TextField label="Квалификация" value={creating.qualification} onChange={(v) => setCreating({ ...creating, qualification: v })} />
                <SelectField label="База образования" value={creating.education_base} onChange={(v) => setCreating({ ...creating, education_base: v })} options={[{ value: "9", label: "После 9 класса" }, { value: "11", label: "После 11 класса" }]} placeholder="—" />
                <TextField label="Стоимость за год (тг)" type="number" value={creating.tuition_year_amount} onChange={(v) => setCreating({ ...creating, tuition_year_amount: v })} />
              </div>
            </div>

            <div>
              <div className="text-[11px] uppercase tracking-wide font-semibold text-charcoal-400 mb-2">
                Законный представитель (родитель)
                {computedAge != null && computedAge < 16 && <span className="text-coral-600"> — обязателен (абитуриент &lt; 16)</span>}
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <TextField label="ФИО родителя" value={creating.parent_full_name} onChange={(v) => setCreating({ ...creating, parent_full_name: v })} />
                <TextField label="Телефон" value={creating.parent_phone} onChange={(v) => setCreating({ ...creating, parent_phone: v })} />
                <TextField label="Email" value={creating.parent_email} onChange={(v) => setCreating({ ...creating, parent_email: v })} />
              </div>
            </div>
            <div className="text-xs text-charcoal-500">
              Остальные реквизиты (адрес, удостоверение и т.д.) можно заполнить на странице договора перед формированием документов.
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
