import { Check } from "lucide-react";
import clsx from "clsx";
import { ROLES, ROLE_SHORT, ROLE_TITLE } from "./contractFlow.js";

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

/** К · П · С — college / partner / student signature indicator. */
export default function SignatureDots({ signedRoles = [], invitedRoles = [], className }) {
  const summary = ROLES.map((r) => `${ROLE_TITLE[r]}: ${STATE_TEXT[dotState(r, signedRoles, invitedRoles)]}`).join("; ");
  return (
    <span role="img" aria-label={`Подписи. ${summary}`} className={clsx("inline-flex items-center gap-1", className)}>
      {ROLES.map((r) => {
        const st = dotState(r, signedRoles, invitedRoles);
        return (
          <span
            key={r}
            title={`${ROLE_TITLE[r]}: ${STATE_TEXT[st]}`}
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
    </span>
  );
}
