import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  CircleAlert,
  CircleCheck,
  Clock,
  Download,
  Eye,
  FileText,
  FileUp,
  Fingerprint,
  Hash,
  KeyRound,
  ListChecks,
  Pencil,
  RefreshCw,
  Save,
  ShieldCheck,
  Trash2,
  TriangleAlert,
  UserRound,
  ExternalLink,
  ScrollText,
  Signature,
  Settings2,
} from "lucide-react";
import toast from "react-hot-toast";
import clsx from "clsx";
import PageHeader from "../components/PageHeader.jsx";
import SectionCard from "../components/SectionCard.jsx";
import StatusBadge from "../components/StatusBadge.jsx";
import Stepper from "../components/Stepper.jsx";
import EmptyState from "../components/EmptyState.jsx";
import FileDropzone from "../components/FileDropzone.jsx";
import CopyButton from "../components/CopyButton.jsx";
import VerificationBadge from "../components/VerificationBadge.jsx";
import SignChannelBadge from "../components/SignChannelBadge.jsx";
import { CardSkeleton } from "../components/Skeleton.jsx";
import { TextArea, TextField } from "../components/Field.jsx";
import { useConfirm } from "../components/ConfirmDialog.jsx";
import MenuButton from "../components/contracts/MenuButton.jsx";
import NextStepCard from "../components/contracts/NextStepCard.jsx";
import ReadinessChecklist from "../components/contracts/ReadinessChecklist.jsx";
import SigningParties from "../components/contracts/SigningParties.jsx";
import ShareLinkModal from "../components/contracts/ShareLinkModal.jsx";
import BulkLinksModal from "../components/contracts/BulkLinksModal.jsx";
import DocumentPreviewModal from "../components/contracts/DocumentPreviewModal.jsx";
import { generateInteractive } from "../components/contracts/bulkOps.js";
import {
  ALLOWED_STATUS_TRANSITIONS,
  ROLES,
  ROLE_TITLE,
  fmtDate,
  fmtDateTime,
  statusMoveLabel,
} from "../components/contracts/contractFlow.js";
import { contractsApi, errorText, signingApi } from "../api/endpoints.js";
import { formatDate } from "../utils/format.js";
import { signBase64WithNCALayer, pingNCALayer } from "../utils/ncalayer.js";
import { useAuth } from "../context/AuthContext.jsx";

// ── small presentational pieces (module level on purpose: never inside render) ──

function InfoRow({ label, children }) {
  return (
    <div className="min-w-0">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-charcoal-400">{label}</div>
      <div className="break-words font-medium text-charcoal-800">{children || "—"}</div>
    </div>
  );
}

function NCABadge({ available }) {
  if (available === null) {
    return <div className="rounded-xl bg-charcoal-50 px-3 py-2 text-xs text-charcoal-600">Проверяем NCALayer…</div>;
  }
  if (available) {
    return (
      <div className="flex items-center gap-1.5 rounded-xl bg-emerald-50 px-3 py-2 text-xs text-emerald-700 ring-1 ring-emerald-100">
        <CircleCheck className="h-4 w-4 shrink-0" aria-hidden="true" />
        NCALayer запущен — подписывать можно
      </div>
    );
  }
  return (
    <div className="flex gap-1.5 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-800 ring-1 ring-amber-100">
      <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <span>
        NCALayer не найден. Запустите приложение NCALayer; если оно уже запущено, откройте{" "}
        <a className="link" href="https://127.0.0.1:13579" target="_blank" rel="noreferrer">
          https://127.0.0.1:13579
        </a>{" "}
        и подтвердите сертификат. Проверка повторяется автоматически.
      </span>
    </div>
  );
}

