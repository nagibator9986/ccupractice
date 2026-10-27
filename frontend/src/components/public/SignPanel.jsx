import { useId, useState } from "react";
import { ChevronDown, Laptop, Loader2, PenLine, RefreshCw, ShieldCheck, Smartphone, TriangleAlert } from "lucide-react";
import clsx from "clsx";
import EgovSignBox from "./EgovSignBox.jsx";

const NCA_URL = "https://pki.gov.kz/ncalayer/";
const NCA_LOCAL = "https://127.0.0.1:13579";

function NcaStatus({ available, rechecking, onRecheck }) {
  if (available === null) {
    return (
      <div className="flex items-center gap-2 rounded-xl bg-charcoal-50 px-3 py-2.5 text-sm text-charcoal-600" role="status">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        Проверяем NCALayer…
      </div>
    );
  }
  if (available) {
    return (
      <div className="flex items-center gap-2 rounded-xl bg-emerald-50 px-3 py-2.5 text-sm text-emerald-800 ring-1 ring-emerald-100" role="status">
        <ShieldCheck className="h-4 w-4 shrink-0" aria-hidden="true" />
        NCALayer найден на этом устройстве — можно подписывать.
      </div>
    );
  }
  return (
    <div className="space-y-2 rounded-xl bg-amber-50 px-3 py-2.5 text-sm text-amber-900 ring-1 ring-amber-100" role="status">
      <div className="flex items-start gap-2 font-medium">
        <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        NCALayer не обнаружен.
      </div>
      <p className="text-xs leading-relaxed">
        Установите приложение НУЦ РК с{" "}
        <a className="link" href={NCA_URL} target="_blank" rel="noreferrer">pki.gov.kz/ncalayer</a> и запустите его.
        Если оно уже запущено, один раз откройте{" "}
        <a className="link break-all" href={NCA_LOCAL} target="_blank" rel="noreferrer">{NCA_LOCAL}</a>{" "}
        и подтвердите сертификат NCALayer (защищённый сайт пускает подпись только к доверенному сертификату), затем нажмите кнопку ниже.
      </p>
      <button type="button" className="btn-secondary w-full sm:w-auto" onClick={onRecheck} disabled={rechecking}>
        <RefreshCw className={clsx("h-4 w-4", rechecking && "animate-spin")} aria-hidden="true" />
        Проверить NCALayer повторно
      </button>
    </div>
  );
}

function SignGuide({ egovAvailable }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  return (
    <div className="rounded-xl border border-charcoal-100">
      <button
        type="button"
        className="flex min-h-[44px] w-full items-center justify-between gap-2 rounded-xl px-3 py-2 text-left text-sm font-medium text-charcoal-700 hover:bg-charcoal-50"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
      >
        Первый раз? Как подписать
        <ChevronDown className={clsx("h-4 w-4 shrink-0 transition-transform", open && "rotate-180")} aria-hidden="true" />
      </button>
      {open && (
        <div id={panelId} className="border-t border-charcoal-100 px-3 py-3 text-sm text-charcoal-700">
          <ol className="list-decimal space-y-1.5 pl-5">
            <li>
              Установите и запустите <a className="link" href={NCA_URL} target="_blank" rel="noreferrer">NCALayer</a> (приложение НУЦ РК).
            </li>
            <li>
              Один раз откройте <a className="link break-all" href={NCA_LOCAL} target="_blank" rel="noreferrer">{NCA_LOCAL}</a> в этом
              браузере и подтвердите сертификат, затем вернитесь сюда.
            </li>
            <li>Нажмите «Подписать ЭЦП» и в окне NCALayer выберите, где хранится ключ: файл (PKCS12), удостоверение личности или токен.</li>
            <li>Введите пароль или PIN и подтвердите подпись — она сохранится автоматически.</li>
          </ol>
          <p className="mt-3 text-xs text-charcoal-500">
            {egovAvailable
              ? "С телефона удобнее подписать через приложение eGov mobile — выберите этот способ выше."
              : "С телефона подписать можно только если на нём установлен NCALayer (мобильная версия). Если не получается — откройте эту же ссылку на компьютере с NCALayer."}
          </p>
        </div>
      )}
    </div>
  );
}

