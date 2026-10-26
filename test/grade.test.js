import assert from 'node:assert/strict';
import test from 'node:test';

import { auditCredits, formatAuditText } from '../src/modules/grade.js';
import { parseGradeRows, splitCategory, summarizeByCategory, sumCredits } from '../src/modules/grade-parser.js';

// 取自河大教务「学生成绩明细」真实返回的列序（含表格尾部汇总行）
const HEADER = ['序号', '课程/环节', '学分', '总学时', '类别', '修读性质', '考核方式', '成绩', '获得学分', '绩点', '学分绩点', '备注'];
const SUMMARY_HEADER = ['', '修读课程环节数', '学分', '获得学分', '获得绩点', '获得学分绩点', '平均成绩', '加权平均成绩'];

const ROWS = [
  HEADER,
  ['1', '[03100249]药理学', '4.5', '108', '专业基础平台课/必修课', '初修', '考试', '65.0', '4.5', '1.7', '7.65', ''],
  ['2', '[03100747]有机化学（一）', '4.0', '90', '学科基础平台课/必修课', '初修', '考试', '60.0', '4.0', '1.0', '4.0', '补考'],
  ['3', '[00900002]军事技能', '1.0', '', '实践课/必修课', '初修', '考查', '合格', '1.0', '4.0', '4.0', ''],
  ['4', '[TSK03193]微信小程序开发入门', '2.0', '36', '通识课程-公共通识课/选修课', '初修', '考查', '92.0', '2.0', '4.0', '8.0', ''],
  SUMMARY_HEADER,
  ['必修课', '3', '9.5', '9.5', '6.7', '15.65', '', ''],
  ['合计', '4', '11.5', '11.5', '10.7', '23.65', '76.20', '72.81']
];

test('解析成绩明细行', () => {
  const { records } = parseGradeRows(ROWS);
  assert.equal(records.length, 4);
  assert.equal(records[0].code, '03100249');
  assert.equal(records[0].name, '药理学');
  assert.equal(records[0].credit, 4.5);
  assert.equal(records[0].earnedCredit, 4.5);
  assert.equal(records[0].category, '专业基础平台课/必修课');
  assert.equal(records[1].note, '补考');
  assert.equal(records[2].score, '合格');
});

test('汇总行不混进课程记录，且能读到加权平均', () => {
  const { records, summary } = parseGradeRows(ROWS);
  assert.ok(records.every((record) => /^[A-Z0-9]/.test(record.code)));
  assert.equal(summary.lines.length, 2);
  assert.equal(summary.total.credits, 11.5);
  assert.equal(summary.total.count, 4);
  assert.equal(summary.total.average, 72.81);
});

test('拆分类别与按类别聚合', () => {
  const { records } = parseGradeRows(ROWS);
  assert.deepEqual(splitCategory('专业基础平台课/必修课'), { platform: '专业基础平台课', nature: '必修课' });

  const buckets = summarizeByCategory(records);
  assert.equal(buckets.length, 4);
  assert.equal(sumCredits(records), 11.5);
});

const MINI_CURRICULUM = {
  major: '测试',
  majorCode: '000000',
  gradeYear: 2023,
  totalCredits: 20,
  planNote: '必修 10 + 选修 5 + 实践 5',
  buckets: [
    {
      id: 'a',
      label: '必修课',
      requiredCredits: 10,
      matchCategories: ['必修课/必修课'],
      courses: [['1001', '课一', 4], ['1002', '课二', 4], ['1003', '课三', 4]]
    },
    {
      id: 'b',
      label: '选修课',
      requiredCredits: 5,
      matchCategories: ['选修课/选修课'],
      courses: []
    },
    {
      id: 'c',
      label: '实践环节',
      requiredCredits: 5,
      matchCategories: [],
      includeCodes: ['2001', '2002'],
      courses: [['2001', '实习', 5], ['2002', '论文', 2]]
    }
  ]
};

test('学分核对：缺口、未修课程与超修抵扣', () => {
  const records = [
    { code: '1001', name: '课一', credit: 4, earnedCredit: 4, category: '必修课/必修课' },
    { code: '1002', name: '课二', credit: 4, earnedCredit: 4, category: '必修课/必修课' },
    { code: '1003', name: '课三', credit: 4, earnedCredit: 0, category: '必修课/必修课' },
    { code: '3001', name: '选修甲', credit: 4, earnedCredit: 4, category: '选修课/选修课' },
    { code: '3002', name: '选修乙', credit: 3, earnedCredit: 3, category: '选修课/选修课' },
    { code: '2001', name: '实习', credit: 5, earnedCredit: 5, category: '实践课/必修课' }
  ];

  const audit = auditCredits(records, MINI_CURRICULUM);
  assert.equal(audit.earnedCredits, 20);
  assert.equal(audit.remainingCredits, 0);
  assert.equal(audit.remainingByBucket, 2);
  assert.equal(audit.surplus, 2);

  const required = audit.buckets.find((bucket) => bucket.id === 'a');
  assert.equal(required.earnedCredits, 8);
  assert.equal(required.gap, 2);
  assert.deepEqual(required.missing.map((item) => item.name), ['课三']);
  assert.equal(required.missing[0].reason, 'not-passed');

  const practice = audit.buckets.find((bucket) => bucket.id === 'c');
  assert.equal(practice.earnedCredits, 5);
  assert.deepEqual(practice.missing.map((item) => [item.name, item.reason]), [['论文', 'not-taken']]);
});

test('学分核对：同一门课重修只算一次', () => {
  const records = [
    { code: '1001', name: '课一', credit: 4, earnedCredit: 0, category: '必修课/必修课' },
    { code: '1001', name: '课一', credit: 4, earnedCredit: 4, category: '必修课/必修课' }
  ];
  const audit = auditCredits(records, MINI_CURRICULUM);
  assert.equal(audit.buckets.find((bucket) => bucket.id === 'a').earnedCredits, 4);
});

test('人读输出包含差额与缺口课程', () => {
  const records = [
    { code: '1001', name: '课一', credit: 4, earnedCredit: 4, category: '必修课/必修课' },
    { code: '9999', name: '计划外课', credit: 1, earnedCredit: 1, category: '其他' }
  ];
  const text = formatAuditText(auditCredits(records, MINI_CURRICULUM));
  assert.match(text, /已获 5 \/ 20 学分/);
  assert.match(text, /课三 4 学分（未修）/);
  assert.match(text, /计划外课 1 学分/);
});
