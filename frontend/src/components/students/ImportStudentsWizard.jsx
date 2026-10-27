import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Loader2 } from "lucide-react";
import toast from "react-hot-toast";
import Modal from "../Modal.jsx";
import Stepper from "../Stepper.jsx";
import BulkContractsWizard from "../contracts/BulkContractsWizard.jsx";
import BulkPracticeModal from "./BulkPracticeModal.jsx";
import ImportFileStep from "./ImportFileStep.jsx";
import ImportPreviewStep from "./ImportPreviewStep.jsx";
import ImportDoneStep from "./ImportDoneStep.jsx";
import InlineAlert from "./InlineAlert.jsx";
import { errorText, partnersApi, studentsApi } from "../../api/endpoints.js";
import { plural } from "../../utils/format.js";
import { EMPTY_PRACTICE, cleanPractice, groupLabelOf, groupParamOf, validatePractice } from "./studentUtils.js";

// JSON with sorted keys so two equal override maps compare equal.
function stable(v) {
  if (Array.isArray(v)) return `[${v.map(stable).join(",")}]`;
  if (v && typeof v === "object") {
    return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stable(v[k])}`).join(",")}}`;
  }
  return JSON.stringify(v);
}

/**
 * «Загрузка студентов из Excel»: Файл → Проверка → Готово.
 *
 * The server is stateless — the SAME File and the SAME options go to
 * importPreview and then importCommit, so what the operator confirmed on step 2
 * is exactly what gets written. State lives only while the dialog is open (the
 * body unmounts on close, which resets everything).
 *
 * Props: { open, onClose, onDone(result), initialGroup?, onChanged?() }
 *  - onDone: after the import was committed.
 *  - onChanged: after a follow-up action started from step 3 changed data
 *    (practice assigned / contracts created) — hosts use it to reload.
 */
export default function ImportStudentsWizard(props) {
  if (!props.open) return null;
  return <WizardBody {...props} />;
}

