export function formatDate(value) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" });
}

export function formatDateTime(value) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export const STATUS_COLORS = {
  draft: "bg-slate-100 text-slate-700",
  generated: "bg-blue-100 text-blue-700",
  sent: "bg-indigo-100 text-indigo-700",
  signed: "bg-emerald-100 text-emerald-700",
  scan_uploaded: "bg-teal-100 text-teal-700",
  completed: "bg-green-100 text-green-700",
};

export const STATUS_LABELS = {
  draft: "Черновик",
  generated: "Сформирован",
  sent: "Отправлен партнеру",
  signed: "Подписан (ЭЦП)",
  scan_uploaded: "Скан загружен",
  completed: "Завершён",
};
