// Operations that several screens share: generating one contract with the
// "fill the gaps first?" / "reset signatures?" prompts, generating a queue of
// contracts one by one, and issuing signing links in chunks.
import toast from "react-hot-toast";
import { contractsApi, errorText, signingApi } from "../../api/endpoints.js";
import { criticalLabels } from "./contractFlow.js";

/** Critical gaps the backend attached to a 422 `incomplete` answer. */
export function missingLabelsFrom(error) {
  return criticalLabels(error?.response?.data?.readiness);
}

/**
 * Generate one contract, asking the user what to do when the server objects:
 *  - 422 `incomplete`      → list the gaps, offer «Сформировать всё равно»;
 *  - 409 `has_signatures`  → danger confirm, then retry with `force`.
 * Resolves to { ok: true, item } | { ok: false, cancelled?: true, error?: true }.
 */
export async function generateInteractive(id, { confirm, payload = {} } = {}) {
  try {
    const hasPayload = Object.keys(payload).length > 0;
    const { item } = await contractsApi.generate(id, hasPayload ? payload : undefined);
    return { ok: true, item };
  } catch (e) {
    const status = e.response?.status;
    const data = e.response?.data;

    if (status === 422 && data?.code === "incomplete" && !payload.allow_incomplete && confirm) {
      const labels = missingLabelsFrom(e);
      const go = await confirm({
        title: "Не хватает данных для договора",
        message:
          (labels.length ? `В документе останутся пустые места:\n${labels.map((l) => `• ${l}`).join("\n")}\n\n` : "") +
          "Лучше сначала заполнить недостающее (откройте договор — там есть ссылки «Исправить»). Сформировать всё равно?",
        confirmText: "Сформировать всё равно",
        cancelText: "Отмена",
        tone: "danger",
      });
      if (!go) return { ok: false, cancelled: true, reason: "incomplete" };
      return generateInteractive(id, { confirm, payload: { ...payload, allow_incomplete: true } });
    }

    if (status === 409 && data?.code === "has_signatures" && !payload.force && confirm) {
      const go = await confirm({
        title: "Сбросить подписи и пересформировать?",
        message:
          "Договор уже на подписании или подписан. Новый файл сделает прежние подписи недействительными: " +
          "подписи будут удалены, а выданные ссылки отозваны. Все стороны придётся подписывать заново.",
        confirmText: "Сбросить подписи и пересформировать",
        cancelText: "Отмена",
        tone: "danger",
      });
      if (!go) return { ok: false, cancelled: true, reason: "has_signatures" };
      return generateInteractive(id, { confirm, payload: { ...payload, force: true } });
    }

    toast.error(await errorText(e, "Не удалось сформировать договор"));
    return { ok: false, error: true };
  }
}

async function describeGenerateFailure(e) {
  const status = e.response?.status;
  const data = e.response?.data;
  if (status === 422 && data?.code === "incomplete") {
    return { reason: "Не хватает данных", missing: missingLabelsFrom(e) };
  }
  if (status === 409 && data?.code === "has_signatures") {
    return { reason: "Договор уже на подписании — пересформируйте его вручную в карточке", missing: [] };
  }
  return { reason: await errorText(e, "Ошибка формирования"), missing: [] };
}

/**
 * Generate files for `items` ({id, number, name}) strictly one after another —
 * LibreOffice needs several seconds per PDF, and one failure must not stop the
 * rest. `shouldStop()` is checked between items (the current one is finished).
 * `onProgress({done, total, current, failures})` fires before the first item
 * and after each one.
 */
export async function runGenerateQueue(items, { onProgress, shouldStop } = {}) {
  const generated = [];
  const failures = [];
  const total = items.length;
  onProgress?.({ done: 0, total, current: items[0] || null, failures: [] });
  for (let i = 0; i < total; i += 1) {
    if (shouldStop?.()) {
      return { generated, failures, cancelled: true, remaining: total - i };
    }
    const it = items[i];
    try {
      await contractsApi.generate(it.id);
      generated.push(it);
    } catch (e) {
      failures.push({ ...it, ...(await describeGenerateFailure(e)) });
    }
    onProgress?.({ done: i + 1, total, current: items[i + 1] || null, failures: failures.slice() });
  }
  return { generated, failures, cancelled: false, remaining: 0 };
}

const INVITE_CHUNK = 100;

/**
 * Issue (or fetch the already live) signing links for many contracts, in
 * chunks of 100. A failed chunk does not abort the rest.
 * → { items, new_links, errors: [message] }
 */
export async function inviteInChunks(ids, { roles } = {}) {
  const items = [];
  const errors = [];
  let newLinks = 0;
  for (let i = 0; i < ids.length; i += INVITE_CHUNK) {
    try {
      const res = await signingApi.bulkInvite(ids.slice(i, i + INVITE_CHUNK), roles);
      items.push(...(res.items || []));
      newLinks += res.new_links || 0;
    } catch (e) {
      errors.push(await errorText(e, "Не удалось создать ссылки"));
    }
  }
  return { items, new_links: newLinks, errors };
}
