import { CalendarClock, Fingerprint, Hash, Lock } from "lucide-react";
import { formatDate } from "../../utils/format.js";

/** Four short trust points. */
export default function SecurityNote({ expiresAt }) {
  const items = [
    { Icon: Lock, text: "Ссылка одноразовая и привязана к одному получателю" },
    { Icon: CalendarClock, text: expiresAt ? `Срок действия: до ${formatDate(expiresAt)}` : "Ссылка действует ограниченное время" },
    { Icon: Fingerprint, text: "Подписант идентифицируется по сертификату НУЦ РК" },
    { Icon: Hash, text: "SHA-256 хэш файла фиксируется в момент подписи" },
  ];
  return (
    <section className="card p-4 sm:p-5" aria-label="Безопасность">
      <h2 className="mb-2.5 text-[11px] font-semibold uppercase tracking-wide text-charcoal-500">Безопасность</h2>
      <ul className="space-y-2 text-xs text-charcoal-600">
        {items.map(({ Icon, text }) => (
          <li key={text} className="flex items-start gap-2">
            <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-charcoal-400" aria-hidden="true" />
            <span>{text}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
