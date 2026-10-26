import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { CURRICULUM } from './curriculum.js';
import { getAuthStatus, loginWithBrowserProfile, logoutBrowserProfile } from './modules/auth.js';
import { getBrowserStatus, selectBrowser, installManagedChromium } from './modules/browser.js';
import { getCourseList, getCourseStatus, getTodayCourses, getTodayWeekday } from './modules/course.js';
import { exportCourseIcs } from './modules/course-ics.js';
import { formatCourseText } from './modules/course-parser.js';
import { formatIcsSummaryText } from './modules/ics.js';
import { getDoctorReport } from './modules/doctor.js';
import { formatExamTabsText, getExamCapabilities } from './modules/exam.js';
import { formatAuditText, formatGpaText, formatGradeText, getGradeAudit, getGradeGpa, getGradeList } from './modules/grade.js';
import { formatInstallText, installGlobal, resolveSkillTargets } from './modules/install.js';
import { getLibraryAccount, getSeatAvailability, searchLibrary } from './modules/library.js';
import { formatNextCourseText, getNextCourse } from './modules/next-course.js';
import { formatAccountText, formatSearchText, formatSeatText } from './modules/library-parser.js';
import {
  formatNoticeListText,
  formatNoticeSearchText,
  formatNoticeText,
  getNotice,
  listNotices,
  searchNotices
} from './modules/notice.js';
import { errorEnvelope, successEnvelope, toErrorShape, writeJson } from './modules/output.js';
import {
  auditPlan,
  formatPlanAuditText,
  formatPlanText,
  getPlan,
  listDepartments,
  listMajors
} from './modules/plan.js';
import { getFreeRooms, getRoomGrid } from './modules/room.js';
import { formatRoomGridText, MAX_PERIOD, summarizeRooms } from './modules/room-parser.js';
import {
  SECOND_CLASSROOM,
  checkSecondClassroom,
  formatSecondCheckText,
  formatSecondStandardText
} from './second-classroom.js';
import { getSkillPath, installSkill, getSkillTargets } from './modules/skill.js';

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const HELP = `henu-cli —— 河南大学校园服务的命令行工具（面向 AI Agent）

用法：
  henu-cli <命令> [子命令] [参数]

环境与登录
  doctor [--verbose]                     检查环境、浏览器与网络连通性
  auth login [--url <地址>]              打开浏览器完成登录，登录态保存在本地 profile
  auth status [--headed]                 检查登录态是否有效
  auth logout                            清除本地登录态

浏览器
  browser status                         查看各浏览器可用性与 profile 路径
  browser use <chrome|edge|chromium>     指定使用哪个浏览器
  browser install chromium --yes         安装 Playwright Chromium

课表
  course list [--weekday 1-7] [--headed] [--dump] [--text]
  course today [--headed] [--dump] [--text] 只看今天的课
  course next [--headed] [--dump] [--text]  下一节课是哪门、几点、在哪、还有多久
  course ics [--start 2026-09-07 | --week-now 8] [--schedule auto|winter|summer]
             [--out <文件>] [--text]
             导出 .ics 日历（手机/电脑日历可直接导入）；
             第 1 周周一给过一次就按学期记在本地
  course status                          登录态与课表可读性检查

空教室
  room grid --building 金明综合楼5 --week 9 [--weekday 3] [--period 3-4]
            [--campus 金明] [--text]
            按小节给出「教室 × 节次」占用矩阵（推荐用这个）；
            留用教室、预约占用都算非空闲，--period 给定时直接列出全空的教室
  room free [--campus 明伦|金明|郑州|其他] [--weekday 3] [--period 1-4]
            [--week 1-18] [--parity 单周|双周] [--type 多媒体]
            [--building 金明综合楼] [--min 1] [--max 200]
            [--include-reserved] [--headed] [--dump] [--text]
            --period 是一天 13 小节内的编号，缺省为全部；
            --weekday 缺省今天，--max 缺省 100 人；
            --week 缺省 1-18 表示「每一周都空」，查具体某周请显式给 --week
  room options                           列出校区/教室类型/楼房的可用取值

成绩与毕业学分
  grade list [--headed] [--dump]          入学以来全部成绩（有效成绩、主修）
  grade audit [--headed] [--dump] [--text] 对照培养方案核对毕业学分缺口
  grade gpa [--headed] [--dump] [--text]   平均学分绩点、加权平均分、按平台绩点
  grade plan                              打印内置的培养方案学分要求

培养方案（任意专业 / 任意年级）
  plan depts                             列出全部院系代码
  plan majors [--dept 0031]              列出该院系下的专业代码
  plan show [--dept 0031] [--major 0116] [--year 2023]
            [--order term|module] [--text] [--headed]
            不传参数时用你自己登录账号的院系/专业/年级
  plan audit [--dept 0031] [--major 0116] [--year 2023]
             [--elective-major 17] [--elective-general 10]
             [--second-credits 0] [--text] [--headed]
             必修平台由教务系统方案池自动求和；
             选修平台的最低学分方案池推不出，需用 --elective-* 指定

第二课堂
  second standard                        打印「第二课堂」专项学分项目一览表
  second check --items 社会实践,普通话    按项目核对是否够 5 学分
                                      支持「名称」「名称:学分」两种写法

考试
  exam tabs [--headed] [--text]           列出「课程考试」模块的可用入口

公文通
  notice list [--channel all|school|academic|jwc] [--limit 10] [--page 1] [--text]
                                         学校公告/学术公告/教务处通知（公开页面，无需登录）
  notice search <关键词> [--channel ...] [--days 30 | --since 2026-09-01]
                [--pages 3] [--limit 10] [--text]
                                         按标题检索；关键词用空格分隔表示同时命中
  notice show --url <公告地址> [--text]   取公告正文

图书馆
  library search <检索词> [--field keyword|title|author] [--rows 10] [--page 1] [--text]
                                         馆藏检索（超星 LSP），返回馆藏/在架册数与索书号
  library account [--history] [--headed] [--text]
                                         我的借阅：证件状态、可借数、当前借阅、借阅历史
  library seat [--day 2026-10-27] [--campus 金明|明伦] [--text]
                                         座位预约各校区/楼层空闲数

其他
  skill path                             打印随包 skill 路径
  skill install [--target ${getSkillTargets().join('|')}|all]
                                         只安装随包 skill
  install [--target ${getSkillTargets().join('|')}|all] [--no-skill] [--prefix <目录>] [--text]
                                         全局安装本 CLI，并顺手装上随包 skill

说明：
  - 不保存账号密码，登录由你在浏览器里完成，CLI 只复用登录态。
  - 所有命令默认输出 JSON；--headed 用于排障时显示浏览器窗口。
`;

