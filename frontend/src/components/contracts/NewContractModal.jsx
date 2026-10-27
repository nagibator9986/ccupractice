import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ExternalLink, Info, TriangleAlert } from "lucide-react";
import toast from "react-hot-toast";
import Modal from "../Modal.jsx";
import { TextArea, TextField } from "../Field.jsx";
import { useConfirm } from "../ConfirmDialog.jsx";
import { contractsApi, errorText, partnersApi, studentsApi } from "../../api/endpoints.js";
import PickerField from "./PickerField.jsx";
import ReadinessChecklist from "./ReadinessChecklist.jsx";
import { todayLocalISO } from "./contractFlow.js";
import StatusBadge from "../StatusBadge.jsx";

/**
 * «Новый договор»: pick a partner and a student (searchable), see right away
 * whether this pair already has a contract and what data is still missing.
 * On success opens /contracts/:id.
 *
 * initial: { student_id?, partner_id? } — prefill from `?new=1&student_id=…`.
 */
export default function NewContractModal({ open, onClose, initial }) {
  const navigate = useNavigate();
  const confirm = useConfirm();

  const [partners, setPartners] = useState([]);
  const [students, setStudents] = useState([]);
  const [listsLoading, setListsLoading] = useState(false);
  const [partnerId, setPartnerId] = useState("");
  const [studentId, setStudentId] = useState("");
  const [date, setDate] = useState(todayLocalISO());
  const [notes, setNotes] = useState("");
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);

  const [check, setCheck] = useState(null);
  const [checkLoading, setCheckLoading] = useState(false);
  const [checkError, setCheckError] = useState("");
  const [recheck, setRecheck] = useState(0);
  const [serverDup, setServerDup] = useState(null);

  // Open: reset the form, apply the prefill, load both registers.
  useEffect(() => {
    if (!open) return undefined;
    let cancelled = false;
    setPartnerId(initial?.partner_id ? String(initial.partner_id) : "");
    setStudentId(initial?.student_id ? String(initial.student_id) : "");
    setDate(todayLocalISO());
    setNotes("");
    setTried(false);
    setCheck(null);
    setServerDup(null);
    setListsLoading(true);
    (async () => {
      try {
        const [p, s] = await Promise.all([partnersApi.list(), studentsApi.list({ with_contracts: 1 })]);
        if (cancelled) return;
        const sItems = s.items || [];
        setPartners(p.items || []);
        setStudents(sItems);
        // A student who already has a partner: preselect it (unless the link said otherwise).
        if (initial?.student_id && !initial?.partner_id) {
          const st = sItems.find((x) => String(x.id) === String(initial.student_id));
          if (st?.partner_id) setPartnerId(String(st.partner_id));
        }
      } catch (e) {
        if (!cancelled) toast.error(await errorText(e, "Не удалось загрузить списки предприятий и студентов"));
      } finally {
        if (!cancelled) setListsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // Pre-flight for the chosen pair.
  useEffect(() => {
    if (!open || !studentId || !partnerId) {
      setCheck(null);
      setCheckError("");
      return undefined;
    }
    let cancelled = false;
    setCheckLoading(true);
    setServerDup(null);
    contractsApi
      .readiness({ student_id: studentId, partner_id: partnerId })
      .then((r) => {
        if (cancelled) return;
        setCheck(r);
        setCheckError("");
      })
      .catch(async (e) => {
        if (cancelled) return;
        setCheck(null);
        setCheckError(await errorText(e, "Не удалось проверить данные"));
      })
      .finally(() => {
        if (!cancelled) setCheckLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, studentId, partnerId, recheck]);

  const partnerOptions = useMemo(
    () => partners.map((p) => ({ value: p.id, label: p.organization_name, hint: p.bin ? `БИН ${p.bin}` : undefined, search: p.bin || "" })),
    [partners],
  );

  const studentOptions = useMemo(() => {
    const pid = partnerId ? String(partnerId) : "";
    const toOpt = (s) => ({
      value: s.id,
      label: `${s.full_name} · ${s.group_name || "без группы"}`,
      hint: s.contract ? `Уже есть договор № ${s.contract.number}` : undefined,
      search: s.iin || "",
      mine: pid && String(s.partner_id || "") === pid,
    });
    const all = students.map(toOpt);
    if (!pid) return all;
    const mine = all.filter((o) => o.mine).map((o) => ({ ...o, group: "Закреплены за этим предприятием" }));
    const rest = all.filter((o) => !o.mine).map((o) => ({ ...o, group: mine.length ? "Остальные студенты" : undefined }));
    return [...mine, ...rest];
  }, [students, partnerId]);

  const onStudentPick = useCallback(
    (v) => {
      setStudentId(v);
      // Convenience: the student's own partner, unless one was already chosen.
      if (v && !partnerId) {
        const st = students.find((s) => String(s.id) === String(v));
        if (st?.partner_id) setPartnerId(String(st.partner_id));
      }
    },
    [partnerId, students],
  );

  const duplicate = serverDup || check?.duplicate || null;

  async function submit(allowDuplicate = false) {
    setTried(true);
    if (!partnerId || !studentId) return;
    if (!date) return;
    setBusy(true);
    try {
      const data = await contractsApi.create({
        partner_id: Number(partnerId),
        student_id: Number(studentId),
        contract_date: date,
        notes: notes.trim() || undefined,
        ...(allowDuplicate ? { allow_duplicate: true } : {}),
      });
      toast.success(`Договор ${data.item.number} создан`);
      onClose?.();
      navigate(`/contracts/${data.item.id}`);
    } catch (e) {
      const d = e.response?.data;
      if (e.response?.status === 409 && d?.code === "duplicate_contract") {
        setServerDup({ id: d.existing_contract_id, number: d.existing_contract_number });
        setBusy(false);
        const again = await confirm({
          title: "Такой договор уже есть",
          message: `${d.error}\n\nСоздать ещё один договор для этой же пары?`,
          confirmText: "Создать ещё один",
          cancelText: "Не создавать",
        });
        if (again) await submit(true);
        return;
      }
      toast.error(await errorText(e, "Не удалось создать договор"));
    } finally {
      setBusy(false);
    }
  }

  const criticalCount = check?.readiness?.critical || 0;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Новый договор практики"
      description="Выберите предприятие и студента — номер договора присвоится автоматически."
      size="md"
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onClose} disabled={busy}>
            Отмена
          </button>
          <button type="button" className="btn-primary" onClick={() => submit(false)} disabled={busy}>
            {busy ? "Создаём…" : "Создать договор"}
          </button>
        </>
      }
    >
      <div className="space-y-5">
        <PickerField
          label="Предприятие"
          required
          value={partnerId}
          onChange={setPartnerId}
          options={partnerOptions}
          loading={listsLoading}
          placeholder="Название или БИН"
          emptyText="Предприятий не найдено. Добавьте его в разделе «Предприятия»."
          error={tried && !partnerId ? "Выберите предприятие" : undefined}
        />
        <PickerField
          label="Студент"
          required
          value={studentId}
          onChange={onStudentPick}
          options={studentOptions}
          loading={listsLoading}
          placeholder="ФИО, группа или ИИН"
          emptyText="Студентов не найдено. Добавьте их в разделе «Студенты»."
          error={tried && !studentId ? "Выберите студента" : undefined}
          hint={partnerId ? "Сначала показаны студенты, закреплённые за выбранным предприятием." : undefined}
        />

        {duplicate && (
          <div className="flex gap-2 rounded-xl bg-amber-50 px-3.5 py-3 text-sm text-amber-900 ring-1 ring-amber-200" role="alert">
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <div className="min-w-0">
              <div className="font-semibold">
                У этого студента с этим предприятием уже есть договор № {duplicate.number}
                {duplicate.year ? ` за ${duplicate.year} год` : ""}.
              </div>
              <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1">
                {duplicate.status && <StatusBadge value={duplicate.status} />}
                <Link to={`/contracts/${duplicate.id}`} className="link inline-flex items-center gap-1 font-semibold" target="_blank" rel="noreferrer">
                  Открыть существующий
                  <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                </Link>
              </div>
              <div className="mt-1 text-xs">Если вы всё равно создадите новый, сайт спросит подтверждение.</div>
            </div>
          </div>
        )}

        {check?.student_contracts > 0 && !duplicate && (
          <p className="flex gap-2 text-xs text-charcoal-500">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />У этого студента уже есть договоров: {check.student_contracts} (с другими предприятиями).
          </p>
        )}

        {checkLoading && <p className="text-sm text-charcoal-500">Проверяем данные студента и предприятия…</p>}
        {checkError && <p className="text-sm text-red-600">{checkError}</p>}
        {check?.readiness && (
          <div>
            <div className="label">Данные для договора</div>
            <ReadinessChecklist readiness={check.readiness} newTab onRecheck={() => setRecheck((n) => n + 1)} rechecking={checkLoading} />
            {criticalCount > 0 && (
              <p className="mt-2 text-xs text-charcoal-500">
                Создать договор можно и сейчас, но сформировать документ получится только после заполнения обязательных данных.
              </p>
            )}
          </div>
        )}

        <TextField
          label="Дата договора"
          type="date"
          required
          value={date}
          onChange={setDate}
          error={tried && !date ? "Укажите дату" : undefined}
        />
        <TextArea label="Примечание" value={notes} onChange={setNotes} rows={2} placeholder="Необязательно" />
      </div>
    </Modal>
  );
}
