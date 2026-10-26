// 图书馆研讨室（zwyy 的「空间预约」）。
//
// 三件事：
//   areas —— 有哪些校区/楼层能约研讨室（免登录）
//   dates —— 未来哪些日子开放预约（免登录）
//   rooms —— 某一天每间研讨室的开放时间、已约时段、算出来的可约时段（需登录）
//
// 「可约时段」是算出来的：接口只给「已被占用的时段」，
// 可用 = 开放区间减去已占用（相邻占用先合并）。这套算法参考了 HENU_Assistant 的做法，
// 但这里不覆盖原始字段名——`occupied` 和 `available` 各归各位，
// 免得读的人猜「这个 date 到底是占用还是可用」。

import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { HENU } from '../config.js';
import { postJson } from './http.js';
import { pickByName, listNames } from './match-name.js';
import { callZwyy } from './zwyy-session.js';

const BASE = HENU.library.seat.base;
const REFERER = `${BASE}/h5/index.html`;
const DATA_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'data');

// ---------------------------------------------------------------- areas（免登录）

export async function getSeminarAreas(options = {}) {
  const campus = String(options.campus ?? '').trim();

  try {
    const payload = await postJson(`${BASE}${HENU.library.seminar.siftApi}`, {}, {
      headers: { Referer: REFERER }
    });
    if (payload?.code !== 0) {
      throw backendError('查询研讨室区域失败', payload, `${HENU.library.seminar.siftApi}`);
    }

    const data = normalizeSift(payload);
    return filterCampus(data, campus);
  } catch (error) {
    // 区域/楼层清单几乎不变，接口挂了就用随包快照兜底，并明确标出来是兜底数据。
    if (error?.code !== 'BACKEND_UNAVAILABLE') throw error;
    const fallback = await loadFallback();
    const data = {
      ...fallback,
      source: 'static_fallback',
      fallbackReason: error.message,
      dates: []
    };
    data.warning = `实时接口取不到（${error.message}），下面是随包快照（核对时间 ${fallback.verified_at}），只保证楼层清单大致有效。`;
    return filterCampus(data, campus);
  }
}

export function normalizeSift(payload) {
  const data = payload?.data ?? {};
  const premises = arrayOf(data.premises);
  const storeys = arrayOf(data.storey);
  const time = data.time ?? {};
  const members = data.members ?? {};
  const boutique = arrayOf(data.boutique);

  return {
    source: 'live',
    campuses: premises.map((campus) => ({
      id: String(campus.id ?? ''),
      name: campus.name ?? '',
      enname: campus.enname ?? '',
      storeys: storeys
        .filter((storey) => String(storey.parentId ?? '') === String(campus.id ?? ''))
        .map((storey) => ({
          id: String(storey.id ?? ''),
          name: storey.name ?? '',
          enname: storey.enname ?? ''
        }))
    })),
    dates: arrayOf(data.date).map(String),
    facilities: boutique.map((item) => ({ id: String(item.id ?? ''), name: item.name ?? '' })),
    rules: {
      open: {
        start: toClock(time.start_time) ?? (time.start_num === undefined ? null : minutesToClock(time.start_num)),
        end: toClock(time.end_time) ?? (time.end_num === undefined ? null : minutesToClock(time.end_num))
      },
      members: {
        min: numberOrNull(members.min),
        max: numberOrNull(members.max),
        step: numberOrNull(members.step)
      }
    }
  };
}

// ---------------------------------------------------------------- dates（免登录）

export async function getSeminarDates() {
  const payload = await postJson(`${BASE}${HENU.library.seminar.datesApi}`, {}, {
    headers: { Referer: REFERER }
  });
  if (payload?.code !== 0) {
    throw backendError('查询可预约日期失败', payload, HENU.library.seminar.datesApi);
  }

  const dates = arrayOf(payload?.data).map(String);
  return {
    source: 'live',
    today: todayInShanghai(),
    dates,
    count: dates.length,
    windowLabel: dates.length > 0 ? `${dates[0]} ~ ${dates[dates.length - 1]}` : null
  };
}

// ---------------------------------------------------------------- rooms（需登录）

