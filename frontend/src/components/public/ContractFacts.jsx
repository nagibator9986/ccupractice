import { formatDate } from "../../utils/format.js";

function Fact({ label, children, wide = false }) {
  const empty = children == null || children === "";
  return (
    <div className={wide ? "sm:col-span-2" : undefined}>
      <dt className="text-[11px] font-semibold uppercase tracking-wide text-charcoal-400">{label}</dt>
      <dd className="mt-0.5 break-words text-sm font-medium text-charcoal-800">{empty ? "—" : children}</dd>
    </div>
  );
}

/**
 * Key facts. Identifiers arrive masked from the backend (`bin_masked`,
 * `iin_masked`) — never the raw `bin` / `iin`, which the public payload omits.
 */
export default function ContractFacts({ contract }) {
  const partner = contract?.partner || {};
  const student = contract?.student || {};
  const director = [partner.director_position, partner.director_full_name].filter(Boolean).join(" ");
  const groupLine = [student.group_name, student.specialty].filter(Boolean).join(" · ");
  const period = student.practice_start
    ? `${formatDate(student.practice_start)} — ${formatDate(student.practice_end)}`
    : "";
  return (
    <section className="card p-4 sm:p-5" aria-label="Сведения о договоре">
      <h2 className="text-base font-semibold text-charcoal-900 mb-3">Сведения о договоре</h2>
      <dl className="grid grid-cols-1 gap-x-6 gap-y-3.5 sm:grid-cols-2">
        <Fact label="Договор">
          № {contract?.number || "—"}
          {contract?.date ? ` от ${formatDate(contract.date)}` : ""}
        </Fact>
        <Fact label="Период практики">{period}</Fact>
        <Fact label="Предприятие">
          {partner.name}
          {partner.bin_masked ? <span className="block text-xs font-normal text-charcoal-500">БИН {partner.bin_masked}</span> : null}
        </Fact>
        <Fact label="Руководитель предприятия">{director}</Fact>
        <Fact label="Студент">
          {student.full_name}
          {student.iin_masked ? <span className="block text-xs font-normal text-charcoal-500">ИИН {student.iin_masked}</span> : null}
        </Fact>
        <Fact label="Группа и специальность">{groupLine}</Fact>
        {partner.legal_address ? <Fact label="Юридический адрес предприятия" wide>{partner.legal_address}</Fact> : null}
        {contract?.college?.name_ru ? <Fact label="Колледж" wide>{contract.college.name_ru}</Fact> : null}
      </dl>
    </section>
  );
}
