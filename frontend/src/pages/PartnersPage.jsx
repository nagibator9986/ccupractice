import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import toast from "react-hot-toast";
import { Building2, CircleAlert, CircleCheck, Clock, Mail, Minus, Pencil, Phone, Plus, RefreshCw, TriangleAlert, Trash2, Eye } from "lucide-react";
import clsx from "clsx";
import PageHeader from "../components/PageHeader.jsx";
import Modal from "../components/Modal.jsx";
import EmptyState from "../components/EmptyState.jsx";
import SearchInput from "../components/SearchInput.jsx";
import Pagination from "../components/Pagination.jsx";
import ProgressBar from "../components/ProgressBar.jsx";
import { CardSkeleton, TableSkeleton } from "../components/Skeleton.jsx";
import { SelectField, TextArea, TextField } from "../components/Field.jsx";
import { useConfirm } from "../components/ConfirmDialog.jsx";
import usePagination from "../hooks/usePagination.js";
import { errorText, partnersApi } from "../api/endpoints.js";
import { useAuth } from "../context/AuthContext.jsx";
import { formatDate, formatPhone, plural } from "../utils/format.js";
import { toneOf } from "../utils/tones.js";

// Stored values stay `active | suspended | archive`; labels are for people.
const STATUS_META = {
  active: { label: "Действует", tone: "emerald" },
  suspended: { label: "Приостановлен", tone: "amber" },
  archive: { label: "В архиве", tone: "slate" },
};
const STATUS_OPTIONS = Object.entries(STATUS_META).map(([value, m]) => ({ value, label: m.label }));
const VALIDITY_FILTERS = [
  { value: "expired", label: "Договор истёк" },
  { value: "soon", label: "Скоро истекает" },
];

const EMPTY = {
  organization_name: "",
  bin: "",
  legal_address: "",
  actual_address: "",
  contact_person: "",
  phone: "",
  email: "",
  director_full_name: "",
  director_position: "",
  director_basis: "Устава",
  specialty: "",
  seats_count: "",
  contract_status: "active",
  contract_valid_until: "",
  notes: "",
  bank_name: "",
  bank_bik: "",
  bank_iik: "",
};

function draftFrom(p) {
  const d = { ...EMPTY };
  for (const k of Object.keys(EMPTY)) d[k] = p?.[k] == null ? EMPTY[k] : String(p[k]);
  if (p?.id != null && p.contract_status == null) d.contract_status = "active";
  if (p?.id != null && p.director_basis == null) d.director_basis = "";
  return d;
}

function validate(d) {
  const e = {};
  if (!d.organization_name.trim()) e.organization_name = "Укажите наименование организации";
  const bin = d.bin.trim();
  if (bin && !/^\d{12}$/.test(bin)) e.bin = "БИН должен состоять из 12 цифр";
  const email = d.email.trim();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) e.email = "Проверьте адрес электронной почты";
  const seats = d.seats_count.trim();
  if (seats !== "" && !/^\d+$/.test(seats)) e.seats_count = "Введите целое число, не меньше 0";
  return e;
}

function payloadFrom(d) {
  const out = {};
  for (const k of Object.keys(EMPTY)) out[k] = typeof d[k] === "string" ? d[k].trim() : d[k];
  const seats = d.seats_count.trim();
  out.seats_count = seats === "" ? 0 : Number(seats);
  out.contract_valid_until = d.contract_valid_until || null;
  return out;
}

const statusKey = (p) => p.contract_status || "active";

// ───────────────────────────── small presentational pieces ─────────────────────────────

function PartnerStatus({ value }) {
  const meta = STATUS_META[value];
  // Unknown stored values stay visible as they are.
  return <span className={clsx("badge", toneOf(meta?.tone).badge)}>{meta?.label || value}</span>;
}