export async function getSeminarRooms(options = {}) {
  const wanted = String(options.date ?? '').trim();
  const day = wanted === '' ? await defaultDay() : wanted;

  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    const error = new Error(`日期格式不对：${day}`);
    error.code = 'INVALID_ARGUMENT';
    error.hint = '用 --date 2026-10-27 这种格式；不传则取今天（Asia/Shanghai）。';
    throw error;
  }

  // 只用公共接口校验日期，给的出错提示是「能约的是这 5 天」而不是接口原文。
  const bookable = await fetchBookableDates();
  if (bookable.length > 0 && !bookable.includes(day)) {
    const error = new Error(`${day} 不在开放预约的日期里。`);
    error.code = 'INVALID_ARGUMENT';
    error.hint = `目前可预约：${bookable.join(' / ')}。`;
    error.details = { date: day, bookable };
    throw error;
  }

  const payload = await callZwyy(HENU.library.seminar.listApi, {
    page: 1,
    limit: Number(options.limit ?? 50) || 50,
    date: day
  }, { headless: options.headless ?? true });

  const result = normalizeRooms(payload, { date: day });

  const campus = String(options.campus ?? '').trim();
  const seats = Number(options.seats ?? 0) || 0;
  let rooms = result.rooms;

  if (campus) {
    rooms = rooms.filter((room) => pickByName([{ name: room.campus }], campus, (row) => row.name));
  }
  if (seats > 0) {
    rooms = rooms.filter((room) => room.capacity.min <= seats && room.capacity.max >= seats);
  }
  if (options.freeOnly) {
    rooms = rooms.filter((room) => room.available.length > 0);
  }

  return {
    ...result,
    filter: { date: day, ...(campus ? { campus } : {}), ...(seats > 0 ? { seats } : {}), ...(options.freeOnly ? { freeOnly: true } : {}) },
    rooms,
    count: rooms.length
  };
}

export function normalizeRooms(payload, options = {}) {
  const data = payload?.data ?? {};
  const rooms = arrayOf(data.data).map((room) => normalizeRoom(room));
  return {
    source: 'live',
    date: options.date ?? null,
    total: numberOrNull(data.total) ?? rooms.length,
    rooms
  };
}

export function normalizeRoom(room) {
  const open = { startNum: numberOrNull(room?.begin_num), endNum: numberOrNull(room?.end_num) };
  if (open.startNum === null) open.startNum = minutesFromTimestamp(room?.start_timestamp);
  if (open.endNum === null) open.endNum = minutesFromTimestamp(room?.end_timestamp);

  const occupied = normalizeSlots(room?.date);
  const merged = mergeSlots(occupied, open.startNum, open.endNum);
  const available = complementSlots(merged, open.startNum, open.endNum);
  const freeMinutes = available.reduce((sum, slot) => sum + (slot.endNum - slot.startNum), 0);

  const capacity = { min: numberOrNull(room?.minPerson) ?? 0, max: numberOrNull(room?.maxPerson) ?? 0 };
  const fullName = String(room?.nameMerge || room?.name || '');

  return {
    id: String(room?.id ?? ''),
    name: fullName,
    shortName: stripParenthetical(String(room?.name ?? '')) || fullName,
    enname: room?.enname ?? '',
    campus: room?.top_name ?? '',
    storey: room?.storey_name ?? '',
    capacity,
    open: {
      start: minutesToClock(open.startNum),
      end: minutesToClock(open.endNum),
      label: open.startNum === null || open.endNum === null ? null : `${minutesToClock(open.startNum)}-${minutesToClock(open.endNum)}`
    },
    occupied: occupied.map(slotLabel),
    available: available.map(slotLabel),
    freeMinutes,
    freeLabel: freeMinutes > 0 ? `${Math.floor(freeMinutes / 60)} 小时 ${freeMinutes % 60} 分` : '无空档',
    isFullyFree: occupied.length === 0 && available.length > 0
  };
}

// ---------------------------------------------------------------- 时段计算

