export function Field({ label, children, span = 1, hint }) {
  return (
    <div className={`col-span-${span}`}>
      <label className="label">{label}</label>
      {children}
      {hint && <div className="text-xs text-slate-400 mt-1">{hint}</div>}
    </div>
  );
}

export function TextField({ label, value, onChange, type = "text", hint, ...rest }) {
  return (
    <Field label={label} hint={hint}>
      <input
        type={type}
        className="input"
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value)}
        {...rest}
      />
    </Field>
  );
}

export function TextArea({ label, value, onChange, rows = 3, hint, ...rest }) {
  return (
    <Field label={label} hint={hint}>
      <textarea
        className="input"
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value)}
        rows={rows}
        {...rest}
      />
    </Field>
  );
}

export function SelectField({ label, value, onChange, options = [], placeholder = "—", hint }) {
  return (
    <Field label={label} hint={hint}>
      <select
        className="input"
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">{placeholder}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </Field>
  );
}
