import assert from 'node:assert/strict';
import test from 'node:test';

import { PERIOD_TIMES, buildCalendar, periodClock, placeWeeks, renderIcs, resolveTermStart } from '../src/modules/ics.js';

// 2026-09-07 是第 1 周周一，周三 = 09-09
const TERM_START = '2026-09-07';

const COURSE = {
  courseCode: '03100743',
  courseName: '临床药物治疗学概论',
  className: '23级药学临床药物治疗学概论',
  credits: 2,
  teachers: ['张伟', '李静'],
  sessions: [
    {
      weekday: 3,
      periods: { start: 1, end: 2 },
      weeks: { start: 1, end: 9, parity: 'all', text: '1-9周' },
      location: '金明综合楼5206(138)',
      raw: '1-9周 三[1-2] 金明综合楼5206(138)'
    }
  ]
};

test('节次时刻：冬季 1-2 节 08:00-09:50，夏季整体后推 30 分钟', () => {
  assert.deepEqual(periodClock({ start: 1, end: 2 }, 'winter'), { start: '08:00', end: '09:50', schedule: 'winter' });
  assert.deepEqual(periodClock({ start: 1, end: 2 }, 'summer'), { start: '08:30', end: '10:20', schedule: 'summer' });
  assert.equal(PERIOD_TIMES.winter.length, 13);
  assert.equal(PERIOD_TIMES.summer.length, 13);
});

test('节次超出 13 小节返回 null，不硬编时间', () => {
  assert.equal(periodClock({ start: 14, end: 14 }, 'winter'), null);
  assert.equal(periodClock({ start: 0 }, 'winter'), null);
});

test('连续周次落到具体日期', () => {
  const placed = placeWeeks({ start: 1, end: 9, parity: 'all' }, 3, TERM_START);
  assert.equal(placed.firstWeek, 1);
  assert.equal(placed.firstDate, '2026-09-09');
  assert.equal(placed.interval, 1);
  assert.equal(placed.count, 9);
});

test('从第 3 周开始、单双周都按周次对齐', () => {
  const odd = placeWeeks({ start: 2, end: 10, parity: 'odd' }, 1, TERM_START);
  assert.equal(odd.firstWeek, 3);
  assert.equal(odd.firstDate, '2026-09-21');
  assert.equal(odd.interval, 2);
  assert.equal(odd.count, 4); // 3、5、7、9

  const even = placeWeeks({ start: 2, end: 10, parity: 'even' }, 1, TERM_START);
  assert.equal(even.firstWeek, 2);
  assert.equal(even.count, 5); // 2、4、6、8、10
});

test('周次不合法或超出范围返回 null', () => {
  assert.equal(placeWeeks({ start: 9, end: 3 }, 1, TERM_START), null);
  assert.equal(placeWeeks({ start: 4, end: 4, parity: 'odd' }, 1, TERM_START), null);
  assert.equal(placeWeeks(null, 1, TERM_START), null);
});

test('跨 10 月 1 日作息切换的课会被拆成两个日程', () => {
  const calendar = buildCalendar([COURSE], { term: '2026-2027学年第一学期', startDate: TERM_START });
  assert.equal(calendar.events, 2);

  const summer = calendar.ics.match(/DTSTART;TZID=Asia\/Shanghai:20260909T083000/);
  assert.ok(summer, '第一段应是夏季作息 08:30 开始');

  // 9/9、9/16、9/23、9/30 属夏季；10/7 起转冬季
  assert.match(calendar.ics, /RRULE:FREQ=WEEKLY;INTERVAL=1;COUNT=4;WKST=MO/);
  assert.match(calendar.ics, /DTSTART;TZID=Asia\/Shanghai:20261007T080000/);
  assert.match(calendar.ics, /RRULE:FREQ=WEEKLY;INTERVAL=1;COUNT=5;WKST=MO/);
  assert.equal(calendar.sessions.length, 1, '课程时段只算一个，不因拆分重复计数');
  assert.deepEqual(calendar.sessions[0].seasons, ['summer', 'winter']);
});

test('强制指定作息时不再拆分', () => {
  const calendar = buildCalendar([COURSE], { term: 't', startDate: TERM_START, schedule: 'winter' });
  assert.equal(calendar.events, 1);
  assert.match(calendar.ics, /COUNT=9/);
});

test('缺星期或节次的时段会进 skipped，不静默丢弃', () => {
  const broken = {
    courseName: '没有时间的课',
    sessions: [{ weekday: null, periods: null, raw: '时间待定' }]
  };
  const calendar = buildCalendar([broken], { term: 't', startDate: TERM_START });
  assert.equal(calendar.events, 0);
  assert.equal(calendar.skipped.length, 1);
  assert.equal(calendar.skipped[0].reason, 'no-weekday-or-period');
});

test('ICS 结构合法：CRLF、每行不超过 75 字节、逗号分号转义', () => {
  // 只有 ASCII 的 ; 和 , 需要转义，全角「；，」原样保留
  const calendar = buildCalendar([{ ...COURSE, courseName: '药物;化学,实验' }], { term: 't', startDate: TERM_START });
  const raw = calendar.ics;

  assert.match(raw, /^BEGIN:VCALENDAR\r\n/);
  assert.match(raw, /\r\nEND:VCALENDAR\r\n$/);
  assert.match(raw, /SUMMARY:药物\\;化学\\,实验/);
  assert.match(raw, /BEGIN:VTIMEZONE[\s\S]*TZID:Asia\/Shanghai/);

  for (const line of raw.split('\r\n')) {
    assert.ok(Buffer.byteLength(line, 'utf8') <= 75, `行超 75 字节：${line}`);
  }
});

test('地点去掉容量后缀，UID 稳定可复现', () => {
  const calendar = buildCalendar([COURSE], { term: 't', startDate: TERM_START });
  assert.match(calendar.ics, /LOCATION:金明综合楼5206\r\n/);
  assert.match(calendar.ics, /UID:henu-03100743-3-1-1-0@henu-cli/);

  const again = buildCalendar([COURSE], { term: 't', startDate: TERM_START });
  assert.equal(again.ics.match(/UID:[^\r]+/g).join(), calendar.ics.match(/UID:[^\r]+/g).join());
});

test('渲染空课表也能得到合法日历', () => {
  const ics = renderIcs([], { term: '空学期' });
  assert.match(ics, /BEGIN:VCALENDAR/);
  assert.ok(!ics.includes('BEGIN:VEVENT'));
});

test('--start / --week-now 归一成第 1 周周一', () => {
  assert.deepEqual(resolveTermStart({ start: '2026-09-07' }), { startDate: '2026-09-07', source: 'flag' });
  assert.deepEqual(resolveTermStart({}), { startDate: null, source: 'missing' });

  // 2026-10-26 是周一，第 8 周 → 第 1 周周一 = 09-07
  const byWeek = resolveTermStart({ weekNow: '8' });
  assert.equal(byWeek.source, 'week-now');
  assert.equal(byWeek.startDate, '2026-09-07');
});

test('非法日期与非法周次直接报 INVALID_ARGUMENT', () => {
  for (const input of [{ start: '2026-9-7' }, { start: '2026-02-30' }, { weekNow: '0' }, { weekNow: 'abc' }]) {
    assert.throws(() => resolveTermStart(input), (error) => error.code === 'INVALID_ARGUMENT');
  }
});
