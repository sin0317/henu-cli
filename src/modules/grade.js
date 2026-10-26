import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { HENU } from '../config.js';
import { CURRICULUM } from '../curriculum.js';
import { assertBrowserAvailable } from './browser.js';
import { getLaunchOptions, importPlaywright } from './browser-options.js';
import {
  formatGradeText,
  parseGradeRows,
  round,
  splitCategory,
  sumCredits,
  summarizeByCategory
} from './grade-parser.js';
import { openJwPage, openJwTabApp } from './jw.js';
import { getHenuHome, getProfilePath } from './paths.js';

export async function getGradeList(options = {}) {
  const loaded = await loadGrades(options);
  const { records, summary } = loaded.parsed;
  const byCategory = summarizeByCategory(records);
  const totalCredits = sumCredits(records);
  const total = summary.total;
  const passed = records.filter((record) => (record.earnedCredit ?? 0) > 0);

  return {
    scope: loaded.scope,
    records,
    total: records.length,
    totalCredits,
    earnedCount: passed.length,
    failed: records.filter((record) => (record.earnedCredit ?? 0) === 0).map((record) => `${record.name}(${record.score})`),
    weightedAverage: total?.average ?? null,
    byCategory,
    systemSummary: summary.lines,
    sourceUrl: loaded.sourceUrl
  };
}

export async function getGradeAudit(options = {}) {
  const loaded = await loadGrades(options);
  return {
    ...auditCredits(loaded.parsed.records, CURRICULUM),
    weightedAverage: loaded.parsed.summary.total?.average ?? null,
    sourceUrl: loaded.sourceUrl
  };
}

// 平均学分绩点：优先用教务系统自己算好的数（获得学分绩点 ÷ 获得学分），
// 同时按明细重算一遍做对照，两套数不一致时以系统为准并给出偏差。
export function summarizeGpa(records, summary) {
  const total = summary?.total ?? null;
  const graded = records.filter((record) => Number.isFinite(record.gpa) && (record.earnedCredit ?? 0) > 0);
  const missing = records
    .filter((record) => !Number.isFinite(record.gpa) && (record.earnedCredit ?? 0) > 0)
    .map((record) => `${record.name}(${record.score})`);

  const creditSum = graded.reduce((sum, record) => sum + record.earnedCredit, 0);
  const pointSum = graded.reduce((sum, record) => sum + record.gpa * record.earnedCredit, 0);
  // 已获学分要把等级制课程也算进去（它们没有绩点但有学分）
  const earnedAll = records.reduce((sum, record) => sum + (record.earnedCredit ?? 0), 0);
  const numeric = graded.filter((record) => Number.isFinite(Number(record.score)));
  const scoreCreditSum = numeric.reduce((sum, record) => sum + record.earnedCredit, 0);
  const scoreSum = numeric.reduce((sum, record) => sum + Number(record.score) * record.earnedCredit, 0);

  const systemCreditGpa = total?.creditGpa ?? null;
  const systemCredits = total?.earnedCredits ?? null;
  const systemAverageGpa = Number.isFinite(systemCreditGpa) && systemCredits
    ? round(systemCreditGpa / systemCredits)
    : null;

  return {
    earnedCredits: systemCredits ?? round(earnedAll),
    averageGpa: systemAverageGpa ?? (creditSum ? round(pointSum / creditSum) : null),
    weightedAverage: total?.average ?? (scoreCreditSum ? round(scoreSum / scoreCreditSum) : null),
    averageScore: total?.averageScore ?? null,
    creditGpaPoints: systemCreditGpa,
    gpaPoints: total?.gpa ?? null,
    source: systemAverageGpa !== null ? 'system' : 'computed',
    computed: {
      averageGpa: creditSum ? round(pointSum / creditSum) : null,
      weightedAverage: scoreCreditSum ? round(scoreSum / scoreCreditSum) : null,
      gradedCourses: graded.length,
      credits: round(creditSum)
    },
    missingGpa: missing
  };
}

