
import { HENU } from '../config.js';
import { SECOND_CLASSROOM } from '../second-classroom.js';
import { assertBrowserAvailable } from './browser.js';
import { getLaunchOptions, importPlaywright } from './browser-options.js';
import { openJwPage, openJwTabApp } from './jw.js';
import { round, groupPlan, parsePlanRows, formatPlanText } from './plan-parser.js';
import { getRequestId, writeDiagnostics } from './output.js';
import { getProfilePath } from './paths.js';

// 教务系统的「专业培养方案达成度」页可以选任意 院系 / 专业 / 年级，
// 提交到 /taglib/DataTable.jsp?tableId=xxx，返回该专业完整方案课程清单，
// 并叠加上当前登录学生自己的成绩与通过状态。
// 这是全校任意专业都能查学分的入口。
export async function listDepartments() {
  return withPlanPage(async ({ frame }) => {
    const options = await readSelectOptions(frame, 'sel_yxb');
    return {
      depts: options.map((item) => ({ code: item.value, name: stripCode(item.text) })),
      total: options.length
    };
  });
}

export async function listMajors(deptCode) {
  return withPlanPage(async ({ frame, page, own }) => {
    const dept = deptCode || own.dept;
    if (!dept) {
      throw invalidArgument('缺少院系代码。先运行 henu-cli plan depts 查可用的院系代码。');
    }
    await selectValue(frame, 'sel_yxb', dept, page);
    const options = await readSelectOptions(frame, 'sel_zy');
    const deptName = stripCode(await readSelectedText(frame, 'sel_yxb'));
    return {
      dept: { code: dept, name: deptName },
      majors: options.map((item) => ({ code: item.value, name: stripCode(item.text) })),
      total: options.length
    };
  });
}

export async function getPlan(options = {}) {
  return withPlanPage(async ({ frame, page, own }) => {
    const target = {
      dept: options.dept || own.dept,
      major: options.major || own.major,
      year: String(options.year || own.year || ''),
      order: options.order === 'term' ? 'axq' : 'akcmk'
    };

    // 换院系要让页面自己把专业列表拉回来，否则专业名和方案都对不上
    let warning;
    if (target.dept && target.dept !== own.dept) {
      await selectValue(frame, 'sel_yxb', target.dept, page);
    }

    const deptName = await readOptionLabel(frame, 'sel_yxb', target.dept);
    const majorOptions = await readSelectOptions(frame, 'sel_zy');
    const majorKnown = target.major
      ? majorOptions.some((item) => item.value === target.major)
      : true;

    if (!majorKnown) {
      // 专业代码全校唯一，教务系统按 zydm 出方案；但代码和院系对不上时先提醒，
      // 免得把 A 学院的代码套在 B 学院下面查出一份不相干的方案。
      warning = `专业代码 ${target.major} 不在「${deptName || target.dept}」的专业列表里。教务系统按专业代码出方案，结果可能不是你想要的，请用 plan majors --dept <院系代码> 核对。`;
    } else if (target.major && target.major !== own.major) {
      await selectValue(frame, 'sel_zy', target.major, page);
    }

    const majorName = majorKnown ? await readOptionLabel(frame, 'sel_zy', target.major) : '';

    const plan = await fetchPlan(frame, { ...target, deptName, majorName });
    if (plan.courses.length === 0) {
      throw planEmpty(target);
    }

    const groups = groupPlan(plan.courses);
    const totalCredits = round(plan.courses.reduce((sum, course) => sum + (course.credit ?? 0), 0));
    const earnedCredits = round(plan.courses.reduce((sum, course) => sum + (course.creditEarned ?? 0), 0));

    return {
      ...plan,
      dept: target.dept,
      major: target.major,
      deptName,
      majorName,
      year: target.year,
      own: own.dept === target.dept && own.major === target.major && own.year === target.year,
      courseCount: plan.courses.length,
      totalCredits,
      earnedCredits,
      groups,
      ...(warning ? { warning } : {}),
      note: '教务系统的方案课程清单是「课程池」：选修课列出的是可选课程全集，通识选修（公选）课不在表内；毕业学分要求以培养方案正文为准。表中「已通过」是当前登录账号本人的成绩，换专业看方案时这一列没有参考意义。'
    };
  }, options);
}