export async function run(argv) {
  const packageInfo = await readPackageInfo();

  if (argv.length === 0 || argv.includes('--help') || argv.includes('-h')) {
    process.stdout.write(HELP);
    return 0;
  }

  if (argv.includes('--version') || argv.includes('-v')) {
    process.stdout.write(`${packageInfo.version}\n`);
    return 0;
  }

  const [domain, action] = argv;
  const rest = argv.slice(2);

  switch (domain) {
    case 'install': {
      const options = {
        target: getOption(argv, '--target'),
        prefix: getOption(argv, '--prefix'),
        skipSkill: hasFlag(argv, '--no-skill')
      };
      if (hasFlag(argv, '--text')) {
        return emitText('install', () => installGlobal(options), formatInstallText);
      }
      return emit('install', () => installGlobal(options));
    }

    case 'doctor':
      return emit('doctor', () => getDoctorReport({ verbose: hasFlag(argv, '--verbose') }));

    case 'browser':
      return handleBrowser(action, rest, argv);

    case 'auth':
      return handleAuth(action, rest, argv);

    case 'course':
      return handleCourse(action, rest, argv);

    case 'room':
      return handleRoom(action, rest, argv);

    case 'grade':
      return handleGrade(action, rest, argv);

    case 'plan':
      return handlePlan(action, rest, argv);

    case 'second':
      return handleSecond(action, rest, argv);

    case 'exam':
      return handleExam(action, argv);

    case 'notice':
      return handleNotice(action, rest, argv);

    case 'library':
      return handleLibrary(action, rest, argv);

    case 'skill':
      return handleSkill(action, rest);

    default:
      process.stderr.write(`未知命令：${domain}\n\n${HELP}`);
      return 2;
  }
}

