import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import toast from "react-hot-toast";
import PageHeader from "../components/PageHeader.jsx";
import Modal from "../components/Modal.jsx";
import { TextField, SelectField } from "../components/Field.jsx";
import { lmsContractsApi } from "../api/endpoints.js";
import { formatDate } from "../utils/format.js";
import { useAuth } from "../context/AuthContext.jsx";
import { StatusPill } from "./EnrollmentsPage.jsx";

export default function LmsContractsPage() {
  const { isAdmin } = useAuth();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [creating, setCreating] = useState(null);
  const [grantStudents, setGrantStudents] = useState([]);

  async function load() {
    setLoading(true);
    try {
      const data = await lmsContractsApi.list({ q, status });
      setItems(data.items || []);
    } catch {
      toast.error("Не удалось загрузить LMS-договоры");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [q, status]); // eslint-disable-line

  async function openCreate() {
    try {
      const today = new Date().toISOString().slice(0, 10);
      const [numRes, studentsRes] = await Promise.all([
        lmsContractsApi.suggestNumber().catch(() => ({ number: "" })),
        lmsContractsApi.grantStudents().catch(() => ({ items: [] })),
      ]);
      setGrantStudents(studentsRes.items || []);
      if (!studentsRes.items?.length) {
        toast(
          "Нет доступных студентов-грантников. Включите флаг «Грантник» на карточке студента.",
          { icon: "💡", duration: 5500 },
        );
      }
      setCreating({
        student_id: "",
        number: numRes.number || "",
        contract_date: today,
        funding_source: "госзаказ",
        grant_order_number: "",
        grant_order_date: "",
        notes: "",
      });
    } catch {
      toast.error("Не удалось открыть мастер создания");
    }
  }

  async function submitCreate() {
    if (!creating.student_id) {
      toast.error("Выберите студента-грантника");
      return;
    }
    try {
      const res = await lmsContractsApi.create({
        ...creating,
        student_id: parseInt(creating.student_id, 10),
      });
      toast.success(`LMS-договор № ${res.item.number} создан`);
      setCreating(null);
      load();
    } catch (e) {
      const msg = e.response?.data?.error || "Не удалось создать договор";
      toast.error(msg);
    }
  }

  return (
    <div>
      <PageHeader
        title="LMS-договоры"
        subtitle="Договоры о подключении к цифровой экосистеме Caspian Digital"
        right={
          <span className="chip-coral">Только грантники (госзаказ)</span>
        }
      />

      <div className="card p-4 mb-4 grid grid-cols-1 md:grid-cols-12 gap-3 items-end">
        <div className="md:col-span-6">
          <TextField
            label="Поиск"
            placeholder="ФИО, ИИН, номер, специальность…"
            value={q}
            onChange={setQ}
          />
        </div>
        <div className="md:col-span-3">
          <SelectField
            label="Статус"
            value={status}
            onChange={setStatus}
            options={[
              { value: "", label: "Все" },
              { value: "draft", label: "Черновик" },
              { value: "generated", label: "Сформирован" },
              { value: "sent", label: "Отправлен на подпись" },
              { value: "signed", label: "Подписан" },
              { value: "completed", label: "Завершён" },
            ]}
          />
        </div>
        <div className="md:col-span-3 flex justify-end">
          {isAdmin && (
            <button onClick={openCreate} className="btn btn-primary">
              + Новый LMS-договор
            </button>
          )}
        </div>
      </div>

      <div className="card">
        <table className="data-table">
          <thead>
            <tr>
              <th>№</th>
              <th>Дата</th>
              <th>Студент</th>
              <th>Специальность</th>
              <th>Статус</th>
              <th>Подписи</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} className="text-center text-charcoal-500 py-6">Загрузка…</td></tr>
            ) : items.length === 0 ? (
              <tr><td colSpan={6} className="text-center text-charcoal-500 py-6">Договоров пока нет.</td></tr>
            ) : (
              items.map((it) => (
                <tr key={it.id} className="hover:bg-coral-50/40">
                  <td className="font-mono">
                    <Link to={`/lms-contracts/${it.id}`} className="text-coral-700 hover:underline">
                      {it.number || `LMS-${it.id}`}
                    </Link>
                  </td>
                  <td>{formatDate(it.contract_date)}</td>
                  <td>
                    <div className="font-medium">{it.applicant_full_name}</div>
                    <div className="text-xs text-charcoal-500">ИИН {it.applicant_iin || "—"}</div>
                  </td>
                  <td>{it.specialty || "—"}</td>
                  <td><StatusPill status={it.status} label={it.status_label} /></td>
                  <td className="text-sm">
                    {it.is_fully_signed ? "✓ подписан" : `${it.signatures_count || 0}/1`}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <Modal
        open={!!creating}
        onClose={() => setCreating(null)}
        title="Новый LMS-договор"
        footer={
          <div className="flex justify-end gap-2">
            <button className="btn btn-secondary" onClick={() => setCreating(null)}>Отмена</button>
            <button className="btn btn-primary" onClick={submitCreate}>Создать</button>
          </div>
        }
      >
        {creating && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <SelectField
              label="Студент-грантник"
              value={creating.student_id}
              onChange={(v) => setCreating({ ...creating, student_id: v })}
              options={[
                { value: "", label: "— выберите —" },
                ...grantStudents.map((s) => ({
                  value: String(s.id),
                  label: `${s.full_name}${s.iin ? ` · ИИН ${s.iin}` : ""}${s.specialty ? ` · ${s.specialty}` : ""}`,
                })),
              ]}
              hint="Видны только студенты с флагом «Грантник» без активного LMS-договора"
            />
            <TextField label="Номер договора" value={creating.number} onChange={(v) => setCreating({ ...creating, number: v })} hint="Можно изменить" />
            <TextField label="Дата договора" type="date" value={creating.contract_date} onChange={(v) => setCreating({ ...creating, contract_date: v })} />
            <SelectField
              label="Источник финансирования"
              value={creating.funding_source}
              onChange={(v) => setCreating({ ...creating, funding_source: v })}
              options={[
                { value: "госзаказ", label: "Государственный образовательный заказ" },
                { value: "грант", label: "Образовательный грант" },
              ]}
            />
            <TextField label="Приказ о зачислении (№)" value={creating.grant_order_number} onChange={(v) => setCreating({ ...creating, grant_order_number: v })} />
            <TextField label="Дата приказа" type="date" value={creating.grant_order_date} onChange={(v) => setCreating({ ...creating, grant_order_date: v })} />
            <div className="md:col-span-2">
              <TextField label="Примечания" value={creating.notes} onChange={(v) => setCreating({ ...creating, notes: v })} />
            </div>
            <div className="md:col-span-2 rounded-xl bg-coral-50/40 ring-1 ring-coral-100 px-3 py-2 text-xs text-charcoal-600">
              💡 ФИО, ИИН, паспортные данные и адрес подтягиваются с карточки студента и могут быть отредактированы на странице договора.
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