// 通用版学分核对：任意专业都能跑。
// 必修 = 方案池里该平台所有课程学分之和（可靠）；
// 选修 = 方案池不能推出最低要求，必须由调用方用 --elective-major / --elective-general 给，
//        没给就如实标 requirementSource: 'unknown'，不臆造数字。
export async function auditPlan(options = {}) {
  const plan = await getPlan(options);
  const groups = plan.groups;

  const electiveMajor = toNumberOrNull(options.electiveMajor);
  const electiveGeneral = toNumberOrNull(options.electiveGeneral);

  const buckets = groups.map((group) => {
    const kind = group.kind;
    let requiredCredits = null;
    let requirementSource = 'plan';

    if (kind === 'required' || kind === 'limited') {
      requiredCredits = group.credits;
    } else if (kind === 'elective') {
      // 只有「专业选修」和「通识选修」两类能给最低学分，
      // 「实践课/选修课」这类是方案里的可选项，没有独立学分要求。
      const isGeneral = /通识|公共选修|公选/.test(group.category);
      const isMajorElective = /专业选修/.test(group.category);
      const supplied = isGeneral ? electiveGeneral : (isMajorElective ? electiveMajor : null);
      if (supplied !== null) {
        requiredCredits = supplied;
        requirementSource = 'option';
      } else {
        requirementSource = 'unknown';
      }
    }

    const gap = requiredCredits === null ? null : round(Math.max(0, requiredCredits - group.earnedCredits));
    return {
      category: group.category,
      kind,
      requiredCredits,
      requirementSource,
      earnedCredits: group.earnedCredits,
      gap,
      courses: group.courses,
      passedCourses: group.passedCourses,
      pending: group.pending,
      status: gap === null ? 'unknown' : (gap === 0 ? 'done' : group.earnedCredits === 0 ? 'untouched' : 'partial')
    };
  });

  // 通识选修（公选课）不在培养方案课程池里，方案表里查不到已修学分，
  // 只能按调用方给的要求列出来，并在结果里说明这一点。
  const hasGeneralGroup = groups.some((group) => group.kind === 'elective' && /通识|公共选修|公选/.test(group.category));
  if (electiveGeneral !== null && !hasGeneralGroup) {
    buckets.push({
      category: '通识课程-公共通识课/选修课',
      kind: 'elective',
      requiredCredits: electiveGeneral,
      requirementSource: 'option',
      earnedCredits: null,
      gap: electiveGeneral,
      courses: 0,
      passedCourses: 0,
      pending: [],
      status: 'unknown',
      note: '公共选修课不在培养方案课程池里，已修学分请用 henu-cli grade list 查看。'
    });
  }

  const measured = buckets.filter((bucket) => bucket.requiredCredits !== null && bucket.earnedCredits !== null);
  const requiredTotal = round(measured.reduce((sum, bucket) => sum + bucket.requiredCredits, 0));
  const earnedRequired = round(measured.reduce((sum, bucket) => sum + bucket.earnedCredits, 0));
  const gapTotal = round(buckets.filter((bucket) => bucket.gap !== null).reduce((sum, bucket) => sum + bucket.gap, 0));
  const unknown = buckets.filter((bucket) => bucket.requirementSource === 'unknown').map((bucket) => bucket.category);

  return {
    major: plan.majorName,
    majorCode: plan.majorCode,
    dept: { code: plan.dept, name: plan.deptName },
    year: plan.year,
    own: plan.own,
    requiredCredits: requiredTotal,
    earnedCredits: earnedRequired,
    remainingCredits: gapTotal,
    completed: gapTotal === 0 && unknown.length === 0,
    buckets,
    unresolved: unknown.length > 0
      ? {
        categories: unknown,
        note: '这些选修平台的毕业最低学分不在教务系统方案池里，需按培养方案正文指定：--elective-major <专业选修最低学分> --elective-general <通识选修最低学分>。'
      }
      : undefined,
    secondClassroom: {
      requiredCredits: SECOND_CLASSROOM.requiredCredits,
      earnedCredits: toNumberOrNull(options.secondCredits) ?? null,
      note: '第二课堂专项学分不在教务系统里，需自行按标准核对（henu-cli second standard）。'
    },
    planCredits: plan.totalCredits,
    note: '必修平台的要求由教务系统方案池自动求和。方案池里可能同时存在新旧版本课程（例如英语读写译 与 英语读写译(一)），求和结果会高于培养方案正文，所以这个数只作参考；要精确核对请用培养方案正文口径的 grade audit。'
  };
}