function handleBrowser(action, rest, argv) {
  if (action === 'status') {
    return emit('browser.status', () => getBrowserStatus());
  }
  if (action === 'use') {
    return emit('browser.use', () => selectBrowser(rest[0]));
  }
  if (action === 'install' && rest.includes('chromium')) {
    return emit('browser.install', () => installManagedChromium({ yes: hasFlag(argv, '--yes') }));
  }
  return usageError(`browser 子命令：status | use <id> | install chromium --yes`);
}

function handleAuth(action, rest, argv) {
  if (action === 'login') {
    return emit('auth.login', () => loginWithBrowserProfile({
      url: getOption(argv, '--url'),
      waitForClose: !hasFlag(argv, '--no-wait')
    }));
  }
  if (action === 'status') {
    return emit('auth.status', () => getAuthStatus({
      url: getOption(argv, '--url'),
      headless: !hasFlag(argv, '--headed')
    }));
  }
  if (action === 'logout') {
    return emit('auth.logout', () => logoutBrowserProfile());
  }
  return usageError('auth 子命令：login | status | logout');
}

function handleCourse(action, rest, argv) {
  const options = {
    headless: !hasFlag(argv, '--headed'),
    dump: hasFlag(argv, '--dump')
  };

  if (action === 'list') {
    const query = { ...options, weekday: getOption(argv, '--weekday') };
    if (hasFlag(argv, '--text')) {
      return emitText('course.list', () => getCourseList(query), formatCourseText);
    }
    return emit('course.list', () => getCourseList(query));
  }
  if (action === 'today') {
    const query = { ...options, weekday: getTodayWeekday() };
    if (hasFlag(argv, '--text')) {
      return emitText('course.today', () => getTodayCourses(options), formatCourseText, { weekday: getTodayWeekday() });
    }
    return emit('course.today', () => getTodayCourses(options), { weekday: getTodayWeekday() });
  }
  if (action === 'ics') {
    const query = {
      ...options,
      start: getOption(argv, '--start'),
      weekNow: getOption(argv, '--week-now'),
      schedule: getOption(argv, '--schedule'),
      out: getOption(argv, '--out')
    };
    if (hasFlag(argv, '--text')) {
      return emitText('course.ics', () => exportCourseIcs(query), formatIcsSummaryText);
    }
    return emit('course.ics', () => exportCourseIcs(query));
  }
  if (action === 'next') {
    if (hasFlag(argv, '--text')) {
      return emitText('course.next', () => getNextCourse(options), formatNextCourseText);
    }
    return emit('course.next', () => getNextCourse(options));
  }
  if (action === 'status') {
    return emit('course.status', () => getCourseStatus({ headless: true }));
  }
  return usageError('course 子命令：list | today | next | ics | status');
}

