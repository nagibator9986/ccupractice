import { BadgeCheck, CircleCheck, FilePlus2, Hourglass, Send } from "lucide-react";
import clsx from "clsx";
import { toneOf } from "../../utils/tones.js";
import { NEXT_ACTION_META } from "./contractFlow.js";

const ICONS = {
  generate: FilePlus2,
  invite: Send,
  await_signatures: Hourglass,
  complete: CircleCheck,
  done: BadgeCheck,
};

export const NEXT_ACTION_ICON = ICONS;

/** «Следующий шаг» chip for a contract (value = Contract.next_action). */
export default function NextActionChip({ action, className }) {
  const meta = NEXT_ACTION_META[action];
  if (!meta) return null;
  const Icon = ICONS[action];
  return (
    <span className={clsx("badge", toneOf(meta.tone).badge, className)}>
      {Icon && <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
      {meta.label}
    </span>
  );
}
