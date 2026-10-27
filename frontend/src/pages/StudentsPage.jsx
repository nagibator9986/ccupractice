import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import toast from "react-hot-toast";
import { Download, FileSpreadsheet, Loader2, SearchX, Upload, UserPlus, Users, X } from "lucide-react";
import PageHeader from "../components/PageHeader.jsx";
import EmptyState from "../components/EmptyState.jsx";
import SearchInput from "../components/SearchInput.jsx";
import { Pagination } from "../components/Pagination.jsx";
import { TableSkeleton } from "../components/Skeleton.jsx";
import { useConfirm } from "../components/ConfirmDialog.jsx";
import usePagination from "../hooks/usePagination.js";
import { useAuth } from "../context/AuthContext.jsx";
import { errorText, partnersApi, specialtiesApi, studentsApi } from "../api/endpoints.js";
import { plural } from "../utils/format.js";
import GroupStrip from "../components/students/GroupStrip.jsx";
import SelectionBar from "../components/students/SelectionBar.jsx";
import { StudentCards, StudentsTable } from "../components/students/StudentsTable.jsx";
import StudentFormModal from "../components/students/StudentFormModal.jsx";
import ImportStudentsWizard from "../components/students/ImportStudentsWizard.jsx";
import BulkPracticeModal from "../components/students/BulkPracticeModal.jsx";
import BlockedDeleteReport from "../components/students/BlockedDeleteReport.jsx";
import BulkContractsWizard from "../components/contracts/BulkContractsWizard.jsx";
import { COURSES, GROUP_NONE } from "../components/students/studentUtils.js";

// Params that live in the URL (everything the list is filtered by).
const FILTER_KEYS = ["q", "group", "partner_id", "contract", "no_partner", "course", "is_grant"];

