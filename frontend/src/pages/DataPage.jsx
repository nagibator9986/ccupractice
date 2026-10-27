import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { BookOpen, Plus } from "lucide-react";
import PageHeader from "../components/PageHeader.jsx";
import Modal from "../components/Modal.jsx";
import SearchInput from "../components/SearchInput.jsx";
import EmptyState from "../components/EmptyState.jsx";
import { TableSkeleton } from "../components/Skeleton.jsx";
import { CheckboxField, TextField } from "../components/Field.jsx";
import { useConfirm } from "../components/ConfirmDialog.jsx";
import { errorText, specialtiesApi } from "../api/endpoints.js";
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
  const confirm = useConfirm();
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
        toast.error(await errorText(e, "Не удалось загрузить справочник"));
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
      toast.error(await errorText(e, "Не удалось сохранить"));
    } finally {
      setSaving(false);
    }
  }

  async function remove(s) {
    const ok = await confirm({
      title: "Удалить специальность?",
      message: `«${s.name}» будет удалена из справочника.`,
      confirmText: "Удалить",
      tone: "danger",
    });
    if (!ok) return;
    try {
      await specialtiesApi.remove(s.id);
      toast.success("Удалено");
      load();
    } catch (e) {
      toast.error(await errorText(e, "Не удалось удалить"));
    }
  }

  return (
    <div>
      <PageHeader
        title="Данные"
        description="Справочники для подстановки в договоры. Специальности, их коды и квалификации можно выбирать списком при оформлении договора со студентом."
        actions={
          isAdmin && (
            <button type="button" onClick={() => setEditing(emptyDraft())} className="btn-primary">
              <Plus className="h-4 w-4" aria-hidden="true" />
              Добавить специальность
            </button>
          )
        }
      />

      <div className="card p-3 sm:p-4 mb-4">
        <SearchInput value={q} onChange={setQ} placeholder="Поиск: специальность, код, квалификация…" />
      </div>

      <div className="card overflow-x-auto">
        <div className="px-5 pt-4 pb-2 text-[11px] uppercase tracking-wide font-semibold text-charcoal-400">
          Специальности
        </div>
        <table className={`table-default ${!loading && items.length === 0 ? "hidden" : ""}`}>
          <thead>
            <tr>
              <th>Специальность</th>
              <th>Код</th>
              <th>Квалификация</th>
              <th>Статус</th>
              {isAdmin && (
                <th>
                  <span className="sr-only">Действия</span>
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <TableSkeleton rows={5} cols={isAdmin ? 5 : 4} />
            ) : (
              items.map((s) => (
                <tr key={s.id}>
                  <td className="font-medium min-w-[14rem]">{s.name}</td>
                  <td className="text-sm whitespace-nowrap">{s.code || "—"}</td>
                  <td className="text-sm">{s.qualification || "—"}</td>
                  <td>
                    <span className={`badge ${s.is_active ? "bg-emerald-100 text-emerald-700" : "bg-charcoal-100 text-charcoal-500"}`}>
                      {s.is_active ? "Активна" : "Скрыта"}
                    </span>
                  </td>
                  {isAdmin && (
                    <td>
                      <div className="flex gap-2 justify-end">
                        <button type="button" className="btn-secondary btn-sm" onClick={() => setEditing({ ...s, is_active: s.is_active ? "1" : "0" })}>
                          Изменить
                        </button>
                        <button type="button" className="btn-ghost btn-sm text-red-600" onClick={() => remove(s)}>
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
        {!loading && items.length === 0 && (
          <EmptyState
            icon={BookOpen}
            title={q.trim() ? "Ничего не найдено" : "Справочник пуст"}
            description={
              q.trim()
                ? "Попробуйте изменить поисковый запрос."
                : isAdmin
                  ? "Добавьте специальности — их можно будет выбирать списком при оформлении договора."
                  : "Специальности ещё не добавлены."
            }
            action={
              q.trim() ? (
                <button type="button" className="btn-secondary" onClick={() => setQ("")}>
                  Очистить поиск
                </button>
              ) : isAdmin ? (
                <button type="button" className="btn-primary" onClick={() => setEditing(emptyDraft())}>
                  <Plus className="h-4 w-4" aria-hidden="true" />
                  Добавить специальность
                </button>
              ) : null
            }
          />
        )}
      </div>

      <Modal
        open={!!editing}
        onClose={() => setEditing(null)}
        title={editing?.id ? "Изменить специальность" : "Новая специальность"}
        size="md"
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => setEditing(null)}>Отмена</button>
            <button type="button" className="btn-primary" onClick={save} disabled={saving}>Сохранить</button>
          </>
        }
      >
        {editing && (
          <div className="space-y-4">
            <TextField
              label="Специальность"
              required
              data-autofocus
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
            <CheckboxField
              label="Статус"
              text="Активна (видна в списке выбора при оформлении договора)"
              checked={editing.is_active === "1"}
              onChange={(v) => setEditing({ ...editing, is_active: v ? "1" : "0" })}
            />
          </div>
        )}
      </Modal>
    </div>
  );
}