function SignatureCard({ role, sig }) {
  return (
    <div className={clsx("rounded-xl border p-3", sig ? "border-emerald-200 bg-emerald-50/40" : "border-charcoal-100")}>
      <div className="flex items-center justify-between gap-2">
        <div className="text-sm font-semibold text-charcoal-800">{ROLE_TITLE[role]}</div>
        {sig ? (
          <span className="badge bg-emerald-100 text-emerald-700">
            <CircleCheck className="h-3.5 w-3.5" aria-hidden="true" />
            Подписано
          </span>
        ) : (
          <span className="badge bg-charcoal-100 text-charcoal-600">Не подписано</span>
        )}
      </div>
      {sig && (
        <dl className="mt-2 space-y-1.5 text-xs text-charcoal-600">
          <div className="flex flex-wrap gap-1.5">
            <VerificationBadge level={sig.verification_level} className="!text-[10px]" />
            <SignChannelBadge channel={sig.channel} payloadFormat={sig.payload_format} className="!text-[10px]" />
          </div>
          <div className="flex items-start gap-1.5">
            <UserRound className="mt-0.5 h-3.5 w-3.5 shrink-0 text-charcoal-400" aria-hidden="true" />
            <span className="min-w-0 break-words">{sig.signer_full_name || "—"}</span>
          </div>
          <div className="flex items-start gap-1.5">
            <Fingerprint className="mt-0.5 h-3.5 w-3.5 shrink-0 text-charcoal-400" aria-hidden="true" />
            <span className="min-w-0 break-all">ИИН/БИН: {sig.signer_iin_or_bin || "—"}</span>
          </div>
          <div className="flex items-start gap-1.5">
            <KeyRound className="mt-0.5 h-3.5 w-3.5 shrink-0 text-charcoal-400" aria-hidden="true" />
            <span className="min-w-0 break-all">Серийный номер: {sig.signer_serial || "—"}</span>
          </div>
          <div className="flex items-start gap-1.5">
            <Clock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-charcoal-400" aria-hidden="true" />
            <span>{fmtDateTime(sig.created_at)}</span>
          </div>
          <div className="flex items-start gap-1.5">
            <Hash className="mt-0.5 h-3.5 w-3.5 shrink-0 text-charcoal-400" aria-hidden="true" />
            <span className="min-w-0 break-all font-mono text-[10px] text-charcoal-500" title={sig.signed_payload_sha256}>
              SHA-256: {sig.signed_payload_sha256?.slice(0, 24)}…
            </span>
          </div>
        </dl>
      )}
    </div>
  );
}

/**
 * Workflow stepper data. Derived from `signatures` + `status` + `invited_roles`
 * (everything a viewer also receives) — NOT from the admin-only signing
 * requests, otherwise a viewer would see a fully signed contract as unsigned.
 */
function buildSteps(contract) {
  const hasFile = !!contract.docx_path;
  const sigRoles = new Set((contract.signatures || []).map((s) => s.signer_role));
  const allSigned = ROLES.every((r) => sigRoles.has(r)) || contract.status === "signed";
  const wasSent =
    (contract.invited_roles || []).length > 0 ||
    sigRoles.size > 0 ||
    ["sent", "signed", "scan_uploaded", "completed"].includes(contract.status);
  const hasScan = !!contract.signed_scan_path;
  const isCompleted = contract.status === "completed";

  const steps = [
    { key: "draft", label: "Создан", done: true },
    { key: "generated", label: "Сформирован", done: hasFile },
    { key: "sent", label: "Ссылки выданы", done: wasSent || allSigned || hasScan || isCompleted },
    {
      key: "signed",
      label: "Подписан всеми",
      done: allSigned || hasScan || isCompleted,
      description: sigRoles.size > 0 && !allSigned ? `${sigRoles.size} из 3 подписей` : undefined,
    },
    { key: "scan", label: "Скан загружен", done: hasScan || isCompleted, description: "необязательно" },
    { key: "completed", label: "Завершён", done: isCompleted },
  ];
  // Exactly one "current" step: the first one that is not done yet.
  const firstPending = steps.find((s) => !s.done);
  return steps.map((s) => ({ ...s, active: s === firstPending }));
}

