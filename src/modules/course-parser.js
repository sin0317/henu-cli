// 课表适配层：解析青果（KINGOSOFT）教务的课表表格。
// 表格是 HTML，字段名集中在 HEADER_HINTS 与 TIME_PLACE_PATTERN 两处，改版时改这里。

import { PERIOD_TIMES } from './ics.js';

const HEADER_HINTS = {
  className: ['上课班级名称'],
  course: ['课程'],
  hours: ['总学时'],
  credits: ['学分'],
  teachers: ['任课教师'],
  status: ['选课状态'],
  timePlace: ['上课时间地点']
};

// 形如：1-9周 三[1-2] 金明综合楼5206(138)
const TIME_PLACE_PATTERN = /^(.+?)周\s*([一二三四五六日天])\s*\[\s*(\d+)\s*(?:-\s*(\d+))?\s*\]\s*(.*)$/;

const WEEKDAY_MAP = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 7, 天: 7 };

export function parseTimetableTable(headerCells, bodyRows) {
  const header = (headerCells ?? []).map(normalizeHeader);
  const columns = resolveColumns(header);
  const items = [];

  for (const cells of bodyRows ?? []) {
    const courseCell = cellAt(cells, columns.course);
    const { code, name } = parseCourseCell(courseCell);
    if (!name) {
      continue;
    }

    items.push({
      courseCode: code,
      courseName: name,
      className: stringOrNull(cellAt(cells, columns.className)),
      hours: numberOrNull(cellAt(cells, columns.hours)),
      credits: numberOrNull(cellAt(cells, columns.credits)),
      teachers: parseTeachers(cellAt(cells, columns.teachers)),
      status: stringOrNull(cellAt(cells, columns.status)),
      sessions: parseTimePlace(cellAt(cells, columns.timePlace)),
      rawTimePlace: stringOrNull(cellAt(cells, columns.timePlace))
    });
  }

  return items;
}

export function parseCourseCell(value) {
  const text = String(value ?? '').trim();
  if (text === '') {
    return { code: null, name: null };
  }
  const match = text.match(/^\[([^\]]+)\]\s*(.+)$/);
  if (match) {
    return { code: match[1].trim(), name: match[2].trim() };
  }
  return { code: null, name: text };
}

export function parseTeachers(value) {
  const text = String(value ?? '').trim();
  if (text === '') {
    return [];
  }
  return text
    .split(/[\s,，、]+/)
    .map((part) => part.replace(/^\[[^\]]+\]/, '').trim())
    .filter(Boolean);
}

export function parseTimePlace(value) {
  const text = String(value ?? '').trim();
  if (text === '') {
    return [];
  }

  return text
    .split(/[；;]/)
    .map((segment) => segment.trim())
    .filter(Boolean)
    .map(parseSession)
    .filter(Boolean);
}

export function parseSession(segment) {
  const match = segment.match(TIME_PLACE_PATTERN);
  if (!match) {
    return { weekday: null, weekdayText: null, periods: null, weeks: null, location: null, raw: segment };
  }

  const [, weeksText, weekdayText, startText, endText, rest] = match;
  const start = Number(startText);
  const end = endText ? Number(endText) : start;

  return {
    weekday: WEEKDAY_MAP[weekdayText] ?? null,
    weekdayText,
    periods: { start, end },
    weeks: parseWeeks(`${weeksText}周`),
    location: stringOrNull(rest.replace(/[；;]\s*$/, '')),
    raw: segment
  };
}

export function parseWeeks(value) {
  const text = String(value ?? '').trim();
  const numbers = text.match(/\d+/g);
  if (!numbers || numbers.length === 0) {
    return null;
  }
  const start = Number(numbers[0]);
  const end = numbers.length > 1 ? Number(numbers[1]) : start;
  const parity = /单/.test(text) ? 'odd' : /双/.test(text) ? 'even' : 'all';
  return { start, end, parity, text };
}

export function parseWeekday(value) {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === 'number') {
    return value >= 1 && value <= 7 ? value : null;
  }
  const text = String(value).trim();
  const digit = text.match(/[1-7]/);
  if (digit) {
    return Number(digit[0]);
  }
  for (const [char, index] of Object.entries(WEEKDAY_MAP)) {
    if (text.includes(char)) {
      return index;
    }
  }
  return null;
}

