import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  classifyCategory,
  describeProgress,
  formatPlanText,
  groupPlan,
  isPassed,
  parsePlanRows
} from '../src/modules/plan-parser.js';
import { SECOND_CLASSROOM, checkSecondClassroom, resolveItem } from '../src/second-classroom.js';

// 真实的培养方案表格结构（取自教务系统 DataTable 返回）
const HEADER = ['课程类别', '课程属性', '标识', '课程', '学分', '总学时', '考核方式', '开设学期', '成绩', '是否通过', '选课', '学业完成度'];

const ROWS = [
  HEADER,
  ['公共基础平台课/必修课', '', '', '[00200005]大学英语读写译(一)', '2.0', '36', '考试', '一', '78', '通过', '已选', '必修课：1/3'],
  ['公共基础平台课/必修课', '', '', '[00101006]形势与政策', '2.0', '36', '考查', '一', '', '', '', '必修课：0/1'],
  ['学科基础平台课/必修课', '', '', '[03100142]物理化学', '5.0', '90', '考试', '三', '60', '通过', '已选', ''],
  ['专业基础平台课/必修课', '', '', '[03100743]临床药物治疗学概论', '2.0', '36', '考试', '七', '', '', '已选', ''],
  ['专业选修课/选修课', '', '', '[03100714]药品研发与注册', '2.0', '36', '考查', '七', '', '', '', ''],
  ['实践课/必修课', '', '', '[03100752]专业实习', '9.0', '', '', '七', '', '', '', ''],
  ['环节', '', '', '[03100754]安全教育', '0.5', '', '', '', '', '', '', ''],
  ['合计', '', '', '', '22.5', '', '', '', '', '', '', '']
];

test('解析培养方案表格：课程号与课程名分离', () => {
  const { courses } = parsePlanRows(ROWS);
  assert.equal(courses.length, 7);
  assert.equal(courses[0].code, '00200005');
  assert.equal(courses[0].name, '大学英语读写译(一)');
  assert.equal(courses[0].credit, 2);
  assert.equal(courses[0].term, '一');
});

test('合计行不会被当成课程', () => {
  const { courses } = parsePlanRows(ROWS);
  assert.ok(!courses.some((course) => course.category.includes('合计')));
});

test('通过判定：成绩数字与状态列都要认', () => {
  const { courses } = parsePlanRows(ROWS);
  const english = courses.find((course) => course.code === '00200005');
  const physics = courses.find((course) => course.code === '03100142');
  const situation = courses.find((course) => course.code === '00101006');
  assert.equal(english.passed, true);
  assert.equal(physics.passed, true);
  assert.equal(situation.passed, false);
  assert.equal(situation.creditEarned, 0);
});

test('五级制与通过/不通过也按通过处理', () => {
  assert.equal(isPassed({ score: '优秀', passed: '' }), true);
  assert.equal(isPassed({ score: '中等', passed: '' }), true);
  assert.equal(isPassed({ score: '不及格', passed: '' }), false);
  assert.equal(isPassed({ score: '59', passed: '' }), false);
  assert.equal(isPassed({ score: '', passed: '通过' }), true);
  assert.equal(isPassed({ score: '', passed: '' }), false);
});

test('平台归类：实践环节算必修', () => {
  assert.equal(classifyCategory('公共基础平台课/必修课'), 'required');
  assert.equal(classifyCategory('专业选修课/选修课'), 'elective');
  assert.equal(classifyCategory('环节'), 'required');
  assert.equal(classifyCategory('实践课/必修课'), 'required');
});

test('按平台汇总学分与缺口', () => {
  const { courses } = parsePlanRows(ROWS);
  const groups = groupPlan(courses);
  const publicBasic = groups.find((group) => group.category === '公共基础平台课/必修课');
  assert.equal(publicBasic.courses, 2);
  assert.equal(publicBasic.credits, 4);
  assert.equal(publicBasic.earnedCredits, 2);
  assert.equal(publicBasic.passedCourses, 1);
  assert.equal(publicBasic.pending.length, 1);
  assert.equal(publicBasic.pending[0].name, '形势与政策');
});

test('进度描述：未修 / 在修 / 已通过', () => {
  const { courses } = parsePlanRows(ROWS);
  const clinical = courses.find((course) => course.code === '03100743');
  const situation = courses.find((course) => course.code === '00101006');
  assert.equal(describeProgress(clinical), '在修');
  assert.equal(describeProgress(situation), '未修');
  assert.equal(describeProgress(courses[0]), '已通过');
});

test('人读输出包含专业、平台与合计', () => {
  const { courses } = parsePlanRows(ROWS);
  const text = formatPlanText({
    majorName: '药学',
    majorCode: '0116',
    year: '2023',
    deptName: '药学院',
    courseCount: courses.length,
    totalCredits: 22.5,
    earnedCredits: 7,
    courses
  });
  assert.match(text, /药学/);
  assert.match(text, /药学院/);
  assert.match(text, /公共基础平台课\/必修课/);
  assert.match(text, /合计 7 门 \/ 22.5 学分/);
});

test('第二课堂：简写能对上项目', () => {
  assert.equal(resolveItem('社会实践').id, 'social-practice');
  assert.equal(resolveItem('大创').id, 'training-project');
  assert.equal(resolveItem('讲座').id, 'lecture');
  assert.equal(resolveItem('不存在的东西'), null);
});

test('第二课堂：3 学分不够，且缺创新创业类', () => {
  const result = checkSecondClassroom(['社会实践', '普通话', '学科前沿讲座']);
  assert.equal(result.earnedCredits, 3);
  assert.equal(result.enough, false);
  assert.equal(result.checks.find((check) => check.id === 'total').passed, false);
  assert.equal(result.checks.find((check) => check.id === 'mandatory').passed, true);
  assert.equal(result.checks.find((check) => check.id === 'innovation').passed, false);
});

test('第二课堂：必修 + 竞赛 4 学分 = 5 学分达标', () => {
  const result = checkSecondClassroom(['社会实践', '竞赛:4']);
  assert.equal(result.earnedCredits, 5);
  assert.equal(result.enough, true);
  assert.equal(result.remainingCredits, 0);
});

test('第二课堂：只凑够总分但没必修学分仍不达标', () => {
  const result = checkSecondClassroom(['竞赛:4', '普通话']);
  assert.equal(result.earnedCredits, 5);
  assert.equal(result.enough, false);
  assert.equal(result.checks.find((check) => check.id === 'mandatory').passed, false);
});

test('第二课堂标准覆盖 1 个必修项与 7 个选修项', () => {
  assert.equal(SECOND_CLASSROOM.requiredCredits, 5);
  assert.equal(SECOND_CLASSROOM.items.filter((item) => item.type === '必修').length, 1);
  assert.equal(SECOND_CLASSROOM.items.length, 8);
  assert.equal(SECOND_CLASSROOM.innovationCategories.length, 4);
});
