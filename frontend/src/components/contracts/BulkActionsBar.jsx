import { FileCheck2, FileSpreadsheet, Send, X } from "lucide-react";
import { plural } from "../../utils/format.js";

/**
 * Sticky bar for the contracts ticked in the list. Counts next to each action
 * tell how many of the selected contracts it actually applies to.
 */
export default function BulkActionsBar({
  count,
  generateCount,
  inviteCount,
  exportCount,
  busy,
  onGenerate,
  onInvite,
  onExport,
  onClear,
}) {
  if (count === 0) return null;
  return (
    <div
      role="region"
      aria-label="Действия с выбранными договорами"
      className="sticky bottom-3 z-20 mt-4 flex flex-wrap items-center gap-2 rounded-2xl bg-charcoal-900 px-3 py-2.5 text-white shadow-soft ring-1 ring-black/10 sm:px-4"
    >
      <div className="mr-auto text-sm font-semibold" aria-live="polite">
        Выбрано: {count} {plural(count, "договор", "договора", "договоров")}
      </div>
      <button
        type="button"
        className="btn-sm inline-flex min-h-[44px] sm:min-h-[40px] items-center gap-1.5 rounded-lg bg-coral-500 px-3 text-xs font-semibold text-white hover:bg-coral-600 disabled:cursor-not-allowed disabled:opacity-40"
        onClick={onGenerate}
        disabled={busy || generateCount === 0}
        title={generateCount === 0 ? "Среди выбранных нет договоров без документа" : undefined}
      >
        <FileCheck2 className="h-4 w-4" aria-hidden="true" />
        Сформировать{generateCount > 0 ? ` (${generateCount})` : ""}
      </button>
      <button
        type="button"
        className="btn-sm inline-flex min-h-[44px] sm:min-h-[40px] items-center gap-1.5 rounded-lg bg-white/10 px-3 text-xs font-semibold text-white hover:bg-white/20 disabled:cursor-not-allowed disabled:opacity-40"
        onClick={onInvite}
        disabled={busy || inviteCount === 0}
        title={inviteCount === 0 ? "Сначала сформируйте договоры: ссылки создаются для сформированных" : undefined}
      >
        <Send className="h-4 w-4" aria-hidden="true" />
        Отправить на подпись{inviteCount > 0 ? ` (${inviteCount})` : ""}
      </button>
      <button
        type="button"
        className="btn-sm inline-flex min-h-[44px] sm:min-h-[40px] items-center gap-1.5 rounded-lg bg-white/10 px-3 text-xs font-semibold text-white hover:bg-white/20 disabled:cursor-not-allowed disabled:opacity-40"
        onClick={onExport}
        disabled={busy || exportCount === 0}
        title={exportCount === 0 ? "Ссылки появятся после «Отправить на подпись»" : undefined}
      >
        <FileSpreadsheet className="h-4 w-4" aria-hidden="true" />
        Ссылки (Excel)
      </button>
      <button
        type="button"
        className="inline-flex min-h-[44px] sm:min-h-[40px] items-center gap-1.5 rounded-lg px-3 text-xs font-semibold text-white/80 hover:bg-white/10 hover:text-white"
        onClick={onClear}
      >
        <X className="h-4 w-4" aria-hidden="true" />
        Снять выбор
      </button>
    </div>
  );
}
