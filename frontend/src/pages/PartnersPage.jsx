import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import PageHeader from "../components/PageHeader.jsx";
import Modal from "../components/Modal.jsx";
import { TextField, TextArea } from "../components/Field.jsx";
import { partnersApi } from "../api/endpoints.js";
import { useAuth } from "../context/AuthContext.jsx";

const EMPTY = {
  organization_name: "",
  bin: "",
  legal_address: "",
  actual_address: "",
  director_full_name: "",
  director_position: "",
  director_basis: "Устава",
  contact_person: "",
  phone: "",
  email: "",
  specialty: "",
  seats_count: 1,
  contract_status: "active",
  contract_valid_until: "",
  bank_name: "",
  bank_bik: "",
  bank_iik: "",
  notes: "",
};

export default function PartnersPage() {
  const { isAdmin } = useAuth();
  const [items, setItems] = useState([]);
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      const data = await partnersApi.list({ q });
      setItems(data.items);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [q]);

  async function onSave() {
    const name = (editing.organization_name || "").trim();
    if (!name) {
      toast.error("Укажите наименование организации");
      return;
    }
    if (editing.bin && !/^\d{12}$/.test(editing.bin.trim())) {
      toast.error("БИН должен состоять из 12 цифр");
      return;
    }
    try {
      if (editing.id) {
        await partnersApi.update(editing.id, editing);
        toast.success("Партнёр обновлён");
      } else {
        await partnersApi.create(editing);
        toast.success("Партнёр добавлен");
      }
      setEditing(null);
      load();
    } catch (e) {
      toast.error(e.response?.data?.error || "Не удалось сохранить партнёра");
    }
  }

  async function onDelete(item) {
    if (!confirm(`Удалить партнёра «${item.organization_name}»?`)) return;
    try {
      await partnersApi.remove(item.id);
      toast.success("Удалено");
      load();
    } catch (e) {
      toast.error(e.response?.data?.error || "Ошибка удаления");
    }
  }

  return (
    <div>
      <PageHeader
        title="Реестр партнёров"
        description="База предприятий-баз практики: реквизиты, контакты, количество мест."
        actions={
          isAdmin && (
            <button onClick={() => setEditing({ ...EMPTY })} className="btn-primary">
              + Добавить партнёра
            </button>
          )
        }
      />

      <div className="card p-4 mb-4">
        <input
          className="input"
          placeholder="Поиск по названию, БИН, контакту, специальности…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>

      <div className="card overflow-x-auto">
        <table className="table-default">
          <thead>
            <tr>
              <th>Организация</th>
              <th>БИН</th>
              <th>Специальность</th>
              <th>Мест</th>
              <th>Контакт</th>
              <th>Статус</th>
              {isAdmin && <th className="text-right">Действия</th>}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={isAdmin ? 7 : 6} className="text-center py-6 text-slate-500">Загрузка…</td></tr>
            ) : items.length === 0 ? (
              <tr><td colSpan={isAdmin ? 7 : 6} className="text-center py-6 text-slate-500">Партнёров пока нет.</td></tr>
            ) : (
              items.map((p) => (
                <tr key={p.id}>
                  <td>
                    <div className="font-semibold">{p.organization_name}</div>
                    <div className="text-xs text-slate-500">{p.legal_address}</div>
                  </td>
                  <td>{p.bin || "—"}</td>
                  <td>{p.specialty || "—"}</td>
                  <td>{p.seats_count}</td>
                  <td>
                    <div>{p.contact_person || "—"}</div>
                    <div className="text-xs text-slate-500">{p.phone || p.email}</div>
                  </td>
                  <td>
                    <span className="badge bg-emerald-100 text-emerald-700">
                      {p.contract_status || "active"}
                    </span>
                  </td>
                  {isAdmin && (
                    <td className="text-right">
                      <button className="btn-ghost" onClick={() => setEditing({ ...EMPTY, ...p })}>
                        Изм.
                      </button>
                      <button className="btn-ghost text-red-600" onClick={() => onDelete(p)}>
                        Удалить
                      </button>
                    </td>
                  )}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <Modal
        open={!!editing}
        onClose={() => setEditing(null)}
        title={editing?.id ? "Редактирование партнёра" : "Новый партнёр"}
        size="xl"
        footer={
          <>
            <button className="btn-secondary" onClick={() => setEditing(null)}>Отмена</button>
            <button className="btn-primary" onClick={onSave}>Сохранить</button>
          </>
        }
      >
        {editing && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <TextField label="Наименование организации *" value={editing.organization_name} onChange={(v) => setEditing({ ...editing, organization_name: v })} />
            <TextField label="БИН" value={editing.bin} onChange={(v) => setEditing({ ...editing, bin: v })} />
            <TextField label="Юридический адрес" value={editing.legal_address} onChange={(v) => setEditing({ ...editing, legal_address: v })} />
            <TextField label="Фактический адрес" value={editing.actual_address} onChange={(v) => setEditing({ ...editing, actual_address: v })} />
            <TextField label="ФИО руководителя" value={editing.director_full_name} onChange={(v) => setEditing({ ...editing, director_full_name: v })} />
            <TextField label="Должность руководителя" value={editing.director_position} onChange={(v) => setEditing({ ...editing, director_position: v })} />
            <TextField label="На основании" value={editing.director_basis} onChange={(v) => setEditing({ ...editing, director_basis: v })} hint="Устав, Доверенность №…" />
            <TextField label="Контактное лицо" value={editing.contact_person} onChange={(v) => setEditing({ ...editing, contact_person: v })} />
            <TextField label="Телефон" value={editing.phone} onChange={(v) => setEditing({ ...editing, phone: v })} />
            <TextField label="Email" value={editing.email} onChange={(v) => setEditing({ ...editing, email: v })} type="email" />
            <TextField label="Направление / специальность" value={editing.specialty} onChange={(v) => setEditing({ ...editing, specialty: v })} />
            <TextField label="Кол-во мест для практики" value={editing.seats_count} onChange={(v) => setEditing({ ...editing, seats_count: v })} type="number" />
            <TextField label="Статус договора" value={editing.contract_status} onChange={(v) => setEditing({ ...editing, contract_status: v })} hint="active / suspended / archive" />
            <TextField label="Срок действия договора (до)" value={editing.contract_valid_until || ""} onChange={(v) => setEditing({ ...editing, contract_valid_until: v })} type="date" />
            <TextField label="Банк" value={editing.bank_name} onChange={(v) => setEditing({ ...editing, bank_name: v })} />
            <TextField label="БИК" value={editing.bank_bik} onChange={(v) => setEditing({ ...editing, bank_bik: v })} />
            <TextField label="ИИК" value={editing.bank_iik} onChange={(v) => setEditing({ ...editing, bank_iik: v })} />
            <div className="md:col-span-2">
              <TextArea label="Примечание" value={editing.notes} onChange={(v) => setEditing({ ...editing, notes: v })} />
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
