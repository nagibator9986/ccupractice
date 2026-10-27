import { Building2, CircleCheck, Clock, FilePlus2, Send } from "lucide-react";

/**
 * Group-level "what to do next" logic for the «Практика по группам» page.
 * Input is one item of GET /api/students/groups.
 */

/**
 * The ONE place that decides what a group needs next. Lower `priority` = more
 * urgent (used by the «требуют внимания» sort).
 */
export function nextStep(g) {
  const bs = g.by_status || {};
  const drafts = (bs.draft || 0) + (bs.generated || 0);
  const sent = bs.sent || 0;
  if (g.students > 0 && !g.with_partner) {
    return {
      key: "practice",
      priority: 0,
      tone: "coral",
      Icon: Building2,
      title: "Назначьте предприятие и сроки практики",
      action: "practice",
      button: "Назначить практику",
    };
  }
  if (g.without_contract > 0) {
    return {
      key: "contracts",
      priority: 1,
      tone: "amber",
      Icon: FilePlus2,
      title: `Оформите договоры: ${g.without_contract}`,
      hint: `Договор есть у ${g.contracts} из ${g.students}`,
      action: "contracts",
      button: "Создать договоры",
    };
  }
  if (drafts > 0) {
    return {
      key: "draft",
      priority: 2,
      tone: "blue",
      Icon: Send,
      title: "Сформируйте и отправьте на подпись",
      hint: `Ждут формирования или отправки: ${drafts}`,
      action: "link",
      button: "Открыть договоры",
    };
  }
  if (sent > 0) {
    return {
      key: "sent",
      priority: 3,
      tone: "indigo",
      Icon: Clock,
      title: "Ждём подписи",
      hint: `Отправлено на подпись: ${sent}`,
      action: "link",
      button: "Открыть договоры",
    };
  }
  return {
    key: "done",
    priority: 4,
    tone: "green",
    Icon: CircleCheck,
    title: "Готово",
    hint: "Все договоры подписаны",
    action: null,
  };
}

export const progressOf = (g) =>
  g.students > 0 ? (g.with_partner + g.with_period + g.contracts + g.fully_signed) / (4 * g.students) : 0;

export const SORTS = [
  { value: "name", label: "По названию" },
  { value: "progress", label: "По прогрессу" },
  { value: "attention", label: "Требуют внимания" },
];

export function sortGroups(list, sort) {
  const byName = (a, b) => (a.name === "") - (b.name === "") || a.name.localeCompare(b.name, "ru", { numeric: true });
  const out = [...list];
  if (sort === "progress") out.sort((a, b) => progressOf(b) - progressOf(a) || byName(a, b));
  else if (sort === "attention") out.sort((a, b) => nextStep(a).priority - nextStep(b).priority || byName(a, b));
  else out.sort(byName);
  return out;
}