function ValidityBadge({ partner }) {
  const { validity, valid_days_left: days, contract_valid_until: until } = partner;
  if (!until) {
    return (
      <span className="badge bg-charcoal-100 text-charcoal-500">
        <Minus className="h-3.5 w-3.5" aria-hidden="true" />
        не задан
      </span>
    );
  }
  if (validity === "expired") {
    return (
      <span className={clsx("badge", toneOf("red").badge)}>
        <CircleAlert className="h-3.5 w-3.5" aria-hidden="true" />
        истёк {formatDate(until)}
      </span>
    );
  }
  if (validity === "soon") {
    return (
      <span className={clsx("badge", toneOf("amber").badge)} title={`до ${formatDate(until)}`}>
        <Clock className="h-3.5 w-3.5" aria-hidden="true" />
        осталось {days} дн.
      </span>
    );
  }
  if (validity === "ok") {
    return (
      <span className={clsx("badge", toneOf("emerald").badge)}>
        <CircleCheck className="h-3.5 w-3.5" aria-hidden="true" />
        до {formatDate(until)}
      </span>
    );
  }
  return <span className="badge bg-charcoal-100 text-charcoal-600">до {formatDate(until)}</span>;
}

function SeatsCell({ partner }) {
  const seats = Number(partner.seats_count) || 0;
  const placed = partner.students_count;
  const studentsLink = (text) => (
    <Link to={`/students?partner_id=${partner.id}`} className="hover:text-coral-600 hover:underline">
      {text}
    </Link>
  );
  if (placed === undefined) {
    return seats ? <span className="text-sm text-charcoal-800">мест: {seats}</span> : <span className="text-sm text-charcoal-400">без лимита</span>;
  }
  if (!seats) {
    return (
      <div className="text-sm">
        <div className="text-charcoal-400">без лимита</div>
        <div className="text-xs text-charcoal-500">{placed > 0 ? studentsLink(`занято ${placed}`) : "занято 0"}</div>
      </div>
    );
  }
  const over = Boolean(partner.overbooked);
  const full = !over && placed >= seats;
  return (
    <div className="min-w-[8.5rem]">
      <ProgressBar
        value={placed}
        max={seats}
        height="sm"
        tone={over ? "red" : full ? "amber" : "blue"}
        label={`Занято мест: ${placed} из ${seats}`}
      />
      <div className={clsx("mt-1 text-xs", over ? "font-semibold text-red-600" : "text-charcoal-600")}>
        {over && <TriangleAlert className="mr-1 inline h-3 w-3 align-[-1px]" aria-hidden="true" />}
        {studentsLink(`занято ${placed} из ${seats}`)}
        {over ? " — больше лимита" : full ? " — мест нет" : ""}
      </div>
    </div>
  );
}

function ContractsLink({ partner }) {
  const n = partner.contracts_count;
  if (n === undefined) return <span className="text-charcoal-400">—</span>;
  if (!n) return <span className="text-charcoal-400">0</span>;
  return (
    <Link to={`/contracts?partner_id=${partner.id}`} className="link font-semibold tabular-nums">
      {n}
    </Link>
  );
}

function ContactLines({ partner }) {
  const phone = formatPhone(partner.phone);
  return (
    <div className="min-w-0 text-sm">
      <div className="truncate text-charcoal-800">{partner.contact_person || <span className="text-charcoal-400">—</span>}</div>
      {phone && (
        <a href={`tel:${String(partner.phone).replace(/[^\d+]/g, "")}`} className="flex items-center gap-1 text-xs text-charcoal-600 hover:text-coral-600">
          <Phone className="h-3 w-3" aria-hidden="true" />
          {phone}
        </a>
      )}
      {partner.email && (
        <a href={`mailto:${partner.email}`} className="flex items-center gap-1 truncate text-xs text-charcoal-600 hover:text-coral-600">
          <Mail className="h-3 w-3 shrink-0" aria-hidden="true" />
          <span className="truncate">{partner.email}</span>
        </a>
      )}
    </div>
  );
}

function RowActions({ partner, isAdmin, onEdit, onDelete }) {
  return (
    <div className="flex items-center justify-end gap-1">
      <button
        type="button"
        className="btn-ghost btn-icon"
        onClick={() => onEdit(partner)}
        aria-label={`${isAdmin ? "Изменить" : "Открыть карточку"}: ${partner.organization_name}`}
        title={isAdmin ? "Изменить" : "Открыть карточку"}
      >
        {isAdmin ? <Pencil className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}
      </button>
      {isAdmin && (
        <button
          type="button"
          className="btn-ghost btn-icon text-red-600 hover:!bg-red-50 hover:!text-red-700"
          onClick={() => onDelete(partner)}
          aria-label={`Удалить: ${partner.organization_name}`}
          title="Удалить"
        >
          <Trash2 className="h-4 w-4" aria-hidden="true" />
        </button>
      )}
    </div>
  );
}

