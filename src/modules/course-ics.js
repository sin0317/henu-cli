import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';

import { getCourseList } from './course.js';
import { buildCalendar, resolveTermStart } from './ics.js';
import { getHenuHome } from './paths.js';

// 「第 1 周周一」每个学期只手动给一次，之后记在本地，下次 course ics 直接复用。
const TERM_CACHE = 'calendar-terms.json';

export async function exportCourseIcs(options = {}) {
  // 什么线索都没有时先别开浏览器：拉一次课表要十几秒，报错应该立刻给。
  if (!options.start && !options.weekNow && Object.keys(readCache()).length === 0) {
    throw missingStartError(null);
  }

  const list = await getCourseList({
    headless: options.headless,
    dump: options.dump,
    refresh: options.refresh
  });
  const term = list.term ?? '';
  const resolved = resolveStart(options, term);

  const calendar = buildCalendar(list.items, {
    term,
    startDate: resolved.startDate,
    schedule: normalizeSchedule(options.schedule)
  });

  const icsPath = writeIcs(options.out, term, calendar.ics);
  const { ics, ...rest } = calendar;
  return {
    ...rest,
    startDateSource: resolved.source,
    path: icsPath,
    sourceUrl: list.sourceUrl
  };
}

function resolveStart(options, term) {
  const explicit = resolveTermStart({ start: options.start, weekNow: options.weekNow });
  if (explicit.startDate) {
    rememberTermStart(term, explicit.startDate);
    return explicit;
  }

  const cached = recallTermStart(term);
  if (cached) {
    return { startDate: cached, source: 'remembered' };
  }

  throw missingStartError(term);
}

function missingStartError(term) {
  const error = new Error('不知道这个学期第 1 周的周一是哪天，没法把课表铺到日历上。');
  error.code = 'INVALID_ARGUMENT';
  error.hint = '用 --start 2026-09-07 指定第 1 周周一，或者用 --week-now 8 说明今天是第几周；'
    + '给过一次之后会按学期记在本地，后面就不用再传。校历：https://www.henu.edu.cn/xyfw/xl.htm';
  error.details = { term: term || null };
  return error;
}

function normalizeSchedule(value) {
  const text = String(value ?? 'auto').trim().toLowerCase();
  if (['auto', 'winter', 'summer'].includes(text)) return text;
  const error = new Error(`--schedule 取值不合法：${value}`);
  error.code = 'INVALID_ARGUMENT';
  error.hint = '可选 auto（按首次上课日期判断）/ winter（冬季作息）/ summer（夏季作息）。';
  throw error;
}

function cachePath() {
  return join(getHenuHome(), TERM_CACHE);
}

function readCache() {
  try {
    const raw = JSON.parse(readFileSync(cachePath(), 'utf8'));
    return raw && typeof raw === 'object' ? raw : {};
  } catch {
    return {};
  }
}

function recallTermStart(term) {
  if (!term) return null;
  const value = readCache()?.[term]?.start;
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value ?? '')) ? value : null;
}

/** 给「下一节课」这类不导出日历的命令复用同一份学期起点缓存。 */
export function lookupTermStart(term) {
  return recallTermStart(term);
}

function rememberTermStart(term, startDate) {
  if (!term) return;
  const existing = readCache();
  try {
    mkdirSync(getHenuHome(), { recursive: true });
    writeFileSync(cachePath(), `${JSON.stringify({ ...existing, [term]: { start: startDate } }, null, 2)}\n`, 'utf8');
  } catch {
    // 记不住就算了，不影响这次导出
  }
}

function writeIcs(out, term, content) {
  const file = out
    ? (isAbsolute(out) ? out : resolve(process.cwd(), out))
    : join(process.cwd(), `课表-${termSlug(term)}.ics`);

  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content, 'utf8');
  return file;
}

function termSlug(term) {
  const match = String(term ?? '').match(/(\d{4})-(\d{4})学年\s*第([一二])学期/);
  if (match) {
    return `${match[1]}-${match[2]}-${match[3] === '一' ? 1 : 2}`;
  }
  return String(term || 'current').replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '') || 'current';
}
