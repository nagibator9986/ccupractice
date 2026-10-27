import { Link2Off, RefreshCw, TimerOff, TriangleAlert, Unlink } from "lucide-react";
import StatusBanner from "./StatusBanner.jsx";

// kind: expired | revoked | invalid | generic. Every state says what to do
// next — the signer is usually a company director who has never seen the page.
const CONTENT = {
  expired: {
    tone: "amber",
    icon: TimerOff,
    title: "Срок действия ссылки истёк",
    text: "Ссылка на подписание действует ограниченное время. Это нормально: колледж может продлить её или прислать новую.",
    todo: "Свяжитесь с колледжем, приславшим вам ссылку, и попросите продлить её или отправить новую.",
  },
  revoked: {
    tone: "red",
    icon: Unlink,
    title: "Ссылка отозвана",
    text: "Колледж отозвал эту ссылку — например, после изменения договора. Подписать документ по ней уже нельзя.",
    todo: "Попросите колледж прислать новую ссылку на подписание.",
  },
  invalid: {
    tone: "slate",
    icon: Link2Off,
    title: "Ссылка недействительна",
    text: "Такой ссылки нет в системе. Возможно, она скопирована не полностью или была заменена новой.",
    todo: "Откройте ссылку из последнего сообщения целиком. Если не помогло — запросите новую у колледжа.",
  },
  generic: {
    tone: "red",
    icon: TriangleAlert,
    title: "Не удалось открыть договор",
    text: "",
    todo: "Проверьте интернет-соединение и попробуйте ещё раз. Если ошибка повторяется — сообщите об этом в колледж.",
  },
};

export default function LinkProblem({ kind = "generic", message, onRetry }) {
  const c = CONTENT[kind] || CONTENT.generic;
  const text = kind === "generic" ? message || "Сервер временно недоступен." : c.text;
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <StatusBanner tone={c.tone} icon={c.icon} title={c.title} role="alert">
        <p>{text}</p>
        <p className="mt-2 font-medium text-charcoal-800">Что делать: {c.todo}</p>
        {onRetry && (
          <div className="mt-3">
            <button type="button" className="btn-secondary" onClick={onRetry}>
              <RefreshCw className="h-4 w-4" aria-hidden="true" />
              Повторить
            </button>
          </div>
        )}
      </StatusBanner>
      <p className="px-1 text-center text-xs text-charcoal-400">
        Контакты колледжа указаны в сообщении, с которым вам пришла ссылка.
      </p>
    </div>
  );
}
