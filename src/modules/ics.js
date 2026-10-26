// 课表 → iCalendar。纯函数，不碰浏览器，方便单测。
//
// 节次时刻来自《河南大学教学时间设置列表》（校发〔2018〕300 号附件）：
// 每年 10 月 1 日至次年 4 月 30 日执行冬季作息，其余时间执行夏季作息，
// 夏季在冬季时刻上整体后推 30 分钟。
export const PERIOD_TIMES = {
  winter: [
    ['08:00', '08:50'], ['09:00', '09:50'],
    ['10:10', '11:00'], ['11:10', '12:00'],
    ['12:20', '13:10'], ['13:20', '14:10'],
    ['14:30', '15:20'], ['15:30', '16:20'],
    ['16:40', '17:30'], ['17:40', '18:30'],
    ['19:00', '19:50'], ['20:00', '20:50'],
    ['21:00', '21:50']
  ],
  // 夏季 = 冬季 + 30 分钟
  summer: null
};
PERIOD_TIMES.summer = PERIOD_TIMES.winter.map(([start, end]) => [shiftMinutes(start, 30), shiftMinutes(end, 30)]);

const TZID = 'Asia/Shanghai';

export function buildCalendar(items, options = {}) {
  const startDate = options.startDate;
  if (!isIsoDate(startDate)) {
    const error = new Error(`第 1 周周一的日期不合法：${startDate ?? '(空)'}`);
    error.code = 'INVALID_ARGUMENT';
    error.hint = '用 --start 2026-09-07 指定第 1 周周一，或者用 --week-now 8 说明今天是第几周。';
    throw error;
  }

  const term = options.term ?? '';
  const scheduleMode = options.schedule ?? 'auto';
  const events = [];
  const courseSummaries = [];
  const skipped = [];
  const schedules = new Set();
  const stamp = icstamp(new Date());

  for (const item of items ?? []) {
    for (const session of item.sessions ?? []) {
      const weekday = session.weekday;
      const periods = session.periods;
      if (!weekday || !periods?.start) {
        skipped.push({ course: item.courseName, reason: 'no-weekday-or-period', raw: session.raw });
        continue;
      }

      const weeks = session.weeks ?? { start: 1, end: 18, parity: 'all' };
      const placed = placeWeeks(weeks, weekday, startDate);
      if (!placed) {
        skipped.push({ course: item.courseName, reason: 'weeks-out-of-range', raw: session.raw });
        continue;
      }

      // 一节课可能跨过 10 月 1 日的作息切换点（夏季 → 冬季），
      // 所以在季节交界处拆成两段，各自用自己的上下课时刻。
      const occurrenceDates = Array.from({ length: placed.count }, (_, index) => addDays(placed.firstDate, index * placed.interval * 7));
      const runs = scheduleMode === 'auto'
        ? splitBySeason(occurrenceDates)
        : [{ season: scheduleMode, dates: occurrenceDates }];

      const runClocks = [];
      let created = 0;

      runs.forEach((run, runIndex) => {
        const clock = periodClock(periods, run.season);
        if (!clock) return;
        runClocks.push(clock);
        schedules.add(run.season);

        events.push({
          uid: `henu-${item.courseCode ?? 'na'}-${weekday}-${periods.start}-${placed.firstWeek}-${runIndex}@henu-cli`,
          summary: item.courseName,
          location: stripCapacity(session.location),
          description: describe(item, session, {
            firstDate: run.dates[0],
            count: run.dates.length,
            interval: placed.interval
          }, clock),
          date: run.dates[0],
          startTime: clock.start,
          endTime: clock.end,
          interval: placed.interval,
          count: run.dates.length,
          schedule: run.season
        });
        created += 1;
      });

      if (created === 0) {
        skipped.push({ course: item.courseName, reason: 'period-out-of-range', raw: session.raw });
        continue;
      }

      courseSummaries.push({
        courseName: item.courseName,
        weekday,
        periods: `${periods.start}${periods.end && periods.end !== periods.start ? `-${periods.end}` : ''}节`,
        firstDate: placed.firstDate,
        firstTime: runClocks[0]?.start ?? '',
        count: placed.count,
        interval: placed.interval,
        seasons: [...new Set(runClocks.map((clock) => clock.schedule))],
        weeks: weeks.text ?? null,
        location: stripCapacity(session.location)
      });
    }
  }

  events.sort((a, b) => (a.date === b.date ? a.startTime.localeCompare(b.startTime) : a.date.localeCompare(b.date)));

  return {
    term,
    startDate,
    schedule: scheduleMode === 'auto' ? [...schedules].join('+') || 'winter' : scheduleMode,
    events: events.length,
    courses: courseSummaries.length,
    skipped,
    ics: renderIcs(events, { term, stamp }),
    sessions: courseSummaries
  };
}