// 占用时段的结束时间常被写成 xx:59:59（16:59:59 表示占到 17:00），
// 直接当 16:59 用会让 16:59~17:00 这 1 分钟变成「可用」。秒数 >= 59 时进位。
export function normalizeSlots(rawSlots) {
  const slots = [];
  for (const slot of arrayOf(rawSlots)) {
    const startNum = numberOrNull(slot?.begin_num) ?? minutesFromTimestamp(slot?.begin_timestamp);
    const rawEnd = numberOrNull(slot?.end_num);
    const seconds = secondsOfTimestamp(slot?.end_timestamp);
    const endNum = rawEnd === null
      ? minutesFromTimestamp(slot?.end_timestamp)
      : (seconds >= 59 ? rawEnd + 1 : rawEnd);

    if (startNum === null || endNum === null || startNum >= endNum) continue;
    slots.push({ startNum, endNum });
  }
  return slots.sort((a, b) => a.startNum - b.startNum);
}

export function mergeSlots(slots, openStart, openEnd) {
  const merged = [];
  for (const slot of slots) {
    const start = Math.max(openStart ?? slot.startNum, slot.startNum);
    const end = Math.min(openEnd ?? slot.endNum, slot.endNum);
    if (start >= end) continue;
    const last = merged[merged.length - 1];
    if (last && start <= last.endNum) {
      last.endNum = Math.max(last.endNum, end);
    } else {
      merged.push({ startNum: start, endNum: end });
    }
  }
  return merged;
}

/** 用开放区间减去已占用，得到还能约的空档。 */
export function complementSlots(merged, openStart, openEnd) {
  if (openStart === null || openEnd === null || openStart >= openEnd) return [];
  const free = [];
  let cursor = openStart;
  for (const slot of merged) {
    if (cursor < slot.startNum) free.push({ startNum: cursor, endNum: slot.startNum });
    cursor = Math.max(cursor, slot.endNum);
  }
  if (cursor < openEnd) free.push({ startNum: cursor, endNum: openEnd });
  return free;
}

// ---------------------------------------------------------------- 文本输出

export function formatSeminarAreasText(result) {
  const lines = [];
  if (result.warning) {
    lines.push(`⚠ ${result.warning}`);
    lines.push('');
  }

  const scope = result.filter?.campus ? ` · ${result.filter.campus}` : '';
  lines.push(`图书馆研讨室 · 开放区域${scope}`);
  const rule = result.rules?.open;
  const members = result.rules?.members ?? {};
  const meta = [
    rule?.start && rule?.end ? `开放 ${rule.start}-${rule.end}` : '',
    members.max ? `单间最多 ${members.max} 人` : '',
    result.facilities?.length ? `可选标签 ${result.facilities.map((item) => item.name).join('/')}` : ''
  ].filter(Boolean);
  if (meta.length > 0) lines.push(meta.join(' · '));
  lines.push('');

  for (const campus of result.campuses) {
    lines.push(`${campus.name}`);
    if (campus.storeys.length === 0) {
      lines.push('  （接口没返回楼层）');
      continue;
    }
    for (const storey of campus.storeys) {
      lines.push(`  ${storey.name}（${storey.enname || '—'}）  id=${storey.id}`);
    }
  }

  if (result.campuses.length === 0) lines.push('没有取到区域数据。');

  if (result.dates?.length > 0) {
    lines.push('');
    lines.push(`可预约日期：${result.dates.join(' / ')}`);
    lines.push('有哪些房间和空档，用 henu-cli library seminar rooms --date <日期>（需要登录）。');
  }
  return lines.join('\n');
}

export function formatSeminarDatesText(result) {
  const lines = [`图书馆研讨室 · 可预约日期（今天 ${result.today}）`, ''];
  if (result.count === 0) {
    lines.push('没有取到可预约日期，可能系统临时关闭了预约。');
    return lines.join('\n');
  }
  result.dates.forEach((date) => {
    lines.push(`  ${date}${date === result.today ? '  （今天）' : ''}`);
  });
  lines.push('');
  lines.push(`共 ${result.count} 天，${result.windowLabel}。`);
  return lines.join('\n');
}