function PartnerRow({ partner, isAdmin, onEdit, onDelete }) {
  return (
    <tr>
      <td className="min-w-[12rem] max-w-[18rem]">
        <button type="button" onClick={() => onEdit(partner)} className="text-left font-semibold text-charcoal-900 hover:text-coral-600">
          {partner.organization_name}
        </button>
        {partner.legal_address && <div className="truncate text-xs text-charcoal-500">{partner.legal_address}</div>}
        {partner.specialty && <div className="truncate text-xs text-charcoal-600 2xl:hidden">{partner.specialty}</div>}
      </td>
      <td className="whitespace-nowrap tabular-nums">{partner.bin || <span className="text-charcoal-400">—</span>}</td>
      <td className="hidden max-w-[12rem] 2xl:table-cell">
        <div className="line-clamp-2 text-sm">{partner.specialty || <span className="text-charcoal-400">—</span>}</div>
      </td>
      <td>
        <SeatsCell partner={partner} />
      </td>
      <td>
        <div className="flex flex-col items-start gap-1">
          <PartnerStatus value={statusKey(partner)} />
          <ValidityBadge partner={partner} />
        </div>
      </td>
      <td className="text-center">
        <ContractsLink partner={partner} />
      </td>
      <td className="max-w-[11rem]">
        <ContactLines partner={partner} />
      </td>
      <td className="whitespace-nowrap">
        <RowActions partner={partner} isAdmin={isAdmin} onEdit={onEdit} onDelete={onDelete} />
      </td>
    </tr>
  );
}

function PartnerCard({ partner, isAdmin, onEdit, onDelete }) {
  return (
    <li className="card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <button type="button" onClick={() => onEdit(partner)} className="break-words text-left text-base font-semibold text-charcoal-900 hover:text-coral-600">
            {partner.organization_name}
          </button>
          {partner.legal_address && <div className="text-xs text-charcoal-500">{partner.legal_address}</div>}
          {partner.specialty && <div className="mt-0.5 text-xs text-charcoal-600">{partner.specialty}</div>}
        </div>
        <PartnerStatus value={statusKey(partner)} />
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
        <div>
          <dt className="text-[11px] font-semibold uppercase tracking-wide text-charcoal-400">БИН</dt>
          <dd className="tabular-nums">{partner.bin || "—"}</dd>
        </div>
        <div>
          <dt className="text-[11px] font-semibold uppercase tracking-wide text-charcoal-400">Договоров</dt>
          <dd>
            <ContractsLink partner={partner} />
          </dd>
        </div>
        <div className="col-span-2">
          <dt className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-charcoal-400">Места</dt>
          <dd>
            <SeatsCell partner={partner} />
          </dd>
        </div>
        <div className="col-span-2">
          <dt className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-charcoal-400">Срок договора</dt>
          <dd>
            <ValidityBadge partner={partner} />
          </dd>
        </div>
        <div className="col-span-2">
          <dt className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-charcoal-400">Контакт</dt>
          <dd>
            <ContactLines partner={partner} />
          </dd>
        </div>
      </dl>
      <div className="mt-3 border-t border-charcoal-100 pt-2">
        <RowActions partner={partner} isAdmin={isAdmin} onEdit={onEdit} onDelete={onDelete} />
      </div>
    </li>
  );
}

function FormSection({ title, description, children }) {
  return (
    <section className="space-y-3">
      <div>
        <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-charcoal-500">{title}</h3>
        {description && <p className="mt-0.5 text-xs text-charcoal-400">{description}</p>}
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">{children}</div>
    </section>
  );
}

