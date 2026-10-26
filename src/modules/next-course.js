// 「下一节课」：把课表铺到时间线上，回答「我接下来上什么、还有多久、在哪」。
// 纯函数部分（pickNext）不碰网络，方便用固定时间做单测。
import { getCourseList } from './course.js';
import { lookupTermStart } from './course-ics.js';
import { periodClock, seasonOf } from './ics.js';

const WEEKDAY_LABELS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
const HORIZON_DAYS = 7;

/** 取上海墙上时间（东八区无夏令时，固定 +8 即可，且不依赖本机时区）。 */
export function shanghaiParts(input = new Date()) {
  const shifted = new Date(input.getTime() + 8 * 3600000);
  const iso = shifted.toISOString().slice(0, 10);
  const hour = shifted.getUTCHours();
  const minute = shifted.getUTCMinutes();
  const day = shifted.getUTCDay();
  return {
    iso,
    minutes: hour * 60 + minute,
    time: `${pad(hour)}:${pad(minute)}`,
    weekday: day === 0 ? 7 : day,
    weekdayLabel: WEEKDAY_LABELS[(day === 0 ? 7 : day) - 1]
  };
}

export function toMinutes(clock) {
  const [hour, minute] = String(clock ?? '').split(':').map(Number);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  return hour * 60 + minute;
}

/** 某天属于学期第几周；早于开学就是 0 或负数。 */
export function weekOfTerm(termStart, isoDate) {
  const toDays = (iso) => Date.parse(`${iso}T00:00:00Z`);
  const gap = Math.round((toDays(isoDate) - toDays(termStart)) / 86400000);
  if (!Number.isFinite(gap)) return null;
  return Math.floor(gap / 7) + 1;
}

/** 周次是否落在该节的周次区间内；周次未知（null）时不过滤。 */
export function weekMatches(weeks, week) {
  if (week === null || week === undefined) return true;
  const start = Number(weeks?.start);
  const end = Number(weeks?.end);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return true;
  if (week < start || week > end) return false;
  if (weeks?.parity === 'odd') return week % 2 === 1;
  if (weeks?.parity === 'even') return week % 2 === 0;
  return true;
}

export function pickNext(courses, options = {}) {
  const nowParts = isParts(options.now) ? options.now : shanghaiParts(options.now ?? new Date());
  const termStart = options.termStart ?? null;
  const items = Array.isArray(courses) ? courses : [];

  const todayWeek = termStart ? weekOfTerm(termStart, nowParts.iso) : null;

  let ongoing = null;
  let next = null;

  for (let offset = 0; offset <= HORIZON_DAYS && !next; offset += 1) {
    const date = addDays(nowParts.iso, offset);
    const weekday = ((nowParts.weekday - 1 + offset) % 7) + 1;
    const week = termStart ? weekOfTerm(termStart, date) : null;

    const daySessions = [];
    for (const item of items) {
      for (const session of item.sessions ?? []) {
        if (session.weekday !== weekday) continue;
        if (!weekMatches(session.weeks, week)) continue;
        const clock = periodClock(session.periods, seasonOf(date));
        if (!clock) continue;
        daySessions.push({
          item,
          session,
          clock,
          startMin: toMinutes(clock.start),
          endMin: toMinutes(clock.end)
        });
      }
    }

    daySessions.sort((a, b) => a.startMin - b.startMin);

    if (offset === 0) {
      const current = daySessions.find((entry) => nowParts.minutes >= entry.startMin && nowParts.minutes <= entry.endMin);
      if (current) ongoing = describe(current, { offset, date, weekday, nowMinutes: nowParts.minutes });
    }

    // 今天只取「还没开始」的；后面几天取最早那节
    const upcoming = offset === 0
      ? daySessions.find((entry) => entry.startMin > nowParts.minutes)
      : daySessions[0];
    if (upcoming) {
      next = describe(upcoming, { offset, date, weekday, nowMinutes: nowParts.minutes });
    }
  }

  const result = {
    now: {
      date: nowParts.iso,
      time: nowParts.time,
      weekday: nowParts.weekday,
      weekdayLabel: nowParts.weekdayLabel
    },
    week: todayWeek,
    weekSource: termStart ? 'remembered' : 'unknown',
    ongoing,
    next
  };

  if (!next) {
    result.note = `未来 ${HORIZON_DAYS} 天没有排到课：可能已在假期，或者课表还没更新。`;
  } else if (!termStart) {
    result.note = '没有这个学期「第 1 周周一」的记录，无法按周次过滤，非本周的课可能被算进来。'
      + '跑一次 course ics --start <第1周周一> 之后就会记住。';
  }

  return result;
}