export async function getGradeGpa(options = {}) {
  const loaded = await loadGrades(options);
  const { records, summary } = loaded.parsed;
  return {
    scope: loaded.scope,
    ...summarizeGpa(records, summary),
    byCategory: summary.lines.filter((line) => line.name !== '合计'),
    sourceUrl: loaded.sourceUrl
  };
}

export function formatGpaText(result) {
  const lines = ['学分绩点（数据来自教务系统成绩明细）'];
  lines.push(`  平均学分绩点：${fmt(result.averageGpa)}${result.source === 'system' ? '' : '（按明细重算）'}`);
  lines.push(`  加权平均成绩：${fmt(result.weightedAverage)}`);
  if (result.averageScore !== null && result.averageScore !== undefined) {
    lines.push(`  算术平均成绩：${fmt(result.averageScore)}`);
  }
  lines.push(`  已获学分：${fmt(result.earnedCredits)}`);
  if (result.creditGpaPoints !== null && result.creditGpaPoints !== undefined) {
    lines.push(`  获得学分绩点：${fmt(result.creditGpaPoints)}`);
  }

  if (result.computed?.averageGpa !== null && result.averageGpa !== null
    && Math.abs(result.computed.averageGpa - result.averageGpa) >= 0.01) {
    lines.push(`  明细重算：${fmt(result.computed.averageGpa)}（与系统值不一致，以系统为准）`);
  }

  if (result.byCategory?.length) {
    lines.push('');
    lines.push('按平台：');
    for (const bucket of result.byCategory) {
      lines.push(`  ${bucket.name}：${bucket.count ?? '?'} 门 / ${fmt(bucket.earnedCredits)} 学分 / 绩点 ${fmt(bucket.creditGpa)}`);
    }
  }

  if (result.missingGpa?.length) {
    lines.push('');
    lines.push(`等级制成绩（不计入绩点）：${result.missingGpa.join('、')}`);
  }

  return `${lines.join('\n')}\n`;
}

// 把成绩记录按培养方案的平台逐项归集，算出每个平台的完成情况。
// 一门课只归一个平台（按顺序首个命中），避免重复计学分。
export function auditCredits(records, curriculum = CURRICULUM) {
  // 同一门课可能修过多次（重修/补考），按课程号去重，取获得学分最高的一次
  const best = new Map();
  for (const record of records) {
    const current = best.get(record.code);
    if (!current || (record.earnedCredit ?? 0) > (current.earnedCredit ?? 0)) {
      best.set(record.code, record);
    }
  }
  const unique = [...best.values()];

  const assigned = new Map();
  const buckets = curriculum.buckets.map((bucket) => {
    const expected = new Set(bucket.courses.map(([code]) => code));
    const hits = unique.filter((record) => {
      if (assigned.has(record.code)) return false;
      const byCategory = bucket.matchCategories.includes(record.category);
      const byCode = (bucket.includeCodes ?? []).includes(record.code) || expected.has(record.code);
      return byCategory || byCode;
    });
    for (const record of hits) assigned.set(record.code, bucket.id);

    const earned = round(hits.reduce((sum, record) => sum + (record.earnedCredit ?? 0), 0));
    const gap = round(Math.max(0, bucket.requiredCredits - earned));
    const missing = bucket.noGradeRecord
      ? bucket.courses.filter(([code]) => !best.has(code)).map(([code, name, credit]) => ({
        code, name, credit, reason: 'no-grade-record'
      }))
      : bucket.courses
        .filter(([code]) => !best.has(code) || (best.get(code).earnedCredit ?? 0) === 0)
        .map(([code, name, credit]) => ({
          code,
          name,
          credit,
          reason: best.has(code) ? 'not-passed' : 'not-taken'
        }));

    return {
      id: bucket.id,
      label: bucket.label,
      requiredCredits: bucket.requiredCredits,
      earnedCredits: earned,
      gap,
      courses: hits.length,
      status: gap === 0 ? 'done' : (earned === 0 ? 'untouched' : 'partial'),
      missing,
      ...(bucket.note ? { note: bucket.note } : {})
    };
  });

  const outsidePlan = unique
    .filter((record) => !assigned.has(record.code))
    .map((record) => ({
      code: record.code,
      name: record.name,
      credit: record.earnedCredit,
      category: record.category
    }));

  // 计划外的已修课程照样计入毕业总学分，但不参与任何平台的缺口计算
  const outsideCredits = round(outsidePlan.reduce((sum, item) => sum + (item.credit ?? 0), 0));
  const earnedCredits = round(buckets.reduce((sum, bucket) => sum + bucket.earnedCredits, 0) + outsideCredits);
  const requiredCredits = round(buckets.reduce((sum, bucket) => sum + bucket.requiredCredits, 0));
  const remainingByBucket = round(buckets.reduce((sum, bucket) => sum + bucket.gap, 0));

  return {
    major: curriculum.major,
    majorCode: curriculum.majorCode,
    gradeYear: curriculum.gradeYear,
    planNote: curriculum.planNote,
    requiredCredits,
    statedTotal: curriculum.totalCredits,
    earnedCredits,
    outsideCredits,
    remainingCredits: round(Math.max(0, curriculum.totalCredits - earnedCredits)),
    remainingByBucket,
    surplus: round(Math.max(0, earnedCredits - (curriculum.totalCredits - remainingByBucket))),
    buckets,
    outsidePlan
  };
}