export function formatPlanAuditText(audit) {
  const lines = [];
  lines.push(`${audit.major || '未知专业'}（${audit.majorCode || '-'}）${audit.year}级 学分核对（教务系统方案池）`);
  if (audit.dept?.name) lines.push(`院系：${audit.dept.name}${audit.dept.code ? `（${audit.dept.code}）` : ''}`);
  lines.push('');
  lines.push(`${'平台'.padEnd(30)}${'要求'.padStart(7)}${'已修'.padStart(8)}${'缺口'.padStart(7)}`);
  for (const bucket of audit.buckets) {
    const mark = bucket.status === 'done' ? '✓' : bucket.status === 'partial' ? '△' : bucket.status === 'untouched' ? '✗' : '?';
    const required = bucket.requiredCredits === null ? '待定' : String(bucket.requiredCredits);
    const earned = bucket.earnedCredits === null ? '待查' : String(bucket.earnedCredits);
    const gap = bucket.gap === null ? '待定' : String(bucket.gap);
    lines.push(`${mark} ${bucket.category.padEnd(28)}${required.padStart(7)}${earned.padStart(8)}${gap.padStart(7)}`);
  }
  lines.push('');
  lines.push(`已修 ${audit.earnedCredits} / 已知要求 ${audit.requiredCredits} 学分，缺口 ${audit.remainingCredits} 学分`);
  lines.push('口径：必修平台按教务系统方案池求和。方案池常混排新旧版本课程，求和值可能高于培养方案正文，仅供估算。');
  if (audit.unresolved) lines.push(`注意：${audit.unresolved.note}`);

  const pending = audit.buckets.filter((bucket) => bucket.pending.length > 0 && bucket.kind === 'required');
  if (pending.length > 0) {
    lines.push('');
    lines.push('必修平台尚缺：');
    for (const bucket of pending) {
      lines.push(`【${bucket.category}】`);
      for (const item of bucket.pending) {
        lines.push(`  ${item.name} ${item.credit ?? '-'} 学分${item.term ? `（${item.term}）` : ''}`);
      }
    }
  }
  return lines.join('\n');
}

async function withPlanPage(task, options = {}) {
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
      const error = new Error('未登录教务系统，且自动单点登录失败。');
      error.code = 'AUTH_REQUIRED';
      error.hint = '先运行 henu-cli auth login 在浏览器里登录一次统一身份认证，再重试。';
      error.details = { reason: opened.authState.reason, finalUrl: opened.pageState.url };
      throw error;
    }

    const nav = await openJwTabApp(page, {
      tile: HENU.jw.plan.tile,
      menuCode: HENU.jw.plan.menuCode,
      formMarker: HENU.jw.plan.formMarker
    });
    if (!nav.ok) {
      const error = new Error('没能打开培养方案达成度页面。');
      error.code = 'PAGE_UNRECOGNIZED';
      error.hint = '用 henu-cli plan show --headed 重跑一次，确认菜单结构是否变了。';
      error.details = { stage: 'open-plan-tab', reason: nav.reason, finalUrl: opened.pageState.url };
      throw error;
    }

    const frame = page.frames().find((candidate) => candidate.url().includes(HENU.jw.plan.formMarker));
    if (!frame) {
      const error = new Error('培养方案表单帧未加载。');
      error.code = 'PAGE_UNRECOGNIZED';
      error.hint = '稍后重试；若持续失败，跑 henu-cli plan show --headed 观察页面。';
      throw error;
    }

    const own = await readOwnTarget(frame);
    return await task({ page, frame, own });
  } finally {
    await context.close().catch(() => {});
  }
}

// 表单初始值就是当前登录学生自己的 年级 / 院系 / 专业，直接读出来当默认值。
async function readOwnTarget(frame) {
  const raw = await frame.evaluate(() => {
    const value = (name) => document.querySelector(`[name="${name}"]`)?.value ?? '';
    const text = (name) => document.querySelector(`[name="${name}"]`)?.selectedOptions?.[0]?.text ?? '';
    return {
      year: value('nj'),
      dept: value('yxdm'),
      major: value('zydm'),
      deptNameRaw: text('yxdm'),
      majorNameRaw: text('zydm'),
      xh: value('xh'),
      xn: value('xn'),
      xq: value('xq_m'),
      xn1: value('xn1'),
      term: value('_xq'),
      menuCode: value('menucode_current')
    };
  });

  return {
    year: raw.year,
    dept: raw.dept,
    major: raw.major,
    deptName: stripCode(raw.deptNameRaw),
    majorName: stripCode(raw.majorNameRaw),
    xh: raw.xh,
    xn: raw.xn,
    xq: raw.xq,
    xn1: raw.xn1,
    term: raw.term,
    menuCode: raw.menuCode
  };
}

