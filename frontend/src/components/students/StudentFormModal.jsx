import { useId, useMemo, useState } from "react";
import { CircleAlert, Loader2 } from "lucide-react";
import toast from "react-hot-toast";
import Modal from "../Modal.jsx";
import Tabs from "../Tabs.jsx";
import SpecialtyPicker from "../SpecialtyPicker.jsx";
import { CheckboxField, SelectField, TextArea, TextField } from "../Field.jsx";
import InlineAlert from "./InlineAlert.jsx";
import { studentsApi } from "../../api/endpoints.js";
import { PRACTICE_TYPES, activeLms, partnerLabel } from "./studentUtils.js";

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
  // Gates standalone LMS-contract creation. Present in EMPTY so the CREATE form
  // can set it — without it every new student was born non-grant and could
  // never appear in the LMS create-picker. On EDIT the row's real value wins.
  is_grant_student: false,
  // Server-side enrichment (GET /api/students?with_lms=1&with_contracts=1);
  // never written back — stripped in save().
  lms_contract: null,
  contract: null,
  notes: "",
};

const TABS = [
  { value: "main", label: "Основное" },
  { value: "practice", label: "Практика" },
  { value: "docs", label: "Документы" },
  { value: "rep", label: "Законный представитель" },
];

// Which tab hosts which validated field (to jump to the first error).
const FIELD_TAB = {
  full_name: "main",
  iin: "main",
  course: "main",
  enrollment_year: "main",
  practice_start: "practice",
  practice_end: "practice",
};
const FIELD_ORDER = ["full_name", "iin", "course", "enrollment_year", "practice_start", "practice_end"];

const STRIP_ON_SAVE = ["lms_contract", "contract", "partner_name", "created_at", "id"];

export function validateStudent(f) {
  const e = {};
  if (!String(f.full_name ?? "").trim()) e.full_name = "Укажите ФИО студента";
  const iin = String(f.iin ?? "").trim();
  if (iin && !/^\d{12}$/.test(iin)) e.iin = "ИИН — ровно 12 цифр";
  if (f.course !== "" && f.course != null) {
    const n = Number(f.course);
    if (!Number.isInteger(n) || n < 1 || n > 6) e.course = "Курс — число от 1 до 6";
  }
  if (f.enrollment_year !== "" && f.enrollment_year != null) {
    const y = Number(f.enrollment_year);
    if (!Number.isInteger(y) || y < 1900 || y > 2100) e.enrollment_year = "Укажите год из четырёх цифр";
  }
  if (f.practice_start && f.practice_end && f.practice_end < f.practice_start) {
    e.practice_end = "Окончание практики не может быть раньше начала";
  }
  return e;
}

/**
 * Create / edit a student. `student === null` means «new».
 * Props: { open, student, onClose, onSaved(item, {created}), partners, specialties, groups? }.
 */
export default function StudentFormModal(props) {
  if (!props.open) return null;
  // key → a fresh form for every student (state is initialised once, no sync effect).
  return <StudentFormBody key={props.student?.id ?? "new"} {...props} />;
}

