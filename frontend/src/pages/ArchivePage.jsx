import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import toast from "react-hot-toast";
import {
  Archive,
  ChevronDown,
  ChevronRight,
  FileSpreadsheet,
  FileText,
  FileType,
  Folder,
  FolderOpen,
  FolderTree,
  List,
  Loader2,
  RefreshCw,
  ScanLine,
  TriangleAlert,
} from "lucide-react";
import PageHeader from "../components/PageHeader.jsx";
import Tabs from "../components/Tabs.jsx";
import SearchInput from "../components/SearchInput.jsx";
import Pagination from "../components/Pagination.jsx";
import EmptyState from "../components/EmptyState.jsx";
import StatusBadge from "../components/StatusBadge.jsx";
import { CardSkeleton, TableSkeleton } from "../components/Skeleton.jsx";
import usePagination from "../hooks/usePagination.js";
import { archiveApi, contractsApi, errorText } from "../api/endpoints.js";
import { formatDate, plural } from "../utils/format.js";

const VIEW_OPTIONS = [
  { value: "list", label: "Список", icon: List },
  { value: "tree", label: "По годам", icon: FolderTree },
];

const FILES = [
  { fmt: "docx", label: "DOCX", Icon: FileText, has: (c) => c.docx_exists },
  { fmt: "pdf", label: "PDF", Icon: FileType, has: (c) => c.pdf_exists },
  { fmt: "scan", label: "Скан", Icon: ScanLine, has: (c) => Boolean(c.signed_scan_path) },
];

function fileName(c, fmt) {
  if (fmt === "scan") {
    const ext = String(c.signed_scan_path || "").split(".").pop();
    return `${c.number}_скан.${ext && ext.length <= 5 ? ext : "pdf"}`;
  }
  return `${c.number}.${fmt}`;
}

function matchesQuery(c, q) {
  if (!q) return true;
  const needle = q.toLowerCase();
  return [c.number, c.partner_name, c.student_name, c.student_group].some((v) => String(v || "").toLowerCase().includes(needle));
}

/** Year -> partner -> contracts, same order as the server tree (year desc, partner A-Z, number A-Z). */
function buildTree(contracts) {
  const years = new Map();
  for (const c of contracts) {
    const yk = String(c.year);
    if (!years.has(yk)) years.set(yk, new Map());
    const partners = years.get(yk);
    const pk = c.partner_name || "Без предприятия";
    if (!partners.has(pk)) partners.set(pk, []);
    partners.get(pk).push(c);
  }
  return [...years.entries()]
    .sort((a, b) => Number(b[0]) - Number(a[0]))
    .map(([year, partners]) => {
      const list = [...partners.entries()]
        .sort((a, b) => a[0].localeCompare(b[0], "ru"))
        .map(([name, items]) => ({
          name,
          items: [...items].sort((a, b) => String(a.number).localeCompare(String(b.number), "ru", { numeric: true })),
        }));
      return { year, total: list.reduce((n, p) => n + p.items.length, 0), partners: list };
    });
}

const countLabel = (n) => `${n} ${plural(n, "договор", "договора", "договоров")}`;

// ───────────────────────────── pieces ─────────────────────────────

function FileButtons({ contract, busyKey, onDownload }) {
  return (
    <div className="flex flex-wrap items-center gap-1">
      {FILES.map(({ fmt, label, Icon, has }) => {
        const available = has(contract);
        const key = `${contract.id}:${fmt}`;
        const busy = busyKey === key;
        if (!available) {
          return (
            <span
              key={fmt}
              className="inline-flex h-8 min-w-[3.25rem] cursor-default items-center justify-center gap-1 rounded-lg px-2 text-xs text-charcoal-300 line-through decoration-charcoal-200"
              title={`${label}: файла нет`}
            >
              <Icon className="h-3.5 w-3.5" aria-hidden="true" />
              {label}
              <span className="sr-only"> — файла нет</span>
            </span>
          );
        }
        return (
          <button
            key={fmt}
            type="button"
            className="inline-flex h-9 min-w-[3.25rem] items-center justify-center gap-1 rounded-lg bg-white px-2 text-xs font-medium text-charcoal-700 ring-1 ring-charcoal-200 transition hover:bg-coral-50 hover:text-coral-700 hover:ring-coral-200 disabled:opacity-60 sm:h-8"
            onClick={() => onDownload(contract, fmt)}
            disabled={Boolean(busyKey)}
            aria-label={`Скачать ${label}: договор № ${contract.number}`}
            title={`Скачать ${label}`}
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Icon className="h-3.5 w-3.5" aria-hidden="true" />}
            {label}
          </button>
        );
      })}
    </div>
  );
}

