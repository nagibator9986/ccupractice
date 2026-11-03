import { Check, Printer } from "lucide-react";
import clsx from "clsx";
import { CAPACITY_REP, ROLES, ROLE_SHORT, ROLE_TITLE, REP_TITLE } from "./contractFlow.js";

// signed → solid green with a check, invited → amber ring, otherwise grey.
// The letter stays visible in every state and each dot carries a text title,
// so the state never relies on colour alone.
function dotState(role, signed, invited) {
  if (signed.includes(role)) return "signed";
  if (invited.includes(role)) return "invited";
  return "none";
}

const STATE_TEXT = {
  signed: "подписано",
  invited: "ждём подпись (ссылка выдана)",
  none: "ссылка не выдана",
};

const STATE_CLASS = {
  signed: "bg-emerald-500 text-white ring-emerald-500",
  invited: "bg-amber-50 text-amber-800 ring-amber-400",
  none: "bg-charcoal-50 text-charcoal-400 ring-charcoal-200",
};

/**
 * К · П · С — college / partner / student signature indicator.
 * Paper signing is flagged next to the dots: the list only carries the student's default
 * method (`student_sign_method`) and the number of scans waiting for the college
 * (`scans_to_review`), so those are the two things that can be shown here.
 */
export default function SignatureDots({
  signedRoles = [],
  invitedRoles = [],
  studentMethod = "ecp",
  paperRoles,
  studentSigner = "self",
  scansToReview = 0,
  className,
}) {
  const studentTitle = studentSigner === CAPACITY_REP ? REP_TITLE : ROLE_TITLE.student;
  const titleOf = (r) => (r === "student" ? studentTitle : ROLE_TITLE[r]);
  // `paperRoles` (from the list payload) names every party that signs on paper; older payloads
  // only had the student's default method.
  const paper = paperRoles ?? (studentMethod === "scan" ? ["student"] : []);
  const paperPendingRoles = paper.filter((r) => !signedRoles.includes(r));
  const paperPending = paperPendingRoles.length > 0;
  const paperText = paperPendingRoles.map((r) => titleOf(r)).join(", ");
  const summary = [
    ...ROLES.map((r) => `${titleOf(r)}: ${STATE_TEXT[dotState(r, signedRoles, invitedRoles)]}`),
    paperPending ? `${paperText}: подписывает на бумаге (скан)` : null,
    scansToReview > 0 ? `скан ждёт проверки колледжем: ${scansToReview}` : null,
  ]
    .filter(Boolean)
    .join("; ");
  return (
    <span role="img" aria-label={`Подписи. ${summary}`} className={clsx("inline-flex flex-wrap items-center gap-1", className)}>
      {ROLES.map((r) => {
        const st = dotState(r, signedRoles, invitedRoles);
        return (
          <span
            key={r}
            title={`${titleOf(r)}: ${STATE_TEXT[st]}`}
            aria-hidden="true"
            className={clsx(
              "relative grid h-6 w-6 place-items-center rounded-full text-[11px] font-bold leading-none ring-2 ring-inset",
              STATE_CLASS[st],
            )}
          >
            {ROLE_SHORT[r]}
            {st === "signed" && (
              <span className="absolute -right-1 -top-1 grid h-3.5 w-3.5 place-items-center rounded-full bg-white text-emerald-600 ring-1 ring-emerald-500">
                <Check className="h-2.5 w-2.5" strokeWidth={4} />
              </span>
            )}
          </span>
        );
      })}
      {scansToReview > 0 ? (
        <span
          aria-hidden="true"
          title={`Скан ждёт проверки колледжем: ${scansToReview}`}
          className="ml-0.5 inline-flex items-center gap-0.5 rounded-md bg-blue-100 px-1.5 py-0.5 text-[10px] font-bold uppercase leading-none tracking-wide text-blue-700"
        >
          <Printer className="h-3 w-3" aria-hidden="true" />
          скан · проверить
        </span>
      ) : (
        paperPending && (
          <span
            aria-hidden="true"
            title={`${paperText} — подписывает на бумаге, по скану`}
            className="ml-0.5 inline-flex items-center gap-0.5 rounded-md bg-teal-100 px-1.5 py-0.5 text-[10px] font-bold uppercase leading-none tracking-wide text-teal-700"
          >
            <Printer className="h-3 w-3" aria-hidden="true" />
            скан
          </span>
        )
      )}
    </span>
  );
}
