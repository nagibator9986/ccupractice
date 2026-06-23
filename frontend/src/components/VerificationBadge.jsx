// Shows how strongly the server verified an ЭЦП signature, so the admin sees the
// real assurance level per signature (RSA/ECDSA are fully verified; KZ GOST is
// accepted with identity + validity and a best-effort document binding).
const LEVELS = {
  full: {
    label: "Проверено полностью",
    cls: "bg-emerald-100 text-emerald-700",
    icon: "🔒",
    title: "Цифровая подпись (RSA/ECDSA) проверена криптографически: хэш документа и сама подпись.",
  },
  document_bound: {
    label: "ГОСТ: привязка подтверждена",
    cls: "bg-blue-100 text-blue-700",
    icon: "🔗",
    title: "ГОСТ-подпись: подтверждена привязка к этому файлу (Streebog). Личность и срок действия сертификата проверены.",
  },
  accepted: {
    label: "ГОСТ: принято",
    cls: "bg-amber-100 text-amber-700",
    icon: "⚠️",
    title: "ГОСТ-подпись принята по личности и сроку действия сертификата; привязку к файлу подтвердить не удалось (национальный алгоритм).",
  },
};

export default function VerificationBadge({ level, className = "" }) {
  const it = LEVELS[level] || LEVELS.full;
  return (
    <span className={`badge ${it.cls} ${className}`} title={it.title}>
      {it.icon} {it.label}
    </span>
  );
}
