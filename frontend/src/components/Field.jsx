// Map the numeric `span` prop to complete, static class strings so Tailwind's
// JIT scanner can discover them at build time. An interpolated `col-span-${span}`
// is never emitted to the production CSS (the class would silently do nothing).
const COL_SPAN = { 1: "col-span-1", 2: "col-span-2", 3: "col-span-3" };

export function Field({ label, children, span = 1, hint }) {
  return (
    <div className={COL_SPAN[span] || "col-span-1"}>
      <label className="label">{label}</label>
      {children}
      {hint && <div className="text-xs text-slate-400 mt-1">{hint}</div>}
    </div>
  );
}

export function TextField({ label, value, onChange, type = "text", hint, span, ...rest }) {
  return (
    <Field label={label} hint={hint} span={span}>
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

export function TextArea({ label, value, onChange, rows = 3, hint, span, ...rest }) {
  return (
    <Field label={label} hint={hint} span={span}>
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

export function SelectField({ label, value, onChange, options = [], placeholder = "—", hint, span, disabled }) {
  return (
    <Field label={label} hint={hint} span={span}>
      <select
        className="input"
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
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

export function CheckboxField({ label, checked, onChange, text, hint, span, disabled }) {
  return (
    <Field label={label} hint={hint} span={span}>
      <label
        className={`flex items-center gap-2.5 rounded-xl border border-charcoal-200 bg-white px-3.5 py-2.5 text-sm select-none ${
          disabled ? "opacity-60 cursor-not-allowed" : "cursor-pointer hover:border-coral-300"
        }`}
      >
        <input
          type="checkbox"
          className="h-4 w-4 shrink-0 accent-coral-500"
          checked={!!checked}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked)}
        />
        <span>{text || label}</span>
      </label>
    </Field>
  );
}
