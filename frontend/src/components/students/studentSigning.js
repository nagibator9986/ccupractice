// Who signs the practice contract for a student and how — client-side mirror of the rule in
// backend/app/utils/signers.py, used only for HINTS (the server stays the authority):
// under 16 → the legal representative signs; birth date from the card, else from the ИИН.

export const ADULT_SIGN_AGE = 16;

// 7th digit of the ИИН = century + sex: 1/2 → 18xx, 3/4 → 19xx, 5/6 → 20xx.
const CENTURY = { 1: 1800, 2: 1800, 3: 1900, 4: 1900, 5: 2000, 6: 2000 };

function validParts(y, m, d) {
  const dt = new Date(y, m - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d ? { y, m, d } : null;
}

/** {y, m, d} from an ИИН (YYMMDD + century digit) or null. */
export function birthPartsFromIin(iin) {
  const digits = String(iin ?? "").replace(/\D/g, "");
  if (digits.length !== 12) return null;
  const base = CENTURY[Number(digits[6])];
  if (!base) return null;
  return validParts(base + Number(digits.slice(0, 2)), Number(digits.slice(2, 4)), Number(digits.slice(4, 6)));
}

/** {y, m, d} from the card's birth date (YYYY-MM-DD), else from the ИИН. */
export function birthPartsOf(student) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(student?.birth_date ?? ""));
  if (m) {
    const parts = validParts(Number(m[1]), Number(m[2]), Number(m[3]));
    if (parts) return parts;
  }
  return birthPartsFromIin(student?.iin);
}

/** Full years today, or null when neither the birth date nor the ИИН tell. */
export function ageToday(student, now = new Date()) {
  const b = birthPartsOf(student);
  if (!b) return null;
  let age = now.getFullYear() - b.y;
  if (now.getMonth() + 1 < b.m || (now.getMonth() + 1 === b.m && now.getDate() < b.d)) age -= 1;
  return age;
}

/** Under 16 today → the legal representative signs the contract. Unknown age → false. */
export function isUnder16(student, now = new Date()) {
  const age = ageToday(student, now);
  return age != null && age < ADULT_SIGN_AGE;
}

/** The select of the student card: an empty value means the default — ЭЦП. */
export const SIGN_METHOD_PAPER_LABEL =
  "На бумаге, со сканом — для тех, кто не может подписать ЭЦП (например, живёт за пределами РК)";