function handleRoom(action, rest, argv) {
  if (action === 'options') {
    return emit('room.options', () => ({
      campuses: [
        { value: '明伦', code: '01' },
        { value: '金明', code: '02' },
        { value: '郑州', code: '03' },
        { value: '其他', code: '04' }
      ],
      roomTypes: [
        { value: '不安排教室', code: '00' },
        { value: '一般教室', code: '01' },
        { value: '多媒体教室', code: '05' },
        { value: '师范生实训中心教室', code: '06' }
      ],
      buildings: [
        '7号教学楼', '计算机大楼', '金明综合楼1', '金明综合楼2', '金明综合楼3',
        '金明综合楼4', '金明综合楼5', '金明综合楼6', '九章学堂北楼B座',
        '九章学堂南楼B座', '十号楼', '友兰学堂北楼B座', '友兰学堂南楼B座',
        '友兰学堂南楼C座', '曾宪梓楼', '综合教学楼'
      ],
      defaults: {
        period: `不指定=全部 1-${MAX_PERIOD} 小节`,
        weekday: '今天',
        week: '1-18（表示全学期每一周都空的交集，查具体某周请显式给 --week）',
        min: 1,
        max: 100,
        reserved: '默认不含设置为留用的教室，--include-reserved 可放开'
      }
    }));
  }

  if (action === 'grid') {
    const options = {
      headless: !hasFlag(argv, '--headed'),
      campus: getOption(argv, '--campus'),
      building: getOption(argv, '--building'),
      weekday: getOption(argv, '--weekday'),
      week: getOption(argv, '--week'),
      period: getOption(argv, '--period')
    };

    if (hasFlag(argv, '--text')) {
      return emitText('room.grid', () => getRoomGrid(options), formatRoomGridText);
    }
    return emit('room.grid', () => getRoomGrid(options));
  }

  if (action === 'free') {
    const options = {
      headless: !hasFlag(argv, '--headed'),
      dump: hasFlag(argv, '--dump'),
      campus: getOption(argv, '--campus'),
      weekday: getOption(argv, '--weekday'),
      period: getOption(argv, '--period'),
      week: getOption(argv, '--week'),
      parity: getOption(argv, '--parity'),
      roomType: getOption(argv, '--type'),
      building: getOption(argv, '--building'),
      min: getOption(argv, '--min'),
      max: getOption(argv, '--max'),
      excludeReserved: !hasFlag(argv, '--include-reserved')
    };

    if (hasFlag(argv, '--text')) {
      return emitText('room.free', () => getFreeRooms(options));
    }
    return emit('room.free', () => getFreeRooms(options));
  }

  return usageError('room 子命令：grid | free | options');
}

function handleGrade(action, rest, argv) {
  const options = {
    headless: !hasFlag(argv, '--headed'),
    dump: hasFlag(argv, '--dump')
  };

  if (action === 'plan') {
    return emit('grade.plan', () => ({
      major: CURRICULUM.major,
      majorCode: CURRICULUM.majorCode,
      gradeYear: CURRICULUM.gradeYear,
      totalCredits: CURRICULUM.totalCredits,
      planNote: CURRICULUM.planNote,
      buckets: CURRICULUM.buckets.map((bucket) => ({
        id: bucket.id,
        label: bucket.label,
        requiredCredits: bucket.requiredCredits,
        courseCount: bucket.courses.length,
        ...(bucket.note ? { note: bucket.note } : {})
      }))
    }));
  }

  if (action === 'list') {
    if (hasFlag(argv, '--text')) {
      return emitText('grade.list', () => getGradeList(options), formatGradeText);
    }
    return emit('grade.list', () => getGradeList(options));
  }

  if (action === 'audit') {
    if (hasFlag(argv, '--text')) {
      return emitText('grade.audit', () => getGradeAudit(options), formatAuditText);
    }
    return emit('grade.audit', () => getGradeAudit(options));
  }

  if (action === 'gpa') {
    if (hasFlag(argv, '--text')) {
      return emitText('grade.gpa', () => getGradeGpa(options), formatGpaText);
    }
    return emit('grade.gpa', () => getGradeGpa(options));
  }

  return usageError('grade 子命令：list | audit | gpa | plan');
}

