import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { CalendarRange, ChevronDown, CircleAlert, FileSpreadsheet, FileText, FilterX, Plus, RefreshCw, Users, X } from "lucide-react";
import clsx from "clsx";
import toast from "react-hot-toast";
import PageHeader from "../components/PageHeader.jsx";
import SearchInput from "../components/SearchInput.jsx";
import Tabs from "../components/Tabs.jsx";
import EmptyState from "../components/EmptyState.jsx";
import { Pagination } from "../components/Pagination.jsx";
import { TableSkeleton, CardSkeleton } from "../components/Skeleton.jsx";
import { SelectField, TextField } from "../components/Field.jsx";
import { useConfirm } from "../components/ConfirmDialog.jsx";
import usePagination from "../hooks/usePagination.js";
import NewContractModal from "../components/contracts/NewContractModal.jsx";
import BulkContractsWizard from "../components/contracts/BulkContractsWizard.jsx";
import BulkActionsBar from "../components/contracts/BulkActionsBar.jsx";
import BulkGenerateModal from "../components/contracts/BulkGenerateModal.jsx";
import BulkLinksModal from "../components/contracts/BulkLinksModal.jsx";
import { ContractCard, ContractRow } from "../components/contracts/ContractListItems.jsx";
import { generateInteractive, inviteInChunks } from "../components/contracts/bulkOps.js";
import { NEXT_ACTION_META, STAGE_OPTIONS } from "../components/contracts/contractFlow.js";
import { contractsApi, errorText, partnersApi, signingApi, studentsApi } from "../api/endpoints.js";
import { STATUS_LABELS, plural } from "../utils/format.js";
import { useAuth } from "../context/AuthContext.jsx";

// Tab captions: STATUS_LABELS, shortened where the full text would not fit a tab.
const TAB_LABEL = { sent: "Отправлен", signed: "Подписан", scan_uploaded: "Скан" };
const STATUSES = Object.keys(STATUS_LABELS);
// Filters the server understands. status / stage / year are applied here, on the
// loaded list, so the tab counters stay correct under the other filters.
const SERVER_KEYS = ["q", "group", "partner_id", "student_id", "date_from", "date_to"];
const ALL_KEYS = [...SERVER_KEYS, "status", "stage", "year"];