function StudentFormBody({ student, onClose, onSaved, partners = [], specialties = [], groups = [] }) {
  const [form, setForm] = useState(() => ({ ...EMPTY, ...(student || {}) }));
  const [tab, setTab] = useState("main");
  const [showErrors, setShowErrors] = useState(false);
  const [busy, setBusy] = useState(false);
  const [serverError, setServerError] = useState("");
  const groupsId = useId();
  const typesId = useId();
  const studyId = useId();

  const isEdit = !!student?.id;
  const lms = activeLms(student);
  const grantLocked = !!lms && !!form.is_grant_student;

  const errors = useMemo(() => validateStudent(form), [form]);
  const visible = showErrors ? errors : {};
  const tabHasError = (t) => Object.keys(visible).some((k) => FIELD_TAB[k] === t);

  const tabOptions = TABS.map((t) =>
    tabHasError(t.value)
      ? { ...t, icon: <CircleAlert className="h-4 w-4 shrink-0 text-red-500" aria-hidden="true" /> }
      : t,
  );

  // Qualification isn't stored on a student; take it from the dictionary row
  // that matches name + code so the picker shows the current choice.
  const pickerQualification =
    specialties.find((s) => (s.name || "") === (form.specialty || "") && (s.code || "") === (form.specialty_code || ""))
      ?.qualification || "";

  const set = (key) => (value) => setForm((f) => ({ ...f, [key]: value }));

  async function save() {
    if (busy) return;
    const errs = validateStudent(form);
    const first = FIELD_ORDER.find((k) => errs[k]);
    if (first) {
      setShowErrors(true);
      setTab(FIELD_TAB[first]);
      toast.error("Проверьте поля, отмеченные красным");
      // Focus after the target tab has rendered.
      requestAnimationFrame(() => document.getElementById(`sf-${first}`)?.focus());
      return;
    }
    setBusy(true);
    setServerError("");
    try {
      const payload = { ...form };
      for (const k of STRIP_ON_SAVE) delete payload[k];
      if (payload.partner_id === "") payload.partner_id = null;
      let item;
      if (isEdit) {
        item = (await studentsApi.update(student.id, payload)).item;
        toast.success("Студент обновлён");
      } else {
        item = (await studentsApi.create(payload)).item;
        toast.success("Студент добавлен");
      }
      onSaved?.(item, { created: !isEdit });
    } catch (e) {
      const d = e.response?.data || {};
      // 409 lms_contract_active — the grant flag cannot be cleared while an
      // unfinished LMS contract exists. The server refuses the WHOLE update,
      // so put the flag back in the form: otherwise every later save of this
      // student would hit the same 409 and nothing could be saved.
      if (d.code === "lms_contract_active") {
        setForm((f) => ({ ...f, is_grant_student: true }));
      }
      const text = d.error || "Не удалось сохранить студента";
      setServerError(text);
      toast.error(text, { duration: d.code ? 7000 : 4000 });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      onClose={busy ? undefined : onClose}
      title={isEdit ? "Редактирование студента" : "Новый студент"}
      description={isEdit ? student.full_name : "Обязательно только ФИО. Остальное можно дополнить позже."}
      size="xl"
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onClose} disabled={busy}>
            Отмена
          </button>
          <button type="button" className="btn-primary" onClick={save} disabled={busy}>
            {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
            {busy ? "Сохраняем…" : "Сохранить"}
          </button>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
        noValidate
      >
        <Tabs options={tabOptions} value={tab} onChange={setTab} ariaLabel="Разделы карточки студента" className="mb-5" />

        {serverError && (
          <InlineAlert tone="red" className="mb-4" title="Не удалось сохранить">
            {serverError}
          </InlineAlert>
        )}

        {tab === "main" && (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <TextField
              id="sf-full_name"
              label="ФИО студента"
              required
              value={form.full_name}
              onChange={set("full_name")}
              error={visible.full_name}
              data-autofocus={!isEdit || undefined}
              autoComplete="off"
            />
            <TextField
              id="sf-iin"
              label="ИИН"
              value={form.iin}
              onChange={set("iin")}
              error={visible.iin}
              hint="12 цифр. Нужен для договора."
              inputMode="numeric"
              autoComplete="off"
            />
            <div>
              <TextField
                label="Группа"
                value={form.group_name}
                onChange={set("group_name")}
                list={groupsId}
                placeholder="например, ПО 25-1"
                autoComplete="off"
              />
              <datalist id={groupsId}>
                {groups.map((g) => (
                  <option key={g} value={g} />
                ))}
              </datalist>
            </div>
            <TextField
              id="sf-course"
              label="Курс"
              type="number"
              min={1}
              max={6}
              value={form.course}
              onChange={set("course")}
              error={visible.course}
            />

            <div className="md:col-span-2">
              <SpecialtyPicker
                specialties={specialties}
                specialty={form.specialty}
                code={form.specialty_code}
                qualification={pickerQualification}
                onPick={(name, code) => setForm((f) => ({ ...f, specialty: name, specialty_code: code }))}
              />
            </div>
            <TextField label="Специальность" value={form.specialty} onChange={set("specialty")} hint="Можно ввести вручную, если её нет в справочнике." />
            <TextField label="Код специальности" value={form.specialty_code} onChange={set("specialty_code")} />
            <TextField label="Образовательная программа" value={form.education_program} onChange={set("education_program")} />
            <TextField
              id="sf-enrollment_year"
              label="Год поступления"
              type="number"
              value={form.enrollment_year}
              onChange={set("enrollment_year")}
              error={visible.enrollment_year}
            />
            <div>
              <TextField
                label="Форма обучения"
                value={form.form_of_study}
                onChange={set("form_of_study")}
                list={studyId}
              />
              <datalist id={studyId}>
                <option value="очная" />
                <option value="заочная" />
              </datalist>
            </div>
            <CheckboxField
              label="Категория финансирования"
              text="Грантник (госзаказ) — доступен LMS-договор"
              checked={!!form.is_grant_student}
              disabled={grantLocked}
              onChange={set("is_grant_student")}
              hint={
                grantLocked
                  ? `Отметку нельзя снять: есть незавершённый LMS-договор ${lms.number || `LMS-${lms.id}`}. Завершите или удалите договор.`
                  : "Только у грантников можно оформить договор о подключении к Caspian Digital."
              }
            />
            <div className="md:col-span-2">
              <TextArea label="Примечание" value={form.notes} onChange={set("notes")} />
            </div>
          </div>
        )}

        {tab === "practice" && (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="md:col-span-2">
              <SelectField
                label="Предприятие (база практики)"
                value={form.partner_id ?? ""}
                onChange={set("partner_id")}
                options={partners.map((p) => ({ value: p.id, label: partnerLabel(p) }))}
                placeholder="— не выбрано —"
              />
            </div>
            <TextField
              id="sf-practice_start"
              label="Начало практики"
              type="date"
              value={form.practice_start || ""}
              onChange={set("practice_start")}
              error={visible.practice_start}
            />
            <TextField
              id="sf-practice_end"
              label="Окончание практики"
              type="date"
              value={form.practice_end || ""}
              onChange={set("practice_end")}
              error={visible.practice_end}
            />
            <div className="md:col-span-2">
              <TextField
                label="Вид практики"
                value={form.practice_type}
                onChange={set("practice_type")}
                list={typesId}
                hint="Учебная, профессиональная, производственная или преддипломная."
              />
              <datalist id={typesId}>
                {PRACTICE_TYPES.map((t) => (
                  <option key={t} value={t} />
                ))}
              </datalist>
            </div>
            <TextField label="Руководитель практики от колледжа" value={form.college_supervisor} onChange={set("college_supervisor")} />
            <TextField label="Руководитель практики от предприятия" value={form.partner_supervisor} onChange={set("partner_supervisor")} />
          </div>
        )}

        {tab === "docs" && (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <TextField label="Дата рождения" type="date" value={form.birth_date || ""} onChange={set("birth_date")} />
            <TextField label="Телефон студента" value={form.phone} onChange={set("phone")} inputMode="tel" />
            <TextField label="№ удостоверения личности" value={form.id_card_number} onChange={set("id_card_number")} />
            <TextField label="Кем и когда выдано" value={form.id_card_issued_by} onChange={set("id_card_issued_by")} />
            <div className="md:col-span-2">
              <TextField label="Домашний адрес" value={form.home_address} onChange={set("home_address")} />
            </div>
          </div>
        )}

        {tab === "rep" && (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <p className="text-sm text-charcoal-500 md:col-span-2">
              Заполняется, если студент несовершеннолетний: законный представитель подписывает от его имени.
            </p>
            <div className="md:col-span-2">
              <TextField label="ФИО законного представителя" value={form.legal_rep_full_name} onChange={set("legal_rep_full_name")} />
            </div>
            <TextField label="ИИН представителя" value={form.legal_rep_iin} onChange={set("legal_rep_iin")} hint="12 цифр" inputMode="numeric" />
            <TextField label="Телефон представителя" value={form.legal_rep_phone} onChange={set("legal_rep_phone")} inputMode="tel" />
          </div>
        )}
        {/* Enter inside an input submits; a hidden submit keeps that working. */}
        <button type="submit" className="sr-only" tabIndex={-1} aria-hidden="true">
          Сохранить
        </button>
      </form>
    </Modal>
  );
}
