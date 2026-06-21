import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import toast from "react-hot-toast";
import PageHeader from "../components/PageHeader.jsx";
import StatusBadge from "../components/StatusBadge.jsx";
import { archiveApi, contractsApi } from "../api/endpoints.js";
import { formatDate } from "../utils/format.js";

export default function ArchivePage() {
  const [view, setView] = useState("list"); // list | tree
  const [q, setQ] = useState("");
  const [year, setYear] = useState("");
  const [items, setItems] = useState([]);
  const [tree, setTree] = useState({});
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      if (view === "list") {
        const data = await archiveApi.list({ q, year });
        setItems(data.items);
      } else {
        const data = await archiveApi.tree();
        setTree(data.tree);
      }
    } catch (e) {
      const s = e.response?.status;
      if (s !== 401 && s !== 422)
        toast.error(e.response?.data?.error || "Не удалось загрузить архив");
      if (view === "list") setItems([]);
      else setTree({});
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [q, year, view]);

  async function downloadFile(contract, fmt, ext) {
    try {
      await contractsApi.download(contract.id, fmt, `${contract.number}.${ext}`);
    } catch (e) {
      toast.error("Не удалось скачать файл");
    }
  }

  return (
    <div>
      <PageHeader
        title="Электронный архив"
        description="Структура: Профессиональная практика / Год / Партнёр / Договоры."
        actions={
          <>
            <button className={`btn-secondary ${view === "list" ? "ring-2 ring-coral-300" : ""}`} onClick={() => setView("list")}>
              Список
            </button>
            <button className={`btn-secondary ${view === "tree" ? "ring-2 ring-coral-300" : ""}`} onClick={() => setView("tree")}>
              Дерево
            </button>
          </>
        }
      />

      {view === "list" && (
        <div className="card p-4 mb-4 flex flex-wrap gap-3">
          <input className="input flex-1 min-w-[240px]" placeholder="Поиск" value={q} onChange={(e) => setQ(e.target.value)} />
          <input
            className="input w-32"
            placeholder="Год"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={4}
            value={year}
            onChange={(e) => setYear(e.target.value.replace(/\D/g, ""))}
          />
        </div>
      )}

      {view === "list" ? (
        <div className="card overflow-x-auto">
          <table className="table-default">
            <thead>
              <tr>
                <th>№</th>
                <th>Год</th>
                <th>Партнёр</th>
                <th>Студент</th>
                <th>Дата</th>
                <th>Статус</th>
                <th>Файлы</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={7} className="text-center py-6 text-slate-500">Загрузка…</td></tr>
              ) : items.length === 0 ? (
                <tr><td colSpan={7} className="text-center py-6 text-slate-500">Архив пуст.</td></tr>
              ) : (
                items.map((c) => (
                  <tr key={c.id}>
                    <td>
                      <Link to={`/contracts/${c.id}`} className="font-semibold text-coral-600 hover:underline">{c.number}</Link>
                    </td>
                    <td>{c.year}</td>
                    <td>{c.partner_name}</td>
                    <td>{c.student_name}</td>
                    <td>{formatDate(c.contract_date)}</td>
                    <td><StatusBadge value={c.status} /></td>
                    <td className="space-x-2">
                      {c.docx_exists && (
                        <button className="text-coral-600 hover:underline text-sm" onClick={() => downloadFile(c, "docx", "docx")}>DOCX</button>
                      )}
                      {c.pdf_exists && (
                        <button className="text-coral-600 hover:underline text-sm" onClick={() => downloadFile(c, "pdf", "pdf")}>PDF</button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="space-y-4">
          {Object.keys(tree).length === 0 && !loading && (
            <div className="card p-6 text-slate-500">Архив пуст.</div>
          )}
          {Object.entries(tree).map(([year, partners]) => (
            <div key={year} className="card">
              <div className="px-5 py-4 border-b font-semibold bg-slate-50">📁 {year}</div>
              <div className="divide-y">
                {Object.entries(partners).map(([partnerName, contracts]) => (
                  <div key={partnerName} className="px-5 py-3">
                    <div className="font-medium mb-2">📂 {partnerName}</div>
                    <ul className="space-y-1 pl-6">
                      {contracts.map((c) => (
                        <li key={c.id} className="flex items-center justify-between gap-3 text-sm">
                          <Link to={`/contracts/${c.id}`} className="text-coral-600 hover:underline">
                            📄 {c.number} — {c.student_name}
                          </Link>
                          <div className="flex gap-2">
                            {c.docx_exists && (
                              <button className="text-charcoal-500 hover:text-coral-600" onClick={() => downloadFile(c, "docx", "docx")}>DOCX</button>
                            )}
                            {c.pdf_exists && (
                              <button className="text-charcoal-500 hover:text-coral-600" onClick={() => downloadFile(c, "pdf", "pdf")}>PDF</button>
                            )}
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
