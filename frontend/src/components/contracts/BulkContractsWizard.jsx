/**
 * «Оформить договоры на всю группу» — one dialog, three steps:
 *   1 Параметры  → live "dry run" verdict (who will get a contract, who is skipped and why)
 *   2 Оформление → create drafts, generate DOCX/PDF one by one, issue signing links
 *   3 Готово     → summary, failures with retry, Excel of links
 *
 * Props contract (other pages already render it with these):
 *   open, onClose, onDone(result)
 *   studentIds?: number[]      explicit selection, OR
 *   group?: string             a whole group ("" = students without a group)
 *   groupLabel?: string        display name for the header
 * When neither studentIds nor group is given the wizard asks for a group itself.
 *
 * onDone(result) fires when the run finishes (and once more after a later
 * retry / link issue, so a host page that reloads on it always shows the truth):
 *   { created, generated, linksIssued, failed, skipped, cancelled,
 *     contractIds, generatedIds, group }
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Circle, CircleAlert, CircleCheck, ExternalLink, FileSpreadsheet, Link2, Loader2, TriangleAlert } from "lucide-react";
import toast from "react-hot-toast";
import clsx from "clsx";
import Modal from "../Modal.jsx";
import Stepper from "../Stepper.jsx";
import { CheckboxField, SelectField, TextField } from "../Field.jsx";
import { useConfirm } from "../ConfirmDialog.jsx";
import { contractsApi, errorText, partnersApi, signingApi, studentsApi } from "../../api/endpoints.js";
import { plural } from "../../utils/format.js";
import GenerateProgress, { FailureList } from "./GenerateProgress.jsx";
import { inviteInChunks, runGenerateQueue } from "./bulkOps.js";
import { todayLocalISO } from "./contractFlow.js";
import useDebounced from "./useDebounced.js";

const NO_GROUP_KEY = "__none__";

const SKIP_META = {
  no_partner: {
    title: "Не назначено предприятие",
    hint: "Выберите предприятие выше для всех или назначьте его студентам на странице «Группы» / «Студенты».",
  },
  has_contract: {
    title: "Уже есть договор в этом году",
    hint: "Чтобы всё равно создать ещё один, выберите «Создать ещё один» выше.",
  },
  incomplete: {
    title: "Не хватает данных",
    hint: "Заполните недостающее в карточке студента (откроется в новой вкладке) и вернитесь сюда — список обновится.",
  },
};

function freshForm() {
  return { partnerId: "", date: todayLocalISO(), existing: "skip", sendLinks: true, skipIncomplete: true };
}

const EMPTY_RUN = {
  phase: "idle", // idle | create | generate | invite | done | error
  error: "",
  created: [],
  done: 0,
  total: 0,
  current: null,
  failures: [],
  generated: [],
  linksIssued: 0,
  inviteErrors: 0,
  invited: false,
  cancelled: false,
  skipped: 0,
  groupNames: [],
};

function partnerLabel(p) {
  const bits = [];
  if (p.seats_count) {
    bits.push(p.overbooked || p.seats_free === 0 ? "мест нет" : `свободно ${p.seats_free} ${plural(p.seats_free, "место", "места", "мест")}`);
  }
  if (p.validity === "expired") bits.push("срок договора истёк");
  return bits.length ? `${p.organization_name} — ${bits.join(", ")}` : p.organization_name;
}

function Tile({ value, label, tone = "slate" }) {
  const tones = {
    slate: "bg-charcoal-50 ring-charcoal-100 text-charcoal-900",
    emerald: "bg-emerald-50 ring-emerald-200 text-emerald-900",
    amber: "bg-amber-50 ring-amber-200 text-amber-900",
    red: "bg-red-50 ring-red-200 text-red-900",
  };
  return (
    <div className={clsx("rounded-xl px-4 py-3 ring-1", tones[tone])}>
      <div className="text-2xl font-bold tabular-nums leading-none">{value}</div>
      <div className="mt-1.5 text-xs font-medium opacity-80">{label}</div>
    </div>
  );
}

function RadioOption({ checked, onChange, title, text, name }) {
  return (
    <label
      className={clsx(
        "flex min-h-[44px] cursor-pointer items-start gap-2.5 rounded-xl border px-3.5 py-2.5 text-sm transition",
        checked ? "border-coral-400 bg-coral-50/50" : "border-charcoal-200 bg-white hover:border-coral-300",
      )}
    >
      <input type="radio" name={name} className="mt-0.5 h-4 w-4 shrink-0 accent-coral-500" checked={checked} onChange={onChange} />
      <span>
        <span className="font-medium text-charcoal-800">{title}</span>
        {text && <span className="block text-xs text-charcoal-500">{text}</span>}
      </span>
    </label>
  );
}

const PHASE_ORDER = ["create", "generate", "invite"];

/** The three things that happen in step 2, with what is done / running / waiting. */
function PhaseList({ phase, sendLinks, createdCount }) {
  const current = PHASE_ORDER.indexOf(phase);
  const items = [
    { key: "create", label: createdCount > 0 ? `Договоры созданы (${createdCount})` : "Создаём договоры" },
    { key: "generate", label: "Формируем документы (Word и PDF)" },
    ...(sendLinks ? [{ key: "invite", label: "Готовим ссылки на подпись" }] : []),
  ];
  return (
    <ol className="space-y-1.5 text-sm" aria-label="Что происходит">
      {items.map((it) => {
        const i = PHASE_ORDER.indexOf(it.key);
        const state = i < current ? "done" : i === current ? "active" : "todo";
        return (
          <li key={it.key} className={clsx("flex items-center gap-2", state === "todo" ? "text-charcoal-400" : "text-charcoal-800")}>
            {state === "done" && <CircleCheck className="h-4 w-4 text-emerald-500" aria-hidden="true" />}
            {state === "active" && <Loader2 className="h-4 w-4 animate-spin text-coral-500" aria-hidden="true" />}
            {state === "todo" && <Circle className="h-4 w-4" aria-hidden="true" />}
            <span className={state === "active" ? "font-semibold" : undefined}>{it.label}</span>
            <span className="sr-only">{state === "done" ? " — готово" : state === "active" ? " — выполняется" : " — ожидает"}</span>
          </li>
        );
      })}
    </ol>
  );
}

