import { useCallback, useEffect, useState } from "react";
import toast from "react-hot-toast";
import { Building2, FileText, RefreshCw, Save, TriangleAlert } from "lucide-react";
import PageHeader from "../components/PageHeader.jsx";
import SectionCard from "../components/SectionCard.jsx";
import EmptyState from "../components/EmptyState.jsx";
import { CardSkeleton } from "../components/Skeleton.jsx";
import { TextField } from "../components/Field.jsx";
import { errorText, settingsApi } from "../api/endpoints.js";
import { formatBytes } from "../utils/format.js";
import { useAuth } from "../context/AuthContext.jsx";

export default function SettingsPage() {
  const { isAdmin } = useAuth();
  const [data, setData] = useState(null);
  const [templateInfo, setTemplateInfo] = useState(null);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState(false);

  const load = useCallback(async () => {
    setLoadError(false);
    try {
      const { item } = await settingsApi.getCollege();
      setData(item);
      const info = await settingsApi.templateInfo();
      setTemplateInfo(info);
    } catch (e) {
      const s = e.response?.status;
      setLoadError(true);
      if (s !== 401 && s !== 422) toast.error(await errorText(e, "Не удалось загрузить настройки"));
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

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
      toast.error(await errorText(e, "Не удалось сохранить настройки"));
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
      toast.error(await errorText(e, "Не удалось загрузить шаблон"));
    } finally {
      setBusy(false);
      event.target.value = "";
    }
  }

  if (loadError && !data)
    return (
      <div className="card">
        <EmptyState
          icon={TriangleAlert}
          title="Не удалось загрузить настройки"
          description="Проверьте соединение и попробуйте ещё раз."
          action={
            <button type="button" className="btn-primary" onClick={load}>
              <RefreshCw className="h-4 w-4" aria-hidden="true" />
              Повторить
            </button>
          }
        />
      </div>
    );
  if (!data)
    return (
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3" aria-busy="true" aria-label="Загрузка настроек">
        <CardSkeleton lines={8} className="xl:col-span-2" />
        <CardSkeleton lines={4} />
      </div>
    );

  return (
    <div>
      <PageHeader
        title="Настройки шаблона и колледжа"
        description="Реквизиты организации образования и шаблон договора. Подставляются автоматически при формировании."
        actions={
          isAdmin && (
            <button className="btn-primary" onClick={onSave} disabled={busy}>
              <Save className="h-4 w-4" aria-hidden="true" />
              Сохранить
            </button>
          )
        }
      />

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <SectionCard className="xl:col-span-2" icon={Building2} title="Реквизиты колледжа">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <TextField label="Наименование (рус.)" required value={data.name_ru} onChange={(v) => setData({ ...data, name_ru: v })} />
            <TextField label="Наименование (қаз.)" value={data.name_kz} onChange={(v) => setData({ ...data, name_kz: v })} />
            <TextField label="ФИО директора" value={data.director_full_name} onChange={(v) => setData({ ...data, director_full_name: v })} />
            <TextField label="На основании" value={data.director_basis} onChange={(v) => setData({ ...data, director_basis: v })} />
            <TextField label="ИИН директора (для ЭЦП)" value={data.director_iin || ""} onChange={(v) => setData({ ...data, director_iin: v })} hint="Личный ИИН — если директор подписывает личной ЭЦП, а не орг-сертификатом. Устраняет ложные предупреждения." />
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
        </SectionCard>

        <SectionCard icon={FileText} title="Шаблон договора" className="self-start">
          <div className="space-y-4">
            <div className="text-sm">
              <div className="label">Текущий шаблон</div>
              <div className="font-mono break-all">{templateInfo?.template}</div>
              <div className="text-xs text-charcoal-500">
                {templateInfo?.exists ? `Размер: ${formatBytes(templateInfo.size)}` : "Файл отсутствует — будет создан автоматически."}
              </div>
            </div>

            <label className="block">
              <span className="label">Загрузить новый шаблон (.docx)</span>
              <input
                type="file"
                accept=".docx"
                onChange={onUpload}
                disabled={busy || !isAdmin}
                className="block w-full text-sm file:mr-3 file:min-h-[44px] file:rounded-xl file:border-0 file:bg-charcoal-100 file:px-4 file:py-2 file:text-sm file:font-semibold file:text-charcoal-700 hover:file:bg-charcoal-200 sm:file:min-h-0"
              />
            </label>

            <div className="rounded-xl bg-charcoal-50 p-3 text-xs text-charcoal-600 space-y-2">
              <div className="font-semibold">Доступные переменные:</div>
              <div className="font-mono leading-5 break-words">
                {"{{ college.name_ru }}"}, {"{{ college.address }}"}, {"{{ college.bin }}"}<br/>
                {"{{ partner.organization_name }}"}, {"{{ partner.bin }}"}, {"{{ partner.director_full_name }}"}<br/>
                {"{{ student.full_name }}"}, {"{{ student.iin }}"}, {"{{ student.group_name }}"}<br/>
                {"{{ student.specialty }}"}, {"{{ student.practice_start }}"}, {"{{ student.practice_end }}"}<br/>
                {"{{ contract.number }}"}, {"{{ contract.date }}"}
              </div>
            </div>
          </div>
        </SectionCard>
      </div>
    </div>
  );
}
