import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import toast from "react-hot-toast";
import { PenLine, TimerOff, TriangleAlert } from "lucide-react";
import { errorText, signingApi } from "../api/endpoints.js";
import { signBase64WithNCALayer, pingNCALayer } from "../utils/ncalayer.js";
import { formatDate } from "../utils/format.js";
import { Skeleton } from "../components/Skeleton.jsx";
import PublicShell from "../components/public/PublicShell.jsx";
import SignHeader from "../components/public/SignHeader.jsx";
import StatusBanner from "../components/public/StatusBanner.jsx";
import SigningProgress, { partyStatus, signedCount } from "../components/public/SigningProgress.jsx";
import DocumentPreview from "../components/public/DocumentPreview.jsx";
import ContractFacts from "../components/public/ContractFacts.jsx";
import SignPanel from "../components/public/SignPanel.jsx";
import SignedConfirmation from "../components/public/SignedConfirmation.jsx";
import SecurityNote from "../components/public/SecurityNote.jsx";
import LinkProblem from "../components/public/LinkProblem.jsx";

const SOON_DAYS = 3;

// Backend answers: 404 unknown token, 410 {code: expired|revoked}. Anything
// else (or no response at all) is a generic, retryable problem.
function classifyError(e) {
  const status = e?.response?.status;
  const code = e?.response?.data?.code;
  if (status === 410 && code === "expired") return { kind: "expired" };
  if (status === 410 && code === "revoked") return { kind: "revoked" };
  if (status === 404) return { kind: "invalid" };
  if (!e?.response) return { kind: "generic", message: "Нет связи с сервером." };
  return { kind: "generic", message: e.response?.data?.error || "Не удалось загрузить договор." };
}

function daysLeft(iso) {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? null : Math.ceil((t - Date.now()) / 86_400_000);
}

function LoadingState() {
  return (
    <div aria-busy="true" aria-label="Загрузка договора">
      <div className="card mb-4 space-y-3 p-4 sm:mb-5 sm:p-6">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-8 w-3/4" />
        <Skeleton className="h-4 w-1/2" />
      </div>
      <div className="card mb-4 space-y-3 p-4 sm:mb-5 sm:p-5">
        <Skeleton className="h-4 w-1/3" />
        <div className="grid grid-cols-3 gap-3">
          <Skeleton className="h-16" />
          <Skeleton className="h-16" />
          <Skeleton className="h-16" />
        </div>
      </div>
      <Skeleton className="h-[50vh] w-full rounded-2xl" />
    </div>
  );
}