// 人读输出：毕业学分核对表
export function formatAuditText(audit) {
  const lines = [];
  lines.push(`${audit.major}专业（${audit.majorCode}）${audit.gradeYear}级 毕业学分核对`);
  lines.push(`培养方案要求 ${audit.statedTotal} 学分：${audit.planNote}`);
  lines.push('');
  lines.push(`${'平台/环节'.padEnd(22)}${'要求'.padStart(7)}${'已修'.padStart(8)}${'缺口'.padStart(7)}`);
  for (const bucket of audit.buckets) {
    const mark = bucket.status === 'done' ? '✓' : bucket.status === 'partial' ? '△' : '✗';
    lines.push(`${mark} ${bucket.label.padEnd(20)}${String(bucket.requiredCredits).padStart(7)}${String(bucket.earnedCredits).padStart(8)}${String(bucket.gap).padStart(7)}`);
  }
  lines.push('');
  lines.push(`已获 ${audit.earnedCredits} / ${audit.statedTotal} 学分，差 ${audit.remainingCredits} 学分`);
  if (audit.remainingByBucket !== audit.remainingCredits) {
    lines.push(`（按平台逐项补齐需再修 ${audit.remainingByBucket} 学分，差额来自选修课超修 ${audit.surplus} 学分的抵扣）`);
  }

  const pending = audit.buckets.filter((bucket) => bucket.missing.length > 0);
  if (pending.length > 0) {
    lines.push('');
    lines.push('尚缺课程：');
    for (const bucket of pending) {
      lines.push(`【${bucket.label}】`);
      for (const item of bucket.missing) {
        const why = item.reason === 'not-taken' ? '未修' : item.reason === 'not-passed' ? '未通过' : '无成绩记录';
        lines.push(`  ${item.name} ${item.credit} 学分（${why}）`);
      }
    }
  }

  if (audit.outsidePlan.length > 0) {
    lines.push('');
    lines.push(`培养方案外的已修课程 ${audit.outsidePlan.length} 门：`);
    for (const item of audit.outsidePlan) {
      lines.push(`  ${item.name} ${item.credit} 学分（${item.category}）`);
    }
  }
  return lines.join('\n');
}