export function formatSeminarRoomsText(result) {
  const filter = result.filter ?? {};
  const lines = [`图书馆研讨室 · ${filter.date ?? result.date ?? ''}`, ''];

  if (result.count === 0) {
    lines.push('这天的研讨室都被约满了，或者被过滤条件筛掉了。');
    lines.push('放宽条件试试：去掉 --campus / --seats / --free-only，或换一天。');
    return lines.join('\n');
  }

  let currentCampus = null;
  for (const room of result.rooms) {
    const head = `${room.campus} / ${room.storey}`;
    if (head !== currentCampus) {
      currentCampus = head;
      lines.push(head);
    }
    lines.push(`  [${room.id}] ${room.shortName} · ${room.capacity.min}-${room.capacity.max} 人 · 开放 ${room.open.label ?? '未知'}`);
    if (room.available.length > 0) {
      lines.push(`       可约 ${room.available.map(slotLabelText).join('、')}（共 ${room.freeLabel}）`);
    } else {
      lines.push('       全天已约满');
    }
    if (room.occupied.length > 0) {
      lines.push(`       已约 ${room.occupied.map(slotLabelText).join('、')}`);
    }
  }

  lines.push('');
  lines.push(`共 ${result.count} 间（接口返回 ${result.total} 间）。预约要在学校系统里完成，本命令只做查询。`);
  return lines.join('\n');
}

// ---------------------------------------------------------------- 内部

async function loadFallback() {
  const raw = await readFile(join(DATA_DIR, 'seminar-fallback.json'), 'utf8');
  return JSON.parse(raw);
}

async function fetchBookableDates() {
  try {
    const payload = await postJson(`${BASE}${HENU.library.seminar.datesApi}`, {}, {
      headers: { Referer: REFERER }
    });
    if (payload?.code !== 0) return [];
    return arrayOf(payload?.data).map(String);
  } catch {
    // 校验失败不该挡住主流程：真错了接口自己会说话。
    return [];
  }
}

async function defaultDay() {
  const shown = await fetchBookableDates();
  return shown[0] ?? todayInShanghai();
}

function filterCampus(data, campus) {
  if (!campus) return data;
  const matched = pickByName(data.campuses, campus);
  if (!matched) {
    const error = new Error(`没有这个校区的研讨室：${campus}`);
    error.code = 'INVALID_ARGUMENT';
    error.hint = `可选：${listNames(data.campuses).join(' / ') || '（接口没返回校区）'}。`;
    throw error;
  }
  return { ...data, filter: { campus: matched.name }, campuses: [matched] };
}

function backendError(message, payload, path) {
  const error = new Error(`${message}：${payload?.message ?? '未知错误'}`);
  error.code = 'BACKEND_UNAVAILABLE';
  error.details = { path, code: payload?.code ?? null, message: payload?.message ?? null };
  return error;
}

function slotLabel(slot) {
  return {
    start: minutesToClock(slot.startNum),
    end: minutesToClock(slot.endNum),
    label: `${minutesToClock(slot.startNum)}-${minutesToClock(slot.endNum)}`
  };
}

function slotLabelText(slot) {
  return slot.label;
}

function stripParenthetical(text) {
  return String(text).replace(/[（(][^（()）]*[）)]\s*$/, '').trim();
}

function minutesToClock(minutes) {
  if (minutes === null || minutes === undefined || !Number.isFinite(Number(minutes))) return null;
  const value = Math.trunc(Number(minutes));
  return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
}

function minutesFromTimestamp(text) {
  const matched = /(\d{1,2}):(\d{2})/.exec(String(text ?? ''));
  if (!matched) return null;
  return Number(matched[1]) * 60 + Number(matched[2]);
}

function secondsOfTimestamp(text) {
  const matched = /(\d{1,2}):(\d{2}):(\d{2})/.exec(String(text ?? ''));
  return matched ? Number(matched[3]) : 0;
}

function toClock(text) {
  const matched = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(String(text ?? '').trim());
  return matched ? `${matched[1].padStart(2, '0')}:${matched[2]}` : null;
}

function todayInShanghai() {
  return new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
}

function arrayOf(value) {
  return Array.isArray(value) ? value : [];
}

function numberOrNull(value) {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
