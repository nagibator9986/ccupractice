import { useId } from "react";
import { TriangleAlert } from "lucide-react";
import { SelectField, TextField } from "../Field.jsx";
import { COURSES, PRACTICE_TYPES, partnerLabel, validatePractice } from "./studentUtils.js";

/**
 * The «practice settings» block shared by the import wizard (defaults for the
 * whole upload) and the bulk-assign dialog. Fully controlled: `value` is the
 * EMPTY_PRACTICE-shaped object, `onChange(patch)` receives a partial update.
 *
 * `count` (students affected) lets us warn when the chosen partner has fewer
 * free seats than that.
 */
export default function PracticeFields({ value, onChange, partners = [], count, showCourse = false, disabled = false }) {
  const typesId = useId();
  const errors = validatePractice(value);
  const partner = partners.find((p) => String(p.id) === String(value.partner_id));
  const tooFewSeats =
    partner && partner.seats_free != null && Number(count) > 0 && Number(count) > partner.seats_free;

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <div className="sm:col-span-2">
        <SelectField
          label="Предприятие (база практики)"
          value={value.partner_id}
          onChange={(v) => onChange({ partner_id: v })}
          options={partners.map((p) => ({ value: p.id, label: partnerLabel(p) }))}
          placeholder={partners.length ? "— не менять —" : "Нет предприятий — добавьте в разделе «Партнёры»"}
          disabled={disabled}
        />
        {tooFewSeats && (
          <p className="mt-2 flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900 ring-1 ring-amber-200" role="status">
            <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" aria-hidden="true" />
            <span>
              У предприятия свободно мест: {partner.seats_free}, а студентов: {count}. Мест может не хватить — это
              не запрещено, но проверьте квоту.
            </span>
          </p>
        )}
      </div>

      <TextField
        label="Начало практики"
        type="date"
        value={value.practice_start}
        onChange={(v) => onChange({ practice_start: v })}
        disabled={disabled}
      />
      <TextField
        label="Окончание практики"
        type="date"
        value={value.practice_end}
        onChange={(v) => onChange({ practice_end: v })}
        error={errors.practice_end}
        disabled={disabled}
      />

      <TextField
        label="Руководитель от колледжа"
        value={value.college_supervisor}
        onChange={(v) => onChange({ college_supervisor: v })}
        placeholder="ФИО"
        disabled={disabled}
      />
      <TextField
        label="Руководитель от предприятия"
        value={value.partner_supervisor}
        onChange={(v) => onChange({ partner_supervisor: v })}
        placeholder="ФИО"
        disabled={disabled}
      />

      <div>
        <TextField
          label="Вид практики"
          value={value.practice_type}
          onChange={(v) => onChange({ practice_type: v })}
          list={typesId}
          placeholder="например, производственной"
          disabled={disabled}
        />
        <datalist id={typesId}>
          {PRACTICE_TYPES.map((t) => (
            <option key={t} value={t} />
          ))}
        </datalist>
      </div>

      {showCourse && (
        <SelectField
          label="Курс"
          value={value.course}
          onChange={(v) => onChange({ course: v })}
          options={COURSES.map((c) => ({ value: c, label: `${c} курс` }))}
          placeholder="— из файла —"
          error={errors.course}
          disabled={disabled}
        />
      )}
    </div>
  );
}