export default function PublicSignPage() {
  const { token } = useParams();
  const [data, setData] = useState(null);
  const [problem, setProblem] = useState(null); // { kind, message? }
  const [ncaAvailable, setNcaAvailable] = useState(null);
  const [busy, setBusy] = useState(false);
  const [doneAt, setDoneAt] = useState(null); // ISO time of OUR signature, set right after submit
  const viewedSentFor = useRef(null);

  const load = useCallback(async () => {
    try {
      const res = await signingApi.publicView(token);
      setData(res);
      setProblem(null);
      // Mark the link as viewed via an explicit POST (the GET is read-only).
      // Fire-and-forget, once per token: a failure here must not block showing the contract.
      if (res?.request?.status === "pending" && viewedSentFor.current !== token) {
        viewedSentFor.current = token;
        signingApi.publicMarkViewed(token).catch(() => {});
      }
    } catch (e) {
      setProblem(classifyError(e));
    }
  }, [token]);

  useEffect(() => {
    setData(null);
    setProblem(null);
    setDoneAt(null);
    load();
  }, [load]);

  useEffect(() => {
    let cancelled = false;
    let timeoutId = null;
    const probe = async () => {
      const ok = await pingNCALayer();
      if (cancelled) return;
      setNcaAvailable(ok);
      // If detected, stop polling; otherwise keep retrying.
      if (!ok) timeoutId = setTimeout(probe, 5000);
    };
    probe();
    return () => {
      cancelled = true;
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, []);

  const number = data?.contract?.number;
  useEffect(() => {
    if (!number) return undefined;
    const prev = document.title;
    document.title = `Подписание договора № ${number}`;
    return () => {
      document.title = prev;
    };
  }, [number]);

  async function recheckNca() {
    setNcaAvailable(await pingNCALayer());
  }

  async function sign() {
    if (busy) return;
    setBusy(true);
    const t = toast.loading("Получаем документ для подписи…");
    try {
      const { payload_base64 } = await signingApi.publicPayload(token);
      toast.loading("Откройте NCALayer и подпишите документ…", { id: t });
      const cms = await signBase64WithNCALayer(payload_base64);
      toast.loading("Сохраняем подпись…", { id: t });
      const res = await signingApi.publicSubmit(token, cms);
      toast.success("Договор успешно подписан", { id: t });
      if (res?.warnings?.length) {
        res.warnings.forEach((w) =>
          toast(w, { icon: <TriangleAlert className="h-4 w-4 text-amber-500" aria-hidden="true" />, duration: 6000 }),
        );
      }
      setDoneAt(new Date().toISOString());
      load();
    } catch (e) {
      // NCALayer errors carry their text in e.message; API errors in the response body.
      const msg = e?.response ? await errorText(e, "Ошибка подписания") : e?.message || "Ошибка подписания";
      toast.error(msg, { id: t });
      // 409 = already signed elsewhere (other tab / admin): refresh so the page shows the truth.
      if (e?.response?.status === 409) load();
    } finally {
      setBusy(false);
    }
  }

  if (!data) {
    return (
      <PublicShell>
        {problem ? (
          <LinkProblem
            kind={problem.kind}
            message={problem.message}
            onRetry={problem.kind === "generic" ? () => { setProblem(null); load(); } : undefined}
          />
        ) : (
          <LoadingState />
        )}
      </PublicShell>
    );
  }

  const { request, contract, signing_state: signingState = {}, download = {} } = data;
  const role = request.signer_role;
  const myStatus = signingState[role]?.status || request.status;
  const alreadySigned = myStatus === "signed" || request.status === "signed" || Boolean(doneAt);
  const signedAt = signingState[role]?.signed_at || doneAt;
  const hasPdf = Boolean(download.pdf_preview || download.pdf);
  const hasDocx = Boolean(download.docx);
  const waitingRoles = ["college", "partner", "student"].filter(
    (r) => r !== role && partyStatus(signingState[r]) !== "signed",
  );
  const left = daysLeft(request.expires_at);
  const expiresSoon = left !== null && left <= SOON_DAYS;
  const revision = signedCount(signingState) + (doneAt ? 1 : 0);

  return (
    <PublicShell college={contract?.college}>
      <SignHeader
        number={contract?.number}
        role={role}
        roleLabel={request.signer_role_label}
        recipientName={request.recipient_name}
        idMasked={request.recipient_iin_or_bin_masked}
      />

      {alreadySigned ? (
        <SignedConfirmation
          token={token}
          signedAt={signedAt}
          waitingRoles={waitingRoles}
          hasPdf={hasPdf}
          hasDocx={hasDocx}
          expiresAt={request.expires_at}
        />
      ) : !hasDocx ? (
        <StatusBanner tone="amber" icon={TriangleAlert} title="Договор ещё не готов к подписанию" className="mb-4 sm:mb-5">
          Колледж ещё не сформировал файл договора. Подписать его пока нельзя — обратитесь в колледж, приславший ссылку.
        </StatusBanner>
      ) : (
        <StatusBanner
          tone="coral"
          icon={PenLine}
          title="Договор готов к подписанию"
          className="mb-4 sm:mb-5"
          actions={
            <a className="link text-sm font-medium lg:hidden" href="#sign">
              Перейти к подписанию
            </a>
          }
        >
          Сначала прочитайте документ ниже, затем отметьте согласие и подпишите его ЭЦП.
          {request.expires_at ? <> Ссылка действует до {formatDate(request.expires_at)}.</> : null}
        </StatusBanner>
      )}

      {!alreadySigned && expiresSoon && (
        <StatusBanner
          tone="amber"
          icon={TimerOff}
          title={left <= 0 ? "Ссылка истекает сегодня" : `Ссылка истекает через ${left} дн.`}
          className="mb-4 sm:mb-5"
        >
          Подпишите договор заранее. Если срок истечёт, попросите колледж продлить ссылку или прислать новую.
        </StatusBanner>
      )}

      <SigningProgress signingState={signingState} myRole={role} forceSigned={Boolean(doneAt)} />

      <div className="grid items-start gap-4 sm:gap-5 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="min-w-0 space-y-4 sm:space-y-5">
          <DocumentPreview token={token} hasPdf={hasPdf} hasDocx={hasDocx} revision={revision} />
          <ContractFacts contract={contract} />
        </div>
        <aside className="space-y-4 sm:space-y-5 lg:sticky lg:top-4">
          {!alreadySigned && (
            <SignPanel
              ncaAvailable={ncaAvailable}
              onRecheck={recheckNca}
              busy={busy}
              docReady={hasDocx}
              onSign={sign}
              token={token}
              egov={data.signing_methods?.egov_mobile}
              onEgovSigned={() => {
                setDoneAt(new Date().toISOString());
                load();
              }}
            />
          )}
          <SecurityNote expiresAt={request.expires_at} />
        </aside>
      </div>
    </PublicShell>
  );
}
