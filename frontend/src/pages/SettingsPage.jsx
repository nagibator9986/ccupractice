import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import PageHeader from "../components/PageHeader.jsx";
import { TextField } from "../components/Field.jsx";
import { settingsApi } from "../api/endpoints.js";
import { useAuth } from "../context/AuthContext.jsx";

export default function SettingsPage() {
  const { isAdmin } = useAuth();
  const [data, setData] = useState(null);
  const [templateInfo, setTemplateInfo] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      const { item } = await settingsApi.getCollege();
      setData(item);
      const info = await settingsApi.templateInfo();
      setTemplateInfo(info);
    })();
  }, []);

  async function onSave() {
    if (!(data.name_ru || "").trim()) {
      toast.error("Поле «Наименование (рус.)» обязательно");
      return;
    }
    setBusy(true);
    try {
      const { item } = await settingsApi.updateCollege(data);
      setData(item);
      toast.success("Настройки сохранены");
    } catch (e) {
      toast.error(e.response?.data?.error || "Не удалось сохранить настройки");
    } finally {
      setBusy(false);
    }
  }

  async function onUpload(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".docx")) {
      toast.error("Допустимы только .docx файлы");
      event.target.value = "";
      return;
    }
    setBusy(true);
    try {
      await settingsApi.uploadTemplate(file);
      const info = await settingsApi.templateInfo();
      setTemplateInfo(info);
      toast.success("Шаблон загружен");
    } catch (e) {
      toast.error(e.response?.data?.error || "Не удалось загрузить шаблон");
    } finally {
      setBusy(false);
      event.target.value = "";
    }
  }

  if (!data) return <div className="text-slate-500">Загрузка…</div>;

  return (
    <div>
      <PageHeader
        title="Настройки шаблона и колледжа"
        description="Реквизиты организации образования и шаблон договора. Подставляются автоматически при формировании."
        actions={
          isAdmin && (
            <button className="btn-primary" onClick={onSave} disabled={busy}>
              Сохранить
            </button>
          )
        }
      />

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <section className="card p-5 xl:col-span-2">
          <h2 className="font-semibold mb-4">Реквизиты колледжа</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <TextField label="Наименование (рус.)" value={data.name_ru} onChange={(v) => setData({ ...data, name_ru: v })} />
            <TextField label="Наименование (қаз.)" value={data.name_kz} onChange={(v) => setData({ ...data, name_kz: v })} />
            <TextField label="ФИО директора" value={data.director_full_name} onChange={(v) => setData({ ...data, director_full_name: v })} />
            <TextField label="На основании" value={data.director_basis} onChange={(v) => setData({ ...data, director_basis: v })} />
            <TextField label="Адрес" value={data.address} onChange={(v) => setData({ ...data, address: v })} />
            <TextField label="Город" value={data.city} onChange={(v) => setData({ ...data, city: v })} />
            <TextField label="БИН" value={data.bin} onChange={(v) => setData({ ...data, bin: v })} />
            <TextField label="ИИК" value={data.iik} onChange={(v) => setData({ ...data, iik: v })} />
            <TextField label="Банк" value={data.bank_name} onChange={(v) => setData({ ...data, bank_name: v })} />
            <TextField label="Адрес банка" value={data.bank_address} onChange={(v) => setData({ ...data, bank_address: v })} />
            <TextField label="БИК" value={data.bank_bik} onChange={(v) => setData({ ...data, bank_bik: v })} />
            <TextField label="Email" value={data.email} onChange={(v) => setData({ ...data, email: v })} />
            <TextField label="Телефон" value={data.phone} onChange={(v) => setData({ ...data, phone: v })} />
            <TextField label="Префикс номера договора" value={data.contract_prefix} onChange={(v) => setData({ ...data, contract_prefix: v })} hint="Например, «ПП» → ПП-2026-001" />
          </div>
        </section>

        <section className="card p-5 space-y-4">
          <h2 className="font-semibold">Шаблон договора</h2>
          <div className="text-sm">
            <div className="text-slate-500 text-xs uppercase font-semibold mb-1">Текущий шаблон</div>
            <div className="font-mono break-all">{templateInfo?.template}</div>
            <div className="text-xs text-slate-500">
              {templateInfo?.exists ? `Размер: ${templateInfo.size} б.` : "Файл отсутствует — будет создан автоматически."}
            </div>
          </div>

          <label className="block">
            <span className="label">Загрузить новый шаблон (.docx)</span>
            <input
              type="file"
              accept=".docx"
              onChange={onUpload}
              disabled={busy || !isAdmin}
              className="text-sm"
            />
          </label>

          <div className="rounded-xl bg-slate-50 p-3 text-xs text-slate-600 space-y-2">
            <div className="font-semibold">Доступные переменные:</div>
            <div className="font-mono leading-5">
              {"{{ college.name_ru }}"}, {"{{ college.address }}"}, {"{{ college.bin }}"}<br/>
              {"{{ partner.organization_name }}"}, {"{{ partner.bin }}"}, {"{{ partner.director_full_name }}"}<br/>
              {"{{ student.full_name }}"}, {"{{ student.iin }}"}, {"{{ student.group_name }}"}<br/>
              {"{{ student.specialty }}"}, {"{{ student.practice_start }}"}, {"{{ student.practice_end }}"}<br/>
              {"{{ contract.number }}"}, {"{{ contract.date }}"}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
