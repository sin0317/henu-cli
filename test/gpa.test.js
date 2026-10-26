import assert from 'node:assert/strict';
import test from 'node:test';

import { formatGpaText, summarizeGpa } from '../src/modules/grade.js';

const RECORDS = [
  { name: '临床药物治疗学概论', score: '92', credit: 3, earnedCredit: 3, gpa: 4.2 },
  { name: '药剂学', score: '85', credit: 2, earnedCredit: 2, gpa: 3.5 },
  { name: '军事技能', score: '优秀', credit: 1, earnedCredit: 1, gpa: null },
  { name: '大学体育', score: '55', credit: 1, earnedCredit: 0, gpa: 0 }
];

const SUMMARY = {
  total: {
    name: '合计',
    count: 4,
    credits: 7,
    earnedCredits: 6,
    gpa: 7.7,
    creditGpa: 19.6,
    averageScore: 89.1,
    average: 89.2
  },
  lines: [
    { name: '公共基础平台课', count: 1, earnedCredits: 1, creditGpa: 0, average: null },
    { name: '合计', count: 4, earnedCredits: 6, creditGpa: 19.6, average: 89.2 }
  ]
};

test('summarizeGpa 优先用系统给的获得学分绩点算平均绩点', () => {
  const result = summarizeGpa(RECORDS, SUMMARY);
  assert.equal(result.source, 'system');
  assert.equal(result.averageGpa, 3.27); // 19.6 / 6
  assert.equal(result.weightedAverage, 89.2);
  assert.equal(result.averageScore, 89.1);
  assert.equal(result.earnedCredits, 6);
  assert.deepEqual(result.computed, {
    averageGpa: 3.92, // (4.2*3 + 3.5*2) / 5，只算有绩点的课
    weightedAverage: 89.2,
    gradedCourses: 2,
    credits: 5
  });
});

test('summarizeGpa 把等级制课程单独列出来', () => {
  const result = summarizeGpa(RECORDS, SUMMARY);
  assert.deepEqual(result.missingGpa, ['军事技能(优秀)']);
});

test('summarizeGpa 没有系统汇总时退回按明细计算', () => {
  const result = summarizeGpa(RECORDS, { total: null, lines: [] });
  assert.equal(result.source, 'computed');
  assert.equal(result.averageGpa, 3.92);
  assert.equal(result.weightedAverage, 89.2);
  assert.equal(result.creditGpaPoints, null);
  assert.equal(result.earnedCredits, 6);
});

test('summarizeGpa 空成绩不会除以零', () => {
  const result = summarizeGpa([], { total: null, lines: [] });
  assert.equal(result.averageGpa, null);
  assert.equal(result.weightedAverage, null);
  assert.deepEqual(result.missingGpa, []);
});

test('formatGpaText 输出绩点、学分与按平台明细', () => {
  const text = formatGpaText({
    ...summarizeGpa(RECORDS, SUMMARY),
    byCategory: SUMMARY.lines.filter((line) => line.name !== '合计')
  });

  assert.match(text, /平均学分绩点：3\.27/);
  assert.match(text, /加权平均成绩：89\.2/);
  assert.match(text, /算术平均成绩：89\.1/);
  assert.match(text, /已获学分：6/);
  assert.match(text, /获得学分绩点：19\.6/);
  assert.match(text, /明细重算：3\.92（与系统值不一致，以系统为准）/);
  assert.match(text, /公共基础平台课/);
  assert.match(text, /军事技能\(优秀\)/);
});