// 只保留指定星期的课，并把 sessions 收窄到当天。
export function filterByWeekday(items, weekday) {
  if (!weekday) {
    return items;
  }
  const target = Number(weekday);
  return items
    .map((item) => ({ ...item, sessions: item.sessions.filter((session) => session.weekday === target) }))
    .filter((item) => item.sessions.length > 0);
}

export function extractTerm(rows = []) {
  for (const cells of rows) {
    const text = cells.join(' ');
    const match = text.match(/\d{4}-\d{4}学年第[一二]学期/);
    if (match) {
      return match[0];
    }
  }
  return null;
}

function resolveColumns(header) {
  const columns = {};
  for (const [field, hints] of Object.entries(HEADER_HINTS)) {
    columns[field] = header.findIndex((cell) => hints.some((hint) => cell.includes(hint)));
  }
  return columns;
}

function cellAt(cells, index) {
  if (index === undefined || index < 0) {
    return '';
  }
  return cells[index] ?? '';
}

export function formatCourseText(result) {
  const sessions = (result.items ?? []).reduce((sum, item) => sum + (item.sessions?.length ?? 0), 0);
  const scope = result.weekday ? `周${'一二三四五六日'[result.weekday - 1]}` : null;
  const lines = [
    `课程表 · ${result.term ?? '当前学期'}${scope ? ` · ${scope}` : ''}`
      + `（${result.items?.length ?? 0} 门课 / ${sessions} 个上课时段，${seasonLabel()}作息）`,
    ''
  ];

  if (sessions === 0) {
    // 按星期过滤后为空 ≠ 没选课，这两种情况要分开说
    lines.push(scope
      ? `${scope}没有课。用 henu-cli course list --text 看整周。`
      : '没有解析到课程。可能是本学期没有选课，或课表页还没排出来。');
    return lines.join('\n');
  }

  const table = PERIOD_TIMES[seasonNow()];
  for (let weekday = 1; weekday <= 7; weekday += 1) {
    const rows = [];
    for (const item of result.items) {
      for (const session of item.sessions ?? []) {
        if (session.weekday === weekday) rows.push({ item, session });
      }
    }
    if (rows.length === 0) continue;

    rows.sort((a, b) => (a.session.periods?.start ?? 99) - (b.session.periods?.start ?? 99));
    lines.push(`周${'一二三四五六日'[weekday - 1]}`);

    for (const { item, session } of rows) {
      const periods = session.periods ?? {};
      const clock = clockOf(table, periods);
      lines.push(`  ${periodText(periods)}${clock ? ` ${clock}` : ''}  ${item.courseName}`);
      const meta = [
        session.weeks?.text,
        session.location,
        item.teachers?.length ? item.teachers.join('、') : null,
        item.credits ? `${item.credits} 学分` : null
      ].filter(Boolean).join(' · ');
      if (meta) lines.push(`        ${meta}`);
    }
    lines.push('');
  }

  return lines.join('\n').trimEnd();
}

function periodText(periods) {
  if (!periods?.start) return '节次未知';
  const end = periods.end && periods.end !== periods.start ? `-${periods.end}` : '';
  return padDisplay(`${periods.start}${end}节`, 7);
}

// 终端里中文占两列，按字符数 padEnd 会错位
function padDisplay(text, width) {
  const columns = [...text].reduce((sum, char) => sum + (char.charCodeAt(0) > 0x2e80 ? 2 : 1), 0);
  return text + ' '.repeat(Math.max(0, width - columns));
}

function clockOf(table, periods) {
  const from = table?.[periods?.start - 1];
  const to = table?.[(periods?.end ?? periods?.start) - 1];
  return from && to ? `${from[0]}-${to[1]}` : '';
}

function seasonNow() {
  const month = Number(new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(5, 7));
  return month >= 5 && month <= 9 ? 'summer' : 'winter';
}

function seasonLabel() {
  return seasonNow() === 'summer' ? '夏季' : '冬季';
}

function normalizeHeader(cell) {
  return String(cell ?? '').replace(/\s+/g, '');
}

function stringOrNull(value) {
  const text = String(value ?? '').trim();
  return text.length > 0 ? text : null;
}

function numberOrNull(value) {
  const text = String(value ?? '').trim();
  if (text === '') {
    return null;
  }
  const number = Number(text);
  return Number.isNaN(number) ? null : number;
}