/** Skipped students grouped by the reason code; «incomplete» links to the fix. */
function SkippedGroups({ items }) {
  const groups = useMemo(() => {
    const by = new Map();
    items.forEach((i) => {
      const key = i.code || "other";
      if (!by.has(key)) by.set(key, []);
      by.get(key).push(i);
    });
    return Array.from(by.entries());
  }, [items]);

  if (groups.length === 0) return null;
  return (
    <div className="space-y-3">
      {groups.map(([code, list]) => {
        const meta = SKIP_META[code] || { title: "Пропущены", hint: "" };
        return (
          <details key={code} className="group rounded-xl ring-1 ring-charcoal-200" open={groups.length === 1 || code === "incomplete"}>
            <summary className="flex cursor-pointer list-none items-center gap-2 px-3.5 py-2.5 text-sm font-semibold text-charcoal-800 [&::-webkit-details-marker]:hidden">
              <span className="badge bg-amber-100 text-amber-800 tabular-nums">{list.length}</span>
              <span className="min-w-0 flex-1">{meta.title}</span>
              <span className="text-xs font-normal text-charcoal-500 group-open:hidden">показать</span>
              <span className="hidden text-xs font-normal text-charcoal-500 group-open:inline">скрыть</span>
            </summary>
            <div className="border-t border-charcoal-100 px-3.5 pb-3 pt-2">
              {meta.hint && <p className="mb-2 text-xs text-charcoal-500">{meta.hint}</p>}
              <ul className="max-h-56 divide-y divide-charcoal-100 overflow-y-auto">
                {list.map((i) => (
                  <li key={i.student_id} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 py-1.5 text-sm">
                    <span className="font-medium text-charcoal-800">{i.full_name}</span>
                    {i.group_name && <span className="text-xs text-charcoal-500">{i.group_name}</span>}
                    {code === "incomplete" && (
                      <>
                        <span className="min-w-0 flex-1 text-xs text-red-700">{(i.missing || []).join(", ")}</span>
                        <a
                          href={`/students?edit=${i.student_id}`}
                          target="_blank"
                          rel="noreferrer"
                          className="link inline-flex items-center gap-1 text-xs font-semibold"
                        >
                          Исправить
                          <ExternalLink className="h-3 w-3" aria-hidden="true" />
                        </a>
                      </>
                    )}
                    {code === "has_contract" && i.number && <span className="text-xs text-charcoal-500">№ {i.number}</span>}
                  </li>
                ))}
              </ul>
            </div>
          </details>
        );
      })}
    </div>
  );
}

