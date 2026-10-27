import { useId } from "react";
import clsx from "clsx";

// Map the numeric `span` prop to complete, static class strings so Tailwind's
// JIT scanner can discover them at build time. An interpolated `col-span-${span}`
// is never emitted to the production CSS (the class would silently do nothing).
const COL_SPAN = { 1: "col-span-1", 2: "col-span-2", 3: "col-span-3" };

// `htmlFor` + `describedBy` link the label / hint / error to the control so
// screen readers announce them; they're optional so bare <Field> usage still works.
export function Field({ label, children, span = 1, hint, error, required, htmlFor, hintId, errorId }) {
  return (
    <div className={COL_SPAN[span] || "col-span-1"}>
      <label className="label" htmlFor={htmlFor}>
        {label}
        {required && (
          <span className="text-coral-600 ml-0.5" aria-hidden="true">
            *
          </span>
        )}
      </label>
      {children}
      {error ? (
        <div id={errorId} className="text-xs text-red-600 mt-1">
          {error}
        </div>
      ) : (
        hint && (
          <div id={hintId} className="text-xs text-charcoal-500 mt-1">
            {hint}
          </div>
        )
      )}
    </div>
  );
}

// Shared wiring for the three text-like controls. Kept as a hook (not a
// component) so the control stays a direct child and never remounts.
function useFieldIds(idProp, error, hint) {
  const auto = useId();
  const id = idProp || auto;
  const errorId = `${id}-err`;
  const hintId = `${id}-hint`;
  const describedBy = error ? errorId : hint ? hintId : undefined;
  return { id, errorId, hintId, describedBy };
}

export function TextField({ label, value, onChange, type = "text", hint, span, error, required, ...rest }) {
  const { id, errorId, hintId, describedBy } = useFieldIds(rest.id, error, hint);
  return (
    <Field label={label} hint={hint} span={span} error={error} required={required} htmlFor={id} hintId={hintId} errorId={errorId}>
      <input
        type={type}
        className={clsx("input", error && "input-error")}
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        aria-required={required || undefined}
        {...rest}
        id={id}
      />
    </Field>
  );
}

export function TextArea({ label, value, onChange, rows = 3, hint, span, error, required, ...rest }) {
  const { id, errorId, hintId, describedBy } = useFieldIds(rest.id, error, hint);
  return (
    <Field label={label} hint={hint} span={span} error={error} required={required} htmlFor={id} hintId={hintId} errorId={errorId}>
      <textarea
        className={clsx("input", error && "input-error")}
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value)}
        rows={rows}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        aria-required={required || undefined}
        {...rest}
        id={id}
      />
    </Field>
  );
}

export function SelectField({
  label,
  value,
  onChange,
  options = [],
  placeholder = "—",
  hint,
  span,
  disabled,
  error,
  required,
  ...rest
}) {
  const { id, errorId, hintId, describedBy } = useFieldIds(rest.id, error, hint);
  return (
    <Field label={label} hint={hint} span={span} error={error} required={required} htmlFor={id} hintId={hintId} errorId={errorId}>
      <select
        className={clsx("input", error && "input-error")}
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        aria-required={required || undefined}
        {...rest}
        id={id}
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

export function CheckboxField({ label, checked, onChange, text, hint, span, disabled, error, required }) {
  return (
    <Field label={label} hint={hint} span={span} error={error} required={required}>
      <label
        className={clsx(
          "flex items-center gap-2.5 rounded-xl border bg-white px-3.5 py-2.5 text-sm select-none min-h-[44px] sm:min-h-0",
          error ? "border-red-400" : "border-charcoal-200",
          disabled ? "opacity-60 cursor-not-allowed" : "cursor-pointer hover:border-coral-300",
        )}
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
