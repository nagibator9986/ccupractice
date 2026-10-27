import { Lock } from "lucide-react";
import BrandLogo from "../BrandLogo.jsx";

const COLLEGE_FALLBACK = "Колледж УО «Каспийский общественный университет»";

/**
 * Chrome shared by every state of the public signing page: logo bar, content
 * column and the college footer. `college` is the optional `contract.college`
 * object from the public payload ({name_ru, city, director_full_name} and, if
 * the backend ever adds them, phone / email).
 */
export default function PublicShell({ children, college }) {
  const name = college?.name_ru || COLLEGE_FALLBACK;
  const contacts = [college?.city, college?.phone, college?.email].filter(Boolean);
  return (
    <div className="min-h-screen bg-gradient-to-br from-coral-50/40 via-white to-charcoal-50/60">
      <div className="mx-auto w-full max-w-6xl px-4 sm:px-6 pt-4 sm:pt-6 pb-8">
        <div className="mb-4 sm:mb-5 flex items-center justify-between gap-3">
          <BrandLogo size={40} withWordmark />
          <span className="chip shrink-0">
            <Lock className="h-3 w-3" aria-hidden="true" />
            Защищённая ссылка
          </span>
        </div>

        <main>{children}</main>

        <footer className="mt-10 flex flex-col items-center gap-1.5 text-center text-xs text-charcoal-400">
          <img src="/ccu-logo.png" alt="" className="h-9 w-9 opacity-60" />
          <div className="font-medium text-charcoal-500">{name}</div>
          {contacts.length > 0 && <div>{contacts.join(" · ")}</div>}
          <div>© {new Date().getFullYear()} CCU PRACTICUM</div>
        </footer>
      </div>
    </div>
  );
}
