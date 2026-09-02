import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import PageHeader from "../components/PageHeader.jsx";
import Modal from "../components/Modal.jsx";
import { TextField, TextArea, SelectField, CheckboxField } from "../components/Field.jsx";
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
  // Gates standalone LMS-contract creation. Present in EMPTY so the CREATE
  // form can set it — without it every new student was born non-grant and
  // could never appear in the LMS create-picker. On EDIT, {...EMPTY, ...s}
  // still lets the row's real value win.
  is_grant_student: false,
  // Server-provided enrichment (GET /api/students?with_lms=1); null while
  // creating. Never sent back — stripped in onSave.
  lms_contract: null,
  notes: "",
};

export default function StudentsPage() {
  const { isAdmin } = useAuth();
  const navigate = useNavigate();
  const [items, setItems] = useState([]);
  const [partners, setPartners] = useState([]);
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState(null);
  const [loading, setLoading] = useState(true);
  const [grantBusy, setGrantBusy] = useState(null);

  async function onToggleGrant(s) {
    if (grantBusy === s.id) return;
    const next = !s.is_grant_student;
    // Optimistic update.
    setGrantBusy(s.id);
    setItems((prev) =>
      prev.map((row) => (row.id === s.id ? { ...row, is_grant_student: next } : row))
    );
    try {
      await studentsApi.setGrant(s.id, next);
      toast.success(
        next ? "Студент переведён в грантники" : "Снята отметка о гранте"
      );
    } catch (e) {
      // Rollback.
      setItems((prev) =>
        prev.map((row) => (row.id === s.id ? { ...row, is_grant_student: !next } : row))
      );
      // Same 409 body as the edit modal — show the server's full sentence
      // rather than a hardcoded summary that drops the contract number.
      const d = e.response?.data || {};
      toast.error(d.error || "Не удалось обновить отметку о гранте", {
        duration: d.code ? 7000 : 4000,
      });
    } finally {
      setGrantBusy(null);
    }
  }

  function onQuickCreateLms(s) {
    navigate(`/lms-contracts?create=${s.id}`);
  }

  // `lms_contract` is attached by the server (?with_lms=1) and therefore
  // refreshes with every list load — no second request, no separate cache to
  // go stale, and the same contract the delete endpoint would name.
  // A non-completed contract pins the grant flag AND blocks the delete; a
  // completed one only blocks the delete.
  function activeLms(student) {
    return student?.lms_contract?.is_active ? student.lms_contract : null;
  }

  async function load() {
    setLoading(true);
    try {
      const [s, p] = await Promise.all([
        studentsApi.list({ q, with_lms: 1 }),
        partnersApi.list(),
      ]);
      setItems(s.items);
      setPartners(p.items);
    } catch (e) {
      const st = e.response?.status;
      if (st !== 401 && st !== 422)
        toast.error(e.response?.data?.error || "Не удалось загрузить студентов");
      setItems([]);
      setPartners([]);
    } finally {
      setLoading(false);
    }
  }

  async function refreshPartners() {
    try {
      const p = await partnersApi.list();
      setPartners(p.items);
    } catch {
      /* ignore — keep stale list */
    }
  }

  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [q]);

  // Refetch partners every time the edit modal opens so a partner added in
  // another tab / page appears in the dropdown without a manual reload.
  function openEditor(seed) {
    setEditing(seed);
    refreshPartners();
  }

  async function onSave() {
    const name = (editing.full_name || "").trim();
    if (!name) {
      toast.error("Укажите ФИО студента");
      return;
    }
    if (editing.iin && !/^\d{12}$/.test(String(editing.iin).trim())) {
      toast.error("ИИН должен состоять из 12 цифр");
      return;
    }
    if (editing.practice_start && editing.practice_end && editing.practice_end < editing.practice_start) {
      toast.error("Окончание практики не может быть раньше начала");
      return;
    }
    try {
      const payload = { ...editing };
      // Server-side enrichment, not a writable field.
      delete payload.lms_contract;
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
      const d = e.response?.data || {};
      // 409 lms_contract_active — the grant flag cannot be cleared while an
      // unfinished LMS contract exists. The server refuses the WHOLE update,
      // so put the flag back in the form: otherwise every later save of this
      // student would hit the same 409 and the admin could not save anything.
      if (d.code === "lms_contract_active") {
        setEditing((prev) => (prev ? { ...prev, is_grant_student: true } : prev));
      }
      toast.error(d.error || "Не удалось сохранить студента", {
        duration: d.code ? 7000 : 4000,
      });
    }
  }

  async function onDelete(item) {
    if (!confirm(`Удалить студента «${item.full_name}»?`)) return;
    try {
      await studentsApi.remove(item.id);
      toast.success("Удалено");
      load();
    } catch (e) {
      const d = e.response?.data || {};
      // The backend now names the blocking LMS contract and returns its id —
      // offer to jump straight there instead of leaving a dead end.
      if (d.code === "lms_contract_exists" && d.lms_contract_id) {
        if (confirm(`${d.error}\n\nОткрыть этот договор сейчас?`)) {
          navigate(`/lms-contracts/${d.lms_contract_id}`);
          return;
        }
      }
      toast.error(d.error || "Ошибка удаления", { duration: d.code ? 7000 : 4000 });
    }
  }

  // Edit-modal context: an unfinished LMS contract pins the grant flag on
  // (the backend enforces the same rule — this only avoids a pointless 409).
  const editingLms = activeLms(editing);
  const lmsBlocksGrantRemoval = !!editingLms;

  return (
    <div>
      <PageHeader
        title="Реестр студентов"
        description="Студенты, направляемые на профессиональную практику, с привязкой к партнёрам."
        actions={
          isAdmin && (
            <button onClick={() => openEditor({ ...EMPTY })} className="btn-primary">
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
              <th>На гранте</th>
              <th>LMS-договор</th>
              {isAdmin && <th className="text-right">Действия</th>}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={isAdmin ? 10 : 9} className="text-center py-6 text-slate-500">Загрузка…</td></tr>
            ) : items.length === 0 ? (
              <tr><td colSpan={isAdmin ? 10 : 9} className="text-center py-6 text-slate-500">Студентов пока нет.</td></tr>
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
                  <td>
                    {isAdmin ? (
                      <label
                        className="inline-flex items-center gap-2 cursor-pointer select-none"
                        title={
                          s.is_grant_student && activeLms(s)
                            ? `Отметку нельзя снять: есть незавершённый LMS-договор ${
                                activeLms(s).number || `LMS-${activeLms(s).id}`
                              }. Завершите или удалите договор.`
                            : "Перевести в категорию грантников / снять отметку"
                        }
                      >
                        <input
                          type="checkbox"
                          className="h-4 w-4"
                          checked={!!s.is_grant_student}
                          disabled={
                            grantBusy === s.id ||
                            (s.is_grant_student && !!activeLms(s))
                          }
                          onChange={() => onToggleGrant(s)}
                        />
                        {s.is_grant_student ? (
                          <span className="inline-block rounded-full bg-orange-100 text-orange-700 text-xs px-2 py-0.5">
                            Грантник
                          </span>
                        ) : (
                          <span className="text-xs text-slate-500">—</span>
                        )}
                      </label>
                    ) : s.is_grant_student ? (
                      <span className="inline-block rounded-full bg-orange-100 text-orange-700 text-xs px-2 py-0.5">
                        Грантник
                      </span>
                    ) : (
                      "—"
                    )}
                  </td>
                  {/* Makes the invisible link visible: this is why the student
                      is absent from the LMS create-picker and why the card
                      refuses to delete. */}
                  <td>
                    {s.lms_contract ? (
                      <Link
                        to={`/lms-contracts/${s.lms_contract.id}`}
                        className="text-xs font-semibold text-coral-700 hover:underline"
                        title={
                          s.lms_contract.is_active
                            ? "Договор не завершён: студент скрыт из мастера создания и карточку нельзя удалить"
                            : "Договор завершён, но карточку нельзя удалить, пока он существует"
                        }
                      >
                        {s.lms_contract.number || `LMS-${s.lms_contract.id} (без номера)`}
                        <span className="block font-normal text-[11px] text-charcoal-500">
                          {s.lms_contract.status_label || s.lms_contract.status}
                        </span>
                      </Link>
                    ) : (
                      <span className="text-xs text-slate-400">—</span>
                    )}
                  </td>
                  {isAdmin && (
                    <td className="text-right whitespace-nowrap">
                      {s.is_grant_student &&
                        (activeLms(s) ? (
                          <button
                            className="btn-ghost text-coral-700"
                            onClick={() => navigate(`/lms-contracts/${activeLms(s).id}`)}
                            title="У студента уже есть незавершённый LMS-договор"
                          >
                            Открыть LMS-договор
                          </button>
                        ) : (
                          <button
                            className="btn-ghost text-orange-600"
                            onClick={() => onQuickCreateLms(s)}
                            title="Открыть форму создания LMS-договора с этим студентом"
                          >
                            Создать LMS-договор
                          </button>
                        ))}
                      <button className="btn-ghost" onClick={() => openEditor({ ...EMPTY, ...s })}>Изм.</button>
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
            {/* Was missing entirely: every student created here was born
                non-grant and therefore invisible in the LMS create-picker. */}
            <div className="md:col-span-2">
              <CheckboxField
                label="Категория финансирования"
                text="Грантник (госзаказ) — доступен LMS-договор"
                checked={!!editing.is_grant_student}
                disabled={editing.is_grant_student && lmsBlocksGrantRemoval}
                onChange={(v) => setEditing({ ...editing, is_grant_student: v })}
                hint={
                  editing.is_grant_student && lmsBlocksGrantRemoval
                    ? `Отметку нельзя снять: есть незавершённый LMS-договор ${
                        editingLms?.number || `LMS-${editingLms?.id}`
                      }. Завершите или удалите договор.`
                    : "Только у грантников можно оформить договор о подключении к Caspian Digital."
                }
              />
            </div>
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