function WizardBody({ onClose, onDone, onChanged, initialGroup }) {
  const navigate = useNavigate();
  const [step, setStep] = useState(1);

  // ── step 1 settings
  const [file, setFile] = useState(null);
  const [scope, setScope] = useState(initialGroup ? "one" : "file");
  const [forceGroup, setForceGroup] = useState(initialGroup || "");
  const [defaultGroup, setDefaultGroup] = useState("");
  const [mode, setMode] = useState("fill");
  const [practiceOpen, setPracticeOpen] = useState(false);
  const [practice, setPractice] = useState({ ...EMPTY_PRACTICE });

  // ── adjustments made while reviewing (sent with preview AND commit)
  const [groupOverrides, setGroupOverrides] = useState({});
  const [columnOverrides, setColumnOverrides] = useState({});
  const [colDraft, setColDraft] = useState({});

  // ── server state
  const [preview, setPreview] = useState(null);
  const [previewOpts, setPreviewOpts] = useState(null);
  const [previewing, setPreviewing] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [error, setError] = useState("");
  const [reviewError, setReviewError] = useState("");
  const [ack, setAck] = useState(false);
  const [result, setResult] = useState(null);
  const [templateBusy, setTemplateBusy] = useState(false);

  // ── step 3
  const [target, setTarget] = useState("");
  const [sub, setSub] = useState(null); // { kind: "practice" | "contracts", group }
  const [followups, setFollowups] = useState({ practice: false, contracts: false });

  // ── dictionaries
  const [groups, setGroups] = useState([]);
  const [partners, setPartners] = useState([]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const g = await studentsApi.groups();
        if (alive) setGroups((g.items || []).map((x) => x.name).filter(Boolean));
      } catch {
        /* the datalist is a convenience — the wizard works without it */
      }
      try {
        const p = await partnersApi.list({ with_stats: 1 });
        if (alive) setPartners(p.items || []);
      } catch {
        /* defaults block just shows an empty partner list */
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const partnerMap = useMemo(() => Object.fromEntries(partners.map((p) => [p.id, p.organization_name])), [partners]);
  const busy = previewing || committing;

  function buildOptions(over = {}) {
    const o = { mode, group_overrides: groupOverrides, column_overrides: columnOverrides, ...over };
    if (scope === "one") o.force_group = forceGroup.trim();
    else if (defaultGroup.trim()) o.default_group = defaultGroup.trim();
    const defaults = cleanPractice(practice);
    if (Object.keys(defaults).length) o.defaults = defaults;
    if (!Object.keys(o.group_overrides).length) delete o.group_overrides;
    if (!Object.keys(o.column_overrides).length) delete o.column_overrides;
    return o;
  }

  async function runPreview(opts, { fromStep1 = false } = {}) {
    if (!file || previewing) return false;
    setPreviewing(true);
    if (fromStep1) setError("");
    else setReviewError("");
    try {
      const data = await studentsApi.importPreview(file, opts);
      setPreview(data);
      setPreviewOpts(opts);
      setAck(false);
      if (fromStep1) {
        setColDraft(columnOverrides);
        setStep(2);
      }
      return true;
    } catch (e) {
      const msg = await errorText(e, "Не удалось прочитать файл");
      if (fromStep1) setError(msg);
      else setReviewError(msg);
      return false;
    } finally {
      setPreviewing(false);
    }
  }

  function onCheckFile() {
    runPreview(buildOptions(), { fromStep1: true });
  }

  function onPickFile(f) {
    // A different file has different sheets: forget everything tied to the old one.
    setFile(f);
    setPreview(null);
    setPreviewOpts(null);
    setGroupOverrides({});
    setColumnOverrides({});
    setColDraft({});
    setError("");
  }

  async function onApplyGroup(sheetName, group) {
    const next = { ...groupOverrides, [sheetName]: group };
    if (await runPreview(buildOptions({ group_overrides: next }))) setGroupOverrides(next);
  }

  function onColumnChange(sheetName, header, key) {
    setColDraft((prev) => {
      const sheet = { ...(prev[sheetName] || {}) };
      const wasApplied = !!columnOverrides[sheetName] && header in columnOverrides[sheetName];
      if (key === "" && !wasApplied) delete sheet[header];
      else sheet[header] = key;
      const next = { ...prev };
      if (Object.keys(sheet).length) next[sheetName] = sheet;
      else delete next[sheetName];
      return next;
    });
  }

  async function onApplyColumns() {
    const cols = colDraft;
    if (await runPreview(buildOptions({ column_overrides: cols }))) setColumnOverrides(cols);
  }

  async function commit() {
    if (committing || previewing || !preview) return;
    const s = preview.summary;
    setCommitting(true);
    setReviewError("");
    try {
      const res = await studentsApi.importCommit(file, previewOpts, { new: s.new, update: s.update });
      setResult(res);
      setTarget((res.groups && res.groups[0]) || "");
      setStep(3);
      onDone?.(res);
    } catch (e) {
      const d = e.response?.data;
      if (e.response?.status === 409 && d?.code === "plan_changed") {
        // The register moved while the operator was reading — show the fresh plan.
        toast.error(d.error || "Данные изменились после проверки. Проверьте результат ещё раз.", { duration: 7000 });
        await runPreview(previewOpts);
      } else {
        setReviewError(await errorText(e, "Не удалось загрузить студентов"));
      }
    } finally {
      setCommitting(false);
    }
  }

  async function downloadTemplate() {
    setTemplateBusy(true);
    try {
      await studentsApi.downloadImportTemplate();
    } catch (e) {
      toast.error(await errorText(e, "Не удалось скачать шаблон"));
    } finally {
      setTemplateBusy(false);
    }
  }

  function requestClose() {
    if (!busy) onClose();
  }

  function openStudents(group) {
    navigate(`/students?group=${encodeURIComponent(groupParamOf(group))}`);
    onClose();
  }

  // ── derived
  const summary = preview?.summary;
  const importable = (summary?.new || 0) + (summary?.update || 0);
  const errorRows = summary?.error || 0;
  const oneGroupMissing = scope === "one" && !forceGroup.trim();
  const practiceInvalid = Object.keys(validatePractice(practice)).length > 0;
  const columnsDirty = stable(colDraft) !== stable(columnOverrides);
  const subGroup = sub ? summary?.groups?.find((g) => g.name === sub.group) : null;
  const subCount = subGroup ? (subGroup.in_db || 0) + (subGroup.new || 0) : undefined;

  const steps = [
    { key: "file", label: "Файл", done: step > 1, active: step === 1 },
    { key: "check", label: "Проверка", done: step > 2, active: step === 2 },
    { key: "done", label: "Готово", done: step === 3, active: step === 3 },
  ];

  let footer = null;
  let footerLeft = null;
  if (step === 1) {
    footer = (
      <>
        <button type="button" className="btn-secondary" onClick={requestClose} disabled={busy}>
          Отмена
        </button>
        <button
          type="button"
          className="btn-primary"
          onClick={onCheckFile}
          disabled={!file || busy || oneGroupMissing || practiceInvalid}
        >
          {previewing && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
          {previewing ? "Проверяем файл…" : "Проверить файл"}
        </button>
      </>
    );
  } else if (step === 2) {
    footerLeft = (
      <button type="button" className="btn-ghost" onClick={() => setStep(1)} disabled={busy}>
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        Назад
      </button>
    );
    footer = (
      <>
        {errorRows > 0 && importable > 0 && (
          <label className="flex w-full cursor-pointer items-start gap-2 text-xs text-charcoal-700 sm:w-auto sm:max-w-xs">
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4 shrink-0 accent-coral-500"
              checked={ack}
              onChange={(e) => setAck(e.target.checked)}
              disabled={busy}
            />
            Понимаю, что {errorRows} {plural(errorRows, "строка", "строки", "строк")} с ошибками будут пропущены
          </label>
        )}
        <button
          type="button"
          className="btn-primary"
          onClick={commit}
          disabled={busy || importable === 0 || (errorRows > 0 && !ack)}
        >
          {committing && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
          {committing
            ? "Загружаем…"
            : `Загрузить ${importable} ${plural(importable, "студента", "студентов", "студентов")}`}
        </button>
      </>
    );
  }

  const description =
    step === 1
      ? "Загрузите списки групп из Excel. Сначала файл проверяется — ничего не сохраняется."
      : step === 2
        ? preview?.filename
        : undefined;

  return (
    <>
      <Modal
        open
        onClose={requestClose}
        title="Загрузка студентов из Excel"
        description={description}
        size="2xl"
        footer={footer}
        footerLeft={footerLeft}
      >
        <Stepper steps={steps} compact className="mb-5" />

        {step === 1 && (
          <ImportFileStep
            file={file}
            onFile={onPickFile}
            onClearFile={() => onPickFile(null)}
            busy={previewing}
            scope={scope}
            onScope={setScope}
            forceGroup={forceGroup}
            onForceGroup={setForceGroup}
            defaultGroup={defaultGroup}
            onDefaultGroup={setDefaultGroup}
            mode={mode}
            onMode={setMode}
            practiceOpen={practiceOpen}
            onPracticeOpen={setPracticeOpen}
            practice={practice}
            onPractice={(patch) => setPractice((p) => ({ ...p, ...patch }))}
            groups={groups}
            partners={partners}
            error={error}
            onDownloadTemplate={downloadTemplate}
            templateBusy={templateBusy}
          />
        )}

        {step === 2 && preview && (
          <div className="space-y-4">
            {reviewError && (
              <InlineAlert tone="red" title="Что-то пошло не так">
                {reviewError}
              </InlineAlert>
            )}
            {importable === 0 && (
              <InlineAlert tone="amber" title="Загружать нечего">
                В файле нет новых студентов и нет изменений для существующих. Вернитесь назад и проверьте файл или режим
                «Если студент уже есть в системе».
              </InlineAlert>
            )}
            <ImportPreviewStep
              preview={preview}
              busy={previewing}
              appliedCols={columnOverrides}
              colDraft={colDraft}
              columnsDirty={columnsDirty}
              onColumnChange={onColumnChange}
              onApplyColumns={onApplyColumns}
              onApplyGroup={onApplyGroup}
              groupNames={groups}
              partnerMap={partnerMap}
            />
          </div>
        )}

        {step === 3 && result && (
          <ImportDoneStep
            result={result}
            target={target}
            onTarget={setTarget}
            followups={followups}
            onPractice={(g) => setSub({ kind: "practice", group: g })}
            onContracts={(g) => setSub({ kind: "contracts", group: g })}
            onStudents={openStudents}
            onClose={onClose}
          />
        )}
      </Modal>

      {/* Follow-ups open ON TOP of the finished wizard, so closing them returns to step 3. */}
      <BulkPracticeModal
        open={sub?.kind === "practice"}
        group={sub?.group}
        groupLabel={sub ? groupLabelOf(sub.group) : undefined}
        count={subCount}
        onClose={() => setSub(null)}
        onDone={() => {
          setFollowups((f) => ({ ...f, practice: true }));
          onChanged?.();
        }}
      />
      <BulkContractsWizard
        open={sub?.kind === "contracts"}
        group={sub?.group}
        groupLabel={sub ? groupLabelOf(sub.group) : undefined}
        onClose={() => setSub(null)}
        onDone={(r) => {
          setFollowups((f) => ({ ...f, contracts: true }));
          onChanged?.(r);
        }}
      />
    </>
  );
}
