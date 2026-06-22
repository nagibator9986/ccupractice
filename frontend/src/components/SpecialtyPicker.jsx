import { SelectField } from "./Field.jsx";

/**
 * A dropdown over the «Данные» specialties dictionary. Picking an entry calls
 * onPick(name, code, qualification) so the parent can auto-fill its three
 * free-text fields at once. The select reflects the current values: if they
 * match a dictionary row it shows that row, otherwise it falls back to the
 * placeholder (e.g. after a manual edit or a one-off typed specialty).
 */
export default function SpecialtyPicker({
  specialties = [],
  specialty = "",
  code = "",
  qualification = "",
  onPick,
  disabled = false,
  label = "Специальность из справочника",
  span,
}) {
  const active = specialties.filter((s) => s.is_active);

  const match = active.find(
    (s) =>
      (s.name || "") === (specialty || "") &&
      (s.code || "") === (code || "") &&
      (s.qualification || "") === (qualification || ""),
  );

  const options = active.map((s) => ({
    value: String(s.id),
    label: [s.name, s.code, s.qualification].filter(Boolean).join(" · "),
  }));

  return (
    <SelectField
      label={label}
      span={span}
      disabled={disabled}
      value={match ? String(match.id) : ""}
      placeholder={
        active.length
          ? "— выбрать из справочника —"
          : "Справочник пуст — добавьте в разделе «Данные»"
      }
      options={options}
      onChange={(v) => {
        const s = active.find((x) => String(x.id) === String(v));
        // Selecting the placeholder (empty value) leaves the fields untouched so
        // manually-entered data is never wiped; only a real pick overwrites.
        if (s) onPick(s.name || "", s.code || "", s.qualification || "");
      }}
    />
  );
}
