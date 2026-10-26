import assert from 'node:assert/strict';
import test from 'node:test';

import { classifyAuthPage } from '../src/modules/auth-detector.js';
import {
  filterByWeekday,
  formatCourseText,
  parseCourseCell,
  parseSession,
  parseTeachers,
  parseTimetableTable,
  parseWeeks
} from '../src/modules/course-parser.js';
import { errorEnvelope, successEnvelope, toErrorShape } from '../src/modules/output.js';

// 真实抓取到的表头与一行数据（河大青果教务，2026-2027-1）
const HEADER = [
  '上课班级\n代码', '上课班级\n名称', '课程', '总\n学时', '学分', '修读\n性质',
  '任课教师', '选课\n状态', '是否\n跨学科', '教材', '上课时间地点', '备\n注'
];

const ROW = [
  '9901021-001',
  '23级药学临床药物治疗学概论',
  '[03100743]临床药物治疗学概论',
  '36',
  '2.0',
  '初修',
  '[10001]张伟 [10002]李静 [10003]王强',
  '选中',
  '否',
  '否',
  '1-9周 三[1-2] 金明综合楼5206(138)；1-9周 四[1-2] 计算机大楼101(150)',
  ''
];

test('parseTimetableTable 解析真实课表行', () => {
  const items = parseTimetableTable(HEADER, [ROW]);
  assert.equal(items.length, 1);

  const item = items[0];
  assert.equal(item.courseCode, '03100743');
  assert.equal(item.courseName, '临床药物治疗学概论');
  assert.equal(item.className, '23级药学临床药物治疗学概论');
  assert.equal(item.credits, 2);
  assert.equal(item.hours, 36);
  assert.equal(item.status, '选中');
  assert.deepEqual(item.teachers, ['张伟', '李静', '王强']);
  assert.equal(item.sessions.length, 2);
});

test('parseTimetableTable 解析出星期、节次、周次、地点', () => {
  const [item] = parseTimetableTable(HEADER, [ROW]);
  const [first, second] = item.sessions;

  assert.equal(first.weekday, 3);
  assert.equal(first.weekdayText, '三');
  assert.deepEqual(first.periods, { start: 1, end: 2 });
  assert.deepEqual(first.weeks, { start: 1, end: 9, parity: 'all', text: '1-9周' });
  assert.equal(first.location, '金明综合楼5206(138)');

  assert.equal(second.weekday, 4);
  assert.equal(second.location, '计算机大楼101(150)');
});

test('filterByWeekday 收窄到当天并丢空', () => {
  const items = parseTimetableTable(HEADER, [ROW]);
  const thursday = filterByWeekday(items, 4);
  assert.equal(thursday.length, 1);
  assert.equal(thursday[0].sessions.length, 1);
  assert.equal(thursday[0].sessions[0].location, '计算机大楼101(150)');

  assert.equal(filterByWeekday(items, 5).length, 0);
  assert.equal(filterByWeekday(items, null).length, 1);
});

test('parseCourseCell 拆出课程代码与名称', () => {
  assert.deepEqual(parseCourseCell('[03100743]临床药物治疗学概论'), {
    code: '03100743',
    name: '临床药物治疗学概论'
  });
  assert.deepEqual(parseCourseCell('只有名称'), { code: null, name: '只有名称' });
  assert.deepEqual(parseCourseCell(''), { code: null, name: null });
});

test('parseTeachers 去掉工号', () => {
  assert.deepEqual(parseTeachers('[10001]张伟 [10002]李静'), ['张伟', '李静']);
  assert.deepEqual(parseTeachers(''), []);
});

test('parseSession 兼容“第1-9周”写法与无地点', () => {
  const session = parseSession('第1-9周 二[3-4]');
  assert.equal(session.weekday, 2);
  assert.deepEqual(session.periods, { start: 3, end: 4 });
  assert.equal(session.location, null);
});

test('parseSession 对无法识别的片段保留原文', () => {
  const session = parseSession('集中实践环节');
  assert.equal(session.weekday, null);
  assert.equal(session.raw, '集中实践环节');
});

test('parseWeeks 识别单双周', () => {
  assert.equal(parseWeeks('1-15单周').parity, 'odd');
  assert.equal(parseWeeks('2-16双周').parity, 'even');
});

test('classifyAuthPage 区分教务登录页与已登录页', () => {
  assert.deepEqual(
    classifyAuthPage({ url: 'https://xk.henu.edu.cn/cas/login.action', title: '', text: '统一认证登录' }),
    { loggedIn: false, reason: 'jw-login-page' }
  );
  assert.deepEqual(
    classifyAuthPage({ url: 'https://xk.henu.edu.cn/frame/homes.action?v=1', title: '', text: '' }),
    { loggedIn: true, reason: 'jw-home' }
  );
});

test('classifyAuthPage 区分 CAS 登录页与个人中心', () => {
  assert.deepEqual(
    classifyAuthPage({ url: 'https://ids.henu.edu.cn/authserver/login?service=x', title: '', text: '' }),
    { loggedIn: false, reason: 'cas-login-page' }
  );
  assert.deepEqual(
    classifyAuthPage({ url: 'https://ids.henu.edu.cn/personalInfo/personCenter/index.html#/authorization', title: '', text: '' }),
    { loggedIn: true, reason: 'cas-personal-center' }
  );
});

test('课表文本视图按星期分组，节次对齐且带时间地点', () => {
  const result = {
    term: '2026-2027学年第一学期',
    items: [
      {
        courseName: '临床药物治疗学概论',
        credits: 2,
        teachers: ['张伟'],
        sessions: [
          { weekday: 3, periods: { start: 1, end: 2 }, weeks: { text: '1-9周' }, location: '金明综合楼5206(138)' },
          { weekday: 5, periods: { start: 9, end: 10 }, weeks: { text: '1-16周' }, location: '计算机大楼101' }
        ]
      }
    ]
  };

  const text = formatCourseText(result);
  assert.match(text, /1 门课 \/ 2 个上课时段/);
  assert.ok(!text.includes('周一'), '没有课的星期不该出现');

  const lines = text.split('\n');
  const wed = lines.find((line) => line.includes('1-2节'));
  const fri = lines.find((line) => line.includes('9-10节'));
  assert.match(wed, /1-2节 +\d{2}:\d{2}-\d{2}:\d{2} +临床药物治疗学概论/);
  assert.match(fri, /9-10节 +\d{2}:\d{2}-\d{2}:\d{2} +临床药物治疗学概论/);
  assert.match(text, /1-9周 · 金明综合楼5206\(138\) · 张伟 · 2 学分/);
});

test('课表文本视图：没有课时不装成功', () => {
  const text = formatCourseText({ term: null, items: [] });
  assert.match(text, /0 门课 \/ 0 个上课时段/);
  assert.match(text, /没有解析到课程/);
});

test('按星期过滤后为空，说的是「这天没课」而不是「没选课」', () => {
  const text = formatCourseText({ term: '2026-2027学年第一学期', weekday: 1, items: [] });
  assert.match(text, /· 周一（0 门课/);
  assert.match(text, /周一没有课/);
  assert.ok(!text.includes('没有解析到课程'));
});

test('JSON 信封结构稳定', () => {
  const ok = successEnvelope({ total: 1 }, { command: 'course.list' });
  assert.equal(ok.ok, true);
  assert.equal(ok.meta.cli, 'henu-cli');

  const failed = errorEnvelope(toErrorShape(Object.assign(new Error('x'), { code: 'AUTH_REQUIRED', hint: 'h' })));
  assert.equal(failed.ok, false);
  assert.equal(failed.error.code, 'AUTH_REQUIRED');
});