function MethodPicker({ value, onChange, disabled }) {
  const options = [
    { id: "egov", icon: Smartphone, title: "eGov mobile", hint: "С телефона: QR-код или кнопка. Ключ ЭЦП не нужен." },
    { id: "ncalayer", icon: Laptop, title: "NCALayer", hint: "С компьютера: ключ ЭЦП (файл, удостоверение, токен)." },
  ];
  return (
    <div role="radiogroup" aria-label="Способ подписания" className="grid gap-2 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
      {options.map((o) => {
        const active = value === o.id;
        return (
          <button
            key={o.id}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={disabled}
            onClick={() => onChange(o.id)}
            className={clsx(
              "flex min-h-[44px] items-start gap-2.5 rounded-xl border px-3 py-2.5 text-left transition",
              active ? "border-coral-400 bg-coral-50/60 ring-2 ring-coral-100" : "border-charcoal-200 bg-white hover:border-coral-300",
              disabled && "opacity-60",
            )}
          >
            <o.icon className={clsx("mt-0.5 h-4 w-4 shrink-0", active ? "text-coral-600" : "text-charcoal-400")} aria-hidden="true" />
            <span className="min-w-0">
              <span className="block text-sm font-semibold text-charcoal-900">{o.title}</span>
              <span className="block text-xs leading-snug text-charcoal-500">{o.hint}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

/**
 * The sign block: consent checkbox -> NCALayer status -> big button -> guide.
 * The probing / signing logic stays in the page; this is presentation only.
 */
export default function SignPanel({ ncaAvailable, onRecheck, busy, docReady, onSign, token, egov, onEgovSigned }) {
  const [agreed, setAgreed] = useState(false);
  const egovAvailable = Boolean(egov?.available);
  // eGov mobile is the modern path (no key file, works from a phone) — default to it when the college has it on.
  const [method, setMethod] = useState(egovAvailable ? "egov" : "ncalayer");
  const useEgov = egovAvailable && method === "egov";
  const [rechecking, setRechecking] = useState(false);
  const hintId = useId();

  async function recheck() {
    setRechecking(true);
    try {
      await onRecheck();
    } finally {
      setRechecking(false);
    }
  }

  const reason = !docReady
    ? "Документ ещё не готов к подписанию — обратитесь в колледж."
    : !agreed
      ? "Отметьте, что ознакомились с договором."
      : ncaAvailable === null
        ? "Проверяем NCALayer…"
        : !ncaAvailable
          ? "Запустите NCALayer — без него подписать нельзя."
          : null;
  const disabled = busy || reason !== null;

  return (
    <section id="sign" className="card scroll-mt-4 p-4 sm:p-5 space-y-4" aria-label="Подписание ЭЦП">
      <div className="flex items-center gap-2.5">
        <span className="h-9 w-9 shrink-0 grid place-items-center rounded-xl bg-coral-50 text-coral-600" aria-hidden="true">
          <PenLine className="h-[18px] w-[18px]" />
        </span>
        <h2 className="text-base font-semibold text-charcoal-900">Подписание ЭЦП</h2>
      </div>

      <label className="flex min-h-[44px] cursor-pointer items-start gap-3 rounded-xl border border-charcoal-200 bg-white px-3.5 py-3 text-sm leading-snug text-charcoal-800 hover:border-coral-300">
        <input
          type="checkbox"
          className="mt-0.5 h-5 w-5 shrink-0 accent-coral-500"
          checked={agreed}
          onChange={(e) => setAgreed(e.target.checked)}
          disabled={busy}
        />
        <span>Я ознакомился(-лась) с содержанием договора и подписываю его своей ЭЦП</span>
      </label>

      {egovAvailable && <MethodPicker value={method} onChange={setMethod} disabled={busy} />}

      {useEgov ? (
        <div>
          <EgovSignBox token={token} enabled onSigned={onEgovSigned} disabled={!docReady || !agreed} />
          {(!docReady || !agreed) && (
            <p className="mt-2 text-xs text-charcoal-500">
              {!docReady ? "Документ ещё не готов к подписанию — обратитесь в колледж." : "Отметьте, что ознакомились с договором."}
            </p>
          )}
        </div>
      ) : (
        <>
          <NcaStatus available={ncaAvailable} rechecking={rechecking} onRecheck={recheck} />

          <div>
            <button
              type="button"
              className="btn-primary w-full py-3.5 text-base"
              disabled={disabled}
              aria-describedby={reason ? hintId : undefined}
              onClick={onSign}
            >
              {busy ? <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" /> : <PenLine className="h-5 w-5" aria-hidden="true" />}
              {busy ? "Подписываем…" : "Подписать ЭЦП"}
            </button>
            {busy ? (
              <p className="mt-2 text-xs text-charcoal-500" role="status">
                Откройте окно NCALayer, выберите ключ и введите PIN. Не закрывайте эту страницу.
              </p>
            ) : reason ? (
              <p id={hintId} className="mt-2 text-xs text-charcoal-500">
                {reason}
              </p>
            ) : null}
          </div>

          <SignGuide egovAvailable={egovAvailable} />
        </>
      )}
    </section>
  );
}
