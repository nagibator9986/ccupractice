import { FilePlus2, Loader2, Trash2, UserCheck, X } from "lucide-react";
import { plural } from "../../utils/format.js";

/**
 * Sticky bar with actions for the selected students (admin only — the host
 * renders it only for admins). Sticks to the bottom of the viewport while its
 * natural place (end of the page) is below the fold.
 */
export default function SelectionBar({ count, onPractice, onContracts, onDelete, onClear, busy = false }) {
  if (!count) return null;
  return (
    <div className="sticky bottom-3 z-30 mt-4" role="region" aria-label="Действия с выбранными студентами">
      <div className="mx-auto flex max-w-4xl flex-wrap items-center gap-2 rounded-2xl bg-charcoal-900 px-3 py-2.5 text-white shadow-[0_18px_40px_-12px_rgba(15,23,42,0.55)] sm:px-4">
        <div className="w-full pl-1 text-sm font-semibold sm:mr-auto sm:w-auto" aria-live="polite">
          Выбрано {count} <span className="font-normal text-charcoal-300">{plural(count, "студент", "студента", "студентов")}</span>
        </div>
        <button type="button" className="btn btn-sm min-h-[44px] flex-1 sm:flex-none sm:min-h-0 !bg-white !text-charcoal-900 hover:!bg-coral-50" onClick={onPractice} disabled={busy}>
          <UserCheck className="h-4 w-4" aria-hidden="true" />
          <span className="sm:hidden">Практика</span>
          <span className="hidden sm:inline">Назначить практику</span>
        </button>
        <button type="button" className="btn btn-sm min-h-[44px] flex-1 sm:flex-none sm:min-h-0 !bg-white !text-charcoal-900 hover:!bg-coral-50" onClick={onContracts} disabled={busy}>
          <FilePlus2 className="h-4 w-4" aria-hidden="true" />
          <span className="sm:hidden">Договоры</span>
          <span className="hidden sm:inline">Создать договоры</span>
        </button>
        <button type="button" className="btn btn-sm min-h-[44px] flex-1 sm:flex-none sm:min-h-0 !bg-red-600 !text-white hover:!bg-red-700" onClick={onDelete} disabled={busy}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Trash2 className="h-4 w-4" aria-hidden="true" />}
          Удалить
        </button>
        <button
          type="button"
          className="btn btn-sm min-h-[44px] sm:min-h-0 !text-charcoal-200 hover:!bg-white/10 hover:!text-white"
          onClick={onClear}
          disabled={busy}
        >
          <X className="h-4 w-4" aria-hidden="true" />
          <span className="sr-only sm:not-sr-only">Снять выбор</span>
        </button>
      </div>
    </div>
  );
}
