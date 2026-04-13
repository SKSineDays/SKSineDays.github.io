import { calculateSineDayForYmd } from "../../js/sineday-engine.js";

const MS_PER_DAY = 86400000;

export function compareYmd(a, b) {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

export function dateFromYmd(ymd) {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12, 0, 0, 0));
}

export function diffDaysUTC(a, b) {
  return Math.round((a.getTime() - b.getTime()) / MS_PER_DAY);
}

export function diffMonthsUTC(a, b) {
  return (
    (a.getUTCFullYear() - b.getUTCFullYear()) * 12 +
    (a.getUTCMonth() - b.getUTCMonth())
  );
}

export function lastDomUtc(y, monthIndex) {
  return new Date(Date.UTC(y, monthIndex + 1, 0)).getUTCDate();
}

export function alignDomUtc(d, domStart) {
  const last = lastDomUtc(d.getUTCFullYear(), d.getUTCMonth());
  return Math.min(domStart, last);
}

/**
 * @param {object} task - social_day_tasks row (needs start_date or task_date, repeat_*)
 * @param {string} ymd
 * @param {string | null | undefined} authorBirthdate - task author's birthdate for sineday mode
 */
export function taskOccursOnSocialDate(task, ymd, authorBirthdate) {
  const startDate = task.start_date || task.task_date;
  if (!startDate) return false;

  const D = dateFromYmd(ymd);
  const S = dateFromYmd(startDate);

  if (compareYmd(ymd, startDate) < 0) return false;
  if (task.repeat_until && compareYmd(ymd, task.repeat_until) > 0) {
    return false;
  }

  const mode = task.repeat_mode || "none";
  const n = Math.max(1, Math.min(365, task.repeat_interval ?? 1));

  switch (mode) {
    case "none":
      return ymd === startDate;
    case "daily": {
      const diff = diffDaysUTC(D, S);
      return diff >= 0 && diff % n === 0;
    }
    case "weekly": {
      const diff = diffDaysUTC(D, S);
      return diff >= 0 && diff % (7 * n) === 0;
    }
    case "monthly": {
      const months = diffMonthsUTC(D, S);
      if (months < 0 || months % n !== 0) return false;
      const domS = S.getUTCDate();
      return D.getUTCDate() === alignDomUtc(D, domS);
    }
    case "yearly": {
      const years = D.getUTCFullYear() - S.getUTCFullYear();
      if (years < 0 || years % n !== 0) return false;
      if (D.getUTCMonth() !== S.getUTCMonth()) return false;
      const domS = S.getUTCDate();
      return D.getUTCDate() === alignDomUtc(D, domS);
    }
    case "weekdays": {
      if (compareYmd(ymd, startDate) < 0) return false;
      const dow = D.getUTCDay();
      return dow >= 1 && dow <= 5;
    }
    case "sineday": {
      const arr = task.repeat_sinedays || [];
      if (!arr.length || !authorBirthdate) return false;
      const result = calculateSineDayForYmd(authorBirthdate, ymd);
      if (!result) return false;
      return arr.some((x) => Number(x) === result.day);
    }
    default:
      return false;
  }
}

export function formatRepeatMeta(task) {
  const mode = task.repeat_mode || "none";
  if (mode === "none") return "";

  const n = Math.max(1, task.repeat_interval ?? 1);

  switch (mode) {
    case "daily":
      return n === 1 ? "Repeats daily" : `Repeats every ${n} days`;
    case "weekly":
      return n === 1 ? "Repeats weekly" : `Repeats every ${n} weeks`;
    case "monthly":
      return n === 1 ? "Repeats monthly" : `Repeats every ${n} months`;
    case "yearly":
      return n === 1 ? "Repeats yearly" : `Repeats every ${n} years`;
    case "weekdays":
      return "Repeats weekdays";
    case "sineday": {
      const arr = [...(task.repeat_sinedays || [])]
        .map(Number)
        .filter((d) => d >= 1 && d <= 18)
        .sort((a, b) => a - b);
      if (!arr.length) return "Repeats on SineDuck days";
      return `Repeats on ${arr.map((d) => `Day ${d}`).join(" · ")}`;
    }
    default:
      return "";
  }
}