function describe(entry, { offset, date, weekday, nowMinutes }) {
  const { item, session, clock, startMin } = entry;
  return {
    courseCode: item.courseCode ?? null,
    courseName: item.courseName ?? null,
    className: item.className ?? null,
    teachers: item.teachers ?? [],
    location: session.location ?? null,
    date,
    weekday,
    dayLabel: dayLabel(offset, weekday),
    periods: session.periods ?? null,
    start: clock.start,
    end: clock.end,
    schedule: clock.schedule,
    weeks: session.weeks?.text ?? null,
    minutesUntil: offset === 0 ? startMin - nowMinutes : null
  };
}

function dayLabel(offset, weekday) {  if (offset === 0) return '今天';
  if (offset === 1) return '明天';
  if (offset === 2) return '后天';
  return WEEKDAY_LABELS[weekday - 1];
}

function addDays(iso, days) {
  const base = Date.parse(`${iso}T00:00:00Z`);
  return new Date(base + days * 86400000).toISOString().slice(0, 10);
}

function pad(value) {
  return String(value).padStart(2, '0');
}

function isParts(value) {
  return Boolean(value) && typeof value === 'object' && !(value instanceof Date)
    && typeof value.iso === 'string' && Number.isFinite(value.minutes);
}

export async function getNextCourse(options = {}) {
  const list = await getCourseList({
    headless: options.headless,
    dump: options.dump,
    refresh: options.refresh
  });
  const termStart = lookupTermStart(list.term);
  const picked = pickNext(list.items, {
    termStart,
    now: options.now ?? new Date()
  });

  return {
    term: list.term ?? null,
    ...picked,
    sourceUrl: list.sourceUrl,
    cache: list.cache,
    ...(list.warning ? { warning: list.warning } : {})
  };
}

export function formatNextCourseText(result) {
  const lines = [
    `现在：${result.now.date} ${result.now.time}（${result.now.weekdayLabel}`
      + `${result.week ? `，第 ${result.week} 周` : ''}）`
  ];

  if (result.ongoing) {
    const item = result.ongoing;
    lines.push('');
    lines.push(`正在上：${item.courseName}（${item.start}-${item.end}）`);
    if (item.location) lines.push(`  地点：${item.location}`);
    if (item.teachers?.length) lines.push(`  教师：${item.teachers.join('、')}`);
  }

  if (result.next) {
    const next = result.next;
    lines.push('');
    const when = next.dayLabel === '今天'
      ? `，还有 ${next.minutesUntil} 分钟`
      : `（${next.date}）`;
    lines.push(`下一节：${next.courseName}`);
    lines.push(`  时间：${next.dayLabel} ${next.start}-${next.end}${when}`);
    if (next.location) lines.push(`  地点：${next.location}`);
    if (next.teachers?.length) lines.push(`  教师：${next.teachers.join('、')}`);
    if (next.courseCode) lines.push(`  课程号：${next.courseCode}`);
  } else {
    lines.push('');
    lines.push(result.note ?? '接下来没有课。');
  }

  if (result.next && result.note) {
    lines.push('');
    lines.push(`提示：${result.note}`);
  }

  return `${lines.join('\n')}\n`;
}