async function fetchPlan(frame, target) {
  const result = await frame.evaluate(async (payload) => {
    const form = document.querySelector('form');
    const action = form?.getAttribute('action') || '/taglib/DataTable.jsp';
    const read = (name) => document.querySelector(`[name="${name}"]`)?.value ?? '';

    const body = new URLSearchParams({
      initQry: '0',
      xh: read('xh'),
      xn: read('xn'),
      xq_m: read('xq_m'),
      xn1: read('xn1'),
      _xq: read('_xq'),
      nj: payload.year,
      yxdm: payload.dept,
      zydm: payload.major,
      zyfxdm: '',
      ck_px: payload.order,
      menucode_current: read('menucode_current') || 'S40301'
    });

    const response = await fetch(action, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
      body: body.toString()
    });

    // 这个接口固定回 GBK，用 response.text() 会得到乱码
    const html = new TextDecoder('gbk').decode(await response.arrayBuffer());
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const rows = [...doc.querySelectorAll('table tr')].map((tr) => [...tr.querySelectorAll('th,td')]
      .map((cell) => (cell.textContent || '').replace(/\s+/g, ' ').trim()));

    return {
      status: response.status,
      action,
      deptName: payload.deptName || '',
      majorName: payload.majorName || '',
      rows,
      textHead: (doc.body?.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 300)
    };
  }, { year: target.year, dept: target.dept, major: target.major, order: target.order, deptName: target.deptName ?? '', majorName: target.majorName ?? '' });

  const parsed = parsePlanRows(result.rows);
  return {
    ...parsed,
    status: result.status,
    tableAction: result.action,
    deptName: result.deptName,
    majorName: result.majorName,
    textHead: result.textHead
  };
}

async function readSelectOptions(frame, id) {
  return frame.evaluate((selectId) => {
    const select = document.getElementById(selectId) || document.querySelector(`[name="${selectId.replace('sel_', '')}"]`);
    if (!select) return [];
    return [...select.options]
      .map((option) => ({ value: option.value, text: (option.text || '').trim() }))
      .filter((item) => item.value !== '');
  }, id);
}

async function readSelectedText(frame, id) {
  return frame.evaluate((selectId) => {
    const select = document.getElementById(selectId);
    return select?.selectedOptions?.[0]?.text?.trim() ?? '';
  }, id);
}

// 从下拉里按 value 找显示名，用于给结果标注院系/专业中文名
async function readOptionLabel(frame, id, value) {
  if (!value) return '';
  const text = await frame.evaluate(({ selectId, target }) => {
    const select = document.getElementById(selectId);
    if (!select) return '';
    const option = [...select.options].find((item) => item.value === target);
    return option ? (option.text || '').trim() : '';
  }, { selectId: id, target: value });
  return stripCode(text);
}

// 院系下拉联动专业下拉，改完要触发 change 让页面重新拉专业列表。
async function selectValue(frame, id, value, page) {
  await frame.evaluate(({ selectId, selectValue: next }) => {
    const select = document.getElementById(selectId);
    if (!select) return;
    select.value = next;
    select.dispatchEvent(new Event('change', { bubbles: true }));
    if (window.jQuery) window.jQuery(select).trigger('change');
    if (typeof select.onchange === 'function') select.onchange();
  }, { selectId: id, selectValue: value });
  await page.waitForTimeout(1800);
}

function stripCode(text) {
  return String(text ?? '').replace(/^\[\w+\]\s*/, '').trim();
}

function toNumberOrNull(value) {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function invalidArgument(message) {
  const error = new Error(message);
  error.code = 'INVALID_ARGUMENT';
  throw error;
}

function planEmpty(target) {
  const error = new Error(`没有取到 ${target.year} 级 院系${target.dept} 专业${target.major} 的培养方案课程。`);
  error.code = 'PLAN_NOT_FOUND';
  error.hint = '该年级/专业可能没有在教务系统里配置方案。先用 henu-cli plan majors --dept <院系代码> 确认专业代码，或换一个年级再试。';
  error.details = target;
  return error;
}

export function dumpPlanDiagnostics(frameRows) {
  // 原来是裸数组，包一层才能带上 requestId（只能靠它把 dump 和报错对上）
  return writeDiagnostics('plan', { requestId: getRequestId(), frames: frameRows });
}

export { formatPlanText };