function PartnerForm({ draft, errors, readOnly, onField, stats, partnerId, formRef }) {
  const statusOptions = STATUS_OPTIONS.some((o) => o.value === draft.contract_status) || !draft.contract_status
    ? STATUS_OPTIONS
    : [...STATUS_OPTIONS, { value: draft.contract_status, label: draft.contract_status }];
  const dis = { disabled: readOnly };
  return (
    <div ref={formRef} className="divide-y divide-charcoal-100 [&>section]:py-5 [&>section:first-child]:pt-0 [&>section:last-child]:pb-0">
      <FormSection title="Организация">
        <div className="sm:col-span-2">
          <TextField
            label="Наименование организации"
            required
            value={draft.organization_name}
            onChange={onField("organization_name")}
            error={errors.organization_name}
            data-autofocus
            {...dis}
          />
        </div>
        <TextField
          label="БИН"
          value={draft.bin}
          onChange={(v) => onField("bin")(v.replace(/\D/g, "").slice(0, 12))}
          error={errors.bin}
          hint="12 цифр"
          inputMode="numeric"
          autoComplete="off"
          {...dis}
        />
        <TextField label="Контактное лицо" value={draft.contact_person} onChange={onField("contact_person")} {...dis} />
        <TextField label="Юридический адрес" value={draft.legal_address} onChange={onField("legal_address")} {...dis} />
        <TextField label="Фактический адрес" value={draft.actual_address} onChange={onField("actual_address")} {...dis} />
        <TextField label="Телефон" type="tel" value={draft.phone} onChange={onField("phone")} {...dis} />
        <TextField label="Email" type="email" value={draft.email} onChange={onField("email")} error={errors.email} {...dis} />
      </FormSection>

      <FormSection title="Руководитель" description="Подставляется в договор как подписант от предприятия">
        <TextField label="ФИО руководителя" value={draft.director_full_name} onChange={onField("director_full_name")} {...dis} />
        <TextField label="Должность" value={draft.director_position} onChange={onField("director_position")} {...dis} />
        <div className="sm:col-span-2">
          <TextField
            label="Действует на основании"
            value={draft.director_basis}
            onChange={onField("director_basis")}
            hint="Например: Устава или Доверенности № 12"
            {...dis}
          />
        </div>
      </FormSection>

      <FormSection title="Практика и места">
        <TextField label="Направление / специальность" value={draft.specialty} onChange={onField("specialty")} {...dis} />
        <TextField
          label="Количество мест"
          type="number"
          min={0}
          inputMode="numeric"
          value={draft.seats_count}
          onChange={onField("seats_count")}
          error={errors.seats_count}
          hint="0 или пусто — без ограничения"
          {...dis}
        />
        <SelectField
          label="Статус договора с предприятием"
          value={draft.contract_status}
          onChange={onField("contract_status")}
          options={statusOptions}
          placeholder="Не указан"
          disabled={readOnly}
        />
        <TextField label="Договор действует до" type="date" value={draft.contract_valid_until} onChange={onField("contract_valid_until")} {...dis} />
        {stats && (
          <p className="text-sm text-charcoal-600 sm:col-span-2">
            Сейчас закреплено студентов:{" "}
            <Link to={`/students?partner_id=${partnerId}`} className="link font-semibold">
              {stats.students_count}
            </Link>
            {Number(stats.seats_count) > 0 ? ` из ${stats.seats_count} мест` : ""}. Договоров практики:{" "}
            <Link to={`/contracts?partner_id=${partnerId}`} className="link font-semibold">
              {stats.contracts_count}
            </Link>
            .
          </p>
        )}
        <div className="sm:col-span-2">
          <TextArea label="Примечание" value={draft.notes} onChange={onField("notes")} {...dis} />
        </div>
      </FormSection>

      <FormSection title="Банк" description="Реквизиты попадают в договор, если они указаны">
        <div className="sm:col-span-2">
          <TextField label="Банк" value={draft.bank_name} onChange={onField("bank_name")} {...dis} />
        </div>
        <TextField label="БИК" value={draft.bank_bik} onChange={onField("bank_bik")} {...dis} />
        <TextField label="ИИК" value={draft.bank_iik} onChange={onField("bank_iik")} {...dis} />
      </FormSection>
    </div>
  );
}

// ───────────────────────────────────── page ─────────────────────────────────────