function handlePlan(action, rest, argv) {
  const options = {
    headless: !hasFlag(argv, '--headed'),
    dept: getOption(argv, '--dept'),
    major: getOption(argv, '--major'),
    year: getOption(argv, '--year'),
    order: getOption(argv, '--order'),
    electiveMajor: getOption(argv, '--elective-major'),
    electiveGeneral: getOption(argv, '--elective-general'),
    secondCredits: getOption(argv, '--second-credits')
  };

  if (action === 'depts') {
    return emit('plan.depts', () => listDepartments());
  }
  if (action === 'majors') {
    return emit('plan.majors', () => listMajors(options.dept));
  }
  if (action === 'show') {
    if (hasFlag(argv, '--text')) {
      return emitText('plan.show', () => getPlan(options), (plan) => formatPlanText(plan, { courses: plan.courses }));
    }
    return emit('plan.show', () => getPlan(options));
  }
  if (action === 'audit') {
    if (hasFlag(argv, '--text')) {
      return emitText('plan.audit', () => auditPlan(options), formatPlanAuditText);
    }
    return emit('plan.audit', () => auditPlan(options));
  }
  return usageError('plan 子命令：depts | majors | show | audit');
}

function handleSecond(action, rest, argv) {
  if (action === 'standard') {
    return emitText('second.standard', async () => SECOND_CLASSROOM, formatSecondStandardText);
  }
  if (action === 'check') {
    const items = collectList(argv, '--items');
    if (items.length === 0) {
      return usageError('second check 需要 --items，例如：--items 社会实践,普通话,学科前沿讲座');
    }
    if (hasFlag(argv, '--json')) {
      return emit('second.check', () => checkSecondClassroom(items));
    }
    return emitText('second.check', () => checkSecondClassroom(items), formatSecondCheckText);
  }
  return usageError('second 子命令：standard | check --items 社会实践,普通话');
}

function handleExam(action, argv) {
  if (action === 'tabs') {
    const options = { headless: !hasFlag(argv, '--headed') };
    if (hasFlag(argv, '--text')) {
      return emitText('exam.tabs', () => getExamCapabilities(options), formatExamTabsText);
    }
    return emit('exam.tabs', () => getExamCapabilities(options));
  }
  return usageError('exam 子命令：tabs');
}

function handleNotice(action, rest, argv) {
  // 公文通全是公开页面，走 fetch 直连，不启动浏览器
  const meta = { backend: 'http' };

  if (action === 'list') {
    const options = {
      channel: getOption(argv, '--channel'),
      limit: getOption(argv, '--limit'),
      page: getOption(argv, '--page')
    };
    if (hasFlag(argv, '--text')) {
      return emitText('notice.list', () => listNotices(options), formatNoticeListText, meta);
    }
    return emit('notice.list', () => listNotices(options), meta);
  }

  if (action === 'search') {
    const options = {
      keyword: rest[0] ?? getOption(argv, '--keyword'),
      channel: getOption(argv, '--channel'),
      limit: getOption(argv, '--limit'),
      pages: getOption(argv, '--pages'),
      since: getOption(argv, '--since'),
      days: getOption(argv, '--days')
    };
    if (hasFlag(argv, '--text')) {
      return emitText('notice.search', () => searchNotices(options), formatNoticeSearchText, meta);
    }
    return emit('notice.search', () => searchNotices(options), meta);
  }

  if (action === 'show') {
    const options = { url: getOption(argv, '--url') ?? rest[0] };
    if (hasFlag(argv, '--text')) {
      return emitText('notice.show', () => getNotice(options), formatNoticeText, meta);
    }
    return emit('notice.show', () => getNotice(options), meta);
  }

  return usageError('notice 子命令：list [--channel ...] | search <关键词> | show --url <公告地址>');
}

