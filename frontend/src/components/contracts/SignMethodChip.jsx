import { KeyRound, Printer } from "lucide-react";
import clsx from "clsx";
import { toneOf } from "../../utils/tones.js";
import { SIGN_METHOD_META } from "./contractFlow.js";

/** How a party signs: «ЭЦП» or «Бумага + скан» (the value is `SigningRequest.method` / `Student.sign_method`). */
export default function SignMethodChip({ method, className, title }) {
  const key = method === "scan" ? "scan" : "ecp";
  const meta = SIGN_METHOD_META[key];
  const Icon = key === "scan" ? Printer : KeyRound;
  return (
    <span
      className={clsx("badge", toneOf(meta.tone).badge, className)}
      title={title || (key === "scan" ? "Подписывает от руки на бумаге и загружает скан — колледж его проверяет" : "Подписывает электронной подписью (NCALayer или eGov mobile)")}
    >
      <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      {meta.label}
    </span>
  );
}