export default function StudentsPage() {
  const { isAdmin } = useAuth();
  const navigate = useNavigate();
  const confirm = useConfirm();
  const [params, setParams] = useSearchParams();

  // ── filters (URL is the single source of truth) ───────────────────────────
  const urlQ = params.get("q") || "";
  const group = params.get("group") || "";
  const partnerId = params.get("partner_id") || "";
  const contractF = params.get("contract") || "";
  const noPartner = params.get("no_partner") === "1";
  const course = params.get("course") || "";
  const grantF = params.get("is_grant") || "";
  const hasFilters = !!(urlQ || group || partnerId || contractF || noPartner || course || grantF);
  const filterKey = [urlQ, group, partnerId, contractF, noPartner ? 1 : 0, course, grantF].join("|");

  const updateParams = useCallback(
    (patch) => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          for (const [k, v] of Object.entries(patch)) {
            if (v === null || v === undefined || v === "" || v === false) next.delete(k);
            else next.set(k, v === true ? "1" : String(v));
          }
          return next;
        },
        { replace: true },
      );
    },
    [setParams],
  );

  // Search box: local text, written to the URL 250 ms after the last keystroke.
  const [qInput, setQInput] = useState(urlQ);
  const lastWrittenQ = useRef(urlQ);
  useEffect(() => {
    if (qInput.trim() === urlQ) return undefined;
    const t = setTimeout(() => {
      lastWrittenQ.current = qInput.trim();
      updateParams({ q: qInput.trim() });
    }, 250);
    return () => clearTimeout(t);
  }, [qInput, urlQ, updateParams]);
  useEffect(() => {
    // The URL changed from elsewhere (reset, a link from another page).
    if (urlQ !== lastWrittenQ.current) {
      lastWrittenQ.current = urlQ;
      setQInput(urlQ);
    }
  }, [urlQ]);

  // ── data ──────────────────────────────────────────────────────────────────
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadedOnce, setLoadedOnce] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [groups, setGroups] = useState([]);
  const [groupsLoading, setGroupsLoading] = useState(true);
  const [partners, setPartners] = useState([]);
  const [specialties, setSpecialties] = useState([]);
  const reqId = useRef(0);

  const load = useCallback(async () => {
    const id = ++reqId.current;
    const p = { with_lms: 1, with_contracts: 1 };
    if (urlQ) p.q = urlQ;
    if (group) p.group = group;
    if (partnerId) p.partner_id = partnerId;
    if (course) p.course = course;
    if (noPartner) p.no_partner = 1;
    if (contractF) p.contract = contractF;
    if (grantF) p.is_grant = grantF;
    setLoading(true);
    try {
      const r = await studentsApi.list(p);
      if (id !== reqId.current) return;
      setItems(r.items || []);
      setLoadFailed(false);
    } catch (e) {
      if (id !== reqId.current) return;
      const st = e.response?.status;
      if (st !== 401 && st !== 422) toast.error(await errorText(e, "Не удалось загрузить студентов"));
      setItems([]);
      setLoadFailed(true);
    } finally {
      if (id === reqId.current) {
        setLoading(false);
        setLoadedOnce(true);
      }
    }
    // filterKey covers every value read above
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterKey]);

  const loadGroups = useCallback(async () => {
    try {
      const r = await studentsApi.groups();
      setGroups(r.items || []);
    } catch {
      /* the strip is a convenience; keep the stale one */
    } finally {
      setGroupsLoading(false);
    }
  }, []);

  const loadPartners = useCallback(async () => {
    try {
      const r = await partnersApi.list({ with_stats: 1 });
      setPartners(r.items || []);
    } catch {
      /* dropdowns keep the stale list */
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    loadGroups();
    loadPartners();
    (async () => {
      try {
        const r = await specialtiesApi.list();
        setSpecialties(r.items || []);
      } catch {
        setSpecialties([]);
      }
    })();
  }, [loadGroups, loadPartners]);

  // After ANY write: refresh the list and the group strip (and seat numbers).
  const afterWrite = useCallback(async () => {
    await Promise.all([load(), loadGroups(), loadPartners()]);
  }, [load, loadGroups, loadPartners]);

  // ── selection ─────────────────────────────────────────────────────────────
  const [selected, setSelected] = useState(() => new Set());
  useEffect(() => {
    setSelected((prev) => (prev.size ? new Set() : prev));
  }, [filterKey]);
  useEffect(() => {
    // Rows that vanished (deleted elsewhere) must not stay selected.
    setSelected((prev) => {
      if (!prev.size) return prev;
      const alive = new Set(items.map((s) => s.id));
      const next = new Set([...prev].filter((id) => alive.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [items]);

  const { page, setPage, pageSize, setPageSize, totalPages, pageItems, total } = usePagination(items, 50, filterKey);
  const pageIds = useMemo(() => pageItems.map((s) => s.id), [pageItems]);
  const allOnPage = pageIds.length > 0 && pageIds.every((id) => selected.has(id));
  const someOnPage = pageIds.some((id) => selected.has(id));
  const allSelected = total > 0 && selected.size === total;

  function toggleOne(id) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function togglePage() {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allOnPage) pageIds.forEach((id) => next.delete(id));
      else pageIds.forEach((id) => next.add(id));
      return next;
    });
  }
  const selectAllFiltered = () => setSelected(new Set(items.map((s) => s.id)));
  const clearSelection = () => setSelected(new Set());
  const selectedIds = useMemo(() => [...selected], [selected]);

  // ── dialogs ───────────────────────────────────────────────────────────────
  const [formState, setFormState] = useState({ open: false, student: null });
  const [importOpen, setImportOpen] = useState(false);
  const [bulkPracticeOpen, setBulkPracticeOpen] = useState(false);
  const [bulkContractsOpen, setBulkContractsOpen] = useState(false);
  const [blockedReport, setBlockedReport] = useState(null); // { blocked, deleted }
  const [bulkBusy, setBulkBusy] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [grantBusy, setGrantBusy] = useState(null);

  function openEditor(student) {
    setFormState({ open: true, student });
    loadPartners(); // a partner added in another tab shows up without a reload
  }

  // Deep links: ?edit=<id> ?new=1 ?import=1 — handled once, then removed.
  const editParam = params.get("edit");
  const newParam = params.get("new");
  const importParam = params.get("import");
  const handled = useRef({});

  useEffect(() => {
    if (!newParam) handled.current.new = null;
    if (!importParam) handled.current.import = null;
    if (newParam && handled.current.new !== newParam) {
      handled.current.new = newParam;
      updateParams({ new: null });
      if (isAdmin) openEditor(null);
    }
    if (importParam && handled.current.import !== importParam) {
      handled.current.import = importParam;
      updateParams({ import: null });
      if (isAdmin) setImportOpen(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [newParam, importParam, isAdmin]);

  useEffect(() => {
    if (!editParam) {
      handled.current.edit = null;
      return;
    }
    if (!loadedOnce || handled.current.edit === editParam) return;
    handled.current.edit = editParam;
    updateParams({ edit: null });
    if (!isAdmin) return;
    (async () => {
      const id = Number(editParam);
      let student = items.find((s) => s.id === id);
      if (!student) {
        // Not on the current (filtered) list: fetch it, then re-read through the
        // list endpoint by name so the LMS/contract summary comes along.
        try {
          const { item } = await studentsApi.get(id);
          student = item;
          try {
            const r = await studentsApi.list({ q: item.full_name, with_lms: 1, with_contracts: 1 });
            student = (r.items || []).find((s) => s.id === id) || item;
          } catch {
            /* the plain card is enough to edit */
          }
        } catch (e) {
          toast.error(await errorText(e, "Студент не найден"));
          return;
        }
      }
      openEditor(student);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editParam, loadedOnce, isAdmin]);

  // ── row actions ───────────────────────────────────────────────────────────
  async function onToggleGrant(s) {
    if (grantBusy === s.id) return;
    const next = !s.is_grant_student;
    setGrantBusy(s.id);
    // Optimistic update.
    setItems((prev) => prev.map((row) => (row.id === s.id ? { ...row, is_grant_student: next } : row)));
    try {
      await studentsApi.setGrant(s.id, next);
      toast.success(next ? "Студент переведён в грантники" : "Снята отметка о гранте");
    } catch (e) {
      // Rollback.
      setItems((prev) => prev.map((row) => (row.id === s.id ? { ...row, is_grant_student: !next } : row)));
      // Same 409 body as the edit form — show the server's full sentence.
      const d = e.response?.data || {};
      toast.error(d.error || "Не удалось обновить отметку о гранте", { duration: d.code ? 7000 : 4000 });
    } finally {
      setGrantBusy(null);
    }
  }

  async function onDelete(s) {
    const ok = await confirm({
      title: "Удалить студента?",
      message: `«${s.full_name}» будет удалён из списка. Это действие нельзя отменить.`,
      confirmText: "Удалить",
      tone: "danger",
    });
    if (!ok) return;
    try {
      await studentsApi.remove(s.id);
      toast.success("Студент удалён");
      afterWrite();
    } catch (e) {
      const d = e.response?.data || {};
      // The backend names the blocking contract and returns its id — offer to
      // jump straight there instead of leaving a dead end.
      const target =
        d.code === "contract_exists" && d.contract_id
          ? `/contracts/${d.contract_id}`
          : d.code === "lms_contract_exists" && d.lms_contract_id
            ? `/lms-contracts/${d.lms_contract_id}`
            : null;
      if (target) {
        const open = await confirm({
          title: "Удалить нельзя",
          message: d.error,
          confirmText: "Открыть договор",
          cancelText: "Закрыть",
        });
        if (open) navigate(target);
        return;
      }
      toast.error(d.error || "Ошибка удаления", { duration: d.code ? 7000 : 4000 });
    }
  }

  async function onBulkDelete() {
    const ids = selectedIds;
    const n = ids.length;
    if (!n || bulkBusy) return;
    const ok = await confirm({
      title: n > 1 ? `Удалить студентов: ${n}?` : "Удалить студента?",
      message:
        "Студенты будут удалены безвозвратно. Те, у кого есть договоры, удалены не будут — вы увидите их список.",
      confirmText: n > 1 ? `Удалить ${n}` : "Удалить",
      tone: "danger",
      requireText: n > 1 ? "удалить" : undefined,
    });
    if (!ok) return;
    setBulkBusy(true);
    try {
      const res = await studentsApi.bulkDelete(ids);
      if (res.deleted) toast.success(`Удалено студентов: ${res.deleted}`);
      if (res.blocked?.length) setBlockedReport({ blocked: res.blocked, deleted: res.deleted || 0 });
      clearSelection();
      await afterWrite();
    } catch (e) {
      toast.error(await errorText(e, "Не удалось удалить студентов"), { duration: 6000 });
    } finally {
      setBulkBusy(false);
    }
  }

  const exportBlocked = group === GROUP_NONE;
  async function onExport() {
    if (exporting) return;
    setExporting(true);
    try {
      await studentsApi.exportXlsx({
        q: urlQ || undefined,
        group: group && group !== GROUP_NONE ? group : undefined,
        partner_id: partnerId || undefined,
      });
    } catch (e) {
      toast.error(await errorText(e, "Не удалось выгрузить файл"));
    } finally {
      setExporting(false);
    }
  }

  async function onDownloadTemplate() {
    try {
      await studentsApi.downloadImportTemplate();
    } catch (e) {
      toast.error(await errorText(e, "Не удалось скачать шаблон"));
    }
  }

  const groupNames = useMemo(() => groups.map((g) => g.name).filter(Boolean), [groups]);
  const totalStudents = groups.reduce((a, g) => a + (g.students || 0), 0);
  const databaseEmpty = loadedOnce && !loadFailed && !hasFilters && items.length === 0 && totalStudents === 0 && !groupsLoading;

  function resetFilters() {
    setQInput("");
    updateParams(Object.fromEntries(FILTER_KEYS.map((k) => [k, null])));
  }

  const showSkeleton = loading && !loadedOnce;

  return (
    <div>
      <PageHeader
        title="Студенты"
        description="Списки студентов по группам: загрузка из Excel, предприятие и сроки практики, договоры."
        actions={
          <>
            {isAdmin && (
              <>
                <button type="button" className="btn-primary" onClick={() => setImportOpen(true)}>
                  <Upload className="h-4 w-4" aria-hidden="true" />
                  Загрузить из Excel
                </button>
                <button type="button" className="btn-secondary" onClick={() => openEditor(null)}>
                  <UserPlus className="h-4 w-4" aria-hidden="true" />
                  Добавить студента
                </button>
              </>
            )}
            <button
              type="button"
              className="btn-ghost"
              onClick={onExport}
              disabled={exporting || exportBlocked}
              title={
                exportBlocked
                  ? "Выгрузка студентов без группы пока недоступна"
                  : "Колонки такие же, как в шаблоне загрузки — выгруженный файл можно поправить и загрузить обратно"
              }
            >
              {exporting ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <Download className="h-4 w-4" aria-hidden="true" />
              )}
              Экспорт в Excel
            </button>
          </>
        }
      />

      {!databaseEmpty && (
        <GroupStrip
          groups={groups}
          loading={groupsLoading}
          value={group}
          onChange={(v) => updateParams({ group: v || null })}
        />
      )}

      {!databaseEmpty && (
        <div className="card mb-3 p-3 sm:p-4">
          <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-[minmax(0,1.6fr)_repeat(4,minmax(0,1fr))]">
            <SearchInput
              className="col-span-2 lg:col-span-1"
              value={qInput}
              onChange={setQInput}
              placeholder="Поиск по ФИО, ИИН, специальности"
            />
            <select
              className="input col-span-2 sm:col-span-1"
              value={partnerId}
              onChange={(e) => updateParams({ partner_id: e.target.value || null })}
              aria-label="Предприятие"
            >
              <option value="">Предприятие</option>
              {partners.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.organization_name}
                </option>
              ))}
            </select>
            <select
              className="input"
              value={contractF}
              onChange={(e) => updateParams({ contract: e.target.value || null })}
              aria-label="Договор"
            >
              <option value="">Договор</option>
              <option value="none">Нет договора</option>
              <option value="any">Есть договор</option>
            </select>
            <select
              className="input"
              value={course}
              onChange={(e) => updateParams({ course: e.target.value || null })}
              aria-label="Курс"
            >
              <option value="">Курс</option>
              {COURSES.map((c) => (
                <option key={c} value={c}>
                  {c} курс
                </option>
              ))}
            </select>
            <select
              className="input col-span-2 sm:col-span-1"
              value={grantF}
              onChange={(e) => updateParams({ is_grant: e.target.value || null })}
              aria-label="Грант"
            >
              <option value="">Грант</option>
              <option value="1">Только грантники</option>
              <option value="0">Не грантники</option>
            </select>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
            <label className="inline-flex min-h-[44px] cursor-pointer select-none items-center gap-2 text-sm text-charcoal-700 sm:min-h-0">
              <input
                type="checkbox"
                className="h-4 w-4 accent-coral-500"
                checked={noPartner}
                onChange={(e) => updateParams({ no_partner: e.target.checked || null })}
              />
              Без предприятия
            </label>
            {hasFilters && (
              <button type="button" className="btn-ghost btn-sm" onClick={resetFilters}>
                <X className="h-4 w-4" aria-hidden="true" />
                Сбросить
              </button>
            )}
            <span className="ml-auto text-xs text-charcoal-500" aria-live="polite">
              {loadedOnce &&
                !loadFailed &&
                (total > pageItems.length
                  ? `Найдено: ${total} · на странице ${pageItems.length}`
                  : `Найдено: ${total} ${plural(total, "студент", "студента", "студентов")}`)}
            </span>
          </div>
        </div>
      )}

      {/* "select all N matching" helper */}
      {isAdmin && allOnPage && total > pageItems.length && !allSelected && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl bg-coral-50 px-3.5 py-2.5 text-sm text-charcoal-800 ring-1 ring-coral-100" role="status">
          Выбраны все {pageItems.length} на этой странице.
          <button type="button" className="font-semibold text-coral-700 underline-offset-2 hover:underline" onClick={selectAllFiltered}>
            Выбрать все {total} по фильтру
          </button>
        </div>
      )}
      {isAdmin && allSelected && total > pageItems.length && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl bg-coral-50 px-3.5 py-2.5 text-sm text-charcoal-800 ring-1 ring-coral-100" role="status">
          Выбраны все {total} студентов по фильтру.
          <button type="button" className="font-semibold text-coral-700 underline-offset-2 hover:underline" onClick={clearSelection}>
            Снять выбор
          </button>
        </div>
      )}

      <div className="card overflow-hidden">
        {showSkeleton ? (
          <table className="table-default table-compact" aria-busy="true">
            <tbody>
              <TableSkeleton rows={8} cols={6} />
            </tbody>
          </table>
        ) : loadFailed ? (
          <EmptyState
            icon={SearchX}
            title="Не удалось загрузить студентов"
            description="Проверьте соединение и попробуйте ещё раз."
            action={
              <button type="button" className="btn-secondary" onClick={load}>
                Повторить
              </button>
            }
          />
        ) : databaseEmpty ? (
          <EmptyState
            icon={Users}
            title="Список студентов пуст"
            description="Загрузите группы из Excel: одна строка — один студент, группа берётся из файла. Ничего не сохранится, пока вы не подтвердите."
            action={
              isAdmin ? (
                <>
                  <button type="button" className="btn-primary" onClick={() => setImportOpen(true)}>
                    <Upload className="h-4 w-4" aria-hidden="true" />
                    Загрузить студентов из Excel
                  </button>
                  <button type="button" className="btn-secondary" onClick={onDownloadTemplate}>
                    <FileSpreadsheet className="h-4 w-4" aria-hidden="true" />
                    Скачать шаблон
                  </button>
                </>
              ) : (
                <p className="text-sm text-charcoal-500">Студентов добавляет администратор.</p>
              )
            }
          />
        ) : items.length === 0 ? (
          <EmptyState
            icon={SearchX}
            title="Ничего не найдено"
            description="По этим условиям студентов нет. Попробуйте изменить поиск или фильтры."
            action={
              <button type="button" className="btn-secondary" onClick={resetFilters}>
                Сбросить фильтры
              </button>
            }
          />
        ) : (
          <>
            <StudentsTable
              rows={pageItems}
              isAdmin={isAdmin}
              selected={selected}
              onToggle={toggleOne}
              allOnPage={allOnPage}
              someOnPage={someOnPage}
              onTogglePage={togglePage}
              onEdit={openEditor}
              onDelete={onDelete}
              onToggleGrant={onToggleGrant}
              grantBusy={grantBusy}
              busy={loading}
            />
            <StudentCards
              rows={pageItems}
              isAdmin={isAdmin}
              selected={selected}
              onToggle={toggleOne}
              onEdit={openEditor}
              onDelete={onDelete}
              onToggleGrant={onToggleGrant}
              grantBusy={grantBusy}
              busy={loading}
            />
            <div className="border-t border-charcoal-100 px-3">
              <Pagination
                page={page}
                totalPages={totalPages}
                total={total}
                pageSize={pageSize}
                onPage={setPage}
                onPageSize={setPageSize}
                pageSizes={[25, 50, 100]}
              />
            </div>
          </>
        )}
      </div>

      {isAdmin && (
        <SelectionBar
          count={selected.size}
          busy={bulkBusy}
          onPractice={() => setBulkPracticeOpen(true)}
          onContracts={() => setBulkContractsOpen(true)}
          onDelete={onBulkDelete}
          onClear={clearSelection}
        />
      )}

      {isAdmin && (
        <>
          <StudentFormModal
            open={formState.open}
            student={formState.student}
            partners={partners}
            specialties={specialties}
            groups={groupNames}
            onClose={() => setFormState({ open: false, student: null })}
            onSaved={() => {
              setFormState({ open: false, student: null });
              afterWrite();
            }}
          />
          <ImportStudentsWizard
            open={importOpen}
            onClose={() => setImportOpen(false)}
            onDone={afterWrite}
            onChanged={afterWrite}
          />
          <BulkPracticeModal
            open={bulkPracticeOpen}
            studentIds={selectedIds}
            onClose={() => setBulkPracticeOpen(false)}
            onDone={afterWrite}
          />
          <BulkContractsWizard
            open={bulkContractsOpen}
            studentIds={selectedIds}
            onClose={() => setBulkContractsOpen(false)}
            onDone={afterWrite}
          />
          <BlockedDeleteReport
            open={!!blockedReport}
            blocked={blockedReport?.blocked || []}
            deleted={blockedReport?.deleted || 0}
            onClose={() => setBlockedReport(null)}
          />
        </>
      )}
    </div>
  );
}
