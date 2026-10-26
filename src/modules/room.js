import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { HENU } from '../config.js';
import { assertBrowserAvailable } from './browser.js';
import { getLaunchOptions, importPlaywright } from './browser-options.js';
import { getTodayWeekday } from './course.js';
import { openJwPage, openJwPublicQuery } from './jw.js';
import { buildRoomQuery, parseFreeRooms, periodLabel } from './room-parser.js';
import { getHenuHome, getProfilePath } from './paths.js';

export async function getFreeRooms(options = {}) {
  const built = buildRoomQuery({
    ...options,
    weekday: options.weekday ?? String(getTodayWeekday())
  });
  if (built.error) {
    const error = new Error(built.error);
    error.code = 'INVALID_ARGUMENT';
    error.hint = '运行 henu-cli room options 查看可用取值。';
    throw error;
  }

  const browser = assertBrowserAvailable();
  const { chromium } = await importPlaywright();

  const context = await chromium.launchPersistentContext(
    getProfilePath(browser.id),
    {
      ...getLaunchOptions({ headless: options.headless ?? true }),
      // 公共查询的菜单是绝对定位布局，视口太小会让卡片跑到可视区外
      viewport: { width: 1600, height: 1000 }
    }
  );

  try {
    const page = context.pages()[0] ?? await context.newPage();

    const opened = await openJwPage(page, HENU.jw.base, options);
    if (!opened.authState.loggedIn) {
      throwAuthRequired(opened.authState, opened.pageState, opened.sso);
    }

    const nav = await openJwPublicQuery(page, {
      menuCode: HENU.jw.room.menuCode,
      moduleId: HENU.jw.room.moduleId,
      formMarker: HENU.jw.room.formMarker,
      timeoutMs: options.waitMs ?? 25000
    });

    const formFrame = page.frames().find((frame) => frame.url().includes(HENU.jw.room.formMarker));
    if (!nav.ok || !formFrame) {
      throwUnrecognized(opened.pageState, {
        reason: nav.reason,
        frames: page.frames().map((frame) => frame.url())
      });
    }

    // 一个请求只对应一个大节，所以按大节循环。同一次会话里连发，
    // 不必反复启动浏览器。
    const fetched = await formFrame.evaluate(async (payload) => {
      const form = document.querySelector('form');
      if (!form) {
        return { error: 'form-missing' };
      }

      const results = [];
      for (const period of payload.periods) {
        // 用页面上的真实表单值做基底，保证学期、学年等字段跟随系统，
        // 只覆盖用户显式指定的项。
        const data = new FormData(form);
        data.delete('btnSubmit');
        for (const [key, value] of Object.entries(payload.overrides)) {
          if (value === '') {
            data.delete(key);
          } else {
            data.set(key, value);
          }
        }
        // hidDJ 是服务端唯一认的节次字段（第几大节，1-4）
        data.set('hidDJ', String(period));
        if (payload.menuCodeCurrent) {
          data.set('menucode_current', payload.menuCodeCurrent);
        }

        const body = [...data.entries()]
          .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
          .join('&');

        const response = await fetch(payload.dataPath, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
          body
        });
        const buffer = await response.arrayBuffer();

        // 结果页声明 charset=GBK；fetch 的 text() 会按 UTF-8 解，中文会乱码
        let text;
        try {
          text = new TextDecoder('gbk').decode(buffer);
        } catch {
          text = new TextDecoder('utf-8').decode(buffer);
        }
        results.push({ period, status: response.status, text });
      }
      return { results };
    }, {
      dataPath: HENU.jw.room.dataPath,
      overrides: built.overrides,
      periods: built.periods,
      menuCodeCurrent: HENU.jw.room.menuCodeCurrent
    });

    if (fetched?.error || !Array.isArray(fetched?.results)) {
      throwUnrecognized(opened.pageState, { reason: fetched?.error ?? 'empty-response' });
    }

    const groups = [];
    const byPeriod = [];
    let term = null;
    let weekLabel = null;
    let weekdayLabel = null;

    for (const item of fetched.results) {
      if (typeof item.text !== 'string') continue;
      const parsed = parseFreeRooms(item.text);
      term = term ?? parsed.title ?? null;
      weekLabel = weekLabel ?? parsed.weekLabel;
      weekdayLabel = weekdayLabel ?? parsed.weekdayLabel;

      // 服务端会在标题里回带 [N节]，比自己推的更可信
      const label = parsed.periodTag
        ? parsed.periodTag.replace(/[[\]]/g, '')
        : periodLabel(item.period);

      let segmentTotal = 0;
      for (const group of parsed.groups) {
        groups.push({ period: label, ...group });
        segmentTotal += group.rooms.length;
      }
      byPeriod.push({ period: label, total: segmentTotal });
    }

    // 服务端会把同一「校区 + 教室类型」拆成多张表（按楼房分页），
    // 标题都写「多媒体教室」，不合并的话输出里会出现多个同名分组。
    const merged = mergeGroups(groups);

    const total = merged.reduce((sum, group) => sum + group.rooms.length, 0);

    if (options.dump) {
      dumpDiagnostics({
        pageState: opened.pageState,
        nav,
        overrides: built.overrides,
        periods: built.periods,
        responses: fetched.results,
        groups: merged
      });
    }

    // 全部大节都拿不到“空闲教室”字样，说明页面结构变了或被踢回登录页
    const sawExpectedPage = fetched.results.some((item) => /空闲教室|没有检索到记录/.test(item.text ?? ''));
    if (!sawExpectedPage) {
      throwUnrecognized(opened.pageState, {
        reason: 'no-room-page',
        frames: page.frames().map((frame) => frame.url())
      });
    }

    return {
      query: describeQuery(built.overrides, built.periods),
      term,
      weekLabel,
      weekdayLabel,
      total,
      byPeriod,
      groups: merged,
      ...(total === 0 ? { note: '该条件下没有空闲教室，可放宽节次、周次或容量范围再试。' } : {}),
      sourceUrl: formFrame.url()
    };
  } finally {
    await context.close().catch(() => {});
  }
}

