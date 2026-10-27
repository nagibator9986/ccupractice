import { formatDate, plural, ROLE_LABELS } from "../../utils/format.js";

/** Pure helpers for the dashboard so the page and its panels stay presentational. */

// The stats API sends statuses as a plain object; the sums below are what the KPI cards show.
const IN_PROGRESS = ["draft", "generated", "sent"];
const SIGNED = ["signed", "scan_uploaded", "completed"];

const sum = (obj, keys) => keys.reduce((a, k) => a + (Number(obj?.[k]) || 0), 0);

export function kpisFrom(stats) {
  const t = stats?.totals || {};
  const bs = stats?.by_status || {};
  const students = Number(t.students) || 0;
  const withoutContract = Number(t.students_without_contract) || 0;
  const inProgress = sum(bs, IN_PROGRESS);
  const signed = sum(bs, SIGNED);
  const contracts = Number(t.contracts) || 0;
  return { students, withoutContract, inProgress, signed, contracts, partners: Number(t.partners) || 0 };
}

/**
 * What should the clerk do first? Admins get the write action, viewers only a
 * read link (or nothing when there is nothing to look at).
 */
export function pickCta(stats, isAdmin) {
  const k = kpisFrom(stats);
  if (k.students === 0) {
    return isAdmin ? { to: "/groups?import=1", label: "Загрузить студентов из Excel", icon: "upload" } : null;
  }
  if (k.withoutContract > 0) {
    return isAdmin
      ? { to: "/groups", label: "Оформить договоры", icon: "contracts" }
      : { to: "/groups", label: "Открыть группы", icon: "groups" };
  }
  return { to: "/contracts", label: "Открыть договоры", icon: "open" };
}

/** One-line summary under the greeting. */
export function summaryLine(stats) {
  const k = kpisFrom(stats);
  if (k.students === 0) return "В системе пока нет студентов — с них начинается оформление практики.";
  const parts = [];
  if (k.withoutContract > 0) {
    parts.push(`${k.withoutContract} ${plural(k.withoutContract, "студент", "студента", "студентов")} без договора`);
  }
  if (k.inProgress > 0) parts.push(`${k.inProgress} ${plural(k.inProgress, "договор", "договора", "договоров")} в работе`);
  if (k.signed > 0) parts.push(`${k.signed} подписано`);
  return parts.length ? `${parts.join(" · ")}.` : "Все студенты обеспечены договорами.";
}

export function daysUntil(iso, now = Date.now()) {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? null : Math.ceil((t - now) / 86_400_000);
}

const VISIBLE = 3;

/**
 * Turns the `attention` block of /contracts/stats (+ the students-without-contract
 * counter) into display groups. Empty groups are dropped, so `length === 0` means
 * "all clear".
 */
export function buildAttentionGroups(attention, withoutContract, now = Date.now()) {
  const a = attention || {};
  const groups = [];

  const expiring = a.links_expiring || [];
  if ((a.links_expiring_total || expiring.length) > 0) {
    groups.push({
      key: "links_expiring",
      icon: "timer",
      title: "Ссылки на подпись скоро истекут",
      hint: "В ближайшие 7 дней — продлите или отправьте заново",
      total: a.links_expiring_total || expiring.length,
      moreTo: "/contracts?stage=await_signatures",
      items: expiring.slice(0, VISIBLE).map((x, i) => {
        const left = daysUntil(x.expires_at, now);
        const when = left == null ? formatDate(x.expires_at) : left <= 0 ? "сегодня" : `через ${left} ${plural(left, "день", "дня", "дней")}`;
        return {
          key: `${x.contract_id}-${x.role}-${i}`,
          to: `/contracts/${x.contract_id}`,
          primary: `№ ${x.number} · ${x.student_name}`,
          secondary: `Ссылка для роли «${ROLE_LABELS[x.role] || x.role}» истекает ${when} (${formatDate(x.expires_at)})`,
        };
      }),
    });
  }

  const stale = a.stale_sent || [];
  if ((a.stale_sent_total || stale.length) > 0) {
    groups.push({
      key: "stale_sent",
      icon: "send",
      title: "Отправлены, но никто не подписал",
      hint: "Больше 7 дней без единой подписи — напомните подписантам",
      total: a.stale_sent_total || stale.length,
      moreTo: "/contracts?status=sent",
      items: stale.slice(0, VISIBLE).map((x) => ({
        key: String(x.contract_id),
        to: `/contracts/${x.contract_id}`,
        primary: `№ ${x.number} · ${x.student_name}`,
        secondary: `${x.partner_name || "Предприятие"} — отправлен ${x.days} ${plural(x.days, "день", "дня", "дней")} назад`,
      })),
    });
  }

  const drafts = a.incomplete_drafts || [];
  if (drafts.length > 0) {
    groups.push({
      key: "incomplete_drafts",
      icon: "draft",
      title: "Черновики с неполными данными",
      hint: "Договор не сформировать, пока не заполнены обязательные поля",
      total: drafts.length,
      capped: drafts.length >= 10, // the API returns at most 10
      moreTo: "/contracts?status=draft",
      items: drafts.slice(0, VISIBLE).map((x) => ({
        key: String(x.contract_id),
        to: `/contracts/${x.contract_id}`,
        primary: `№ ${x.number} · ${x.student_name}`,
        secondary: `Не заполнено обязательных полей: ${x.critical}`,
      })),
    });
  }

  const expiredPartners = a.expired_partners || [];
  if ((a.expired_partners_total || expiredPartners.length) > 0) {
    groups.push({
      key: "expired_partners",
      icon: "partner",
      title: "У предприятий истёк срок договора",
      hint: "Продлите соглашение или смените предприятие студентам",
      total: a.expired_partners_total || expiredPartners.length,
      moreTo: "/partners?validity=expired",
      items: expiredPartners.slice(0, VISIBLE).map((x) => ({
        key: String(x.id),
        to: `/partners?edit=${x.id}`,
        primary: x.name,
        secondary: `Договор истёк ${formatDate(x.valid_until)}`,
      })),
    });
  }

  if (withoutContract > 0) {
    groups.push({
      key: "no_contract",
      icon: "students",
      title: "Студенты без договора",
      hint: "Оформите договоры по группам",
      total: withoutContract,
      moreCount: 0, // one summary row stands for all of them
      moreTo: "/students?contract=none",
      items: [
        {
          key: "no_contract",
          to: "/groups",
          primary: `${withoutContract} ${plural(withoutContract, "студент", "студента", "студентов")} без договора`,
          secondary: "Откройте группы и оформите договоры сразу всей группе",
        },
      ],
    });
  }

  return groups;
}

/** Groups that still need work first (biggest remaining first), capped for the dashboard. */
export function topGroups(groups, limit = 8) {
  return [...(groups || [])]
    .sort((a, b) => {
      const ra = (a.students || 0) - (a.fully_signed || 0);
      const rb = (b.students || 0) - (b.fully_signed || 0);
      return rb - ra || String(a.name).localeCompare(String(b.name), "ru");
    })
    .slice(0, limit);
}

export function groupQuery(name) {
  return encodeURIComponent(name || "__none__");
}

export const GROUP_NONE_LABEL = "Без группы";