export default function ContractsPage() {
  const { isAdmin } = useAuth();
  const confirm = useConfirm();
  const [sp, setSp] = useSearchParams();

  // `?new=1&student_id=…&partner_id=…` means "open the dialog prefilled", not "filter by".
  const newIntent = sp.get("new") === "1";
  const get = (k) => sp.get(k) || "";
  const status = get("status");
  const stage = get("stage");
  const year = get("year");
  const serverParams = useMemo(() => {
    const p = {};
    SERVER_KEYS.forEach((k) => {
      if (newIntent && (k === "student_id" || k === "partner_id")) return;
      const v = sp.get(k);
      if (v) p[k] = v;
    });
    return p;
  }, [sp, newIntent]);
  const serverKey = JSON.stringify(serverParams);

  const setParams = useCallback(
    (patch) => {
      setSp(
        (prev) => {
          const next = new URLSearchParams(prev);
          Object.entries(patch).forEach(([k, v]) => {
            if (v === "" || v == null) next.delete(k);
            else next.set(k, v);
          });
          return next;
        },
        { replace: true },
      );
    },
    [setSp],
  );

  // ── data ────────────────────────────────────────────────────────────────────
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [groups, setGroups] = useState([]);
  const [partners, setPartners] = useState([]);
  const reqId = useRef(0);

  const load = useCallback(
    async (silent = false) => {
      const my = ++reqId.current;
      if (!silent) setLoading(true);
      try {
        const data = await contractsApi.list(JSON.parse(serverKey));
        if (my !== reqId.current) return;
        setItems(data.items || []);
        setLoadFailed(false);
      } catch (e) {
        if (my !== reqId.current) return;
        setItems([]);
        setLoadFailed(true);
        toast.error(await errorText(e, "Не удалось загрузить договоры"));
      } finally {
        if (my === reqId.current) setLoading(false);
      }
    },
    [serverKey],
  );

  useEffect(() => {
    load();
  }, [load]);

  // Reference lists for the filters (once).
  useEffect(() => {
    let cancelled = false;
    Promise.allSettled([studentsApi.groups(), partnersApi.list()]).then(([g, p]) => {
      if (cancelled) return;
      if (g.status === "fulfilled") setGroups(g.value.items || []);
      if (p.status === "fulfilled") setPartners(p.value.items || []);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // ── search box (debounced into the URL) ─────────────────────────────────────
  const [qInput, setQInput] = useState(get("q"));
  const lastPushedQ = useRef(get("q"));
  useEffect(() => {
    const t = setTimeout(() => {
      const v = qInput.trim();
      if (v !== lastPushedQ.current) {
        lastPushedQ.current = v;
        setParams({ q: v });
      }
    }, 250);
    return () => clearTimeout(t);
  }, [qInput, setParams]);
  const urlQ = get("q");
  useEffect(() => {
    // The URL changed from the outside (a link, "Сбросить"): follow it.
    if (urlQ !== lastPushedQ.current) {
      lastPushedQ.current = urlQ;
      setQInput(urlQ);
    }
  }, [urlQ]);

  // ── filters on the loaded list ──────────────────────────────────────────────
  const years = useMemo(() => {
    const set = new Set(items.map((c) => String(c.year)));
    if (year) set.add(year);
    return Array.from(set).sort((a, b) => Number(b) - Number(a));
  }, [items, year]);

  const byYear = useMemo(() => (year ? items.filter((c) => String(c.year) === year) : items), [items, year]);

  const statusCounts = useMemo(() => {
    const base = stage ? byYear.filter((c) => c.next_action === stage) : byYear;
    const counts = { "": base.length };
    base.forEach((c) => {
      counts[c.status] = (counts[c.status] || 0) + 1;
    });
    return counts;
  }, [byYear, stage]);

  const stageCounts = useMemo(() => {
    const base = status ? byYear.filter((c) => c.status === status) : byYear;
    const counts = {};
    base.forEach((c) => {
      counts[c.next_action] = (counts[c.next_action] || 0) + 1;
    });
    return counts;
  }, [byYear, status]);

  const visible = useMemo(
    () => byYear.filter((c) => (!status || c.status === status) && (!stage || c.next_action === stage)),
    [byYear, status, stage],
  );

  const hasFilters = ALL_KEYS.some((k) => !!sp.get(k)) || !!qInput.trim();
  const resetKey = `${serverKey}|${status}|${stage}|${year}`;
  const pg = usePagination(visible, 50, resetKey);

  // ── selection ───────────────────────────────────────────────────────────────
  const [selected, setSelected] = useState(() => new Set());
  useEffect(() => {
    // Selection never outlives the rows on screen (a filter change drops hidden ones).
    setSelected((prev) => {
      if (prev.size === 0) return prev;
      const ids = new Set(visible.map((c) => c.id));
      const next = new Set([...prev].filter((id) => ids.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [visible]);

  const toggle = useCallback((id) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const pageIds = useMemo(() => pg.pageItems.map((c) => c.id), [pg.pageItems]);
  const allOnPage = pageIds.length > 0 && pageIds.every((id) => selected.has(id));
  const someOnPage = pageIds.some((id) => selected.has(id));
  const allSelected = visible.length > 0 && visible.every((c) => selected.has(c.id));

  function togglePage() {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allOnPage) pageIds.forEach((id) => next.delete(id));
      else pageIds.forEach((id) => next.add(id));
      return next;
    });
  }

  const selectedItems = useMemo(() => visible.filter((c) => selected.has(c.id)), [visible, selected]);
  const toGenerate = useMemo(() => selectedItems.filter((c) => c.next_action === "generate"), [selectedItems]);
  const toInvite = useMemo(
    () => selectedItems.filter((c) => c.next_action === "invite" || c.next_action === "await_signatures"),
    [selectedItems],
  );
  const exportable = useMemo(() => selectedItems.filter((c) => (c.invited_roles || []).length > 0), [selectedItems]);

  // ── dialogs / actions ───────────────────────────────────────────────────────
  const [newModal, setNewModal] = useState({ open: false, initial: null });
  const [wizardOpen, setWizardOpen] = useState(false);
  const [genOpen, setGenOpen] = useState(false);
  const [linksResult, setLinksResult] = useState(null);
  const [rowBusy, setRowBusy] = useState(null);
  const [bulkBusy, setBulkBusy] = useState("");
  const [showDates, setShowDates] = useState(!!(sp.get("date_from") || sp.get("date_to")));

  useEffect(() => {
    if (!newIntent) return;
    if (isAdmin) {
      setNewModal({ open: true, initial: { student_id: get("student_id"), partner_id: get("partner_id") } });
    }
    setParams({ new: "", student_id: "", partner_id: "" });
  }, [newIntent]); // eslint-disable-line react-hooks/exhaustive-deps

  async function exportExcel() {
    const params = { ...serverParams };
    if (status) params.status = status;
    if (year) params.year = year;
    try {
      await contractsApi.exportXlsx(params);
    } catch (e) {
      toast.error(await errorText(e, "Не удалось скачать Excel"));
    }
  }

  const runQuick = useCallback(
    async (c) => {
      setRowBusy(c.id);
      try {
        if (c.next_action === "generate") {
          const res = await generateInteractive(c.id, { confirm });
          if (res.ok) {
            toast.success(`Договор ${c.number} сформирован`);
            await load(true);
          }
        } else if (c.next_action === "invite" || c.next_action === "await_signatures") {
          const inv = await inviteInChunks([c.id]);
          if (inv.items.length === 0) toast.error(inv.errors[0] || "Не удалось получить ссылки");
          else setLinksResult({ new_links: inv.new_links, items: inv.items });
          await load(true);
        } else if (c.next_action === "complete") {
          await contractsApi.update(c.id, { status: "completed" });
          toast.success(`Договор ${c.number} завершён`);
          await load(true);
        }
      } catch (e) {
        toast.error(await errorText(e, "Не удалось выполнить действие"));
      } finally {
        setRowBusy(null);
      }
    },
    [confirm, load],
  );

  async function inviteSelected() {
    setBulkBusy("invite");
    try {
      const inv = await inviteInChunks(toInvite.map((c) => c.id));
      if (inv.items.length === 0) toast.error(inv.errors[0] || "Не удалось создать ссылки");
      else {
        if (inv.errors.length) toast.error(`Часть договоров обработать не удалось: ${inv.errors[0]}`);
        setLinksResult({ new_links: inv.new_links, items: inv.items });
      }
      await load(true);
    } finally {
      setBulkBusy("");
    }
  }

  async function exportSelectedLinks() {
    setBulkBusy("export");
    try {
      await signingApi.exportLinks(exportable.map((c) => c.id));
    } catch (e) {
      toast.error(await errorText(e, "Не удалось скачать ссылки"));
    } finally {
      setBulkBusy("");
    }
  }

  function resetAll() {
    setQInput("");
    lastPushedQ.current = "";
    setSp({}, { replace: true });
    setShowDates(false);
  }

  // ── options ─────────────────────────────────────────────────────────────────
  const groupOptions = useMemo(() => {
    const names = groups.filter((g) => g.name).map((g) => ({ value: g.name, label: `${g.name} (${g.students})` }));
    const cur = get("group");
    if (cur && cur !== "__none__" && !names.some((o) => o.value === cur)) names.push({ value: cur, label: cur });
    return [{ value: "__none__", label: "Без группы" }, ...names];
  }, [groups, sp]); // eslint-disable-line react-hooks/exhaustive-deps

  const partnerOptions = useMemo(
    () => partners.map((p) => ({ value: String(p.id), label: p.organization_name })),
    [partners],
  );

  const tabOptions = useMemo(
    () => [
      { value: "", label: "Все", count: statusCounts[""] ?? 0 },
      ...STATUSES.map((s) => ({ value: s, label: TAB_LABEL[s] || STATUS_LABELS[s], count: statusCounts[s] || 0 })),
    ],
    [statusCounts],
  );

  const stageOptions = STAGE_OPTIONS.map((s) => ({
    value: s,
    label: `${NEXT_ACTION_META[s].label} (${stageCounts[s] || 0})`,
  }));

  const studentFilterName = get("student_id") && items[0] ? items[0].student_name : "";
  const columns = isAdmin ? 9 : 8;

  // ── render ──────────────────────────────────────────────────────────────────
  const emptyEverything = !loading && !loadFailed && items.length === 0 && !hasFilters;
  const emptyFiltered = !loading && !loadFailed && visible.length === 0 && !emptyEverything;

  return (
    <div>
      <PageHeader
        title="Договоры практики"
        description="Трёхсторонние договоры «колледж — предприятие — студент». Здесь видно, на каком шаге каждый договор и что с ним делать дальше."
        actions={
          <>
            {isAdmin && (
              <>
                <button type="button" onClick={() => setNewModal({ open: true, initial: null })} className="btn-primary">
                  <Plus className="h-4 w-4" aria-hidden="true" />
                  Новый договор
                </button>
                <button type="button" onClick={() => setWizardOpen(true)} className="btn-secondary">
                  <Users className="h-4 w-4" aria-hidden="true" />
                  Оформить на всю группу
                </button>
              </>
            )}
            <button
              type="button"
              onClick={exportExcel}
              className="btn-ghost"
              title={stage ? "Фильтр «Что делать дальше» в файл не попадёт" : "Скачать список с текущими фильтрами"}
            >
              <FileSpreadsheet className="h-4 w-4" aria-hidden="true" />
              Экспорт в Excel
            </button>
          </>
        }
      />

      {!emptyEverything && (
        <>
      {/* statuses */}
      <div className="mb-4">
        <Tabs options={tabOptions} value={status} onChange={(v) => setParams({ status: v })} ariaLabel="Статус договора" />
      </div>

      {/* filters */}
      <div className="card mb-4 space-y-3 p-3 sm:p-4">
        <div className="flex flex-col gap-2 sm:flex-row">
          <SearchInput className="flex-1" value={qInput} onChange={setQInput} placeholder="Поиск: № договора, предприятие, студент, ИИН" />
          <button
            type="button"
            className={clsx("btn-secondary", (showDates || get("date_from") || get("date_to")) && "!ring-coral-300")}
            onClick={() => setShowDates((s) => !s)}
            aria-expanded={showDates}
          >
            <CalendarRange className="h-4 w-4" aria-hidden="true" />
            Период
            <ChevronDown className={clsx("h-4 w-4 transition", showDates && "rotate-180")} aria-hidden="true" />
          </button>
          {hasFilters && (
            <button type="button" className="btn-ghost" onClick={resetAll}>
              <FilterX className="h-4 w-4" aria-hidden="true" />
              Сбросить
            </button>
          )}
        </div>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <SelectField label="Группа" value={get("group")} onChange={(v) => setParams({ group: v })} options={groupOptions} placeholder="Все группы" />
          <SelectField label="Предприятие" value={get("partner_id")} onChange={(v) => setParams({ partner_id: v })} options={partnerOptions} placeholder="Все предприятия" />
          <SelectField label="Год" value={year} onChange={(v) => setParams({ year: v })} options={years.map((y) => ({ value: y, label: y }))} placeholder="Все годы" />
          <SelectField label="Что делать дальше" value={stage} onChange={(v) => setParams({ stage: v })} options={stageOptions} placeholder="Любой шаг" />
        </div>
        {showDates && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <TextField label="Договор с" type="date" value={get("date_from")} onChange={(v) => setParams({ date_from: v })} />
            <TextField label="Договор по" type="date" value={get("date_to")} onChange={(v) => setParams({ date_to: v })} />
          </div>
        )}
        {get("student_id") && (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="chip">
              Только договоры студента{studentFilterName ? `: ${studentFilterName}` : ""}
              <button type="button" className="ml-1 rounded p-0.5 hover:bg-coral-100" onClick={() => setParams({ student_id: "" })} aria-label="Показать договоры всех студентов">
                <X className="h-3 w-3" aria-hidden="true" />
              </button>
            </span>
          </div>
        )}
      </div>
        </>
      )}

      {/* result line */}
      {!loading && !loadFailed && items.length > 0 && (
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2 px-1 text-sm text-charcoal-600" aria-live="polite">
          <span>
            Найдено: <b className="tabular-nums text-charcoal-900">{visible.length}</b> {plural(visible.length, "договор", "договора", "договоров")}
          </span>
          {isAdmin && allOnPage && !allSelected && visible.length > pageIds.length && (
            <span>
              Выбраны все {pageIds.length} на странице.{" "}
              <button type="button" className="link font-semibold" onClick={() => setSelected(new Set(visible.map((c) => c.id)))}>
                Выбрать все {visible.length}
              </button>
            </span>
          )}
          {isAdmin && allSelected && visible.length > pageIds.length && (
            <span>
              Выбраны все {visible.length}.{" "}
              <button type="button" className="link font-semibold" onClick={() => setSelected(new Set())}>
                Снять выбор
              </button>
            </span>
          )}
        </div>
      )}

      {loadFailed && (
        <div className="card">
          <EmptyState
            icon={CircleAlert}
            title="Не удалось загрузить договоры"
            description="Проверьте соединение и попробуйте ещё раз."
            action={
              <button type="button" className="btn-primary" onClick={() => load()}>
                <RefreshCw className="h-4 w-4" aria-hidden="true" />
                Повторить
              </button>
            }
          />
        </div>
      )}

      {emptyEverything && (
        <div className="card">
          <EmptyState
            icon={FileText}
            title="Договоров практики пока нет"
            description="Процесс такой: загрузите студентов по группам, назначьте им предприятие и сроки практики, создайте договоры, сформируйте документы и отправьте ссылки на подпись."
            action={
              <>
                {isAdmin && (
                  <>
                    <button type="button" className="btn-primary" onClick={() => setNewModal({ open: true, initial: null })}>
                      <Plus className="h-4 w-4" aria-hidden="true" />
                      Новый договор
                    </button>
                    <button type="button" className="btn-secondary" onClick={() => setWizardOpen(true)}>
                      <Users className="h-4 w-4" aria-hidden="true" />
                      Оформить на всю группу
                    </button>
                  </>
                )}
                <Link to="/groups" className="btn-ghost">
                  К группам
                </Link>
              </>
            }
          />
        </div>
      )}

      {emptyFiltered && (
        <div className="card">
          <EmptyState
            icon={FilterX}
            title="Ничего не найдено"
            description="Под выбранные фильтры ни один договор не подходит."
            action={
              <button type="button" className="btn-secondary" onClick={resetAll}>
                Сбросить фильтры
              </button>
            }
          />
        </div>
      )}

      {/* table (md+) */}
      {!loadFailed && !emptyEverything && !emptyFiltered && (
        <>
          <div className="card hidden max-h-[70vh] overflow-auto xl:block">
            <table className="table-default table-compact table-sticky">
              <thead>
                <tr>
                  {isAdmin && (
                    <th className="w-10">
                      <input
                        type="checkbox"
                        className="h-4 w-4 accent-coral-500"
                        checked={allOnPage}
                        ref={(el) => {
                          if (el) el.indeterminate = someOnPage && !allOnPage;
                        }}
                        onChange={togglePage}
                        aria-label="Выбрать все договоры на странице"
                        disabled={loading || pageIds.length === 0}
                      />
                    </th>
                  )}
                  <th>№ договора</th>
                  <th>Студент</th>
                  <th>Предприятие</th>
                  <th className="hidden 2xl:table-cell">Период практики</th>
                  <th>Статус</th>
                  <th>Подписи</th>
                  <th>Следующий шаг</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <TableSkeleton rows={8} cols={columns} />
                ) : (
                  pg.pageItems.map((c) => (
                    <ContractRow key={c.id} c={c} selected={selected.has(c.id)} onToggle={toggle} isAdmin={isAdmin} busy={rowBusy === c.id} onQuick={runQuick} />
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* cards (below xl) */}
          <div className="xl:hidden">
            {loading ? (
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <CardSkeleton lines={4} />
                <CardSkeleton lines={4} />
                <CardSkeleton lines={4} />
              </div>
            ) : (
              <ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
                {pg.pageItems.map((c) => (
                  <ContractCard key={c.id} c={c} selected={selected.has(c.id)} onToggle={toggle} isAdmin={isAdmin} busy={rowBusy === c.id} onQuick={runQuick} />
                ))}
              </ul>
            )}
          </div>

          {!loading && (
            <Pagination page={pg.page} totalPages={pg.totalPages} total={pg.total} pageSize={pg.pageSize} onPage={pg.setPage} onPageSize={pg.setPageSize} />
          )}
        </>
      )}

      {isAdmin && (
        <BulkActionsBar
          count={selectedItems.length}
          generateCount={toGenerate.length}
          inviteCount={toInvite.length}
          exportCount={exportable.length}
          busy={!!bulkBusy}
          onGenerate={() => setGenOpen(true)}
          onInvite={inviteSelected}
          onExport={exportSelectedLinks}
          onClear={() => setSelected(new Set())}
        />
      )}

      {isAdmin && (
        <>
          <NewContractModal open={newModal.open} initial={newModal.initial} onClose={() => setNewModal({ open: false, initial: null })} />
          <BulkContractsWizard open={wizardOpen} onClose={() => setWizardOpen(false)} onDone={() => load(true)} />
          <BulkGenerateModal
            open={genOpen}
            contracts={toGenerate.map((c) => ({ id: c.id, number: c.number, name: c.student_name }))}
            skippedCount={selectedItems.length - toGenerate.length}
            onClose={() => setGenOpen(false)}
            onDone={() => load(true)}
          />
          <BulkLinksModal result={linksResult} onClose={() => setLinksResult(null)} />
        </>
      )}
    </div>
  );
}