export default function BulkContractsWizard({ open, onClose, onDone, studentIds, group, groupLabel }) {
  const navigate = useNavigate();
  const confirm = useConfirm();

  const hasIds = Array.isArray(studentIds) && studentIds.length > 0;
  const hasGroupProp = group !== undefined && group !== null;
  const needsPicker = !hasIds && !hasGroupProp;

  const [step, setStep] = useState(1);
  const [form, setForm] = useState(freshForm);
  const [partners, setPartners] = useState([]);
  const [groups, setGroups] = useState(null); // null = loading
  const [pickedKey, setPickedKey] = useState("");

  const [preview, setPreview] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState("");
  const [ownPartners, setOwnPartners] = useState(null); // students that have their own partner (partner "" run)

  const [run, setRun] = useState(EMPTY_RUN);
  const [retrying, setRetrying] = useState(null); // {done,total,current} while retrying
  const [busy, setBusy] = useState("");
  // The host may clear its selection from onDone; keep the title that was shown when the run started.
  const [lockedLabel, setLockedLabel] = useState("");
  const stopRef = useRef(false);
  const runRef = useRef(EMPTY_RUN);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  const updateRun = useCallback((patch) => {
    runRef.current = typeof patch === "function" ? patch(runRef.current) : { ...runRef.current, ...patch };
    setRun(runRef.current);
  }, []);

  // ── selection source ────────────────────────────────────────────────────────
  const effectiveGroup = hasGroupProp ? group : pickedKey === "" ? null : pickedKey === NO_GROUP_KEY ? "" : pickedKey;
  const source = useMemo(() => {
    if (hasIds) return { student_ids: studentIds };
    if (effectiveGroup !== null) return { group: effectiveGroup };
    return null;
  }, [hasIds, studentIds, effectiveGroup]);
  const sourceKey = source ? JSON.stringify(source) : "";

  const isRunning = step === 2 && ["create", "generate", "invite"].includes(run.phase);

  // ── open / reset ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!open) return undefined;
    let cancelled = false;
    setStep(1);
    setForm(freshForm());
    setPickedKey("");
    setPreview(null);
    setPreviewError("");
    setOwnPartners(null);
    setRetrying(null);
    setBusy("");
    setLockedLabel("");
    stopRef.current = false;
    runRef.current = EMPTY_RUN;
    setRun(EMPTY_RUN);

    partnersApi
      .list({ with_stats: 1 })
      .then((r) => {
        if (!cancelled) setPartners((r.items || []).slice().sort((a, b) => a.organization_name.localeCompare(b.organization_name, "ru")));
      })
      .catch(async (e) => {
        if (!cancelled) toast.error(await errorText(e, "Не удалось загрузить список предприятий"));
      });

    if (needsPicker) {
      setGroups(null);
      studentsApi
        .groups()
        .then((r) => {
          if (!cancelled) setGroups(r.items || []);
        })
        .catch(async (e) => {
          if (!cancelled) {
            setGroups([]);
            toast.error(await errorText(e, "Не удалось загрузить список групп"));
          }
        });
    }
    return () => {
      cancelled = true;
    };
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── live dry run (step 1) ───────────────────────────────────────────────────
  const debouncedForm = useDebounced(form, 350);
  useEffect(() => {
    if (!open || !sourceKey) {
      setPreview(null);
      return undefined;
    }
    if (step !== 1) return undefined;
    let cancelled = false;
    setPreviewLoading(true);
    contractsApi
      .bulk({
        ...JSON.parse(sourceKey),
        ...(debouncedForm.partnerId ? { partner_id: Number(debouncedForm.partnerId) } : {}),
        ...(debouncedForm.date ? { contract_date: debouncedForm.date } : {}),
        existing: debouncedForm.existing,
        skip_incomplete: debouncedForm.skipIncomplete,
        dry_run: true,
      })
      .then((res) => {
        if (cancelled) return;
        setPreview(res);
        setPreviewError("");
        if (!debouncedForm.partnerId) {
          setOwnPartners({ withPartner: (res.items || []).filter((i) => i.partner_id).length, total: (res.items || []).length });
        }
      })
      .catch(async (e) => {
        if (cancelled) return;
        setPreview(null);
        setPreviewError(await errorText(e, "Не удалось проверить список студентов"));
      })
      .finally(() => {
        if (!cancelled) setPreviewLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, step, sourceKey, debouncedForm]);

  // Do not lose a running batch by accident (reload / closing the tab).
  useEffect(() => {
    if (!isRunning) return undefined;
    const warn = (e) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [isRunning]);

  const setF = (patch) => setForm((f) => ({ ...f, ...patch }));

  // ── derived header text ─────────────────────────────────────────────────────
  const pickedGroup = groups && pickedKey ? groups.find((g) => (g.name || NO_GROUP_KEY) === pickedKey) : null;
  const headerLabel = hasIds
    ? groupLabel || `выбранные студенты (${studentIds.length})`
    : hasGroupProp
    ? groupLabel || (group === "" ? "студенты без группы" : group)
    : pickedGroup
    ? pickedGroup.name || "студенты без группы"
    : "";

  const willCreate = preview?.will_create ?? 0;
  // The verdict on screen lags the form by the debounce; do not start on a stale one.
  const settling = form !== debouncedForm;
  const skippedItems = useMemo(() => (preview?.items || []).filter((i) => i.action === "skip"), [preview]);
  const noOwnPartner = ownPartners && ownPartners.total > 0 && ownPartners.withPartner === 0;

  // ── step 2: the run ─────────────────────────────────────────────────────────
  async function startRun() {
    if (!source || willCreate === 0) return;
    stopRef.current = false;
    setLockedLabel(headerLabel);
    setStep(2);
    setRetrying(null);
    updateRun({ ...EMPTY_RUN, phase: "create" });
    const f = form;

    let created = [];
    let skipped = 0;
    let groupNames = [];
    try {
      const res = await contractsApi.bulk({
        ...source,
        ...(f.partnerId ? { partner_id: Number(f.partnerId) } : {}),
        ...(f.date ? { contract_date: f.date } : {}),
        existing: f.existing,
        skip_incomplete: f.skipIncomplete,
        dry_run: false,
      });
      created = (res.items || [])
        .filter((i) => i.contract_id)
        .map((i) => ({ id: i.contract_id, number: i.number, name: i.full_name }));
      skipped = res.skipped || 0;
      groupNames = [...new Set((res.items || []).filter((i) => i.contract_id).map((i) => i.group_name || ""))];
    } catch (e) {
      updateRun({ phase: "error", error: await errorText(e, "Не удалось создать договоры") });
      return;
    }

    updateRun({ phase: "generate", created, total: created.length, done: 0, current: created[0] || null, skipped, groupNames });
    const g = await runGenerateQueue(created, {
      shouldStop: () => stopRef.current,
      onProgress: (p) => updateRun({ done: p.done, total: p.total, current: p.current, failures: p.failures }),
    });
    updateRun({ generated: g.generated, failures: g.failures, cancelled: g.cancelled, current: null });

    let linksIssued = 0;
    let inviteErrors = 0;
    let invited = false;
    if (f.sendLinks && g.generated.length > 0 && !g.cancelled) {
      updateRun({ phase: "invite" });
      const inv = await inviteInChunks(g.generated.map((x) => x.id));
      linksIssued = inv.new_links;
      inviteErrors = inv.errors.length;
      invited = inviteErrors === 0;
    }
    finish({ linksIssued, inviteErrors, invited });
  }

  function buildResult(r) {
    return {
      created: r.created.length,
      generated: r.generated.length,
      linksIssued: r.linksIssued,
      failed: r.failures.length,
      skipped: r.skipped,
      cancelled: r.cancelled,
      contractIds: r.created.map((c) => c.id),
      generatedIds: r.generated.map((c) => c.id),
      group: hasGroupProp ? group : effectiveGroup,
    };
  }

  function finish(patch) {
    updateRun({ ...patch, phase: "done" });
    setStep(3);
    if (runRef.current.created.length > 0) onDoneRef.current?.(buildResult(runRef.current));
  }

  // ── step 3 actions ──────────────────────────────────────────────────────────
  async function retryFailed() {
    const items = runRef.current.failures.map((f) => ({ id: f.id, number: f.number, name: f.name }));
    if (items.length === 0) return;
    stopRef.current = false;
    setBusy("retry");
    setRetrying({ done: 0, total: items.length, current: items[0] });
    const g = await runGenerateQueue(items, {
      shouldStop: () => false,
      onProgress: (p) => setRetrying({ done: p.done, total: p.total, current: p.current }),
    });
    setRetrying(null);
    setBusy("");
    updateRun((r) => ({
      ...r,
      generated: [...r.generated, ...g.generated],
      failures: g.failures,
      cancelled: false,
      // Newly generated contracts have no links yet.
      invited: g.generated.length > 0 ? false : r.invited,
    }));
    onDoneRef.current?.(buildResult(runRef.current));
    if (g.failures.length === 0) toast.success("Все договоры сформированы");
  }

  async function issueLinks() {
    const ids = runRef.current.generated.map((x) => x.id);
    if (ids.length === 0) return;
    setBusy("links");
    try {
      const inv = await inviteInChunks(ids);
      updateRun((r) => ({
        ...r,
        linksIssued: r.linksIssued + inv.new_links,
        inviteErrors: inv.errors.length,
        invited: inv.errors.length === 0,
      }));
      if (inv.errors.length) toast.error(inv.errors[0]);
      else toast.success(inv.new_links ? `Создано ссылок: ${inv.new_links}` : "Ссылки уже были выданы");
      onDoneRef.current?.(buildResult(runRef.current));
    } finally {
      setBusy("");
    }
  }

  async function exportLinks() {
    setBusy("export");
    try {
      await signingApi.exportLinks(runRef.current.generated.map((x) => x.id));
    } catch (e) {
      toast.error(await errorText(e, "Не удалось скачать ссылки"));
    } finally {
      setBusy("");
    }
  }

  function openGroupContracts() {
    let url = "/contracts";
    const g = hasGroupProp ? group : effectiveGroup;
    if (g === "") url = "/contracts?group=__none__";
    else if (g) url = `/contracts?group=${encodeURIComponent(g)}`;
    else if (runRef.current.groupNames.length === 1) {
      const only = runRef.current.groupNames[0];
      url = only ? `/contracts?group=${encodeURIComponent(only)}` : "/contracts?group=__none__";
    }
    onClose?.();
    navigate(url);
  }

  async function requestClose() {
    if (isRunning) {
      if (run.phase !== "generate") {
        toast("Подождите, это займёт несколько секунд…");
        return;
      }
      const ok = await confirm({
        title: "Прервать оформление?",
        message:
          "Уже созданные договоры сохранятся. Текущий договор будет дособран, затем покажем итоги — остальные можно сформировать позже из списка договоров.",
        confirmText: "Прервать",
        cancelText: "Продолжить",
        tone: "danger",
      });
      if (ok) stopRef.current = true;
      return;
    }
    onClose?.();
  }

  // ── render ──────────────────────────────────────────────────────────────────
  const steps = [
    { key: "params", label: "Параметры", done: step > 1, active: step === 1 },
    { key: "run", label: "Оформление", done: step > 2, active: step === 2 },
    { key: "done", label: "Готово", done: step === 3, active: false },
  ];

  let footer;
  if (step === 1) {
    footer = (
      <>
        <button type="button" className="btn-secondary" onClick={requestClose}>
          Отмена
        </button>
        <button type="button" className="btn-primary" onClick={startRun} disabled={!source || previewLoading || settling || willCreate === 0 || !form.date}>
          {willCreate > 0 ? `Оформить ${willCreate} ${plural(willCreate, "договор", "договора", "договоров")}` : "Оформить договоры"}
        </button>
      </>
    );
  } else if (step === 2) {
    footer =
      run.phase === "error" ? (
        <button type="button" className="btn-secondary" onClick={() => setStep(1)}>
          Назад к параметрам
        </button>
      ) : (
        <button type="button" className="btn-secondary" onClick={requestClose} disabled={run.phase !== "generate"}>
          {run.phase === "generate" ? "Остановить" : "Подождите…"}
        </button>
      );
  } else {
    footer = (
      <>
        <button type="button" className="btn-secondary" onClick={openGroupContracts}>
          {hasGroupProp || effectiveGroup !== null ? "Открыть договоры группы" : "Открыть договоры"}
        </button>
        <button type="button" className="btn-primary" onClick={onClose} data-autofocus>
          Закрыть
        </button>
      </>
    );
  }

  const partnerOptions = partners.map((p) => ({ value: p.id, label: partnerLabel(p) }));

  return (
    <Modal
      open={open}
      onClose={requestClose}
      title={(step > 1 && lockedLabel) || headerLabel ? `Оформить договоры — ${step > 1 && lockedLabel ? lockedLabel : headerLabel}` : "Оформить договоры на группу"}
      description="Создадим договоры, сформируем документы и подготовим ссылки на подпись."
      size="xl"
      footer={footer}
    >
      <div className="space-y-5">
        <Stepper steps={steps} compact />

        {/* ───────────── Step 1 ───────────── */}
        {step === 1 && (
          <div className="space-y-5">
            {needsPicker && (
              <div>
                <SelectField
                  label="Для какой группы"
                  required
                  value={pickedKey}
                  onChange={setPickedKey}
                  placeholder={groups === null ? "Загружаем группы…" : "— выберите группу —"}
                  options={(groups || []).map((g) => ({
                    value: g.name || NO_GROUP_KEY,
                    label: `${g.name || "Без группы"} — ${g.students} ${plural(g.students, "студент", "студента", "студентов")}`,
                  }))}
                />
                {pickedGroup && (
                  <p className="mt-1.5 text-xs text-charcoal-500">
                    С предприятием: {pickedGroup.with_partner} из {pickedGroup.students} · уже есть договор: {pickedGroup.contracts} · без договора:{" "}
                    {pickedGroup.without_contract}
                  </p>
                )}
                {groups && groups.length === 0 && (
                  <p className="mt-1.5 text-xs text-charcoal-500">Групп пока нет — сначала загрузите список студентов на странице «Группы».</p>
                )}
              </div>
            )}

            {source && (
              <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
                <div className="space-y-4">
                  <div>
                    <SelectField
                      label="Предприятие"
                      value={form.partnerId}
                      onChange={(v) => setF({ partnerId: v })}
                      placeholder="Предприятие каждого студента (из карточки)"
                      options={partnerOptions}
                      hint={
                        noOwnPartner && !form.partnerId
                          ? "Ни у одного студента предприятие не назначено — выберите его в списке."
                          : ownPartners && !form.partnerId
                          ? `В карточке предприятие назначено у ${ownPartners.withPartner} из ${ownPartners.total}. Или выберите одно для всех.`
                          : "Одно предприятие для всех студентов. Чтобы взять предприятие из карточки каждого, выберите первый пункт списка."
                      }
                    />
                  </div>
                  <TextField label="Дата договора" type="date" required value={form.date} onChange={(v) => setF({ date: v })} error={!form.date ? "Укажите дату" : undefined} />
                  <div>
                    <div className="label">Если у студента уже есть договор в этом году</div>
                    <div className="space-y-2" role="radiogroup" aria-label="Если у студента уже есть договор в этом году">
                      <RadioOption name="existing" checked={form.existing === "skip"} onChange={() => setF({ existing: "skip" })} title="Пропустить" text="Повторов не будет" />
                      <RadioOption name="existing" checked={form.existing === "allow"} onChange={() => setF({ existing: "allow" })} title="Создать ещё один" />
                    </div>
                  </div>
                  <CheckboxField
                    label="После оформления"
                    checked={form.sendLinks}
                    onChange={(v) => setF({ sendLinks: v })}
                    text="Сразу подготовить ссылки на подпись предприятию и студенту"
                    hint="Ссылки создаются автоматически, но рассылаете их вы (WhatsApp, почта) или скачиваете Excel."
                  />
                  <CheckboxField
                    label="Неполные данные"
                    checked={form.skipIncomplete}
                    onChange={(v) => setF({ skipIncomplete: v })}
                    text="Пропускать студентов с неполными данными"
                    hint="Иначе договор создастся, но сформировать его не получится, пока данные не заполнены."
                  />
                </div>

                {/* live verdict */}
                <div aria-live="polite" className="min-w-0 space-y-3">
                  {previewError && (
                    <div className="flex gap-2 rounded-xl bg-red-50 px-3.5 py-3 text-sm text-red-800 ring-1 ring-red-200" role="alert">
                      <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                      {previewError}
                    </div>
                  )}
                  <div className={clsx("grid grid-cols-2 gap-3 transition-opacity", previewLoading && "opacity-50")}>
                    <Tile value={preview ? preview.will_create : "…"} label="Будет создано договоров" tone={willCreate > 0 ? "emerald" : "slate"} />
                    <Tile value={preview ? preview.skipped : "…"} label="Будет пропущено студентов" tone={preview?.skipped > 0 ? "amber" : "slate"} />
                  </div>
                  {previewLoading && <p className="text-xs text-charcoal-500">Проверяем список…</p>}

                  {(preview?.warnings || []).length > 0 && (
                    <ul className="space-y-1.5">
                      {preview.warnings.map((w, i) => (
                        <li key={`${w.code}-${w.partner_id}-${i}`} className="flex gap-2 rounded-xl bg-amber-50 px-3.5 py-2.5 text-sm text-amber-900 ring-1 ring-amber-200">
                          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                          {w.message}
                        </li>
                      ))}
                    </ul>
                  )}

                  {preview && willCreate === 0 && (
                    <p className="text-sm text-charcoal-600">
                      Некого оформлять: {preview.skipped > 0 ? "все студенты пропущены — причины ниже." : "в списке нет студентов."}
                    </p>
                  )}

                  <SkippedGroups items={skippedItems} />
                </div>
              </div>
            )}
          </div>
        )}

        {/* ───────────── Step 2 ───────────── */}
        {step === 2 && (
          <div className="space-y-4">
            {run.phase === "error" && (
              <div className="flex gap-2 rounded-xl bg-red-50 px-3.5 py-3 text-sm text-red-800 ring-1 ring-red-200" role="alert">
                <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                <div>
                  <div className="font-semibold">Договоры не созданы</div>
                  <div>{run.error}</div>
                </div>
              </div>
            )}
            {run.phase !== "error" && <PhaseList phase={run.phase} sendLinks={form.sendLinks} createdCount={run.created.length} />}
            {(run.phase === "generate" || run.phase === "invite") && (
              <>
                <p className="text-sm text-charcoal-600">Окно нужно держать открытым: каждый документ собирается несколько секунд.</p>
                <GenerateProgress done={run.done} total={run.total} current={run.current} failures={run.failures} running={run.phase === "generate"} />
              </>
            )}
          </div>
        )}

        {/* ───────────── Step 3 ───────────── */}
        {step === 3 && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
              <Tile value={run.created.length} label="Договоров создано" tone="emerald" />
              <Tile value={run.generated.length} label="Документов сформировано" tone={run.generated.length ? "emerald" : "slate"} />
              <Tile value={run.linksIssued} label="Ссылок на подпись выпущено" tone={run.linksIssued ? "emerald" : "slate"} />
              <Tile value={run.failures.length} label="Ошибок" tone={run.failures.length ? "red" : "slate"} />
              <Tile value={run.skipped} label="Студентов пропущено" tone={run.skipped ? "amber" : "slate"} />
            </div>

            {run.cancelled && (
              <div className="flex gap-2 rounded-xl bg-amber-50 px-3.5 py-3 text-sm text-amber-900 ring-1 ring-amber-200">
                <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                Оформление остановлено вручную. Оставшиеся договоры созданы как черновики — сформировать их можно в списке договоров.
              </div>
            )}
            {run.created.length === 0 && (
              <div className="flex gap-2 rounded-xl bg-amber-50 px-3.5 py-3 text-sm text-amber-900 ring-1 ring-amber-200">
                <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                Ни один договор не создан — список студентов изменился. Закройте окно и откройте его снова, чтобы проверить параметры.
              </div>
            )}
            {!run.cancelled && run.failures.length === 0 && run.created.length > 0 && (
              <div className="flex gap-2 rounded-xl bg-emerald-50 px-3.5 py-3 text-sm text-emerald-900 ring-1 ring-emerald-200">
                <CircleCheck className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                Всё готово: договоры созданы и документы сформированы.
              </div>
            )}

            {retrying ? (
              <GenerateProgress title="Повторное формирование" done={retrying.done} total={retrying.total} current={retrying.current} failures={[]} running />
            ) : (
              run.failures.length > 0 && (
                <div className="space-y-2">
                  <FailureList failures={run.failures} />
                  <button type="button" className="btn-secondary" onClick={retryFailed} disabled={!!busy}>
                    Повторить для {run.failures.length} {plural(run.failures.length, "договора", "договоров", "договоров")}
                  </button>
                </div>
              )
            )}

            {run.generated.length > 0 && !run.invited && (
              <div className="rounded-xl bg-blue-50 px-3.5 py-3 text-sm text-blue-900 ring-1 ring-blue-100">
                <div className="font-semibold">
                  {run.inviteErrors > 0 ? "Не все ссылки на подпись удалось подготовить" : "Ссылки на подпись ещё не подготовлены"}
                </div>
                <p className="mt-0.5 text-xs">
                  Подготовьте ссылки предприятию и студенту — потом скачаете их в Excel или откроете в списке договоров.
                </p>
                <button type="button" className="btn-primary btn-sm max-sm:min-h-[44px] mt-2" onClick={issueLinks} disabled={!!busy}>
                  <Link2 className="h-4 w-4" aria-hidden="true" />
                  {busy === "links" ? "Готовим…" : `Подготовить ссылки (${run.generated.length})`}
                </button>
              </div>
            )}

            {run.generated.length > 0 && (
              <div className="flex flex-wrap items-center gap-2">
                <button type="button" className="btn-secondary" onClick={exportLinks} disabled={!!busy || (run.linksIssued === 0 && !run.invited)}>
                  <FileSpreadsheet className="h-4 w-4" aria-hidden="true" />
                  {busy === "export" ? "Готовим файл…" : "Скачать ссылки на подпись (Excel)"}
                </button>
                <span className="text-xs text-charcoal-500">В файле — ссылки и готовые тексты сообщений для рассылки.</span>
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