function handleLibrary(action, rest, argv) {
  if (action === 'search') {
    const options = {
      keyword: rest[0] ?? getOption(argv, '--keyword'),
      field: getOption(argv, '--field'),
      rows: getOption(argv, '--rows'),
      page: getOption(argv, '--page')
    };
    const meta = { backend: 'http' };
    if (hasFlag(argv, '--text')) {
      return emitText('library.search', () => searchLibrary(options), formatSearchText, meta);
    }
    return emit('library.search', () => searchLibrary(options), meta);
  }

  if (action === 'account') {
    const options = {
      headless: !hasFlag(argv, '--headed'),
      history: hasFlag(argv, '--history')
    };
    if (hasFlag(argv, '--text')) {
      return emitText('library.account', () => getLibraryAccount(options), formatAccountText);
    }
    return emit('library.account', () => getLibraryAccount(options));
  }

  if (action === 'seat') {
    const options = { day: getOption(argv, '--day'), campus: getOption(argv, '--campus') };
    const meta = { backend: 'http' };
    if (hasFlag(argv, '--text')) {
      return emitText('library.seat', () => getSeatAvailability(options), formatSeatText, meta);
    }
    return emit('library.seat', () => getSeatAvailability(options), meta);
  }

  return usageError('library 子命令：search <检索词> | account | seat');
}

function handleSkill(action, rest) {
  if (action === 'path') {
    process.stdout.write(`${getSkillPath()}\n`);
    return 0;
  }
  if (action === 'install') {
    return emit('skill.install', async () => {
      const targets = resolveSkillTargets(getOption(rest, '--target'));
      const installed = [];
      for (const target of targets) {
        const result = await installSkill({ target });
        installed.push({ target, destination: result.destination });
      }
      return installed.length === 1
        ? { installed: true, ...installed[0] }
        : { installed: true, targets: installed };
    });
  }
  return usageError('skill 子命令：path | install [--target <name>|all]');
}

async function emit(command, task, meta = {}) {
  try {
    const data = await task();
    writeJson(successEnvelope(data, { command, ...meta }));
    return 0;
  } catch (error) {
    writeJson(errorEnvelope(toErrorShape(error), { command, ...meta }));
    return error instanceof Error ? exitCodeFor(error.code) : 1;
  }
}

async function emitText(command, task, formatter = summarizeRooms, meta = {}) {
  try {
    const data = await task();
    process.stdout.write(`${formatter(data)}\n`);
    return 0;
  } catch (error) {
    writeJson(errorEnvelope(toErrorShape(error), { command, ...meta }));
    return error instanceof Error ? exitCodeFor(error.code) : 1;
  }
}

function exitCodeFor(code) {
  switch (code) {
    case 'AUTH_REQUIRED':
      return 3;
    case 'INVALID_ARGUMENT':
      return 2;
    case 'BROWSER_UNAVAILABLE':
    case 'BACKEND_UNAVAILABLE':
    case 'INSTALL_FAILED':
    case 'BROWSER_INSTALL_FAILED':
    case 'BROWSER_INSTALL_CONFIRM_REQUIRED':
      return 4;
    case 'PAGE_UNRECOGNIZED':
      return 5;
    case 'PLAN_NOT_FOUND':
      return 6;
    default:
      return 1;
  }
}

function usageError(message) {
  process.stderr.write(`${message}\n`);
  return 2;
}

function hasFlag(argv, flag) {
  return argv.includes(flag);
}

function getOption(argv, name) {
  const index = argv.indexOf(name);
  if (index === -1) {
    return undefined;
  }
  const value = argv[index + 1];
  return value && !value.startsWith('--') ? value : undefined;
}

// --items 支持逗号分隔，也支持重复出现多次
function collectList(argv, name) {
  const out = [];
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] !== name) continue;
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) continue;
    out.push(...value.split(/[,，]/).map((item) => item.trim()).filter(Boolean));
  }
  return out;
}

async function readPackageInfo() {
  const raw = await readFile(join(PACKAGE_ROOT, 'package.json'), 'utf8');
  return JSON.parse(raw);
}