function ListTable({ rows, loading, busyKey, onDownload }) {
  return (
    <>
      <div className="card hidden overflow-x-auto md:block" aria-busy={loading || undefined}>
        <table className="table-default">
          <thead>
            <tr>
              <th>№ договора</th>
              <th>Предприятие</th>
              <th>Студент</th>
              <th>Дата</th>
              <th>Статус</th>
              <th>Файлы</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <TableSkeleton rows={6} cols={6} />
            ) : (
              rows.map((c) => (
                <tr key={c.id}>
                  <td className="whitespace-nowrap">
                    <Link to={`/contracts/${c.id}`} className="font-semibold text-coral-600 hover:underline">
                      {c.number}
                    </Link>
                  </td>
                  <td className="max-w-[16rem]">
                    <div className="truncate">{c.partner_name}</div>
                  </td>
                  <td className="max-w-[14rem]">
                    <div className="truncate">{c.student_name}</div>
                    {c.student_group && <div className="text-xs text-charcoal-500">{c.student_group}</div>}
                  </td>
                  <td className="whitespace-nowrap">{formatDate(c.contract_date)}</td>
                  <td>
                    <StatusBadge value={c.status} />
                  </td>
                  <td>
                    <FileButtons contract={c} busyKey={busyKey} onDownload={onDownload} />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <ul className="space-y-3 md:hidden" aria-busy={loading || undefined}>
        {loading
          ? [0, 1, 2, 3].map((i) => (
              <li key={i}>
                <CardSkeleton lines={3} />
              </li>
            ))
          : rows.map((c) => (
              <li key={c.id} className="card p-4">
                <div className="flex items-start justify-between gap-2">
                  <Link to={`/contracts/${c.id}`} className="font-semibold text-coral-600 hover:underline">
                    № {c.number}
                  </Link>
                  <StatusBadge value={c.status} />
                </div>
                <div className="mt-1.5 text-sm font-medium text-charcoal-800">{c.student_name}</div>
                <div className="text-xs text-charcoal-500">
                  {[c.student_group, c.partner_name, formatDate(c.contract_date)].filter(Boolean).join(" · ")}
                </div>
                <div className="mt-3">
                  <FileButtons contract={c} busyKey={busyKey} onDownload={onDownload} />
                </div>
              </li>
            ))}
      </ul>
    </>
  );
}

function TreeView({ tree, q, openYears, openPartners, onToggleYear, onTogglePartner, busyKey, onDownload }) {
  return (
    <div className="space-y-3">
      {tree.map((y, yi) => {
        const yearOpen = openYears[y.year] ?? (Boolean(q) || yi === 0);
        const YearIcon = yearOpen ? FolderOpen : Folder;
        return (
          <section key={y.year} className="card overflow-hidden">
            <h2>
              <button
                type="button"
                className="flex min-h-[48px] w-full items-center gap-3 bg-charcoal-50/60 px-4 py-3 text-left hover:bg-charcoal-50 sm:px-5"
                aria-expanded={yearOpen}
                onClick={() => onToggleYear(y.year, yearOpen)}
              >
                {yearOpen ? <ChevronDown className="h-4 w-4 text-charcoal-400" aria-hidden="true" /> : <ChevronRight className="h-4 w-4 text-charcoal-400" aria-hidden="true" />}
                <YearIcon className="h-5 w-5 text-coral-500" aria-hidden="true" />
                <span className="font-serif text-lg font-semibold text-charcoal-900">{y.year} год</span>
                <span className="ml-auto text-xs text-charcoal-500">
                  {countLabel(y.total)} · {y.partners.length} {plural(y.partners.length, "предприятие", "предприятия", "предприятий")}
                </span>
              </button>
            </h2>
            {yearOpen && (
              <ul className="divide-y divide-charcoal-100 border-t border-charcoal-100">
                {y.partners.map((p) => {
                  const key = `${y.year}|${p.name}`;
                  const open = openPartners[key] ?? Boolean(q);
                  const PIcon = open ? FolderOpen : Folder;
                  return (
                    <li key={key}>
                      <button
                        type="button"
                        className="flex min-h-[44px] w-full items-center gap-2.5 px-4 py-2.5 text-left hover:bg-coral-50/30 sm:px-5 sm:pl-10"
                        aria-expanded={open}
                        onClick={() => onTogglePartner(key, open)}
                      >
                        {open ? <ChevronDown className="h-4 w-4 shrink-0 text-charcoal-400" aria-hidden="true" /> : <ChevronRight className="h-4 w-4 shrink-0 text-charcoal-400" aria-hidden="true" />}
                        <PIcon className="h-4 w-4 shrink-0 text-charcoal-500" aria-hidden="true" />
                        <span className="min-w-0 flex-1 truncate text-sm font-medium text-charcoal-800">{p.name}</span>
                        <span className="shrink-0 rounded-full bg-charcoal-100 px-2 text-xs font-semibold tabular-nums leading-5 text-charcoal-600">{p.items.length}</span>
                      </button>
                      {open && (
                        <ul className="border-t border-charcoal-100 bg-charcoal-50/30">
                          {p.items.map((c) => (
                            <li
                              key={c.id}
                              className="flex flex-col gap-2 px-4 py-2.5 sm:flex-row sm:items-center sm:justify-between sm:gap-3 sm:px-5 sm:pl-16"
                            >
                              <div className="flex min-w-0 items-center gap-2">
                                <FileText className="h-4 w-4 shrink-0 text-charcoal-400" aria-hidden="true" />
                                <Link to={`/contracts/${c.id}`} className="min-w-0 truncate text-sm text-coral-600 hover:underline">
                                  <span className="font-semibold">{c.number}</span> — {c.student_name}
                                </Link>
                              </div>
                              <div className="flex flex-wrap items-center gap-2 pl-6 sm:pl-0">
                                <StatusBadge value={c.status} />
                                <FileButtons contract={c} busyKey={busyKey} onDownload={onDownload} />
                              </div>
                            </li>
                          ))}
                        </ul>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}

// ───────────────────────────────────── page ─────────────────────────────────────

export default function ArchivePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const view = searchParams.get("view") === "tree" ? "tree" : "list";
  const urlQ = searchParams.get("q") || "";
  const year = searchParams.get("year") || "";

  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [qInput, setQInput] = useState(urlQ);
  const [busyKey, setBusyKey] = useState(null);
  const [exporting, setExporting] = useState(false);
  const [openYears, setOpenYears] = useState({}); // year -> bool (overrides the default)
  const [openPartners, setOpenPartners] = useState({}); // "year|partner" -> bool
  const requestSeq = useRef(0);

  const setParams = useCallback(
    (changes) =>
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          for (const [k, v] of Object.entries(changes)) {
            if (v === "" || v == null) next.delete(k);
            else next.set(k, v);
          }
          return next;
        },
        { replace: true },
      ),
    [setSearchParams],
  );

  useEffect(() => {
    const t = setTimeout(() => {
      if (qInput.trim() !== urlQ) setParams({ q: qInput.trim() });
    }, 250);
    return () => clearTimeout(t);
  }, [qInput]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    setQInput((cur) => (cur.trim() === urlQ ? cur : urlQ));
  }, [urlQ]);

  // One request feeds both views: the list and the tree are the same contracts,
  // grouped differently, and search / year are applied on the client.
  const load = useCallback(async () => {
    const seq = ++requestSeq.current;
    setLoading(true);
    setLoadError(null);
    try {
      const data = await archiveApi.list({});
      if (seq !== requestSeq.current) return;
      setItems(data.items || []);
    } catch (e) {
      if (seq !== requestSeq.current) return;
      const msg = await errorText(e, "Не удалось загрузить архив");
      setItems([]);
      setLoadError(msg);
      const s = e.response?.status;
      if (s !== 401 && s !== 422) toast.error(msg);
    } finally {
      if (seq === requestSeq.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const years = useMemo(() => {
    const set = new Set(items.map((c) => String(c.year)));
    if (year) set.add(year); // a stale ?year= stays selectable
    return [...set].sort((a, b) => Number(b) - Number(a));
  }, [items, year]);

  const filtered = useMemo(
    () => items.filter((c) => (!year || String(c.year) === year) && matchesQuery(c, urlQ.trim())),
    [items, year, urlQ],
  );
  const tree = useMemo(() => (view === "tree" ? buildTree(filtered) : []), [view, filtered]);
  const filtersActive = Boolean(urlQ || year);

  const { page, setPage, pageSize, setPageSize, totalPages, pageItems, total } = usePagination(filtered, 50, `${urlQ}|${year}|${view}`);

  function resetFilters() {
    setQInput("");
    setParams({ q: "", year: "" });
  }

  async function onDownload(contract, fmt) {
    const key = `${contract.id}:${fmt}`;
    setBusyKey(key);
    try {
      await contractsApi.download(contract.id, fmt, fileName(contract, fmt));
    } catch (e) {
      toast.error(await errorText(e, "Не удалось скачать файл"));
    } finally {
      setBusyKey(null);
    }
  }

  async function onExport() {
    setExporting(true);
    try {
      await contractsApi.exportXlsx({ q: urlQ.trim() || undefined, year: year || undefined });
    } catch (e) {
      toast.error(await errorText(e, "Не удалось сформировать реестр"));
    } finally {
      setExporting(false);
    }
  }

  const expandAll = (open) => {
    const ys = {};
    const ps = {};
    for (const y of tree) {
      ys[y.year] = open;
      for (const p of y.partners) ps[`${y.year}|${p.name}`] = open;
    }
    setOpenYears(ys);
    setOpenPartners(ps);
  };

  const showEmpty = !loading && !loadError && filtered.length === 0;

  return (
    <div>
      <PageHeader
        title="Электронный архив"
        description="Сформированные договоры практики по годам и предприятиям: скачайте нужный файл или выгрузите реестр в Excel."
        actions={
          <button type="button" className="btn-secondary" onClick={onExport} disabled={exporting}>
            {exporting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <FileSpreadsheet className="h-4 w-4" aria-hidden="true" />}
            Реестр в Excel
          </button>
        }
      />

      <div className="card mb-3 flex flex-col gap-3 p-3 sm:p-4 md:flex-row md:items-center">
        <Tabs
          ariaLabel="Вид архива"
          options={VIEW_OPTIONS.map((o) => (o.value === "list" ? { ...o, count: filtered.length } : o))}
          value={view}
          onChange={(v) => setParams({ view: v === "tree" ? "tree" : "" })}
          className="self-start"
        />
        <SearchInput
          className="md:min-w-[14rem] md:flex-1"
          value={qInput}
          onChange={setQInput}
          placeholder="№ договора, предприятие, студент…"
        />
        <select className="input md:w-40" value={year} onChange={(e) => setParams({ year: e.target.value })} aria-label="Год">
          <option value="">Все годы</option>
          {years.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
      </div>

      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 px-1 text-sm text-charcoal-500" aria-live="polite">
        <span>
          {loading ? "Загрузка…" : `Найдено: ${filtered.length}${filtered.length !== items.length ? ` из ${items.length}` : ""}`}
        </span>
        <span className="flex items-center gap-3">
          {view === "tree" && !loading && tree.length > 0 && (
            <>
              <button type="button" className="link text-sm" onClick={() => expandAll(true)}>
                Развернуть всё
              </button>
              <button type="button" className="link text-sm" onClick={() => expandAll(false)}>
                Свернуть всё
              </button>
            </>
          )}
          {filtersActive && (
            <button type="button" className="link text-sm" onClick={resetFilters}>
              Сбросить фильтры
            </button>
          )}
        </span>
      </div>

      {loadError && !loading ? (
        <div className="card">
          <EmptyState
            icon={TriangleAlert}
            title="Не удалось загрузить архив"
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
          {items.length === 0 ? (
            <EmptyState
              icon={Archive}
              title="Архив пока пуст"
              description="Здесь появляются договоры, у которых сформирован документ. Откройте договор и нажмите «Сформировать»."
              action={
                <Link to="/contracts" className="btn-primary">
                  К договорам
                </Link>
              }
            />
          ) : (
            <EmptyState
              icon={Archive}
              title="Ничего не найдено"
              description="Попробуйте изменить поиск или выбрать другой год."
              action={
                <button type="button" className="btn-secondary" onClick={resetFilters}>
                  Сбросить фильтры
                </button>
              }
            />
          )}
        </div>
      ) : view === "list" ? (
        <>
          <ListTable rows={pageItems} loading={loading} busyKey={busyKey} onDownload={onDownload} />
          {!loading && (
            <Pagination page={page} totalPages={totalPages} total={total} pageSize={pageSize} onPage={setPage} onPageSize={setPageSize} />
          )}
        </>
      ) : loading ? (
        <div className="space-y-3" aria-busy="true">
          <CardSkeleton lines={2} />
          <CardSkeleton lines={2} />
        </div>
      ) : (
        <TreeView
          tree={tree}
          q={urlQ.trim()}
          openYears={openYears}
          openPartners={openPartners}
          onToggleYear={(y, open) => setOpenYears((m) => ({ ...m, [y]: !open }))}
          onTogglePartner={(k, open) => setOpenPartners((m) => ({ ...m, [k]: !open }))}
          busyKey={busyKey}
          onDownload={onDownload}
        />
      )}
    </div>
  );
}
