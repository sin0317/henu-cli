import assert from 'node:assert/strict';
import test from 'node:test';

import {
  formatNextCourseText,
  pickNext,
  shanghaiParts,
  toMinutes,
  weekMatches,
  weekOfTerm
} from '../src/modules/next-course.js';

// 2026-09-07 是第 1 周周一 → 2026-10-26 周一属于第 8 周
const TERM_START = '2026-09-07';

const COURSES = [
  {
    courseCode: '03100743',
    courseName: '临床药物治疗学概论',
    teachers: ['张伟'],
    sessions: [
      {
        weekday: 1,
        periods: { start: 3, end: 4 },
        weeks: { start: 1, end: 18, parity: 'all', text: '1-18周' },
        location: '金明综合楼5206'
      }
    ]
  },
  {
    courseCode: '03100801',
    courseName: '药剂学',
    teachers: ['李静'],
    sessions: [
      {
        weekday: 1,
        periods: { start: 7, end: 8 },
        weeks: { start: 1, end: 18, parity: 'all', text: '1-18周' },
        location: '金明综合楼5301'
      }
    ]
  },
  {
    courseCode: '03100902',
    courseName: '药物分析',
    teachers: ['王强'],
    sessions: [
      {
        weekday: 2,
        periods: { start: 1, end: 2 },
        weeks: { start: 1, end: 18, parity: 'all', text: '1-18周' },
        location: '金明综合楼5102'
      }
    ]
  }
];

function at(isoUtc) {
  return shanghaiParts(new Date(isoUtc));
}

test('shanghaiParts 按东八区取墙上时间，与本机时区无关', () => {
  // 03:30Z → 上海 11:30
  const parts = at('2026-10-26T03:30:00Z');
  assert.equal(parts.iso, '2026-10-26');
  assert.equal(parts.time, '11:30');
  assert.equal(parts.minutes, 690);
  assert.equal(parts.weekday, 1);
  assert.equal(parts.weekdayLabel, '周一');

  // 周日要映射成 7，而不是 0
  const sunday = at('2026-10-25T02:00:00Z');
  assert.equal(sunday.weekday, 7);
  assert.equal(sunday.weekdayLabel, '周日');
});

test('weekOfTerm 用第 1 周周一换算周次', () => {
  assert.equal(weekOfTerm(TERM_START, '2026-09-07'), 1);
  assert.equal(weekOfTerm(TERM_START, '2026-09-14'), 2);
  assert.equal(weekOfTerm(TERM_START, '2026-10-26'), 8);
  assert.equal(weekOfTerm(TERM_START, '2026-09-06'), 0);
});

test('weekMatches 处理区间、单双周与周次未知', () => {
  const weeks = { start: 1, end: 18, parity: 'all' };
  assert.equal(weekMatches(weeks, 8), true);
  assert.equal(weekMatches(weeks, 19), false);
  assert.equal(weekMatches({ start: 1, end: 18, parity: 'odd' }, 8), false);
  assert.equal(weekMatches({ start: 1, end: 18, parity: 'odd' }, 9), true);
  assert.equal(weekMatches({ start: 1, end: 18, parity: 'even' }, 8), true);
  // 周次未知时不过滤
  assert.equal(weekMatches(weeks, null), true);
});

test('toMinutes 把时刻换成分种', () => {
  assert.equal(toMinutes('10:10'), 610);
  assert.equal(toMinutes('08:00'), 480);
  assert.equal(toMinutes(null), null);
});

test('pickNext 上午课后返回当天的下午课', () => {
  // 12:30：上午 3-4 节（10:10-12:00）已经下课
  const result = pickNext(COURSES, { now: at('2026-10-26T04:30:00Z'), termStart: TERM_START });
  assert.equal(result.week, 8);
  assert.equal(result.weekSource, 'remembered');
  assert.equal(result.ongoing, null);
  assert.equal(result.next.courseName, '药剂学');
  assert.equal(result.next.dayLabel, '今天');
  assert.equal(result.next.start, '14:30');
  assert.equal(result.next.end, '16:20');
  assert.equal(result.next.minutesUntil, 120);
  assert.equal(result.next.location, '金明综合楼5301');
});

test('pickNext 在课间返回下一节，并带上剩余分钟', () => {
  const result = pickNext(COURSES, { now: at('2026-10-26T01:00:00Z'), termStart: TERM_START });
  assert.equal(result.next.courseName, '临床药物治疗学概论');
  assert.equal(result.next.start, '10:10');
  assert.equal(result.next.minutesUntil, 70);
});

test('pickNext 上课中会同时给出 ongoing 和下一节', () => {
  const result = pickNext(COURSES, { now: at('2026-10-26T07:00:00Z'), termStart: TERM_START });
  assert.equal(result.ongoing.courseName, '药剂学');
  assert.equal(result.ongoing.start, '14:30');
  // 周一下午之后没有课了，下一节是周二早上
  assert.equal(result.next.courseName, '药物分析');
  assert.equal(result.next.dayLabel, '明天');
  assert.equal(result.next.date, '2026-10-27');
  assert.equal(result.next.minutesUntil, null);
});

test('pickNext 周次不在区间内的课不会出现', () => {
  const onlyEarly = [
    {
      courseCode: 'X',
      courseName: '已结课的选修',
      sessions: [{
        weekday: 1,
        periods: { start: 7, end: 8 },
        weeks: { start: 1, end: 4, parity: 'all', text: '1-4周' },
        location: '某教室'
      }]
    }
  ];
  const result = pickNext(onlyEarly, { now: at('2026-10-26T03:30:00Z'), termStart: TERM_START });
  assert.equal(result.next, null);
  assert.match(result.note, /未来 7 天没有排到课/);
});

test('pickNext 没有学期起点缓存时照常给结果但提示可能不准', () => {
  const result = pickNext(COURSES, { now: at('2026-10-26T03:30:00Z'), termStart: null });
  assert.equal(result.week, null);
  assert.equal(result.weekSource, 'unknown');
  assert.equal(result.next.courseName, '药剂学');
  assert.match(result.note, /course ics --start/);
});

test('pickNext 十月按冬季作息、五月按夏季作息', () => {
  const winter = pickNext(COURSES, { now: at('2026-10-26T03:30:00Z'), termStart: TERM_START });
  assert.equal(winter.next.schedule, 'winter');

  const summerTerm = '2026-02-23'; // 第 1 周周一
  const summer = pickNext(COURSES, { now: at('2026-05-04T03:30:00Z'), termStart: summerTerm });
  assert.equal(summer.next.schedule, 'summer');
  assert.equal(summer.next.start, '15:00');
});

test('formatNextCourseText 输出下一节与正在进行', () => {
  const result = pickNext(COURSES, { now: at('2026-10-26T07:00:00Z'), termStart: TERM_START });
  const text = formatNextCourseText(result);
  assert.match(text, /现在：2026-10-26 15:00（周一，第 8 周）/);
  assert.match(text, /正在上：药剂学（14:30-16:20）/);
  assert.match(text, /下一节：药物分析/);
  assert.match(text, /明天 08:00-09:50（2026-10-27）/);
});

test('formatNextCourseText 没有课时说明原因', () => {
  const result = pickNext([], { now: at('2026-10-26T03:30:00Z'), termStart: TERM_START });
  const text = formatNextCourseText(result);
  assert.match(text, /未来 7 天没有排到课/);
});