export default function PartnersPage() {
  const { isAdmin } = useAuth();
  const confirm = useConfirm();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const urlQ = searchParams.get("q") || "";
  const status = searchParams.get("status") || "";
  const validity = searchParams.get("validity") || "";
  const freeOnly = searchParams.get("free") === "1";
  const editParam = searchParams.get("edit");
  const newParam = searchParams.get("new");

  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [qInput, setQInput] = useState(urlQ);

  const [modal, setModal] = useState(null); // { id, stats } | null
  const [draft, setDraft] = useState(EMPTY);
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const formRef = useRef(null);
  const requestSeq = useRef(0);

  const setParams = useCallback(
    (changes) =>
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          for (const [k, v] of Object.entries(changes)) {
            if (v === "" || v == null || v === false) next.delete(k);
            else next.set(k, v === true ? "1" : v);
          }
          return next;
        },
        { replace: true },
      ),
    [setSearchParams],
  );

  // Search box: type freely, push to the URL (and so to the server) 250 ms after the last key.
  useEffect(() => {
    const t = setTimeout(() => {
      if (qInput.trim() !== urlQ) setParams({ q: qInput.trim() });
    }, 250);
    return () => clearTimeout(t);
  }, [qInput]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    setQInput((cur) => (cur.trim() === urlQ ? cur : urlQ));
  }, [urlQ]);

  const load = useCallback(async () => {
    const seq = ++requestSeq.current;
    setLoading(true);
    setLoadError(null);
    try {
      const data = await partnersApi.list({ q: urlQ || undefined, with_stats: 1 });
      if (seq !== requestSeq.current) return;
      setItems(data.items || []);
    } catch (e) {
      if (seq !== requestSeq.current) return;
      const msg = await errorText(e, "Не удалось загрузить партнёров");
      setItems([]);
      setLoadError(msg);
      const s = e.response?.status;
      if (s !== 401 && s !== 422) toast.error(msg);
    } finally {
      if (seq === requestSeq.current) setLoading(false);
    }
  }, [urlQ]);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = useMemo(
    () =>
      items.filter(
        (p) =>
          (!status || statusKey(p) === status) &&
          (!validity || p.validity === validity) &&
          (!freeOnly || (p.seats_free ?? 0) > 0),
      ),
    [items, status, validity, freeOnly],
  );
  const filtersActive = Boolean(urlQ || status || validity || freeOnly);
  const { page, setPage, pageSize, setPageSize, totalPages, pageItems, total } = usePagination(
    filtered,
    50,
    `${urlQ}|${status}|${validity}|${freeOnly}`,
  );

  function resetFilters() {
    setQInput("");
    setParams({ q: "", status: "", validity: "", free: "" });
  }

  // ── modal ──
  function openPartner(p) {
    setDraft(draftFrom(p));
    setErrors({});
    setModal({
      id: p.id,
      stats: p.students_count !== undefined ? { students_count: p.students_count, contracts_count: p.contracts_count, seats_count: p.seats_count } : null,
    });
  }
  function openNew() {
    setDraft({ ...EMPTY });
    setErrors({});
    setModal({ id: null, stats: null });
  }
  function closeModal() {
    if (!saving) setModal(null);
  }
  const onField = (key) => (value) => {
    setDraft((d) => ({ ...d, [key]: value }));
    setErrors((e) => (e[key] ? { ...e, [key]: undefined } : e));
  };

  // ?edit=<id> / ?new=1 deep links (dashboard, readiness links).
  useEffect(() => {
    if (!editParam && !newParam) return undefined;
    let cancelled = false;
    (async () => {
      if (editParam) {
        try {
          const { item } = await partnersApi.get(editParam);
          if (cancelled) return;
          openPartner(item);
        } catch (e) {
          if (cancelled) return;
          toast.error(await errorText(e, "Партнёр не найден"));
        }
      } else if (isAdmin) {
        openNew();
      }
      if (!cancelled) setParams({ edit: "", new: "" });
    })();
    return () => {
      cancelled = true;
    };
  }, [editParam, newParam]); // eslint-disable-line react-hooks/exhaustive-deps

  async function onSave() {
    const found = validate(draft);
    if (Object.keys(found).length) {
      setErrors(found);
      requestAnimationFrame(() => formRef.current?.querySelector('[aria-invalid="true"]')?.focus());
      return;
    }
    setSaving(true);
    try {
      const payload = payloadFrom(draft);
      if (modal.id) {
        await partnersApi.update(modal.id, payload);
        toast.success("Партнёр обновлён");
      } else {
        await partnersApi.create(payload);
        toast.success("Партнёр добавлен");
      }
      setModal(null);
      load();
    } catch (e) {
      const msg = await errorText(e, "Не удалось сохранить партнёра");
      if (e.response?.status === 409 && /БИН/.test(msg)) setErrors({ bin: msg });
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  }

  // ── delete ──
  async function showBlocked(p, text) {
    const hasContracts = (p.contracts_count || 0) > 0 || /договор/i.test(text);
    const go = await confirm({
      title: "Нельзя удалить партнёра",
      message: text,
      confirmText: hasContracts ? "Показать договоры" : "Показать студентов",
      cancelText: "Закрыть",
    });
    if (go) navigate(hasContracts ? `/contracts?partner_id=${p.id}` : `/students?partner_id=${p.id}`);
  }

  async function onDelete(p) {
    const contracts = p.contracts_count || 0;
    const students = p.students_count || 0;
    if (contracts > 0 || students > 0) {
      const parts = [];
      if (contracts > 0) parts.push(`${contracts} ${plural(contracts, "договор", "договора", "договоров")}`);
      if (students > 0) parts.push(`${students} ${plural(students, "студент", "студента", "студентов")}`);
      await showBlocked(
        p,
        `У «${p.organization_name}» есть ${parts.join(" и ")}. Сначала удалите договоры и переназначьте студентов другому предприятию.`,
      );
      return;
    }
    const ok = await confirm({
      title: "Удалить партнёра?",
      message: `«${p.organization_name}» будет удалён без возможности восстановления.`,
      confirmText: "Удалить",
      tone: "danger",
    });
    if (!ok) return;
    try {
      await partnersApi.remove(p.id);
      toast.success("Партнёр удалён");
      load();
    } catch (e) {
      const msg = await errorText(e, "Не удалось удалить партнёра");
      if (e.response?.status === 409) await showBlocked(p, msg);
      else toast.error(msg);
    }
  }

  const colCount = 8;
  const showEmpty = !loading && !loadError && filtered.length === 0;
  const catalogEmpty = showEmpty && items.length === 0 && !urlQ;

  return (
    <div>
      <PageHeader
        title="Партнёры"
        description="Предприятия — базы практики: реквизиты, места и срок действия договора. Договоры оформляются только с предприятием из этого списка."
        actions={
          isAdmin && (
            <button type="button" onClick={openNew} className="btn-primary whitespace-nowrap">
              <Plus className="h-4 w-4" aria-hidden="true" />
              Добавить партнёра
            </button>
          )
        }
      />

      <div className="card mb-3 flex flex-col gap-3 p-3 sm:p-4 md:flex-row md:flex-wrap md:items-center">
        <SearchInput
          className="md:min-w-[16rem] md:flex-1"
          value={qInput}
          onChange={setQInput}
          placeholder="Название, БИН, контакт…"
        />
        <select className="input md:w-48" value={status} onChange={(e) => setParams({ status: e.target.value })} aria-label="Статус договора">
          <option value="">Все статусы</option>
          {STATUS_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <select className="input md:w-48" value={validity} onChange={(e) => setParams({ validity: e.target.value })} aria-label="Срок договора">
          <option value="">Любой срок</option>
          {VALIDITY_FILTERS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <label
          className="flex min-h-[44px] cursor-pointer select-none items-center gap-2.5 rounded-xl border border-charcoal-200 bg-white px-3.5 text-sm hover:border-coral-300 md:min-h-0 md:py-2.5"
          title="Только предприятия с указанным лимитом, где остались свободные места"
        >
          <input
            type="checkbox"
            className="h-4 w-4 shrink-0 accent-coral-500"
            checked={freeOnly}
            onChange={(e) => setParams({ free: e.target.checked })}
          />
          Есть свободные места
        </label>
      </div>

      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 px-1 text-sm text-charcoal-500" aria-live="polite">
        <span>
          {loading ? "Загрузка…" : `Найдено: ${filtered.length}${filtered.length !== items.length ? ` из ${items.length}` : ""}`}
        </span>
        {filtersActive && (
          <button type="button" className="link text-sm" onClick={resetFilters}>
            Сбросить фильтры
          </button>
        )}
      </div>

      {loadError && !loading ? (
        <div className="card">
          <EmptyState
            icon={TriangleAlert}
            title="Не удалось загрузить партнёров"
            description={loadError}
            action={
              <button type="button" className="btn-primary" onClick={load}>
                <RefreshCw className="h-4 w-4" aria-hidden="true" />
                Повторить
              </button>
            }
          />
        </div>
      ) : showEmpty ? (
        <div className="card">
          {catalogEmpty ? (
            <EmptyState
              icon={Building2}
              title="Партнёров пока нет"
              description="Договор практики оформляется с предприятием, поэтому сначала добавьте базы практики. Студентов можно загрузить позже."
              action={
                isAdmin ? (
                  <button type="button" className="btn-primary" onClick={openNew}>
                    <Plus className="h-4 w-4" aria-hidden="true" />
                    Добавить партнёра
                  </button>
                ) : null
              }
            />
          ) : (
            <EmptyState
              icon={Building2}
              title="Ничего не найдено"
              description="Попробуйте изменить поиск или сбросить фильтры."
              action={
                <button type="button" className="btn-secondary" onClick={resetFilters}>
                  Сбросить фильтры
                </button>
              }
            />
          )}
        </div>
      ) : (
        <>
          {/* ≥ xl: full table */}
          <div className="card hidden overflow-x-auto xl:block" aria-busy={loading || undefined}>
            <table className="table-default">
              <thead>
                <tr>
                  <th>Организация</th>
                  <th>БИН</th>
                  <th className="hidden 2xl:table-cell">Специальность</th>
                  <th>Места</th>
                  <th>Статус и срок договора</th>
                  <th className="text-center">Договоров</th>
                  <th>Контакт</th>
                  <th>
                    <span className="sr-only">Действия</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <TableSkeleton rows={6} cols={colCount} />
                ) : (
                  pageItems.map((p) => <PartnerRow key={p.id} partner={p} isAdmin={isAdmin} onEdit={openPartner} onDelete={onDelete} />)
                )}
              </tbody>
            </table>
          </div>

          {/* < xl: cards */}
          <ul className="grid gap-3 md:grid-cols-2 xl:hidden" aria-busy={loading || undefined}>
            {loading
              ? [0, 1, 2, 3].map((i) => (
                  <li key={i}>
                    <CardSkeleton lines={4} />
                  </li>
                ))
              : pageItems.map((p) => <PartnerCard key={p.id} partner={p} isAdmin={isAdmin} onEdit={openPartner} onDelete={onDelete} />)}
          </ul>

          {!loading && (
            <Pagination page={page} totalPages={totalPages} total={total} pageSize={pageSize} onPage={setPage} onPageSize={setPageSize} />
          )}
        </>
      )}

      <Modal
        open={!!modal}
        onClose={closeModal}
        size="xl"
        title={modal?.id ? (isAdmin ? "Редактирование партнёра" : "Карточка партнёра") : "Новый партнёр"}
        description={isAdmin ? undefined : "Только просмотр"}
        footer={
          isAdmin ? (
            <>
              <button type="button" className="btn-secondary" onClick={closeModal} disabled={saving}>
                Отмена
              </button>
              <button type="button" className="btn-primary" onClick={onSave} disabled={saving}>
                {saving ? "Сохраняем…" : "Сохранить"}
              </button>
            </>
          ) : (
            <button type="button" className="btn-secondary" onClick={closeModal}>
              Закрыть
            </button>
          )
        }
      >
        {modal && (
          <PartnerForm
            draft={draft}
            errors={errors}
            readOnly={!isAdmin}
            onField={onField}
            stats={modal.stats}
            partnerId={modal.id}
            formRef={formRef}
          />
        )}
      </Modal>
    </div>
  );
}
