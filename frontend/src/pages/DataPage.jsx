import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import PageHeader from "../components/PageHeader.jsx";
import Modal from "../components/Modal.jsx";
import { TextField } from "../components/Field.jsx";
import { specialtiesApi } from "../api/endpoints.js";
import { useAuth } from "../context/AuthContext.jsx";

const emptyDraft = () => ({
  id: null,
  name: "",
  code: "",
  qualification: "",
  is_active: "1",
});

export default function DataPage() {
  const { isAdmin } = useAuth();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const data = await specialtiesApi.list({ q });
      setItems(data.items);
    } catch (e) {
      const s = e.response?.status;
      if (s !== 401 && s !== 422)
        toast.error(e.response?.data?.error || "Не удалось загрузить справочник");
      setItems([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [q]); // eslint-disable-line

  async function save() {
    if (!editing.name.trim()) {
      toast.error("Укажите название специальности");
      return;
    }
    setSaving(true);
    const payload = {
      name: editing.name,
      code: editing.code,
      qualification: editing.qualification,
      is_active: editing.is_active === "1",
    };
    try {
      if (editing.id) await specialtiesApi.update(editing.id, payload);
      else await specialtiesApi.create(payload);
      toast.success("Сохранено");
      setEditing(null);
      load();
    } catch (e) {
      toast.error(e.response?.data?.error || "Не удалось сохранить");
    } finally {
      setSaving(false);
    }
  }

  async function remove(s) {
    if (!window.confirm(`Удалить «${s.name}» из справочника?`)) return;
    try {
      await specialtiesApi.remove(s.id);
      toast.success("Удалено");
      load();
    } catch (e) {
      toast.error(e.response?.data?.error || "Не удалось удалить");
    }
  }

  return (
    <div>
      <PageHeader
        title="Данные"
        description="Справочники для подстановки в договоры. Специальности, их коды и квалификации можно выбирать списком при оформлении договора со студентом."
        actions={
          isAdmin && (
            <button onClick={() => setEditing(emptyDraft())} className="btn-primary">
              + Добавить специальность
            </button>
          )
        }
      />

      <div className="card p-4 mb-4">
        <input
          className="input"
          placeholder="Поиск: специальность, код, квалификация…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>

      <div className="card overflow-x-auto">
        <div className="px-5 pt-4 pb-2 text-[11px] uppercase tracking-wide font-semibold text-charcoal-400">
          Специальности
        </div>
        <table className="table-default">
          <thead>
            <tr>
              <th>Специальность</th>
              <th>Код</th>
              <th>Квалификация</th>
              <th>Статус</th>
              {isAdmin && <th></th>}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={isAdmin ? 5 : 4} className="text-center py-6 text-slate-500">Загрузка…</td></tr>
            ) : items.length === 0 ? (
              <tr>
                <td colSpan={isAdmin ? 5 : 4} className="text-center py-8 text-slate-500">
                  Справочник пуст.
                  {isAdmin && " Нажмите «+ Добавить специальность», чтобы заполнить список."}
                </td>
              </tr>
            ) : (
              items.map((s) => (
                <tr key={s.id}>
                  <td className="font-medium">{s.name}</td>
                  <td className="text-sm">{s.code || "—"}</td>
                  <td className="text-sm">{s.qualification || "—"}</td>
                  <td>
                    <span className={`badge ${s.is_active ? "bg-emerald-100 text-emerald-700" : "bg-charcoal-100 text-charcoal-500"}`}>
                      {s.is_active ? "Активна" : "Скрыта"}
                    </span>
                  </td>
                  {isAdmin && (
                    <td>
                      <div className="flex gap-2 justify-end">
                        <button className="btn-secondary text-xs" onClick={() => setEditing({ ...s, is_active: s.is_active ? "1" : "0" })}>
                          Изменить
                        </button>
                        <button className="btn-ghost text-xs text-red-600" onClick={() => remove(s)}>
                          Удалить
                        </button>
                      </div>
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
        title={editing?.id ? "Изменить специальность" : "Новая специальность"}
        size="md"
        footer={
          <>
            <button className="btn-secondary" onClick={() => setEditing(null)}>Отмена</button>
            <button className="btn-primary" onClick={save} disabled={saving}>Сохранить</button>
          </>
        }
      >
        {editing && (
          <div className="space-y-4">
            <TextField
              label="Специальность *"
              value={editing.name}
              onChange={(v) => setEditing({ ...editing, name: v })}
              hint="Например: Вычислительная техника и программное обеспечение"
            />
            <TextField
              label="Код специальности"
              value={editing.code}
              onChange={(v) => setEditing({ ...editing, code: v })}
              hint="Например: 06120100"
            />
            <TextField
              label="Квалификация"
              value={editing.qualification}
              onChange={(v) => setEditing({ ...editing, qualification: v })}
              hint="Например: Техник-программист"
            />
            <div>
              <label className="label">Статус</label>
              <label className="flex items-center gap-2 mt-1 text-sm text-charcoal-700 cursor-pointer">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-charcoal-300 text-coral-600 focus:ring-coral-500"
                  checked={editing.is_active === "1"}
                  onChange={(e) => setEditing({ ...editing, is_active: e.target.checked ? "1" : "0" })}
                />
                Активна (видна в списке выбора при оформлении договора)
              </label>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
