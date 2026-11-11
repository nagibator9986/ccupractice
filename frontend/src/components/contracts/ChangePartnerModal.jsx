import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ExternalLink, Info, TriangleAlert } from "lucide-react";
import Modal from "../Modal.jsx";
import PickerField from "./PickerField.jsx";
import { contractsApi, errorText, partnersApi } from "../../api/endpoints.js";

/**
 * «Изменить предприятие»: the student moved to another organisation after the contract
 * was created. The contract keeps its number; the old document and any issued links go away
 * (the server asks for a second confirmation when links or signatures exist).
 *
 * Props: { open, contract, onClose, onChanged(item, warning) }.
 */
export default function ChangePartnerModal({ open, contract, onClose, onChanged }) {
  const [partners, setPartners] = useState([]);
  const [loading, setLoading] = useState(false);
  const [partnerId, setPartnerId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [needsReset, setNeedsReset] = useState(null); // { links, signatures } — 409 has_signatures
  const [duplicate, setDuplicate] = useState(null); // { id, number } — 409 duplicate_contract

  useEffect(() => {
    if (!open) return undefined;
    let cancelled = false;
    setPartnerId("");
    setError("");
    setNeedsReset(null);
    setDuplicate(null);
    setLoading(true);
    partnersApi
      .list()
      .then((res) => !cancelled && setPartners(res.items || []))
      .catch(async (e) => !cancelled && setError(await errorText(e, "Не удалось загрузить предприятия")))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [open]);

  const options = useMemo(
    () =>
      partners
        .filter((p) => p.id !== contract?.partner_id)
        .map((p) => ({ value: p.id, label: p.organization_name, hint: p.bin ? `БИН ${p.bin}` : undefined, search: p.bin || "" })),
    [partners, contract?.partner_id],
  );

  function pick(value) {
    setPartnerId(value);
    setNeedsReset(null);
    setDuplicate(null);
    setError("");
  }

  async function submit() {
    if (!partnerId) {
      setError("Выберите новое предприятие");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const res = await contractsApi.update(contract.id, {
        partner_id: Number(partnerId),
        ...(needsReset ? { force: true } : {}),
        ...(duplicate ? { allow_duplicate: true } : {}),
      });
      onChanged?.(res.item, res.warning);
    } catch (e) {
      const d = e.response?.data;
      if (e.response?.status === 409 && d?.code === "has_signatures") {
        setNeedsReset({ links: d.links_count || 0, signatures: d.signatures_count || 0 });
      } else if (e.response?.status === 409 && d?.code === "duplicate_contract") {
        setDuplicate({ id: d.existing_contract_id, number: d.existing_contract_number, message: d.error });
      } else {
        setError(await errorText(e, "Не удалось изменить предприятие"));
      }
    } finally {
      setBusy(false);
    }
  }

  const confirmLabel = needsReset ? "Сбросить подписи и сменить" : duplicate ? "Всё равно сменить" : "Сменить предприятие";

  return (
    <Modal
      open={open}
      onClose={busy ? undefined : onClose}
      title="Изменить предприятие"
      description={contract ? `Договор № ${contract.number} · ${contract.student_name}` : undefined}
      size="md"
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onClose} disabled={busy}>
            Отмена
          </button>
          <button
            type="button"
            className={needsReset ? "btn-danger" : "btn-primary"}
            onClick={submit}
            disabled={busy || !partnerId}
          >
            {busy ? "Сохраняем…" : confirmLabel}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="rounded-xl bg-charcoal-50 px-3.5 py-3 text-sm">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-charcoal-400">Сейчас</div>
          <div className="break-words font-medium text-charcoal-800">{contract?.partner_name}</div>
        </div>

        <PickerField
          label="Новое предприятие"
          required
          value={partnerId}
          onChange={pick}
          options={options}
          loading={loading}
          placeholder="Название или БИН"
          emptyText="Предприятий не найдено. Сначала добавьте его в разделе «Предприятия»."
          error={error || undefined}
        />

        <p className="flex gap-2 text-xs text-charcoal-500">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>
            Номер договора сохранится. Прежний документ удалится, договор вернётся в «Черновик» — потом нажмите «Сформировать
            договор», и реквизиты подставятся уже нового предприятия. В карточке студента место практики обновится само.
          </span>
        </p>

        {needsReset && (
          <div className="flex gap-2 rounded-xl bg-amber-50 px-3.5 py-3 text-sm text-amber-900 ring-1 ring-amber-200" role="alert">
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <div>
              <div className="font-semibold">Ссылки и подписи станут недействительными</div>
              <div className="mt-0.5">
                {needsReset.links > 0 && <>Выданных ссылок на подпись: {needsReset.links}. </>}
                {needsReset.signatures > 0 && <>Поставленных подписей: {needsReset.signatures}. </>}
                Они относятся к договору со старым предприятием. После смены договор нужно сформировать, разослать и подписать
                заново.
              </div>
            </div>
          </div>
        )}

        {duplicate && (
          <div className="flex gap-2 rounded-xl bg-amber-50 px-3.5 py-3 text-sm text-amber-900 ring-1 ring-amber-200" role="alert">
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <div className="min-w-0">
              <div className="font-semibold">{duplicate.message}</div>
              <Link to={`/contracts/${duplicate.id}`} className="link mt-1 inline-flex items-center gap-1 font-semibold" target="_blank" rel="noreferrer">
                Открыть существующий
                <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
              </Link>
              <div className="mt-1 text-xs">Если сменить всё равно, у студента будет два договора с этим предприятием.</div>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
