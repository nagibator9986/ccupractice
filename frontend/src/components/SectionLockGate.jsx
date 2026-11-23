import { useState } from "react";
import { Outlet } from "react-router-dom";
import { Lock } from "lucide-react";
import { TextField } from "./Field.jsx";
import { errorText } from "../api/endpoints.js";
import { useSectionLock } from "../context/SectionLockContext.jsx";

/**
 * Route layout for the password-protected sections: renders the section (<Outlet/>) once unlocked,
 * otherwise a password screen. The section's pages never mount while locked, so they cannot
 * fire requests that the server would refuse.
 */
export default function SectionLockGate() {
  const { ready, locked, unlock } = useSectionLock();
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  if (!ready) {
    return <div className="py-20 text-center text-sm text-charcoal-500">Загрузка…</div>;
  }
  if (!locked) return <Outlet />;

  async function submit(e) {
    e.preventDefault();
    if (!password) {
      setError("Введите пароль");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await unlock(password);
      setPassword("");
    } catch (err) {
      setError(await errorText(err, "Не удалось проверить пароль"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto mt-6 max-w-md rounded-2xl bg-white p-6 shadow-sm ring-1 ring-charcoal-100 sm:mt-16 sm:p-8">
      <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-coral-50 text-coral-600">
        <Lock className="h-7 w-7" aria-hidden="true" />
      </div>
      <h1 className="mt-4 text-center font-display text-2xl text-charcoal-900">Раздел закрыт паролем</h1>
      <p className="mt-2 text-center text-sm text-charcoal-500">
        В «Договорах со студентами» и «LMS-договорах» хранятся персональные данные абитуриентов и родителей.
        Введите пароль, чтобы открыть оба раздела.
      </p>
      <form onSubmit={submit} className="mt-6 space-y-4">
        <TextField
          label="Пароль"
          type="password"
          value={password}
          onChange={(v) => {
            setPassword(v);
            setError("");
          }}
          error={error || undefined}
          autoComplete="off"
          data-autofocus
          autoFocus
        />
        <button type="submit" className="btn-primary w-full" disabled={busy}>
          {busy ? "Проверяем…" : "Открыть"}
        </button>
      </form>
    </div>
  );
}
