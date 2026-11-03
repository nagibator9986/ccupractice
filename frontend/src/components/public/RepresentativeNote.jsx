import { UserRound } from "lucide-react";

/** Shown to a parent / legal representative who signs instead of a student under 16. */
export default function RepresentativeNote({ studentName }) {
  return (
    <div
      role="note"
      className="mb-4 flex items-start gap-3 rounded-2xl bg-blue-50 px-4 py-3 text-sm text-blue-900 ring-1 ring-blue-100 sm:mb-5"
    >
      <UserRound className="mt-0.5 h-5 w-5 shrink-0 text-blue-600" aria-hidden="true" />
      <div className="min-w-0">
        <p className="font-medium">Обучающийся младше 16 лет — договор подписывает законный представитель.</p>
        {studentName ? <p className="mt-0.5 break-words text-blue-900/80">Обучающийся: {studentName}</p> : null}
      </div>
    </div>
  );
}
