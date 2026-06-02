import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import PageHeader from "../components/PageHeader.jsx";
import Modal from "../components/Modal.jsx";
import { TextField, TextArea, SelectField } from "../components/Field.jsx";
import { partnersApi, studentsApi } from "../api/endpoints.js";
import { useAuth } from "../context/AuthContext.jsx";

const EMPTY = {
  full_name: "",
  iin: "",
  group_name: "",
  specialty: "",
  course: 1,
  practice_start: "",
  practice_end: "",
  college_supervisor: "",
  partner_supervisor: "",
  partner_id: "",
  birth_date: "",
  id_card_number: "",
  id_card_issued_by: "",
  home_address: "",
  phone: "",
  legal_rep_full_name: "",
  legal_rep_iin: "",
  legal_rep_phone: "",
  education_program: "",
  specialty_code: "",
  enrollment_year: new Date().getFullYear(),
  practice_type: "профессиональной",
  form_of_study: "очная",
  notes: "",
};

export default function StudentsPage() {
  const { isAdmin } = useAuth();
  const [items, setItems] = useState([]);
  const [partners, setPartners] = useState([]);
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      const [s, p] = await Promise.all([studentsApi.list({ q }), partnersApi.list()]);
      setItems(s.items);
      setPartners(p.items);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [q]);

  async function onSave() {
    try {
      const payload = { ...editing };
      if (payload.partner_id === "") payload.partner_id = null;
      if (editing.id) {
        await studentsApi.update(editing.id, payload);
        toast.success("Студент обновлён");
      } else {
        await studentsApi.create(payload);
        toast.success("Студент добавлен");
      }
      setEditing(null);
      load();
    } catch (e) {
      toast.error(e.response?.data?.error || "Ошибка сохранения");
    }
  }

  async function onDelete(item) {
    if (!confirm(`Удалить студента «${item.full_name}»?`)) return;
    try {
      await studentsApi.remove(item.id);
      toast.success("Удалено");
      load();
    } catch (e) {
      toast.error(e.response?.data?.error || "Ошибка удаления");
    }
  }

  return (
    <div>
      <PageHeader
        title="Реестр студентов"
        description="Студенты, направляемые на профессиональную практику, с привязкой к партнёрам."
        actions={
          isAdmin && (
            <button onClick={() => setEditing({ ...EMPTY })} className="btn-primary">
              + Добавить студента
            </button>
          )
        }
      />

      <div className="card p-4 mb-4">
        <input
          className="input"
          placeholder="Поиск по ФИО, ИИН, специальности…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>

      <div className="card overflow-x-auto">
        <table className="table-default">
          <thead>
            <tr>
              <th>ФИО</th>
              <th>ИИН</th>
              <th>Группа</th>
              <th>Специальность</th>
              <th>Курс</th>
              <th>Период практики</th>
              <th>Партнёр</th>
              {isAdmin && <th className="text-right">Действия</th>}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={isAdmin ? 8 : 7} className="text-center py-6 text-slate-500">Загрузка…</td></tr>
            ) : items.length === 0 ? (
              <tr><td colSpan={isAdmin ? 8 : 7} className="text-center py-6 text-slate-500">Студентов пока нет.</td></tr>
            ) : (
              items.map((s) => (
                <tr key={s.id}>
                  <td className="font-semibold">{s.full_name}</td>
                  <td>{s.iin || "—"}</td>
                  <td>{s.group_name || "—"}</td>
                  <td>{s.specialty || "—"}</td>
                  <td>{s.course || "—"}</td>
                  <td className="text-xs">
                    {s.practice_start ? `${s.practice_start} → ${s.practice_end || "?"}` : "—"}
                  </td>
                  <td>{s.partner_name || "—"}</td>
                  {isAdmin && (
                    <td className="text-right">
                      <button className="btn-ghost" onClick={() => setEditing({ ...EMPTY, ...s })}>Изм.</button>
                      <button className="btn-ghost text-red-600" onClick={() => onDelete(s)}>Удалить</button>
                    </td>
                  )}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <Modal
        open={!!editing}
        onClose={() => setEditing(null)}
        title={editing?.id ? "Редактирование студента" : "Новый студент"}
        size="xl"
        footer={
          <>
            <button className="btn-secondary" onClick={() => setEditing(null)}>Отмена</button>
            <button className="btn-primary" onClick={onSave}>Сохранить</button>
          </>
        }
      >
        {editing && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <TextField label="ФИО студента *" value={editing.full_name} onChange={(v) => setEditing({ ...editing, full_name: v })} />
            <TextField label="ИИН" value={editing.iin} onChange={(v) => setEditing({ ...editing, iin: v })} />
            <TextField label="Группа" value={editing.group_name} onChange={(v) => setEditing({ ...editing, group_name: v })} />
            <TextField label="Специальность" value={editing.specialty} onChange={(v) => setEditing({ ...editing, specialty: v })} />
            <TextField label="Код специальности" value={editing.specialty_code} onChange={(v) => setEditing({ ...editing, specialty_code: v })} />
            <TextField label="Курс" value={editing.course} onChange={(v) => setEditing({ ...editing, course: v })} type="number" />
            <TextField label="Образовательная программа" value={editing.education_program} onChange={(v) => setEditing({ ...editing, education_program: v })} />
            <TextField label="Год поступления" value={editing.enrollment_year} onChange={(v) => setEditing({ ...editing, enrollment_year: v })} type="number" />
            <TextField label="Форма обучения" value={editing.form_of_study} onChange={(v) => setEditing({ ...editing, form_of_study: v })} />
            <TextField label="Вид практики" value={editing.practice_type} onChange={(v) => setEditing({ ...editing, practice_type: v })} hint="учебная / производственная / преддипломная" />

            <TextField label="Начало практики" value={editing.practice_start || ""} onChange={(v) => setEditing({ ...editing, practice_start: v })} type="date" />
            <TextField label="Окончание практики" value={editing.practice_end || ""} onChange={(v) => setEditing({ ...editing, practice_end: v })} type="date" />

            <TextField label="Руководитель практики от колледжа" value={editing.college_supervisor} onChange={(v) => setEditing({ ...editing, college_supervisor: v })} />
            <TextField label="Руководитель практики от предприятия" value={editing.partner_supervisor} onChange={(v) => setEditing({ ...editing, partner_supervisor: v })} />

            <SelectField
              label="Партнёр (база практики)"
              value={editing.partner_id || ""}
              onChange={(v) => setEditing({ ...editing, partner_id: v })}
              options={partners.map((p) => ({ value: p.id, label: p.organization_name }))}
              placeholder="— не выбран —"
            />
            <TextField label="Телефон студента" value={editing.phone} onChange={(v) => setEditing({ ...editing, phone: v })} />

            <TextField label="Дата рождения" value={editing.birth_date || ""} onChange={(v) => setEditing({ ...editing, birth_date: v })} type="date" />
            <TextField label="№ удостоверения" value={editing.id_card_number} onChange={(v) => setEditing({ ...editing, id_card_number: v })} />
            <TextField label="Кем и когда выдано" value={editing.id_card_issued_by} onChange={(v) => setEditing({ ...editing, id_card_issued_by: v })} />
            <TextField label="Домашний адрес" value={editing.home_address} onChange={(v) => setEditing({ ...editing, home_address: v })} />

            <TextField label="ФИО законного представителя" value={editing.legal_rep_full_name} onChange={(v) => setEditing({ ...editing, legal_rep_full_name: v })} />
            <TextField label="ИИН представителя" value={editing.legal_rep_iin} onChange={(v) => setEditing({ ...editing, legal_rep_iin: v })} />
            <TextField label="Телефон представителя" value={editing.legal_rep_phone} onChange={(v) => setEditing({ ...editing, legal_rep_phone: v })} />

            <div className="md:col-span-2">
              <TextArea label="Примечание" value={editing.notes} onChange={(v) => setEditing({ ...editing, notes: v })} />
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