// 把「第 X-Y 周（单/双）」落到具体日期：算出首次上课日、重复间隔、重复次数。
export function placeWeeks(weeks, weekday, startDate) {
  const start = Number(weeks?.start);
  const end = Number(weeks?.end);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start || start < 1) {
    return null;
  }

  const interval = weeks?.parity === 'odd' || weeks?.parity === 'even' ? 2 : 1;
  let firstWeek = start;
  // 单/双周的奇偶是对周次说的：start 周不对齐就往后挪一周
  if (weeks?.parity === 'odd' && firstWeek % 2 === 0) firstWeek += 1;
  if (weeks?.parity === 'even' && firstWeek % 2 === 1) firstWeek += 1;
  if (firstWeek > end) return null;

  const count = Math.floor((end - firstWeek) / interval) + 1;
  const firstDate = addDays(startDate, (firstWeek - 1) * 7 + (weekday - 1));
  return { firstWeek, firstDate, interval, count };
}

export function periodClock(periods, schedule = 'winter') {
  const table = PERIOD_TIMES[schedule] ?? PERIOD_TIMES.winter;
  const from = table[periods.start - 1];
  const to = table[(periods.end ?? periods.start) - 1];
  if (!from || !to) return null;
  return { start: from[0], end: to[1], schedule };
}

// --start 或 --week-now 归一成「第 1 周周一」的 YYYY-MM-DD。
export function resolveTermStart(options = {}) {
  const start = String(options.start ?? '').trim();
  if (start) {
    if (!isIsoDate(start)) {
      const error = new Error(`--start 日期格式不对：${start}`);
      error.code = 'INVALID_ARGUMENT';
      error.hint = '用 --start 2026-09-07（第 1 周周一）这种格式。';
      throw error;
    }
    return { startDate: start, source: 'flag' };
  }

  const weekNow = String(options.weekNow ?? '').trim();
  if (weekNow) {
    const week = Number(weekNow);
    if (!Number.isFinite(week) || week < 1 || week > 30) {
      const error = new Error(`--week-now 取值不合法：${weekNow}`);
      error.code = 'INVALID_ARGUMENT';
      error.hint = '--week-now 是「今天属于第几周」，取值 1~30。';
      throw error;
    }
    const today = todayInShanghai();
    const monday = addDays(today, -(weekdayOf(today) - 1));
    return { startDate: addDays(monday, -(Math.trunc(week) - 1) * 7), source: 'week-now' };
  }

  return { startDate: null, source: 'missing' };
}

export function formatIcsSummaryText(result) {
  const lines = [];
  lines.push(`课表日历 · ${result.term || '当前学期'}`);
  lines.push(`第 1 周周一：${result.startDate}（作息：${scheduleLabel(result.schedule)}）`);
  lines.push(`已生成 ${result.events} 个日程（${result.courses} 个上课时段）`);
  lines.push(`文件：${result.path}`);
  lines.push('');

  for (const session of result.sessions) {
    const repeat = session.interval === 2 ? '隔周' : '每周';
    const crossing = session.seasons?.length > 1 ? '（跨夏/冬季作息，已按日期拆成两段）' : '';
    lines.push(`  ${weekdayLabel(session.weekday)} ${session.periods} ${session.firstTime} 起  ${session.courseName}`);
    lines.push(`      ${session.firstDate} 起，${repeat} ${session.count} 次${crossing}`);
    if (session.location) lines.push(`      ${session.location}`);
  }

  if (result.skipped.length > 0) {
    lines.push('');
    lines.push(`有 ${result.skipped.length} 个时段没能生成（缺星期/节次，或周次不在学期内）：`);
    for (const item of result.skipped.slice(0, 5)) {
      lines.push(`  ${item.course ?? '(未知课程)'} · ${item.reason} · ${item.raw ?? ''}`);
    }
  }

  lines.push('');
  lines.push('导入方式：手机/电脑日历 → 添加日历 → 从文件导入，选这个 .ics 即可。');
  return lines.join('\n');
}

export function renderIcs(events, options = {}) {
  const stamp = options.stamp ?? icstamp(new Date());
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//henu-cli//Course Timetable//CN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeText(`课程表 ${options.term ?? ''}`.trim())}`,
    'X-WR-TIMEZONE:Asia/Shanghai',
    'BEGIN:VTIMEZONE',
    `TZID:${TZID}`,
    'BEGIN:STANDARD',
    'DTSTART:19700101T000000',
    'TZOFFSETFROM:+0800',
    'TZOFFSETTO:+0800',
    'TZNAME:CST',
    'END:STANDARD',
    'END:VTIMEZONE'
  ];

  for (const event of events) {
    lines.push(
      'BEGIN:VEVENT',
      `UID:${escapeText(event.uid)}`,
      `DTSTAMP:${stamp}`,
      `DTSTART;TZID=${TZID}:${compact(event.date, event.startTime)}`,
      `DTEND;TZID=${TZID}:${compact(event.date, event.endTime)}`,
      `RRULE:FREQ=WEEKLY;INTERVAL=${event.interval};COUNT=${event.count};WKST=MO`,
      `SUMMARY:${escapeText(event.summary)}`,
      ...(event.location ? [`LOCATION:${escapeText(event.location)}`] : []),
      `DESCRIPTION:${escapeText(event.description)}`,
      'TRANSP:OPAQUE',
      'END:VEVENT'
    );
  }

  lines.push('END:VCALENDAR');
  return `${lines.map(foldLine).join('\r\n')}\r\n`;
}

