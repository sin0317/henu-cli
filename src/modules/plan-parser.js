// 培养方案表格的纯解析层：不碰浏览器，便于单测。
//
// 数据来源：教务系统「学业成绩 → 专业培养方案达成度」的 DataTable 接口，
// 表头固定为：课程类别 / 课程属性 / 标识 / 课程 / 学分 / 总学时 / 考核方式 /
//             开设学期 / 成绩 / 是否通过 / 选课 / 学业完成度
// 「课程」列形如「[00200005]大学英语读写译(一)」，实践环节可能没有课程号。

const HEADER_HINTS = ['课程类别', '学分'];

// 「[03100743]临床药物治疗学概论」→ { code, name }
function splitCourseCell(text) {
  const value = String(text ?? '').trim();
  const match = value.match(/^\[([0-9A-Za-z]+)\]\s*(.*)$/);
  if (match) {
    return { code: match[1], name: match[2].trim() };
  }
  return { code: null, name: value };
}

function toNumber(value) {
  const text = String(value ?? '').replace(/[^\d.-]/g, '');
  if (text === '') return null;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
}

// 成绩列可能为空、数字、五级制或「通过/不通过」。
// 只有明确「通过」或数值 ≥ 60 才算拿到学分；空着表示还没修。
export function isPassed(row) {
  const flag = String(row.passed ?? '').trim();
  if (flag === '通过') return true;
  if (flag === '不通过' || flag === '未通过') return false;

  const score = String(row.score ?? '').trim();
  if (score === '') return false;
  if (/^(优秀|优|良好|良|中等|中|及格|合格|通过)$/.test(score)) return true;
  if (/^(不及格|不合格|不通过|缺考|缓考|作弊)$/.test(score)) return false;

  const numeric = toNumber(score);
  return numeric !== null && numeric >= 60;
}

export function parsePlanRows(rows) {
  if (!Array.isArray(rows) || rows.length === 0) {
    return { courses: [], header: [] };
  }

  const headerIndex = rows.findIndex((row) => HEADER_HINTS.every((hint) => row.join('').includes(hint)));
  const header = headerIndex >= 0 ? rows[headerIndex] : rows[0];
  const body = rows.slice(headerIndex >= 0 ? headerIndex + 1 : 1);

  const courses = [];
  for (const row of body) {
    const category = String(row[0] ?? '').trim();
    const courseCell = String(row[3] ?? '').trim();
    if (!category && !courseCell) continue;
    // 分组小标题行（只有类别，没有课程）跳过，避免当成课程
    if (!courseCell) continue;
    if (/^(合计|小计|总计)/.test(category) || /^(合计|小计|总计)/.test(courseCell)) continue;

    const { code, name } = splitCourseCell(courseCell);
    if (!name) continue;

    const course = {
      category,
      attr: String(row[1] ?? '').trim() || null,
      code,
      name,
      credit: toNumber(row[4]),
      hours: toNumber(row[5]),
      exam: String(row[6] ?? '').trim() || null,
      term: String(row[7] ?? '').trim() || null,
      score: String(row[8] ?? '').trim() || null,
      passedFlag: String(row[9] ?? '').trim() || null,
      selected: String(row[10] ?? '').trim() || null,
      progress: String(row[11] ?? '').trim() || null
    };
    course.passed = isPassed({ score: course.score, passed: course.passedFlag });
    if (!course.passed) course.creditEarned = 0;
    else course.creditEarned = course.credit ?? 0;
    courses.push(course);
  }

  return { courses, header };
}

// 平台类型：青果的课程类别都以「/必修课」「/选修课」结尾，但没有统一的「平台」字段，
// 只能按类别名归类。这里按结尾判断，选修再细分专业选修 / 通识选修。
export function classifyCategory(category) {
  const text = String(category ?? '');
  if (text.endsWith('/必修课') || text.endsWith('/必修')) return 'required';
  if (text.endsWith('/选修课') || text.endsWith('/选修')) return 'elective';
  if (text.endsWith('/限选课')) return 'limited';
  // 实践环节常只写「环节」「实践环节」，没有 /必修课 后缀
  if (/环节/.test(text)) return 'required';
  return 'other';
}

export function groupPlan(courses) {
  const map = new Map();
  for (const course of courses) {
    if (!map.has(course.category)) {
      map.set(course.category, {
        category: course.category,
        kind: classifyCategory(course.category),
        courses: 0,
        credits: 0,
        earnedCredits: 0,
        passedCourses: 0,
        pending: []
      });
    }
    const group = map.get(course.category);
    group.courses += 1;
    group.credits += course.credit ?? 0;
    group.earnedCredits += course.creditEarned ?? 0;
    if (course.passed) {
      group.passedCourses += 1;
    } else {
      group.pending.push({ code: course.code, name: course.name, credit: course.credit, term: course.term });
    }
  }

  return [...map.values()].map((group) => ({
    ...group,
    credits: round(group.credits),
    earnedCredits: round(group.earnedCredits)
  }));
}

// 「已选」「已通过」这类状态在实践环节里常为空，这里给出人话解释。
export function describeProgress(course) {
  if (course.passed) return '已通过';
  if (course.score) return `未通过（${course.score}）`;
  if (course.selected === '已选') return '在修';
  return '未修';
}

export function round(value, digits = 1) {
  const factor = 10 ** digits;
  return Math.round((Number(value) + Number.EPSILON) * factor) / factor;
}

// 人读输出：按平台列课程清单，未通过的单独标注。
export function formatPlanText(plan, options = {}) {
  const limit = options.limit ?? 200;
  const lines = [];
  lines.push(`${plan.majorName || '未知专业'}（${plan.majorCode || '-'}）${plan.year || '-'}级 培养方案`);
  if (plan.deptName) lines.push(`院系：${plan.deptName}${plan.deptCode ? `（${plan.deptCode}）` : ''}`);
  lines.push(`来源：教务系统 培养方案达成度（${plan.courseCount} 门课程 / ${plan.totalCredits} 学分）`);
  lines.push('');

  const groups = options.groups ?? groupPlan(plan.courses);
  for (const group of groups) {
    const kind = group.kind === 'required' ? '必修' : group.kind === 'elective' ? '选修' : group.kind === 'limited' ? '限选' : '其他';
    lines.push(`【${group.category}】${kind} ${group.courses} 门 / ${group.credits} 学分（已通过 ${group.passedCourses} 门 / ${group.earnedCredits} 学分）`);

    const items = plan.courses.filter((course) => course.category === group.category);
    for (const course of items.slice(0, limit)) {
      const mark = course.passed ? '✓' : (course.selected === '已选' ? '△' : ' ');
      const code = course.code ? `[${course.code}]` : '[--]';
      lines.push(`  ${mark} ${code} ${course.name} ${course.credit ?? '-'} 学分 ${describeProgress(course)}`);
    }
    if (items.length > limit) {
      lines.push(`  … 另有 ${items.length - limit} 门未显示（--limit 可调）`);
    }
    lines.push('');
  }

  lines.push(`合计 ${plan.courseCount} 门 / ${plan.totalCredits} 学分，已通过 ${plan.earnedCredits} 学分`);
  if (plan.note) lines.push(plan.note);
  return lines.join('\n').trimEnd();
}
