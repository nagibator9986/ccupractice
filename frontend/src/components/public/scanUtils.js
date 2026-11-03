import { formatBytes } from "../../utils/format.js";

// Limits mirror backend/app/services/scan_store.py (MAX_IMAGES, MAX_FILE_BYTES).
export const SCAN_MAX_IMAGES = 10;
export const SCAN_MAX_MB = 15;
export const SCAN_ACCEPT = ".pdf,image/*";

/**
 * The server sends naive UTC for most timestamps (no "Z"); `new Date()` would read
 * those as local time and show them hours off. Bare strings are therefore read as UTC.
 */
export function utcIso(iso) {
  if (!iso) return iso;
  const s = String(iso);
  return /[zZ]$|[+-]\d\d:?\d\d$/.test(s) ? s : `${s}Z`;
}

/** "Колледж (организация образования)" -> "Колледж": the progress cells are narrow. */
export function shortLabel(label) {
  return String(label || "").replace(/\s*\([^)]*\)\s*$/, "").trim();
}

/** "pdf" | "image" (JPG/PNG — what the server can merge) | null. Judged by type, falling back to the extension. */
export function scanKind(file) {
  const name = String(file?.name || "").toLowerCase();
  const type = String(file?.type || "").toLowerCase();
  if (type === "application/pdf" || name.endsWith(".pdf")) return "pdf";
  if (type === "image/jpeg" || type === "image/jpg" || type === "image/png") return "image";
  if (/\.(jpe?g|png)$/.test(name)) return "image";
  return null;
}

const sameFile = (a, b) => a.name === b.name && a.size === b.size && a.lastModified === b.lastModified;

/**
 * Add `incoming` to the already chosen `current` list, keeping the list ALWAYS valid for the
 * server: either exactly one PDF, or 1..10 photos (JPG/PNG), each up to 15 MB.
 * Returns `{ files, errors }` — `errors` are user-ready sentences about what was left out.
 */
export function mergeScanFiles(current, incoming) {
  const errors = [];
  const accepted = [];
  for (const f of incoming) {
    const kind = scanKind(f);
    if (!kind) {
      const heic = /heic|heif|webp|gif/i.test(`${f.type} ${f.name}`);
      errors.push(
        heic
          ? `Файл «${f.name}» в формате, который мы не можем прочитать. Сделайте фото в формате JPG или PNG либо загрузите PDF.`
          : `Файл «${f.name}» не подходит. Загрузите PDF или фото в формате JPG или PNG.`,
      );
      continue;
    }
    if (!f.size) {
      errors.push(`Файл «${f.name}» пустой — выберите другой.`);
      continue;
    }
    if (f.size > SCAN_MAX_MB * 1024 * 1024) {
      errors.push(`Файл «${f.name}» слишком большой (${formatBytes(f.size)}). Максимум — ${SCAN_MAX_MB} МБ.`);
      continue;
    }
    if ([...current, ...accepted].some((x) => sameFile(x, f))) continue; // picked twice
    accepted.push(f);
  }
  if (accepted.length === 0) return { files: current, errors };

  // A single new PDF simply replaces the PDF that was chosen before.
  if (accepted.length === 1 && scanKind(accepted[0]) === "pdf" && current.length === 1 && scanKind(current[0]) === "pdf") {
    return { files: accepted, errors };
  }

  const next = [...current, ...accepted];
  if (next.some((f) => scanKind(f) === "pdf") && next.length > 1) {
    return {
      files: current,
      errors: [...errors, "PDF загружается одним файлом — без фото и других файлов. Уберите лишнее из списка или выберите только фото."],
    };
  }
  if (next.length > SCAN_MAX_IMAGES) {
    return {
      files: current,
      errors: [...errors, `Можно загрузить не больше ${SCAN_MAX_IMAGES} фото. Если страниц больше — соберите их в один PDF.`],
    };
  }
  return { files: next, errors };
}

/** Server/transport failure of the upload -> one plain sentence for the signer. */
export function uploadErrorText(e) {
  if (!e?.response) {
    return e?.code === "ECONNABORTED"
      ? "Загрузка заняла слишком много времени. Проверьте интернет и нажмите «Отправить на проверку» ещё раз — выбранные файлы сохранены."
      : "Нет связи с сервером. Проверьте интернет и нажмите «Отправить на проверку» ещё раз — выбранные файлы сохранены.";
  }
  const { status, data } = e.response;
  const code = data?.code;
  if (status === 413) return "Файлы слишком большие для отправки. Уменьшите размер или количество фото и попробуйте ещё раз.";
  if (status === 410) {
    return code === "revoked"
      ? "Колледж отозвал эту ссылку. Попросите прислать новую."
      : "Срок действия ссылки истёк. Попросите колледж продлить её или прислать новую.";
  }
  if (code === "signed") return "Эта сторона уже подписала договор. Страница обновлена.";
  return data?.error || "Не удалось отправить скан. Попробуйте ещё раз.";
}

/** Codes after which the page's own state is stale and must be reloaded. */
export function uploadErrorIsStale(e) {
  const code = e?.response?.data?.code;
  return code === "signed" || code === "not_scan" || code === "no_document";
}