async function loadGrades(options = {}) {
  const browser = assertBrowserAvailable();
  const { chromium } = await importPlaywright();

  const context = await chromium.launchPersistentContext(
    getProfilePath(browser.id),
    { ...getLaunchOptions({ headless: options.headless ?? true }), viewport: { width: 1600, height: 1000 } }
  );

  try {
    const page = context.pages()[0] ?? await context.newPage();

    const opened = await openJwPage(page, HENU.jw.base, options);
    if (!opened.authState.loggedIn) {
      throwAuthRequired(opened.authState, opened.pageState, opened.sso);
    }

    const nav = await openJwTabApp(page, {
      tile: HENU.jw.grade.tile,
      menuCode: HENU.jw.grade.menuCode,
      formMarker: HENU.jw.grade.formMarker
    });
    if (!nav.ok) {
      throwUnrecognized(opened.pageState, { stage: 'open-grade-tab', reason: nav.reason });
    }

    const scope = await applyQueryScope(nav.formFrame);
    await nav.formFrame.locator(HENU.jw.grade.queryButton).click({ timeout: 20000 });

    const dataFrame = await waitForDataFrame(page, HENU.jw.grade.dataMarker, options.waitMs ?? 45000);
    if (!dataFrame) {
      throwUnrecognized(opened.pageState, { stage: 'query', reason: 'data-frame-missing', scope });
    }

    const tables = await dataFrame.evaluate(() => [...document.querySelectorAll('table')]
      .map((table) => [...table.querySelectorAll('tr')]
        .map((row) => [...row.querySelectorAll('th,td')].map((cell) => (cell.innerText || '').replace(/\s+/g, ' ').trim())))
      .filter((rows) => rows.length > 1 && rows.some((row) => row.join('').includes('课程/环节'))));

    if (tables.length === 0) {
      throwUnrecognized(opened.pageState, { stage: 'read-table', reason: 'no-grade-table', scope });
    }

    const html = await dataFrame.content();
    if (options.dump) {
      dumpDiagnostics({ pageState: opened.pageState, nav, scope, tables, html });
    }

    const parsed = parseGradeRows(tables.flat());
    return { parsed, scope, sourceUrl: dataFrame.url(), tables: tables.length };
  } finally {
    await context.close().catch(() => {});
  }
}

// 查询口径：入学以来 + 有效成绩 + 主修。
// 注意复选框默认就是勾选状态，直接 click 会把它取消掉，必须先判断再点。
async function applyQueryScope(frame) {
  const controls = HENU.jw.grade.controls;
  return frame.evaluate((cfg) => {
    const radio = (id) => {
      const node = document.getElementById(id);
      if (node && !node.checked) node.click();
    };
    radio(cfg.timeAll);
    radio(cfg.effective);
    const main = document.getElementById(cfg.mainMajor);
    if (main && !main.checked) main.click();
    return {
      timeAll: document.getElementById(cfg.timeAll)?.checked ?? false,
      effective: document.getElementById(cfg.effective)?.checked ?? false,
      mainMajor: main?.checked ?? false
    };
  }, controls);
}

async function waitForDataFrame(page, marker, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const frame = page.frames().find((candidate) => candidate.url().includes(marker));
    if (frame) return frame;
    await page.waitForTimeout(500);
  }
  return null;
}

function throwAuthRequired(authState, pageState, sso) {
  const error = new Error('未登录教务系统，且自动单点登录失败。');
  error.code = 'AUTH_REQUIRED';
  error.hint = '先运行 henu-cli auth login 在浏览器里登录一次统一身份认证，再重试。';
  error.details = { reason: authState.reason, finalUrl: pageState.url, sso };
  throw error;
}

function throwUnrecognized(pageState, details = {}) {
  const error = new Error('已登录，但没有取到成绩表格。');
  error.code = 'PAGE_UNRECOGNIZED';
  error.hint = '用 henu-cli grade list --headed --dump 重跑，把 ~/.henu-cli/diagnostics-grade.json 交给维护者。';
  error.details = { ...details, finalUrl: pageState.url, title: pageState.title };
  throw error;
}

function dumpDiagnostics({ pageState, nav, scope, tables, html }) {
  const home = getHenuHome();
  mkdirSync(home, { recursive: true });
  const file = join(home, 'diagnostics-grade.json');
  writeFileSync(file, `${JSON.stringify({
    finalUrl: pageState.url,
    title: pageState.title,
    nav,
    scope,
    tableCount: tables.length,
    headers: tables.map((rows) => rows[0] ?? []),
    sampleRows: tables.map((rows) => rows[1] ?? []),
    htmlHead: html.slice(0, 4000)
  }, null, 2)}\n`, 'utf8');
  process.stderr.write(`diagnostics written to ${file}\n`);
}

function fmt(value) {
  if (value === null || value === undefined || value === '') return '—';
  return Number.isFinite(Number(value)) ? String(round(Number(value))) : String(value);
}

export { formatGradeText, splitCategory };
