import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import toast from "react-hot-toast";
import PageHeader from "../components/PageHeader.jsx";
import Modal from "../components/Modal.jsx";
import StatusBadge from "../components/StatusBadge.jsx";
import { SelectField, TextField } from "../components/Field.jsx";
import { contractsApi, partnersApi, studentsApi } from "../api/endpoints.js";
import { formatDate, STATUS_LABELS } from "../utils/format.js";
import { useAuth } from "../context/AuthContext.jsx";

export default function ContractsPage() {
  const { isAdmin } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [items, setItems] = useState([]);
  const [partners, setPartners] = useState([]);
  const [students, setStudents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({
    q: searchParams.get("q") || "",
    status: searchParams.get("status") || "",
    group: searchParams.get("group") || "",
    specialty: searchParams.get("specialty") || "",
    date_from: searchParams.get("date_from") || "",
    date_to: searchParams.get("date_to") || "",
  });
  const [creating, setCreating] = useState(null);

  async function load() {
    setLoading(true);
    try {
      const data = await contractsApi.list(filters);
      setItems(data.items);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    (async () => {
      const [p, s] = await Promise.all([partnersApi.list(), studentsApi.list()]);
      setPartners(p.items);
      setStudents(s.items);
    })();
  }, []);

  useEffect(() => {
    const t = setTimeout(() => {
      const params = Object.fromEntries(Object.entries(filters).filter(([, v]) => v));
      setSearchParams(params);
      load();
    }, 250);
    return () => clearTimeout(t);
  }, [filters]); // eslint-disable-line

  async function createContract() {
    try {
      const data = await contractsApi.create(creating);
      toast.success(`Договор ${data.item.number} создан`);
      setCreating(null);
      load();
    } catch (e) {
      toast.error(e.response?.data?.error || "Ошибка создания");
    }
  }

  return (
    <div>
      <PageHeader
        title="Договоры"
        description="Реестр трёхсторонних договоров профессиональной практики. Поиск и фильтрация по статусу, группе, специальности и дате."
        actions={
          isAdmin && (
            <button
              onClick={() => setCreating({ partner_id: "", student_id: "", contract_date: new Date().toISOString().slice(0, 10), notes: "" })}
              className="btn-primary"
            >
              + Новый договор
            </button>
          )
        }
      />

      <div className="card p-4 mb-4 grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <input className="input lg:col-span-2" placeholder="Поиск: №, партнёр, студент…" value={filters.q} onChange={(e) => setFilters({ ...filters, q: e.target.value })} />
        <select className="input" value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })}>
          <option value="">Любой статус</option>
          {Object.entries(STATUS_LABELS).map(([v, l]) => (
            <option key={v} value={v}>{l}</option>
          ))}
        </select>
        <input className="input" placeholder="Группа" value={filters.group} onChange={(e) => setFilters({ ...filters, group: e.target.value })} />
        <input className="input" placeholder="Специальность" value={filters.specialty} onChange={(e) => setFilters({ ...filters, specialty: e.target.value })} />
        <div className="flex gap-2">
          <input type="date" className="input" value={filters.date_from} onChange={(e) => setFilters({ ...filters, date_from: e.target.value })} />
          <input type="date" className="input" value={filters.date_to} onChange={(e) => setFilters({ ...filters, date_to: e.target.value })} />
        </div>
      </div>

      <div className="card overflow-x-auto">
        <table className="table-default">
          <thead>
            <tr>
              <th>№ договора</th>
              <th>Дата</th>
              <th>Партнёр</th>
              <th>Студент</th>
              <th>Группа / специальность</th>
              <th>Период практики</th>
              <th>Статус</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={8} className="text-center py-6 text-slate-500">Загрузка…</td></tr>
            ) : items.length === 0 ? (
              <tr><td colSpan={8} className="text-center py-6 text-slate-500">Договоров пока нет.</td></tr>
            ) : (
              items.map((c) => (
                <tr key={c.id}>
                  <td>
                    <Link to={`/contracts/${c.id}`} className="font-semibold text-coral-600 hover:underline">
                      {c.number}
                    </Link>
                  </td>
                  <td>{formatDate(c.contract_date)}</td>
                  <td>{c.partner_name}</td>
                  <td>{c.student_name}</td>
                  <td className="text-sm">
                    <div>{c.student_group}</div>
                    <div className="text-slate-500 text-xs">{c.student_specialty}</div>
                  </td>
                  <td className="text-xs">
                    {c.practice_start ? `${formatDate(c.practice_start)} → ${formatDate(c.practice_end)}` : "—"}
                  </td>
                  <td><StatusBadge value={c.status} /></td>
                  <td><Link to={`/contracts/${c.id}`} className="btn-secondary">Открыть</Link></td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <Modal
        open={!!creating}
        onClose={() => setCreating(null)}
        title="Новый договор"
        size="md"
        footer={
          <>
            <button className="btn-secondary" onClick={() => setCreating(null)}>Отмена</button>
            <button className="btn-primary" onClick={createContract}>Создать</button>
          </>
        }
      >
        {creating && (
          <div className="space-y-4">
            <SelectField
              label="Партнёр *"
              value={creating.partner_id}
              onChange={(v) => setCreating({ ...creating, partner_id: v })}
              options={partners.map((p) => ({ value: p.id, label: p.organization_name }))}
              placeholder="— выберите —"
            />
            <SelectField
              label="Студент *"
              value={creating.student_id}
              onChange={(v) => setCreating({ ...creating, student_id: v })}
              options={students.map((s) => ({ value: s.id, label: `${s.full_name} (${s.group_name || "?"})` }))}
              placeholder="— выберите —"
            />
            <TextField
              label="Дата договора"
              type="date"
              value={creating.contract_date}
              onChange={(v) => setCreating({ ...creating, contract_date: v })}
            />
            <div className="text-xs text-slate-500">
              Номер договора будет присвоен автоматически в формате <code>ПП-{new Date().getFullYear()}-001</code>.
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
