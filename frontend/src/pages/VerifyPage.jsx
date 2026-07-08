import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import BrandLogo from "../components/BrandLogo.jsx";
import { verifyApi } from "../api/endpoints.js";
import { formatDate, formatDateTime } from "../utils/format.js";

const ROLE_LABELS = {
  // Practicum (three-party): college / partner / student
  college: "Колледж",
  partner: "Предприятие",
  student: "Обучающийся",
  // LMS (single-signer) reuses student + adds parent for minors
  parent: "Родитель (законный представитель)",
};

const LEVEL_BADGE = {
  legal:           { label: "Юридически верифицирована (NCANode)", cls: "bg-emerald-100 text-emerald-700" },
  full:            { label: "Криптографически проверена",          cls: "bg-emerald-100 text-emerald-700" },
  document_bound:  { label: "Привязана к документу (GOST)",         cls: "bg-amber-100 text-amber-700"   },
  accepted:        { label: "Принята (без полной проверки)",        cls: "bg-amber-100 text-amber-700"   },
};

export default function VerifyPage() {
  const { code } = useParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await verifyApi.get(code);
        if (!cancelled) setData(res);
      } catch (e) {
        if (!cancelled) {
          const status = e.response?.status;
          if (status === 404) setError("Документ с таким кодом не найден.");
          else setError(e.response?.data?.error || "Не удалось загрузить страницу проверки.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [code]);

  if (loading) return <Wrapper><p className="text-charcoal-500 text-center">Загрузка…</p></Wrapper>;
  if (error)   return <Wrapper><ErrorState message={error} code={code} /></Wrapper>;
  if (!data)   return null;

  const { contract, signatures, summary, integrity, download } = data;
  const allSigned = summary.fully_signed;
  const integrityKnown = integrity.available;
  const integrityOk = integrity.match;

  // Status banner
  let banner;
  if (allSigned && integrityKnown && integrityOk) {
    const partyWord = summary.required_count === 1 ? "сторона подписала"
      : summary.required_count < 5 ? "стороны подписали"
        : "сторон подписали";
    banner = {
      tone: "ok",
      title: "Документ подписан и подлинность подтверждена",
      sub: `Все ${summary.required_count} ${partyWord} договор, хэш SHA-256 архивного файла совпадает с хэшем подписи.`,
    };
  } else if (allSigned && integrityKnown && !integrityOk) {
    banner = {
      tone: "warn",
      title: "Подписи валидны, но архивный файл не совпадает с подписанным",
      sub: "Хэш SHA-256 текущего файла не совпадает с тем, который был зафиксирован при подписании. Возможно, документ был пересформирован после подписания.",
    };
  } else if (summary.signed_count === 0) {
    banner = {
      tone: "pending",
      title: "Документ ожидает подписей",
      sub: `Подписей пока нет (требуется ${summary.required_count}: ${(summary.required_roles || summary.required_parties || []).map((r) => ROLE_LABELS[r] || r).join(", ")}).`,
    };
  } else {
    banner = {
      tone: "partial",
      title: "Документ подписан частично",
      sub: `Подписали ${summary.signed_count} из ${summary.required_count}. Не хватает: ${(summary.missing_roles || summary.missing_parties || []).map((r) => ROLE_LABELS[r] || r).join(", ") || "—"}.`,
    };
  }

  return (
    <Wrapper>
      <Header banner={banner} />

      <section className="card p-6 mb-5">
        <h2 className="section-title mb-4">📋 О документе</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
          <Info label="Номер договора" value={contract.number} strong />
          <Info label="Дата договора" value={formatDate(contract.contract_date)} />
          <Info label="Партнёр" value={contract.partner_name} />
          <Info label="БИН партнёра" value={contract.partner_bin} />
          <Info label="Студент" value={contract.student_name} />
          <Info label="ИИН студента" value={contract.student_iin_masked} hint="скрыто частично" />
          <Info label="Группа / специальность" value={[contract.student_group, contract.student_specialty].filter(Boolean).join(" · ")} />
          <Info label="Период практики" value={
            contract.practice_start
              ? `${formatDate(contract.practice_start)} → ${formatDate(contract.practice_end)}`
              : "—"
          } />
          <Info label="Статус договора" value={contract.status_label} />
          <Info label="Код проверки" value={contract.verification_code} mono />
        </div>

        <div className="divider my-5" />
        <h3 className="font-semibold mb-2 text-charcoal-700">Скачать оригинал</h3>
        <div className="flex flex-wrap gap-2">
          {download.pdf && <a className="btn-secondary" href={download.pdf}>📕 PDF</a>}
          {download.docx && <a className="btn-secondary" href={download.docx}>📄 DOCX</a>}
        </div>
      </section>

      <section className="card p-6 mb-5">
        <h2 className="section-title mb-4">🖋️ Список подписей</h2>
        <ul className="space-y-3">
          {(summary.required_roles || summary.required_parties || []).map((role, idx) => {
            const sig = signatures.find((s) => s.signer_role === role || s.signer_party === role);
            // LMS facsimile rows arrive with verification_level=null. Treat
            // them as "facsimile/accepted" rather than a green crypto badge —
            // a legal-verifier page must never claim a stronger assurance than
            // the backend actually attested.
            const level = sig?.verification_level;
            const levelInfo = level ? LEVEL_BADGE[level] : null;
            return (
              <li key={role} className={`rounded-xl border p-4 ${sig ? "border-emerald-200 bg-emerald-50/40" : "border-charcoal-100"}`}>
                <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
                  <div className="font-semibold text-charcoal-800">
                    Подпись №{idx + 1}{" "}
                    <span className="text-charcoal-500 font-normal text-sm">— {ROLE_LABELS[role] || role}</span>
                  </div>
                  {sig ? (
                    <span className={`badge ${levelInfo?.cls || "bg-charcoal-100 text-charcoal-600"}`}
                          title={level ? "" : "Уровень верификации не указан"}>
                      {levelInfo?.label || "Подписано (без указания уровня)"}
                    </span>
                  ) : (
                    <span className="badge bg-charcoal-100 text-charcoal-600">Не подписано</span>
                  )}
                </div>
                {sig ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-sm text-charcoal-600 mt-2">
                    <div><span className="text-charcoal-400">Подписант: </span><b className="text-charcoal-800">{sig.signer_full_name}</b></div>
                    <div><span className="text-charcoal-400">ИИН / БИН: </span>{sig.signer_iin_or_bin_masked || "—"}</div>
                    <div><span className="text-charcoal-400">Серийный № сертификата: </span><span className="font-mono">…{sig.signer_serial_tail || "—"}</span></div>
                    <div><span className="text-charcoal-400">Время подписания: </span>{formatDateTime(sig.created_at)}</div>
                    {sig.signed_payload_sha256 && (
                      <div className="md:col-span-2 break-all font-mono text-[11px] text-charcoal-500">
                        SHA-256: {sig.signed_payload_sha256}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="text-xs text-charcoal-500">Ожидается ЭЦП от роли «{ROLE_LABELS[role] || role}».</div>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      <section className="card p-6 mb-5">
        <h2 className="section-title mb-4">🔒 Целостность документа</h2>
        {integrityKnown ? (
          <div className="space-y-2 text-sm">
            <div className="font-mono text-xs break-all bg-charcoal-50 rounded-xl px-3 py-2">
              <span className="text-charcoal-400">SHA-256 подписанного:</span><br />
              {integrity.signed_payload_sha256}
            </div>
            <div className="font-mono text-xs break-all bg-charcoal-50 rounded-xl px-3 py-2">
              <span className="text-charcoal-400">SHA-256 архивного файла:</span><br />
              {integrity.current_file_sha256}
            </div>
            <div className={`text-sm font-semibold ${integrityOk ? "text-emerald-700" : "text-amber-700"}`}>
              {integrityOk
                ? "✓ Хэши совпадают — документ не был изменён после подписания."
                : "⚠ Хэши не совпадают — архивный файл отличается от подписанного."}
            </div>
          </div>
        ) : (
          <p className="text-sm text-charcoal-500">
            Хэш будет показан после того, как хотя бы одна сторона подпишет документ.
          </p>
        )}
      </section>

      <footer className="text-center text-xs text-charcoal-400 mt-10 flex flex-col items-center gap-2 pb-10">
        <img src="/ccu-logo.png" alt="" className="h-10 w-10 opacity-60" />
        © {new Date().getFullYear()} Колледж УО «Каспийский общественный университет» · CCU PRACTICUM
        <span>
          Документ согласно п. 1 ст. 7 ЗРК от 7 января 2003 года № 370-II «Об электронном документе и электронной цифровой подписи»
          равнозначен документу на бумажном носителе при наличии действительных ЭЦП всех сторон.
        </span>
      </footer>
    </Wrapper>
  );
}

function Wrapper({ children }) {
  return (
    <div className="min-h-screen bg-gradient-to-br from-coral-50/40 via-white to-charcoal-50/60 py-6 px-4 md:py-10">
      <div className="max-w-3xl mx-auto">{children}</div>
    </div>
  );
}

function Header({ banner }) {
  const tones = {
    ok:      "bg-gradient-to-br from-emerald-500 to-emerald-700 text-white",
    warn:    "bg-gradient-to-br from-amber-500 to-amber-700 text-white",
    partial: "bg-gradient-to-br from-coral-500 to-coral-700 text-white",
    pending: "bg-gradient-to-br from-charcoal-700 to-charcoal-900 text-white",
  };
  const icon = { ok: "✓", warn: "⚠", partial: "⏳", pending: "○" }[banner.tone];
  return (
    <header className={`rounded-3xl shadow-soft p-7 md:p-8 mb-6 ${tones[banner.tone]}`}>
      <div className="flex items-center gap-3 mb-5">
        <BrandLogo size={48} withWordmark variant="light" />
      </div>
      <div className="flex items-start gap-4">
        <div className="h-14 w-14 rounded-2xl bg-white/15 grid place-items-center text-3xl backdrop-blur shrink-0">
          {icon}
        </div>
        <div>
          <h1 className="font-serif text-2xl md:text-3xl font-bold leading-tight">
            {banner.title}
          </h1>
          <p className="opacity-90 text-sm mt-2">{banner.sub}</p>
        </div>
      </div>
    </header>
  );
}

function Info({ label, value, strong = false, mono = false, hint }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide text-charcoal-400 font-semibold">
        {label}
        {hint && <span className="ml-1 normal-case font-normal text-charcoal-300">({hint})</span>}
      </div>
      <div className={`text-charcoal-800 ${strong ? "font-bold" : "font-medium"} ${mono ? "font-mono text-[12px]" : ""}`}>
        {value || "—"}
      </div>
    </div>
  );
}

function ErrorState({ message, code }) {
  return (
    <div className="card p-10 text-center">
      <div className="text-5xl mb-3">⚠️</div>
      <h1 className="font-serif text-2xl font-bold mb-2">Документ не найден</h1>
      <p className="text-charcoal-500">{message}</p>
      <p className="text-xs text-charcoal-400 mt-4 font-mono">code: {code}</p>
    </div>
  );
}