// ---------- 工具 ----------

// 每个 VEVENT 描述这一段日程本身（跨作息时会拆成两段，所以这里按段写）
function describe(item, session, run, clock) {
  const parts = [];
  if (item.teachers?.length) parts.push(`教师：${item.teachers.join('、')}`);
  if (item.courseCode) parts.push(`课程号：${item.courseCode}`);
  if (item.credits) parts.push(`学分：${item.credits}`);
  if (item.className) parts.push(`教学班：${item.className}`);
  if (session.weeks?.text) parts.push(`周次：${session.weeks.text}`);
  parts.push(`本段：${run.firstDate} 起，${run.interval === 2 ? '隔周' : '每周'} ${run.count} 次`);
  parts.push(`节次：${session.raw?.split(' ').slice(0, 2).join(' ') || ''}`);
  parts.push(`作息：${clock.schedule === 'summer' ? '夏季' : '冬季'}`);
  parts.push('由 henu-cli 生成');
  return parts.filter(Boolean).join('\n');
}

function seasonOf(isoDate) {
  const month = Number(isoDate.slice(5, 7));
  // 5 月 1 日 ~ 9 月 30 日 执行夏季作息
  return month >= 5 && month <= 9 ? 'summer' : 'winter';
}

// 把连续的日期按作息切成若干段；同一段内作息一致，可以合成一个 RRULE。
function splitBySeason(dates) {
  const runs = [];
  for (const date of dates) {
    const season = seasonOf(date);
    const last = runs[runs.length - 1];
    if (last && last.season === season) last.dates.push(date);
    else runs.push({ season, dates: [date] });
  }
  return runs;
}

function scheduleLabel(schedule) {
  const labels = { winter: '冬季', summer: '夏季', 'winter+summer': '冬季+夏季（跨季自动切换）', 'summer+winter': '夏季+冬季（跨季自动切换）' };
  return labels[schedule] ?? schedule;
}

function weekdayLabel(weekday) {
  return `周${'一二三四五六日'[weekday - 1] ?? '?'}`;
}

function stripCapacity(location) {
  if (!location) return '';
  // 教室后面常带容量，如「金明综合楼5206(138)」，日历里没必要
  return String(location).replace(/\(\s*\d+\s*\)\s*$/, '').trim();
}

function shiftMinutes(hhmm, minutes) {
  const [hour, minute] = hhmm.split(':').map(Number);
  const total = hour * 60 + minute + minutes;
  const nextHour = Math.floor(total / 60) % 24;
  const nextMinute = total % 60;
  return `${String(nextHour).padStart(2, '0')}:${String(nextMinute).padStart(2, '0')}`;
}

function isIsoDate(value) {
  const text = String(value ?? '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  const [year, month, day] = text.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function addDays(isoDate, days) {
  const [year, month, day] = isoDate.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return date.toISOString().slice(0, 10);
}

function weekdayOf(isoDate) {
  const [year, month, day] = isoDate.split('-').map(Number);
  const dayOfWeek = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return dayOfWeek === 0 ? 7 : dayOfWeek;
}

function todayInShanghai() {
  return new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
}

function compact(isoDate, hhmm) {
  return `${isoDate.replace(/-/g, '')}T${hhmm.replace(':', '')}00`;
}

function icstamp(date) {
  return `${date.toISOString().replace(/[-:]/g, '').split('.')[0]}Z`;
}

function escapeText(text) {
  return String(text ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

// RFC 5545 要求每行不超过 75 个八位组，续行以空格开头。中文按字节算，不能按字符算。
function foldLine(line) {
  const bytes = Buffer.from(line, 'utf8');
  if (bytes.length <= 75) return line;

  const parts = [];
  let rest = bytes;
  let limit = 75;

  while (rest.length > limit) {
    let end = limit;
    // 不要把一个多字节字符劈开
    while (end > 0 && (rest[end] & 0xc0) === 0x80) end -= 1;

    // 优先在转义的换行（\n）之后断开，日历里读起来更像自然段落。
    // 断点太靠前就放弃（否则一行会短得离谱），直接用字节上限。
    const chunk = rest.subarray(0, end).toString('utf8');
    const breakAt = chunk.lastIndexOf('\\n');
    if (breakAt >= Math.floor(chunk.length * 0.4)) {
      end = Buffer.byteLength(chunk.slice(0, breakAt + 2), 'utf8');
    }

    parts.push(rest.subarray(0, end).toString('utf8'));
    rest = rest.subarray(end);
    limit = 74; // 续行前面要加一个空格
  }

  parts.push(rest.toString('utf8'));
  return parts.join('\r\n ');
}
