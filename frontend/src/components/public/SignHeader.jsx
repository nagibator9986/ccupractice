import { PenLine } from "lucide-react";

// BIN for legal entities, IIN for people; the college recipient can be either.
export function idLabelFor(role) {
  if (role === "partner") return "БИН";
  if (role === "student") return "ИИН";
  return "ИИН/БИН";
}

/** Compact brand-consistent header: which contract, and in what capacity you sign. */
export default function SignHeader({ number, roleLabel, recipientName, role, idMasked }) {
  return (
    <header className="card p-4 sm:p-6 mb-4 sm:mb-5">
      <span className="chip">
        <PenLine className="h-3 w-3" aria-hidden="true" />
        Электронное подписание ЭЦП
      </span>
      <h1 className="mt-3 font-serif text-2xl sm:text-3xl font-bold leading-tight text-charcoal-900">
        Подписание договора практики <span className="whitespace-nowrap">№ {number || "—"}</span>
      </h1>
      <p className="mt-2 text-sm sm:text-base text-charcoal-700">
        Вы подписываете как: <span className="font-semibold text-charcoal-900">{roleLabel || "—"}</span>
        {recipientName ? <> — <span className="break-words">{recipientName}</span></> : null}
      </p>
      {idMasked ? (
        <p className="mt-2 text-xs text-charcoal-500">
          {idLabelFor(role)}: <span className="font-mono text-charcoal-700">{idMasked}</span>
          <span className="ml-1">(скрыт частично)</span>
        </p>
      ) : null}
    </header>
  );
}
