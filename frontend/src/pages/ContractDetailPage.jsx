import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import toast from "react-hot-toast";
import PageHeader from "../components/PageHeader.jsx";
import StatusBadge from "../components/StatusBadge.jsx";
import Modal from "../components/Modal.jsx";
import { contractsApi, signingApi } from "../api/endpoints.js";
import { formatDate, formatDateTime, STATUS_LABELS } from "../utils/format.js";
import { signBase64WithNCALayer, pingNCALayer } from "../utils/ncalayer.js";
import { useAuth } from "../context/AuthContext.jsx";

const SIGNER_LABELS = {
  college: "Колледж",
  partner: "Предприятие",
  student: "Обучающийся",
};
const SIGNER_DESC = {
  college: "Директор колледжа подписывает ЭЦП от лица организации образования",
  partner: "Руководитель предприятия подписывает ЭЦП от лица базы практики",
  student: "Студент подписывает ЭЦП от собственного имени",
};

export default function ContractDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { isAdmin } = useAuth();
  const [contract, setContract] = useState(null);
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [ncaAvailable, setNcaAvailable] = useState(null);
  const [linkOpen, setLinkOpen] = useState(null);

  async function load() {
    setLoading(true);
    try {
      const { item } = await contractsApi.get(id);
      setContract(item);
      if (isAdmin) {
        const r = await signingApi.listRequests(id);
        setRequests(r.items);
      }
    } catch (e) {
      toast.error("Договор не найден");
      navigate("/contracts");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, [id]); // eslint-disable-line

  useEffect(() => {
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
  }, []);

  async function generate(force = false) {
    setBusy(true);
    try {
      const { item } = await contractsApi.generate(id, force ? { force: true } : undefined);
      setContract(item);
      toast.success("Договор сформирован");
      load();
    } catch (e) {
      if (
        !force &&
        e.response?.status === 409 &&
        e.response?.data?.code === "has_signatures"
      ) {
        if (
          confirm(
            "Договор уже подписан или находится на подписании. Пересформировать и СБРОСИТЬ все существующие подписи?",
          )
        ) {
          return await generate(true);
        }
      } else {
        toast.error(e.response?.data?.error || "Ошибка формирования");
      }
    } finally {
      setBusy(false);
    }
  }

  async function updateStatus(status) {
    try {
      const { item } = await contractsApi.update(id, { status });
      setContract(item);
      toast.success("Статус обновлён");
    } catch (e) {
      toast.error(e.response?.data?.error || "Ошибка");
    }
  }

  async function sendForSigning(roles) {
    setBusy(true);
    try {
      const data = await signingApi.invite(id, { roles });
      if (data.items.length === 0) {
        toast("Активные ссылки уже существуют. Используйте «Переотправить».", { icon: "ℹ️" });
      } else {
        toast.success(`Создано ссылок: ${data.items.length}`);
        if (data.items.length === 1) {
          setLinkOpen(data.items[0]);
        }
      }
      load();
    } catch (e) {
      toast.error(e.response?.data?.error || "Ошибка отправки");
    } finally {
      setBusy(false);
    }
  }

  async function revoke(rid) {
    if (!confirm("Отозвать ссылку?")) return;
    try {
      await signingApi.revoke(rid);
      toast.success("Ссылка отозвана");
      load();
    } catch (e) {
      toast.error(e.response?.data?.error || "Ошибка");
    }
  }

  async function resend(rid) {
    try {
      const { item } = await signingApi.resend(rid);
      toast.success("Ссылка перевыпущена");
      setLinkOpen(item);
      load();
    } catch (e) {
      toast.error(e.response?.data?.error || "Ошибка");
    }
  }

  async function signSelf(role) {
    if (!contract.docx_path) {
      toast.error("Сначала сформируйте договор");
      return;
    }
    // Block if this role is already signed (don't issue a second signature).
    const alreadySigned = (contract.signatures || []).some((s) => s.signer_role === role);
    if (alreadySigned) {
      toast.error("Эта роль уже подписана");
      return;
    }
    // Reuse an active signing request for this role; otherwise create a new one.
    let req = requests.find(
      (r) => r.signer_role === role && ["pending", "viewed"].includes(r.status),
    );
    if (!req) {
      try {
        const data = await signingApi.invite(id, { roles: [role] });
        req = data.items[0];
        if (!req) {
          toast.error("Не удалось получить ссылку для подписания");
          return;
        }
        await load();
      } catch (e) {
        toast.error(e.response?.data?.error || "Не удалось создать запрос подписания");
        return;
      }
    }

    setBusy(true);
    const t = toast.loading("Получаем документ для подписи…");
    try {
      const { payload_base64 } = await signingApi.publicPayload(req.token);
      toast.loading("Подпишите документ в NCALayer…", { id: t });
      const cms = await signBase64WithNCALayer(payload_base64);
      toast.loading("Сохраняем подпись…", { id: t });
      const res = await signingApi.publicSubmit(req.token, cms);
      toast.success("Подпись добавлена", { id: t });
      if (res?.warnings?.length) {
        res.warnings.forEach((w) => toast(w, { icon: "⚠️", duration: 6000 }));
      }
      load();
    } catch (e) {
      const msg = e.response?.data?.error || e.message || "Ошибка подписания";
      toast.error(msg, { id: t });
    } finally {
      setBusy(false);
    }
  }

  async function downloadFile(fmt, ext) {
    try {
      await contractsApi.download(contract.id, fmt, `${contract.number}.${ext}`);
    } catch (e) {
      toast.error("Не удалось скачать файл");
    }
  }

  async function downloadReport() {
    try {
      await contractsApi.signatureReport(contract.id, contract.number);
    } catch (e) {
      toast.error("Не удалось скачать отчёт");
    }
  }

  const stepData = useMemo(
    () => (contract ? buildSteps(contract, requests) : []),
    [contract, requests],
  );

  if (loading || !contract) {
    return <div className="text-charcoal-500">Загрузка…</div>;
  }

  return (
    <div>
      <PageHeader
        title={`Договор № ${contract.number}`}
        description={`${contract.partner_name} • ${contract.student_name} • ${formatDate(contract.contract_date)}`}
        actions={
          <>
            <button className="btn-secondary" onClick={() => navigate(-1)}>← Назад</button>
            {isAdmin && (
              <button className="btn-primary" disabled={busy} onClick={() => generate()}>
                {contract.docx_path ? "Пересформировать" : "Сформировать договор"}
              </button>
            )}
          </>
        }
      />

      {/* Workflow stepper */}
      <div className="card p-5 mb-6 overflow-x-auto">
        <Stepper steps={stepData} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <section className="xl:col-span-2 space-y-6">
          <div className="card p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="section-title">📋 Сведения</h2>
              <StatusBadge value={contract.status} />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
              <InfoRow label="Партнёр" value={contract.partner_name} />
              <InfoRow label="Студент" value={contract.student_name} />
              <InfoRow label="Группа" value={contract.student_group} />
              <InfoRow label="Специальность" value={contract.student_specialty} />
              <InfoRow label="Период практики" value={contract.practice_start ? `${formatDate(contract.practice_start)} — ${formatDate(contract.practice_end)}` : "—"} />
              <InfoRow label="Год" value={contract.year} />
              <InfoRow label="Создан" value={formatDateTime(contract.created_at)} />
              <InfoRow label="Обновлён" value={formatDateTime(contract.updated_at)} />
            </div>

            <div className="divider my-5" />
            <h3 className="font-semibold mb-3 text-charcoal-700">Файлы договора</h3>
            <div className="flex flex-wrap gap-2">
              {contract.docx_path ? (
                <button className="btn-secondary" onClick={() => downloadFile("docx", "docx")}>📄 Скачать DOCX</button>
              ) : (
                <span className="text-sm text-charcoal-500">Договор ещё не сформирован.</span>
              )}
              {contract.pdf_path && (
                <button className="btn-secondary" onClick={() => downloadFile("pdf", "pdf")}>📕 Скачать PDF</button>
              )}
              {contract.signed_scan_path && (
                <button className="btn-secondary" onClick={() => downloadFile("scan", contract.signed_scan_path.split(".").pop())}>🖼️ Скан</button>
              )}
              {contract.signatures_count > 0 && isAdmin && (
                <button className="btn-dark" onClick={downloadReport}>📑 Отчёт подписания</button>
              )}
            </div>
          </div>

          {isAdmin && (
            <div className="card p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="section-title">🤝 Документооборот</h2>
                <div className="flex gap-2">
                  <button
                    className="btn-primary"
                    onClick={() => sendForSigning(["partner", "student"])}
                    disabled={busy || !contract.docx_path}
                  >
                    Отправить партнёру и студенту
                  </button>
                  <button
                    className="btn-secondary"
                    onClick={() => sendForSigning(["college", "partner", "student"])}
                    disabled={busy || !contract.docx_path}
                  >
                    Отправить всем
                  </button>
                </div>
              </div>

              {!contract.docx_path && (
                <div className="text-sm text-amber-700 bg-amber-50 ring-1 ring-amber-100 rounded-xl px-3 py-2 mb-3">
                  Сначала сформируйте договор, чтобы создать ссылки на подписание.
                </div>
              )}

              <ul className="divide-y divide-charcoal-100">
                {["college", "partner", "student"].map((role) => {
                  const req = requests.find((r) => r.signer_role === role && r.status !== "revoked");
                  return (
                    <li key={role} className="py-4 flex flex-col md:flex-row md:items-center gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="font-semibold text-charcoal-800">{SIGNER_LABELS[role]}</div>
                        <div className="text-xs text-charcoal-500">{SIGNER_DESC[role]}</div>
                        {req?.recipient_name && (
                          <div className="text-xs text-charcoal-600 mt-1">👤 {req.recipient_name}</div>
                        )}
                        {req?.signed_at && (
                          <div className="text-xs text-emerald-600 mt-0.5">✓ Подписано {formatDateTime(req.signed_at)}</div>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-2 items-center">
                        <RequestStatusBadge status={req?.status} />
                        {req && req.status !== "signed" && (
                          <>
                            <button className="btn-ghost text-xs" onClick={() => setLinkOpen(req)}>Ссылка</button>
                            <button className="btn-ghost text-xs" onClick={() => resend(req.id)}>Перевыпустить</button>
                            <button className="btn-ghost text-xs text-red-600" onClick={() => revoke(req.id)}>Отозвать</button>
                          </>
                        )}
                        {!req && contract.docx_path && (
                          <button className="btn-secondary text-xs" onClick={() => sendForSigning([role])}>Создать ссылку</button>
                        )}
                        {role === "college" && req?.status !== "signed" && (
                          <button
                            className="btn-primary text-xs"
                            onClick={() => signSelf("college")}
                            disabled={busy || !contract.docx_path || !ncaAvailable}
                          >
                            Подписать здесь
                          </button>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {isAdmin && (
            <div className="card p-6">
              <h2 className="section-title mb-3">⚙️ Управление статусом</h2>
              <div className="flex flex-wrap gap-2">
                {Object.entries(STATUS_LABELS).map(([v, l]) => (
                  <button
                    key={v}
                    onClick={() => updateStatus(v)}
                    className={`btn-secondary text-xs ${contract.status === v ? "ring-2 ring-coral-300" : ""}`}
                  >
                    {l}
                  </button>
                ))}
              </div>

              <div className="divider my-5" />
              <h3 className="font-semibold mb-2 text-charcoal-700">Загрузить подписанный скан</h3>
              <input
                type="file"
                accept="application/pdf,image/jpeg,image/png"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  setBusy(true);
                  contractsApi
                    .uploadScan(id, file)
                    .then(({ item }) => {
                      setContract(item);
                      toast.success("Скан загружен");
                    })
                    .catch((err) => toast.error(err.response?.data?.error || "Ошибка"))
                    .finally(() => {
                      setBusy(false);
                      e.target.value = "";
                    });
                }}
                className="text-sm"
                disabled={busy}
              />
              <div className="text-xs text-charcoal-400 mt-1">Допустимы PDF, JPG, PNG.</div>
            </div>
          )}
        </section>

        <aside className="space-y-6">
          <div className="card p-6">
            <h2 className="section-title mb-3">🔐 Подписи сторон</h2>
            <NCABadge available={ncaAvailable} />
            <div className="mt-4 space-y-3">
              {["college", "partner", "student"].map((role) => {
                const sig = (contract.signatures || []).find((s) => s.signer_role === role);
                return (
                  <div key={role} className={`rounded-xl border p-3 ${sig ? "border-emerald-200 bg-emerald-50/40" : "border-charcoal-100"}`}>
                    <div className="flex items-center justify-between gap-2">
                      <div className="font-semibold text-sm">{SIGNER_LABELS[role]}</div>
                      {sig ? (
                        <span className="badge bg-emerald-100 text-emerald-700">Подписано</span>
                      ) : (
                        <span className="badge bg-charcoal-100 text-charcoal-600">Не подписано</span>
                      )}
                    </div>
                    {sig && (
                      <div className="text-xs text-charcoal-600 mt-2 space-y-1">
                        <div>👤 {sig.signer_full_name || "—"}</div>
                        <div>🆔 {sig.signer_iin_or_bin || "—"}</div>
                        <div>🔢 Серийный: {sig.signer_serial}</div>
                        <div>🗓️ {formatDateTime(sig.created_at)}</div>
                        <div className="break-all font-mono text-[10px] text-charcoal-500">SHA-256: {sig.signed_payload_sha256?.slice(0, 32)}…</div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          <div className="card p-6">
            <h3 className="section-title mb-2">📜 Бундл документов</h3>
            <p className="text-xs text-charcoal-500 mb-3">
              После подписания всеми сторонами создаётся юридический пакет: оригинальный
              договор + криптографический отчёт о подписях.
            </p>
            <div className="flex flex-col gap-2">
              <button className="btn-secondary text-sm" disabled={!contract.docx_path} onClick={() => downloadFile("docx", "docx")}>
                Скачать договор (DOCX)
              </button>
              {contract.pdf_path && (
                <button className="btn-secondary text-sm" onClick={() => downloadFile("pdf", "pdf")}>
                  Скачать договор (PDF)
                </button>
              )}
              <button className="btn-dark text-sm" disabled={contract.signatures_count === 0} onClick={downloadReport}>
                Скачать отчёт о подписях
              </button>
            </div>
          </div>
        </aside>
      </div>

      <ShareLinkModal request={linkOpen} onClose={() => setLinkOpen(null)} />
    </div>
  );
}

function InfoRow({ label, value }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide text-charcoal-400 font-semibold">{label}</div>
      <div className="font-medium text-charcoal-800">{value || "—"}</div>
    </div>
  );
}

function RequestStatusBadge({ status }) {
  const map = {
    pending: ["Ссылка отправлена", "bg-amber-100 text-amber-700"],
    viewed: ["Просмотрено", "bg-indigo-100 text-indigo-700"],
    signed: ["Подписано ЭЦП", "bg-emerald-100 text-emerald-700"],
    revoked: ["Отозвано", "bg-red-100 text-red-700"],
  };
  const [label, cls] = map[status] || ["Нет ссылки", "bg-charcoal-100 text-charcoal-600"];
  return <span className={`badge ${cls}`}>{label}</span>;
}

function NCABadge({ available }) {
  if (available === null)
    return <div className="text-xs px-3 py-2 rounded-xl bg-charcoal-50 text-charcoal-600">Проверяем NCALayer…</div>;
  if (available)
    return <div className="text-xs px-3 py-2 rounded-xl bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100">✓ NCALayer готов</div>;
  return (
    <div className="text-xs px-3 py-2 rounded-xl bg-amber-50 text-amber-700 ring-1 ring-amber-100">
      ⚠ Запустите NCALayer перед подписанием
    </div>
  );
}

function ShareLinkModal({ request, onClose }) {
  const [copied, setCopied] = useState(false);
  if (!request) return null;
  // Always build the URL from the frontend origin so links are clickable
  // regardless of what backend host generated them.
  const fullUrl = `${window.location.origin}/sign/${request.token}`;

  function copy() {
    navigator.clipboard.writeText(fullUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    });
  }

  const subject = encodeURIComponent(`Договор практики № ${request.contract_id} — на подпись`);
  const body = encodeURIComponent(
    `Здравствуйте, ${request.recipient_name || ""}!\n\nПросим подписать договор профессиональной практики по ссылке ниже.\nПодписание выполняется через приложение NCALayer (ЭЦП).\n\n${fullUrl}\n\nСрок действия ссылки: до ${request.expires_at?.slice(0,10) || "—"}.\n\nС уважением, CCU PRACTICUM.`,
  );

  return (
    <Modal
      open={!!request}
      onClose={onClose}
      title="Ссылка на подписание"
      size="md"
      footer={<button className="btn-secondary" onClick={onClose}>Закрыть</button>}
    >
      <div className="space-y-4">
        <div>
          <div className="label">Получатель</div>
          <div className="font-medium">{SIGNER_LABELS[request.signer_role]} — {request.recipient_name || "не указан"}</div>
          {request.recipient_email && (
            <div className="text-xs text-charcoal-500">{request.recipient_email}</div>
          )}
        </div>
        <div>
          <div className="label">URL для подписания</div>
          <div className="flex gap-2">
            <input className="input flex-1 font-mono text-xs" readOnly value={fullUrl} onClick={(e) => e.target.select()} />
            <button className="btn-primary text-xs" onClick={copy}>
              {copied ? "✓" : "Копировать"}
            </button>
          </div>
        </div>
        <a
          href={fullUrl}
          target="_blank"
          rel="noreferrer"
          className="btn-dark w-full text-xs"
        >
          🔗 Открыть в новой вкладке
        </a>
        <div className="flex gap-2">
          {request.recipient_email && (
            <a
              className="btn-secondary text-xs flex-1"
              href={`mailto:${request.recipient_email}?subject=${subject}&body=${body}`}
            >
              📧 В почту
            </a>
          )}
          <a
            className="btn-secondary text-xs flex-1"
            target="_blank"
            rel="noreferrer"
            href={`https://wa.me/?text=${encodeURIComponent(`Подпишите договор практики: ${fullUrl}`)}`}
          >
            🟢 WhatsApp
          </a>
          <a
            className="btn-secondary text-xs flex-1"
            target="_blank"
            rel="noreferrer"
            href={`https://t.me/share/url?url=${encodeURIComponent(fullUrl)}&text=${encodeURIComponent("Подпишите договор практики")}`}
          >
            ✈️ Telegram
          </a>
        </div>
        <div className="text-xs text-charcoal-500">
          Срок действия ссылки: до {request.expires_at?.slice(0, 10)}. После подписания ссылка автоматически закрывается.
        </div>
      </div>
    </Modal>
  );
}

function Stepper({ steps }) {
  return (
    <ol className="flex items-center gap-2 min-w-max">
      {steps.map((s, i) => (
        <li key={s.key} className="flex items-center gap-2">
          <div
            className={`flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-semibold ${
              s.done
                ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200"
                : s.active
                ? "bg-coral-50 text-coral-700 ring-1 ring-coral-200"
                : "bg-charcoal-50 text-charcoal-500 ring-1 ring-charcoal-100"
            }`}
          >
            <span
              className={`h-6 w-6 rounded-full grid place-items-center text-[11px] ${
                s.done ? "bg-emerald-500 text-white" : s.active ? "bg-coral-500 text-white" : "bg-charcoal-300 text-white"
              }`}
            >
              {s.done ? "✓" : i + 1}
            </span>
            <span>{s.label}</span>
          </div>
          {i < steps.length - 1 && (
            <span className={`h-px w-6 ${steps[i + 1].done || steps[i + 1].active ? "bg-coral-300" : "bg-charcoal-200"}`} />
          )}
        </li>
      ))}
    </ol>
  );
}

function buildSteps(contract, requests) {
  const hasFile = !!contract.docx_path;
  const sentCount = requests.filter((r) => ["pending", "viewed"].includes(r.status)).length;
  const signedRoles = new Set(requests.filter((r) => r.status === "signed").map((r) => r.signer_role));
  const allSigned = ["college", "partner", "student"].every((r) => signedRoles.has(r));
  const hasScan = !!contract.signed_scan_path;
  const isCompleted = contract.status === "completed";

  // `active` marks the SINGLE next step the workflow is currently waiting on.
  // A step can be either done or active, never both.
  const steps = [
    { key: "draft", label: "Создан", done: true },
    { key: "generated", label: "Сформирован", done: hasFile },
    { key: "sent", label: "Отправлен сторонам", done: sentCount > 0 || allSigned || hasScan || isCompleted },
    { key: "signed", label: "Подписан ЭЦП всеми", done: allSigned || hasScan || isCompleted },
    { key: "scan", label: "Скан загружен", done: hasScan || isCompleted },
    { key: "completed", label: "Завершён", done: isCompleted },
  ];
  // Mark only the first not-done step as active
  const firstPending = steps.find((s) => !s.done);
  return steps.map((s) => ({ ...s, active: s === firstPending }));
}