export default function ContractDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { isAdmin } = useAuth();
  const confirm = useConfirm();
  // `navigate` changes identity with the location; keep it out of the loader's deps.
  const navRef = useRef(navigate);
  navRef.current = navigate;

  const [contract, setContract] = useState(null);
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [busyKey, setBusyKey] = useState("");
  const [ncaAvailable, setNcaAvailable] = useState(null);
  const [share, setShare] = useState(null);
  const [linksResult, setLinksResult] = useState(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [scanFile, setScanFile] = useState(null);
  const [notesDraft, setNotesDraft] = useState("");
  const [dateDraft, setDateDraft] = useState("");

  // ── loading ─────────────────────────────────────────────────────────────────
  const load = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      setLoadError("");
      try {
        const { item } = await contractsApi.get(id);
        setContract(item);
        if (isAdmin) {
          try {
            const r = await signingApi.listRequests(id);
            setRequests(r.items || []);
          } catch (e) {
            setRequests([]);
            toast.error(await errorText(e, "Не удалось загрузить ссылки на подпись"));
          }
        }
      } catch (e) {
        if (e.response?.status === 404) {
          toast.error("Договор не найден");
          navRef.current("/contracts", { replace: true });
          return;
        }
        setLoadError(await errorText(e, "Не удалось загрузить договор"));
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [id, isAdmin],
  );

  useEffect(() => {
    setContract(null);
    setRequests([]);
    setScanFile(null);
    load();
  }, [load]);

  // Edit drafts follow the saved values.
  useEffect(() => {
    if (!contract) return;
    setNotesDraft(contract.notes || "");
    setDateDraft(contract.contract_date || "");
  }, [contract?.id, contract?.notes, contract?.contract_date]); // eslint-disable-line react-hooks/exhaustive-deps

  // NCALayer probe: keeps retrying every 5 s until it answers. Only the admin signs.
  useEffect(() => {
    if (!isAdmin) return undefined;
    let cancelled = false;
    let t = null;
    const probe = async () => {
      const ok = await pingNCALayer();
      if (cancelled) return;
      setNcaAvailable(ok);
      if (!ok) t = setTimeout(probe, 5000);
    };
    probe();
    return () => {
      cancelled = true;
      if (t) clearTimeout(t);
    };
  }, [isAdmin]);

  // ── actions ─────────────────────────────────────────────────────────────────
  const busy = !!busyKey;

  async function runGenerate() {
    setBusyKey("generate");
    try {
      const res = await generateInteractive(id, { confirm });
      if (res.ok) {
        toast.success(contract?.docx_path ? "Договор пересформирован" : "Договор сформирован");
        await load(true);
      }
    } finally {
      setBusyKey("");
    }
  }

  async function invite(roles) {
    setBusyKey("invite");
    try {
      const data = await signingApi.invite(id, { roles });
      const created = data.items || [];
      if (created.length === 0) {
        toast("Активные ссылки уже есть — они в блоке «Подписи сторон».");
      } else {
        setLinksResult({
          new_links: created.length,
          items: [
            {
              contract_id: contract.id,
              number: contract.number,
              student_name: contract.student_name,
              group_name: contract.student_group,
              status: "ok",
              links: created.map((l) => ({ ...l, is_new: true })),
            },
          ],
        });
      }
      await load(true);
    } catch (e) {
      toast.error(await errorText(e, "Не удалось создать ссылки"));
    } finally {
      setBusyKey("");
    }
  }

  async function setStatus(status) {
    if (status === "completed" && (contract.signed_roles || []).length < ROLES.length) {
      const ok = await confirm({
        title: "Завершить без всех подписей?",
        message: `Подписали ${(contract.signed_roles || []).length} из 3 сторон. Завершить договор всё равно?`,
        confirmText: "Завершить",
        tone: "danger",
      });
      if (!ok) return;
    }
    setBusyKey("status");
    try {
      const { item } = await contractsApi.update(id, { status });
      setContract(item);
      toast.success("Статус обновлён");
    } catch (e) {
      toast.error(await errorText(e, "Не удалось изменить статус"));
    } finally {
      setBusyKey("");
    }
  }

  async function extend(req) {
    setBusyKey("extend");
    try {
      const { item } = await signingApi.extend(req.id, 30);
      toast.success(`Ссылка продлена до ${fmtDate(item.expires_at)}. Адрес остался прежним.`);
      await load(true);
    } catch (e) {
      toast.error(await errorText(e, "Не удалось продлить ссылку"));
    } finally {
      setBusyKey("");
    }
  }

  async function resend(req) {
    const ok = await confirm({
      title: "Выпустить новую ссылку?",
      message: `Прежняя ссылка для «${ROLE_TITLE[req.signer_role]}» перестанет работать. Новую ссылку нужно отправить получателю заново.`,
      confirmText: "Выпустить новую",
    });
    if (!ok) return;
    setBusyKey("resend");
    try {
      const { item } = await signingApi.resend(req.id);
      toast.success("Новая ссылка готова");
      setShare(item);
      await load(true);
    } catch (e) {
      toast.error(await errorText(e, "Не удалось выпустить ссылку"));
    } finally {
      setBusyKey("");
    }
  }

  async function revoke(req) {
    const ok = await confirm({
      title: "Отозвать ссылку?",
      message: `Получатель («${ROLE_TITLE[req.signer_role]}») больше не сможет подписать по этой ссылке. Позже можно создать новую.`,
      confirmText: "Отозвать",
      tone: "danger",
    });
    if (!ok) return;
    setBusyKey("revoke");
    try {
      await signingApi.revoke(req.id);
      toast.success("Ссылка отозвана");
      await load(true);
    } catch (e) {
      toast.error(await errorText(e, "Не удалось отозвать ссылку"));
    } finally {
      setBusyKey("");
    }
  }

  // College signs from this very page with the director's ЭЦП (NCALayer).
  async function signSelf(role = "college") {
    if (!contract.docx_path) {
      toast.error("Сначала сформируйте договор");
      return;
    }
    if ((contract.signatures || []).some((s) => s.signer_role === role)) {
      toast.error("Эта роль уже подписана");
      return;
    }
    // Reuse an active signing request for this role; otherwise create one.
    let req = requests.find((r) => r.signer_role === role && ["pending", "viewed"].includes(r.status));
    if (!req) {
      try {
        const data = await signingApi.invite(id, { roles: [role] });
        req = data.items[0];
        if (!req) {
          toast.error("Не удалось получить ссылку для подписания");
          return;
        }
        await load(true);
      } catch (e) {
        toast.error(await errorText(e, "Не удалось создать запрос подписания"));
        return;
      }
    }

    setBusyKey("sign");
    const t = toast.loading("Получаем документ для подписи…");
    try {
      const { payload_base64 } = await signingApi.publicPayload(req.token);
      toast.loading("Подпишите документ в NCALayer…", { id: t });
      const cms = await signBase64WithNCALayer(payload_base64);
      toast.loading("Сохраняем подпись…", { id: t });
      const res = await signingApi.publicSubmit(req.token, cms);
      toast.success("Подпись добавлена", { id: t });
      (res?.warnings || []).forEach((w) =>
        toast(w, { icon: <TriangleAlert className="h-4 w-4 text-amber-600" aria-hidden="true" />, duration: 6000 }),
      );
      await load(true);
    } catch (e) {
      toast.error(e.response?.data?.error || e.message || "Ошибка подписания", { id: t });
    } finally {
      setBusyKey("");
    }
  }

  async function downloadFile(fmt, ext) {
    try {
      await contractsApi.download(contract.id, fmt, `${contract.number}.${ext}`);
    } catch (e) {
      toast.error(await errorText(e, "Не удалось скачать файл"));
    }
  }

  async function downloadReport() {
    try {
      await contractsApi.signatureReport(contract.id, contract.number);
    } catch (e) {
      toast.error(await errorText(e, "Не удалось скачать отчёт"));
    }
  }

  async function saveNotes() {
    setBusyKey("notes");
    try {
      const { item } = await contractsApi.update(id, { notes: notesDraft });
      setContract(item);
      toast.success("Примечание сохранено");
    } catch (e) {
      toast.error(await errorText(e, "Не удалось сохранить примечание"));
    } finally {
      setBusyKey("");
    }
  }

  async function saveDate() {
    setBusyKey("date");
    try {
      const res = await contractsApi.update(id, { contract_date: dateDraft });
      setContract(res.item);
      if (res.warning) {
        toast(res.warning, { icon: <TriangleAlert className="h-4 w-4 text-amber-600" aria-hidden="true" />, duration: 8000 });
      } else {
        toast.success("Дата договора сохранена");
      }
    } catch (e) {
      toast.error(await errorText(e, "Не удалось сохранить дату"));
    } finally {
      setBusyKey("");
    }
  }

  async function uploadScan() {
    if (!scanFile) return;
    if (contract.status === "completed") {
      const ok = await confirm({
        title: "Загрузить скан в завершённый договор?",
        message: "Статус договора сменится на «Скан загружен». Потом его можно снова завершить.",
        confirmText: "Загрузить",
      });
      if (!ok) return;
    }
    setBusyKey("scan");
    try {
      const { item } = await contractsApi.uploadScan(id, scanFile);
      setContract(item);
      setScanFile(null);
      toast.success("Скан загружен");
    } catch (e) {
      toast.error(await errorText(e, "Не удалось загрузить скан"));
    } finally {
      setBusyKey("");
    }
  }

  async function removeContract() {
    const first = await confirm({
      title: `Удалить договор № ${contract.number}?`,
      message: `Договор студента «${contract.student_name}» и его файлы будут удалены без возможности восстановления.`,
      confirmText: "Удалить договор",
      tone: "danger",
      requireText: contract.number,
    });
    if (!first) return;
    setBusyKey("delete");
    try {
      try {
        await contractsApi.remove(id);
      } catch (e) {
        if (e.response?.status === 409 && e.response?.data?.code === "has_signatures") {
          setBusyKey("");
          const n = e.response.data.signatures_count;
          const second = await confirm({
            title: "Договор подписан — удалить вместе с подписями?",
            message:
              `${e.response.data.error}\n\n` +
              `Электронные подписи${n ? ` (${n})` : ""}, скан и файлы договора будут уничтожены. Восстановить их нельзя — стороны придётся подписывать заново.`,
            confirmText: "Да, удалить вместе с подписями",
            tone: "danger",
          });
          if (!second) return;
          setBusyKey("delete");
          await contractsApi.remove(id, true);
        } else {
          throw e;
        }
      }
      toast.success(`Договор ${contract.number} удалён`);
      navigate("/contracts", { replace: true });
    } catch (e) {
      toast.error(await errorText(e, "Не удалось удалить договор"));
    } finally {
      setBusyKey("");
    }
  }

  function scrollTo(elId) {
    document.getElementById(elId)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  const steps = useMemo(() => (contract ? buildSteps(contract) : []), [contract]);

  // ── states ──────────────────────────────────────────────────────────────────
  if (loading && !contract) {
    return (
      <div className="space-y-4" aria-busy="true">
        <CardSkeleton lines={2} />
        <CardSkeleton lines={4} />
        <CardSkeleton lines={4} />
      </div>
    );
  }
  if (!contract) {
    return (
      <div className="card">
        <EmptyState
          icon={CircleAlert}
          title="Не удалось открыть договор"
          description={loadError || "Договор не загрузился."}
          action={
            <>
              <button type="button" className="btn-primary" onClick={() => load()}>
                <RefreshCw className="h-4 w-4" aria-hidden="true" />
                Повторить
              </button>
              <Link to="/contracts" className="btn-ghost">
                К списку договоров
              </Link>
            </>
          }
        />
      </div>
    );
  }

  // ── derived ─────────────────────────────────────────────────────────────────
  const hasFile = !!contract.docx_path;
  const hasPdf = !!contract.pdf_path;
  const hasSignatures = (contract.signatures_count || 0) > 0;
  const action = contract.next_action;
  const moves = (ALLOWED_STATUS_TRANSITIONS[contract.status] || []).filter(
    // Marking an empty draft "generated" would just mislead; the file comes from «Сформировать».
    (to) => !(contract.status === "draft" && to === "generated" && !hasFile),
  );
  const rd = contract.readiness;
  const showReadiness = rd && !hasSignatures && contract.status !== "completed" && (rd.critical > 0 || rd.recommended > 0);
  const notesChanged = (notesDraft || "") !== (contract.notes || "");
  const dateChanged = !!dateDraft && dateDraft !== contract.contract_date;
  const scanExt = contract.signed_scan_path ? contract.signed_scan_path.split(".").pop() : "pdf";

  const headerPrimary =
    isAdmin &&
    ({
      generate: { label: "Сформировать договор", run: runGenerate, key: "generate" },
      invite: { label: "Отправить на подпись", run: () => invite(["partner", "student"]), key: "invite" },
      complete: { label: "Завершить договор", run: () => setStatus("completed"), key: "status" },
    }[action] ||
      null);

  const menuItems = [
    { key: "preview", label: "Предпросмотр PDF", icon: Eye, onClick: () => setPreviewOpen(true), hidden: !hasPdf },
    { key: "docx", label: "Скачать DOCX", icon: Download, onClick: () => downloadFile("docx", "docx"), hidden: !hasFile },
    { key: "pdf", label: "Скачать PDF", icon: Download, onClick: () => downloadFile("pdf", "pdf"), hidden: !hasPdf },
    { key: "regen", label: "Пересформировать", icon: RefreshCw, onClick: runGenerate, hidden: !isAdmin || !hasFile, divider: true, disabled: busy },
  ];

  return (
    <div>
      <PageHeader
        breadcrumbs={[{ label: "Договоры", to: "/contracts" }, { label: `№ ${contract.number}` }]}
        title={`Договор № ${contract.number}`}
        description={`${contract.student_name} → ${contract.partner_name} · ${formatDate(contract.contract_date)}`}
        actions={
          <>
            <StatusBadge value={contract.status} />
            {headerPrimary && (
              <button type="button" className="btn-primary hidden md:inline-flex" onClick={headerPrimary.run} disabled={busy}>
                {busyKey === headerPrimary.key ? "Выполняем…" : headerPrimary.label}
              </button>
            )}
            <MenuButton items={menuItems} label="Действия с договором" className="btn-secondary btn-icon" />
          </>
        }
      />

      <div className="space-y-5">
        <NextStepCard
          contract={contract}
          requests={requests}
          isAdmin={isAdmin}
          busyKey={busyKey}
          ncaAvailable={ncaAvailable}
          onGenerate={runGenerate}
          onInvite={invite}
          onComplete={() => setStatus("completed")}
          onSignCollege={() => signSelf("college")}
          onGoParties={() => scrollTo("signing-parties")}
          onGoScan={() => scrollTo("scan-section")}
        />

        {showReadiness && (
          <SectionCard
            title="Данные для договора"
            icon={ListChecks}
            tone={rd.critical > 0 ? "red" : undefined}
            description={
              rd.critical > 0
                ? "Пока обязательные поля пустые, договор нельзя нормально сформировать."
                : "Обязательное заполнено. Остальное по желанию."
            }
          >
            <ReadinessChecklist readiness={rd} onRecheck={() => load(true)} />
          </SectionCard>
        )}

        {/* `relative overflow-hidden`: the Stepper's sr-only spans are absolutely positioned and,
            without a positioned ancestor, widen the whole page on phones. */}
        <div className="card relative overflow-hidden p-4 sm:p-5">
          <Stepper steps={steps} />
        </div>

        <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
          <div className="space-y-5 xl:col-span-2">
            <SigningParties
              contract={contract}
              requests={requests}
              isAdmin={isAdmin}
              busyKey={busyKey}
              ncaAvailable={ncaAvailable}
              onInvite={invite}
              onShare={setShare}
              onExtend={extend}
              onResend={resend}
              onRevoke={revoke}
              onSignCollege={() => signSelf("college")}
            />

            <SectionCard
              title="Документ"
              icon={FileText}
              description={hasFile ? "Файл собран из официального шаблона колледжа." : "Файл ещё не сформирован."}
            >
              {hasFile ? (
                <div className="flex flex-wrap gap-2">
                  <button type="button" className="btn-secondary" onClick={() => setPreviewOpen(true)} disabled={!hasPdf} title={hasPdf ? undefined : "PDF-версии нет"}>
                    <Eye className="h-4 w-4" aria-hidden="true" />
                    Предпросмотр
                  </button>
                  <button type="button" className="btn-secondary" onClick={() => downloadFile("docx", "docx")}>
                    <Download className="h-4 w-4" aria-hidden="true" />
                    DOCX
                  </button>
                  {hasPdf && (
                    <button type="button" className="btn-secondary" onClick={() => downloadFile("pdf", "pdf")}>
                      <Download className="h-4 w-4" aria-hidden="true" />
                      PDF
                    </button>
                  )}
                  {contract.signed_scan_path && (
                    <button type="button" className="btn-secondary" onClick={() => downloadFile("scan", scanExt)}>
                      <Download className="h-4 w-4" aria-hidden="true" />
                      Скан
                    </button>
                  )}
                  {hasSignatures && (
                    <button type="button" className="btn-dark" onClick={downloadReport}>
                      <ScrollText className="h-4 w-4" aria-hidden="true" />
                      Отчёт о подписях
                    </button>
                  )}
                </div>
              ) : (
                <p className="text-sm text-charcoal-600">
                  Сначала сформируйте договор — появятся файлы для скачивания и предпросмотра.
                </p>
              )}
              {hasFile && !hasPdf && (
                <p className="mt-3 flex gap-2 rounded-xl bg-amber-50 px-3.5 py-2.5 text-sm text-amber-800 ring-1 ring-amber-100">
                  <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                  PDF не создан — на сервере, вероятно, не работает конвертер (LibreOffice). Файл Word доступен; предпросмотр недоступен.
                </p>
              )}
              {contract.verification_code && (
                <div className="mt-4 flex flex-wrap items-center gap-3 rounded-xl bg-coral-50/40 p-3 text-sm ring-1 ring-coral-100">
                  <ShieldCheck className="h-5 w-5 shrink-0 text-coral-600" aria-hidden="true" />
                  <div className="min-w-[12rem] flex-1">
                    <div className="font-semibold text-charcoal-800">Публичная проверка</div>
                    <div className="text-xs text-charcoal-500">
                      QR-код в документе ведёт на страницу, где любой видит, кто подписал договор.
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <a className="btn-secondary btn-sm max-sm:min-h-[44px]" href={`/verify/${contract.verification_code}`} target="_blank" rel="noreferrer">
                      <ExternalLink className="h-4 w-4" aria-hidden="true" />
                      Открыть
                    </a>
                    <CopyButton text={`${window.location.origin}/verify/${contract.verification_code}`} label="Копировать адрес" copiedLabel="Скопировано" className="max-sm:min-h-[44px]" />
                  </div>
                </div>
              )}
            </SectionCard>

            <SectionCard title="Данные договора" icon={Pencil}>
              <div className="grid grid-cols-1 gap-x-6 gap-y-4 text-sm md:grid-cols-2">
                <InfoRow label="Предприятие">{contract.partner_name}</InfoRow>
                <InfoRow label="Студент">{contract.student_name}</InfoRow>
                <InfoRow label="Группа">{contract.student_group}</InfoRow>
                <InfoRow label="Специальность">{contract.student_specialty}</InfoRow>
                <InfoRow label="Период практики">
                  {contract.practice_start ? `${formatDate(contract.practice_start)} — ${formatDate(contract.practice_end)}` : ""}
                </InfoRow>
                <InfoRow label="Год договора">{contract.year}</InfoRow>
                <InfoRow label="Создан">{fmtDateTime(contract.created_at)}</InfoRow>
                <InfoRow label="Обновлён">{fmtDateTime(contract.updated_at)}</InfoRow>
              </div>

              <div className="divider my-5" />

              <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
                <div>
                  {isAdmin ? (
                    <>
                      <TextField
                        label="Дата договора"
                        type="date"
                        value={dateDraft}
                        onChange={setDateDraft}
                        disabled={hasSignatures}
                        hint={
                          hasSignatures
                            ? "Договор уже подписан — дату менять нельзя. Чтобы изменить, пересформируйте договор со сбросом подписей."
                            : hasFile
                            ? "Дата печатается в документе: после изменения договор нужно пересформировать."
                            : undefined
                        }
                      />
                      {dateChanged && !hasSignatures && (
                        <button type="button" className="btn-primary btn-sm max-sm:min-h-[44px] mt-2" onClick={saveDate} disabled={busy}>
                          <Save className="h-4 w-4" aria-hidden="true" />
                          {busyKey === "date" ? "Сохраняем…" : "Сохранить дату"}
                        </button>
                      )}
                    </>
                  ) : (
                    <InfoRow label="Дата договора">{formatDate(contract.contract_date)}</InfoRow>
                  )}
                </div>
                <div>
                  {isAdmin ? (
                    <>
                      <TextArea label="Примечание" value={notesDraft} onChange={setNotesDraft} rows={3} placeholder="Необязательно" />
                      {notesChanged && (
                        <div className="mt-2 flex gap-2">
                          <button type="button" className="btn-primary btn-sm max-sm:min-h-[44px]" onClick={saveNotes} disabled={busy}>
                            <Save className="h-4 w-4" aria-hidden="true" />
                            {busyKey === "notes" ? "Сохраняем…" : "Сохранить"}
                          </button>
                          <button type="button" className="btn-ghost btn-sm max-sm:min-h-[44px]" onClick={() => setNotesDraft(contract.notes || "")}>
                            Отмена
                          </button>
                        </div>
                      )}
                    </>
                  ) : (
                    <InfoRow label="Примечание">{contract.notes}</InfoRow>
                  )}
                </div>
              </div>
            </SectionCard>

            {isAdmin && (
              <SectionCard
                title="Статус"
                icon={Settings2}
                description="Статус меняется сам по ходу работы. Здесь — только то, что можно сделать вручную."
              >
                <div className="flex flex-wrap items-center gap-3">
                  <span className="text-sm text-charcoal-600">Сейчас:</span>
                  <StatusBadge value={contract.status} />
                </div>
                {moves.length > 0 ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {moves.map((to) => (
                      <button
                        key={to}
                        type="button"
                        className={to === "completed" ? "btn-success btn-sm max-sm:min-h-[44px]" : "btn-secondary btn-sm max-sm:min-h-[44px]"}
                        onClick={() => setStatus(to)}
                        disabled={busy}
                      >
                        {statusMoveLabel(contract.status, to)}
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="mt-3 text-sm text-charcoal-500">Из этого статуса вручную перейти некуда.</p>
                )}
                <p className="mt-3 text-xs text-charcoal-500">
                  Статус «Подписан» выставляется автоматически, когда подписали все три стороны.
                </p>
              </SectionCard>
            )}

            {isAdmin && (
              <div id="scan-section" className="scroll-mt-20">
                <SectionCard
                  title="Скан подписанного договора"
                  icon={FileUp}
                  description="Необязательно: загрузите, если договор подписывали на бумаге."
                >
                  {contract.signed_scan_path && (
                    <div className="mb-3 flex flex-wrap items-center gap-3 rounded-xl bg-emerald-50 px-3.5 py-2.5 text-sm text-emerald-900 ring-1 ring-emerald-200">
                      <CircleCheck className="h-4 w-4 shrink-0" aria-hidden="true" />
                      <span className="flex-1">Скан загружен. Новая загрузка заменит его.</span>
                      <button type="button" className="btn-secondary btn-sm max-sm:min-h-[44px]" onClick={() => downloadFile("scan", scanExt)}>
                        <Download className="h-4 w-4" aria-hidden="true" />
                        Скачать
                      </button>
                    </div>
                  )}
                  <FileDropzone
                    accept=".pdf,.jpg,.jpeg,.png"
                    file={scanFile}
                    onFile={setScanFile}
                    onClear={() => setScanFile(null)}
                    busy={busyKey === "scan"}
                    hint="PDF, JPG или PNG, до 20 МБ"
                  />
                  {scanFile && busyKey !== "scan" && (
                    <button type="button" className="btn-primary mt-3" onClick={uploadScan} disabled={busy}>
                      <FileUp className="h-4 w-4" aria-hidden="true" />
                      Загрузить скан
                    </button>
                  )}
                </SectionCard>
              </div>
            )}

            {isAdmin && (
              <SectionCard
                title="Опасная зона"
                icon={Trash2}
                tone="red"
                description="Удаление нельзя отменить."
              >
                <p className="text-sm text-charcoal-600">
                  Договор, его файлы и ссылки на подпись будут удалены.
                  {hasSignatures || contract.signed_scan_path
                    ? " У этого договора есть подписи или скан — сайт попросит дополнительное подтверждение."
                    : ""}
                </p>
                <button type="button" className="btn-danger mt-3" onClick={removeContract} disabled={busy}>
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                  {busyKey === "delete" ? "Удаляем…" : "Удалить договор"}
                </button>
              </SectionCard>
            )}
          </div>

          <aside className="space-y-5">
            <SectionCard title="Электронные подписи" icon={Signature}>
              {isAdmin && <NCABadge available={ncaAvailable} />}
              <div className={clsx("space-y-3", isAdmin && "mt-4")}>
                {ROLES.map((role) => (
                  <SignatureCard key={role} role={role} sig={(contract.signatures || []).find((s) => s.signer_role === role)} />
                ))}
              </div>
            </SectionCard>
          </aside>
        </div>
      </div>

      <ShareLinkModal
        request={share}
        contractNumber={contract.number}
        studentName={contract.student_name}
        onClose={() => setShare(null)}
      />
      <BulkLinksModal result={linksResult} onClose={() => setLinksResult(null)} />
      <DocumentPreviewModal
        open={previewOpen}
        onClose={() => setPreviewOpen(false)}
        contractId={contract.id}
        number={contract.number}
        hasPdf={hasPdf}
        onDownload={() => downloadFile("pdf", "pdf")}
      />
    </div>
  );
}
