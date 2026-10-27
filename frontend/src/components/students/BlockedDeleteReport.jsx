import { Link } from "react-router-dom";
import Modal from "../Modal.jsx";
import InlineAlert from "./InlineAlert.jsx";
import { plural } from "../../utils/format.js";

/** Shown after a bulk delete when some students could not be removed. */
export default function BlockedDeleteReport({ open, onClose, blocked = [], deleted = 0 }) {
  if (!open) return null;
  return (
    <Modal
      open
      onClose={onClose}
      title="Часть студентов не удалена"
      description={deleted > 0 ? `Удалено: ${deleted}. Остальных удалить нельзя.` : "Никто не удалён."}
      size="md"
      footer={
        <button type="button" className="btn-primary" onClick={onClose} data-autofocus>
          Понятно
        </button>
      }
    >
      <InlineAlert tone="amber" title={`Не удалено: ${blocked.length} ${plural(blocked.length, "студент", "студента", "студентов")}`}>
        Студентов с договорами удалять нельзя, чтобы не потерять документы и подписи. Сначала разберитесь с их
        договорами, затем повторите.
      </InlineAlert>
      <ul className="mt-4 divide-y divide-charcoal-100 rounded-xl border border-charcoal-200">
        {blocked.map((b) => (
          <li key={b.id} className="flex flex-wrap items-center justify-between gap-2 px-3.5 py-2.5 text-sm">
            <div className="min-w-0">
              <div className="font-medium text-charcoal-900">{b.full_name}</div>
              <div className="text-xs text-charcoal-500">Причина: {b.reason}</div>
            </div>
            {/практик/i.test(b.reason || "") && (
              <Link to={`/contracts?student_id=${b.id}`} className="btn-ghost btn-sm text-coral-700" onClick={onClose}>
                Открыть договоры
              </Link>
            )}
          </li>
        ))}
      </ul>
    </Modal>
  );
}
