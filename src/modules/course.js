import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { HENU } from '../config.js';
import { assertBrowserAvailable } from './browser.js';
import { getLaunchOptions, importPlaywright } from './browser-options.js';
import { CACHE_KEYS, CACHE_TTL, readThroughCache } from './cache.js';
import { extractTerm, filterByWeekday, parseTimetableTable } from './course-parser.js';
import { openJwMenuApp, openJwPage } from './jw.js';
import { getRequestId } from './output.js';
import { getHenuHome, getProfilePath } from './paths.js';

export async function getCourseList(options = {}) {
  const loaded = await loadTimetableCached(options);
  const items = parseTimetableTable(loaded.table.header, loaded.table.rows);

  const filtered = filterByWeekday(items, options.weekday);
  const weekday = normalizeWeekday(options.weekday);
  return {
    term: loaded.term,
    ...(weekday ? { weekday } : {}),
    items: filtered,
    total: filtered.length,
    ...(items.length === 0 ? { note: '页面已打开，但当前学期没有解析到课程记录。' } : {}),
    sourceUrl: loaded.table.sourceUrl,
    cache: loaded.cache,
    ...(loaded.warning ? { warning: loaded.warning } : {})
  };
}

/**
 * 课表走本地缓存（默认保鲜 6 小时）。
 * 调课/补课不频繁，6 小时内重复查询没必要反复开浏览器；
 * 真要最新数据用 --refresh，抓取失败时会退回旧缓存并给出 warning。
 */
async function loadTimetableCached(options = {}) {
  const result = await readThroughCache({
    key: CACHE_KEYS.timetable,
    ttlSeconds: CACHE_TTL.timetable,
    refresh: options.refresh === true,
    // pageState 里是大段页面文本，只缓存解析需要的表格和学期
    loader: async () => {
      const fresh = await loadTimetable(options);
      return { table: fresh.table, term: fresh.term };
    }
  });

  return {
    ...result.data,
    cache: result.cache,
    ...(result.warning ? { warning: result.warning } : {})
  };
}

export async function getTodayCourses(options = {}) {
  return getCourseList({ ...options, weekday: getTodayWeekday() });
}

export async function getCourseStatus(options = {}) {
  try {
    const loaded = await loadTimetable({ ...options, headless: true });
    return {
      loggedIn: true,
      hasData: loaded.table.rows.length > 0,
      term: loaded.term,
      total: parseTimetableTable(loaded.table.header, loaded.table.rows).length,
      sourceUrl: loaded.table.sourceUrl
    };
  } catch (error) {
    if (error.code === 'AUTH_REQUIRED') {
      return { loggedIn: false, reason: error.details?.reason ?? 'unauthenticated', hasData: false };
    }
    throw error;
  }
}

export function getTodayWeekday() {
  const day = new Date().getDay();
  return day === 0 ? 7 : day;
}

// 用户的 --weekday 可能是 3 或 '周三'，统一成 1-7 的数字再回显
function normalizeWeekday(value) {
  if (value === null || value === undefined || value === '') return null;
  const text = String(value).trim();
  const digit = text.match(/[1-7]/);
  if (digit) return Number(digit[0]);
  const index = '一二三四五六日'.indexOf(text.replace('周', ''));
  return index >= 0 ? index + 1 : null;
}

async function loadTimetable(options = {}) {
  const browser = assertBrowserAvailable();
  const { chromium } = await importPlaywright();

  const context = await chromium.launchPersistentContext(
    getProfilePath(browser.id),
    getLaunchOptions({ headless: options.headless ?? true })
  );

  try {
    const page = context.pages()[0] ?? await context.newPage();

    const opened = await openJwPage(page, HENU.jw.base, options);
    if (!opened.authState.loggedIn) {
      throwAuthRequired(opened.authState, opened.pageState, opened.sso);
    }

    const nav = await openJwMenuApp(page, {
      group: HENU.jw.menu.group,
      item: HENU.jw.menu.timetable,
      dataMarker: HENU.jw.timetableMarker,
      dataTimeoutMs: options.waitMs ?? 25000
    });

    const frameUrls = page.frames().map((frame) => frame.url()).filter((url) => url.startsWith('http'));
    const table = nav.ok
      ? await readTimetableTable(page, HENU.jw.timetableMarker, options.waitMs ?? 20000)
      : null;

    if (options.dump) {
      dumpDiagnostics({ pageState: opened.pageState, nav, table, frameUrls });
    }

    if (!nav.ok) {
      throwUnrecognized(opened.pageState, { reason: nav.reason, frameUrls });
    }
    if (!table) {
      throwUnrecognized(opened.pageState, { reason: 'no-timetable-table', frameUrls });
    }

    return {
      pageState: opened.pageState,
      table,
      term: extractTerm([table.header, ...table.rows]) ?? extractTermFromText(opened.pageState, table)
    };
  } finally {
    await context.close().catch(() => {});
  }
}

async function readTimetableTable(page, marker, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;

  // 青果的课表 iframe 加载后会重新挂载，帧句柄会 detached，
  // 所以每轮都按 URL 重新取帧，而不是复用旧句柄。
  while (Date.now() < deadline) {
    const frames = page.frames().filter((frame) => frame.url().includes(marker));

    for (const frame of frames) {
      const table = await frame.evaluate(() => {
        const candidates = [...document.querySelectorAll('table')]
          .map((table) => [...table.querySelectorAll('tr')]
            .map((row) => [...row.querySelectorAll('th,td')].map((cell) => (cell.innerText || '').trim())))
          .filter((rows) => rows.length > 1 && rows[0].join('').includes('上课时间地点'));
        const best = candidates.sort((a, b) => b.length - a.length)[0];
        return best ? { header: best[0], rows: best.slice(1) } : null;
      }).catch(() => null);

      if (table) {
        return { ...table, sourceUrl: frame.url() };
      }
    }

    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  return null;
}

function extractTermFromText(pageState, table) {
  const match = `${pageState.text ?? ''} ${table.header.join(' ')}`.match(/\d{4}-\d{4}学年\s*第[一二]学期/);
  return match ? match[0].replace(/\s+/g, '') : null;
}

function throwAuthRequired(authState, pageState, sso) {
  const error = new Error('未登录教务系统，且自动单点登录失败。');
  error.code = 'AUTH_REQUIRED';
  error.hint = '先运行 henu-cli auth login 在浏览器里登录一次统一身份认证，再重试。';
  error.details = { reason: authState.reason, finalUrl: pageState.url, sso };
  throw error;
}

function throwUnrecognized(pageState, details = {}) {
  const error = new Error('已登录，但没有取到课表数据表格。');
  error.code = 'PAGE_UNRECOGNIZED';
  error.hint = '用 henu-cli course list --headed --dump 重跑，把 ~/.henu-cli/diagnostics-course.json 交给维护者。';
  error.details = { ...details, finalUrl: pageState.url, title: pageState.title };
  throw error;
}

function dumpDiagnostics({ pageState, nav, table, frameUrls }) {
  const home = getHenuHome();
  mkdirSync(home, { recursive: true });
  const file = join(home, 'diagnostics-course.json');
  writeFileSync(file, `${JSON.stringify({
    requestId: getRequestId(),
    finalUrl: pageState.url,
    title: pageState.title,
    nav,
    frameUrls,
    header: table?.header ?? null,
    rowCount: table?.rows?.length ?? 0,
    sampleRows: (table?.rows ?? []).slice(0, 2)
  }, null, 2)}\n`, 'utf8');
  process.stderr.write(`diagnostics written to ${file}\n`);
}