const WEEKDAY_CHARS = '一二三四五六日';

// 同「节次 + 校区 + 教室类型」的分组合并成一条，房间按出现顺序拼接。
function mergeGroups(groups) {
  const merged = new Map();
  for (const group of groups) {
    const key = `${group.period ?? ''}|${group.campus ?? ''}|${group.roomType ?? ''}`;
    const existing = merged.get(key);
    if (existing) {
      existing.rooms.push(...group.rooms);
      existing.declaredCount = (existing.declaredCount ?? 0) + (group.declaredCount ?? 0);
    } else {
      merged.set(key, { ...group, rooms: [...group.rooms] });
    }
  }
  return [...merged.values()];
}

function describeQuery(overrides, periods) {
  const campusLabel = {
    '01': '明伦校区',
    '02': '金明校区',
    '03': '郑州校区',
    '04': '其他校区'
  }[overrides.selXQ] ?? '全部校区';

  const roomTypeLabel = {
    '00': '不安排教室',
    '01': '一般教室',
    '05': '多媒体教室',
    '06': '师范生实训中心教室'
  }[overrides.selJSLX] ?? '全部类型';

  const from = overrides.selZ ?? '1';
  const to = overrides.selZ2 ?? from;
  const weekday = from === to
    ? `星期${WEEKDAY_CHARS[Number(from) - 1]}`
    : `星期${WEEKDAY_CHARS[Number(from) - 1]}至星期${WEEKDAY_CHARS[Number(to) - 1]}`;

  return {
    campus: campusLabel,
    weekday,
    periods: periods.map(periodLabel),
    week: `${overrides.txtZC ?? '1-18'} 周`,
    parity: overrides.seldsz === '1' ? '单周' : overrides.seldsz === '2' ? '双周' : '不限',
    roomType: roomTypeLabel,
    capacity: `${overrides.hidMIN ?? 1}-${overrides.hidMAX ?? 100} 人`
  };
}

function throwAuthRequired(authState, pageState, sso) {
  const error = new Error('未登录教务系统，且自动单点登录失败。');
  error.code = 'AUTH_REQUIRED';
  error.hint = '先运行 henu-cli auth login 在浏览器里登录一次统一身份认证，再重试。';
  error.details = { reason: authState.reason, finalUrl: pageState.url, sso };
  throw error;
}

function throwUnrecognized(pageState, details = {}) {
  const error = new Error('已进入空闲教室查询，但没有解析到结果表格。');
  error.code = 'PAGE_UNRECOGNIZED';
  error.hint = '用 henu-cli room free --headed --dump 重跑，把 ~/.henu-cli/diagnostics-room.json 交给维护者。';
  error.details = { ...details, finalUrl: pageState.url };
  throw error;
}

function dumpDiagnostics({ pageState, nav, overrides, periods, responses, groups }) {
  const home = getHenuHome();
  mkdirSync(home, { recursive: true });
  const file = join(home, 'diagnostics-room.json');
  writeFileSync(file, `${JSON.stringify({
    finalUrl: pageState.url,
    nav,
    overrides,
    periods,
    responses: responses.map((item) => ({
      period: item.period,
      status: item.status,
      length: (item.text ?? '').length,
      hasTable: /空闲教室/.test(item.text ?? ''),
      head: (item.text ?? '').slice(0, 800)
    })),
    groupCount: groups.length,
    sampleGroup: groups[0] ?? null
  }, null, 2)}\n`, 'utf8');
  process.stderr.write(`diagnostics written to ${file}\n`);
}
