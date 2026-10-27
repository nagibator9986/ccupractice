import { Laptop, Smartphone } from "lucide-react";

const CHANNELS = {
  egov_mobile: {
    label: "eGov mobile",
    icon: Smartphone,
    cls: "bg-sky-100 text-sky-800",
    title: "Подписано в приложении eGov mobile (QR-код или ссылка). Подписан PDF-вариант договора — тот, что показывает приложение.",
  },
  ncalayer: {
    label: "NCALayer",
    icon: Laptop,
    cls: "bg-charcoal-100 text-charcoal-700",
    title: "Подписано через NCALayer ключом ЭЦП на компьютере. Подписан DOCX-вариант договора.",
  },
};

/** How a signature was made: app + which file version it covers. */
export default function SignChannelBadge({ channel, payloadFormat, className = "" }) {
  const it = CHANNELS[channel] || CHANNELS.ncalayer;
  const fmt = (payloadFormat || (channel === "egov_mobile" ? "pdf" : "docx")).toUpperCase();
  return (
    <span className={`badge ${it.cls} ${className}`} title={it.title}>
      <it.icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      {it.label} · {fmt}
    </span>
  );
}
