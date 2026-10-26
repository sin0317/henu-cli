import { HENU } from '../config.js';
import { assertBrowserAvailable } from './browser.js';
import { getLaunchOptions, importPlaywright } from './browser-options.js';
import { listJwTileTabs, openJwPage } from './jw.js';
import { getProfilePath } from './paths.js';

// 河大教务系统学生端的「课程考试」只有三项：申请缓考 / 查看缓考信息 / 申请补考。
// 没有「考试安排查询」入口，也没有 ksap.* 的考试安排页（逐个试过，全部 404）。
// 所以这个命令不假装能查考场，而是把系统里真实的入口列出来，并说明去哪拿考试安排。
export async function getExamCapabilities(options = {}) {
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

    const listed = await listJwTileTabs(page, { tile: HENU.jw.exam.tile });
    if (!listed.ok) {
      const error = new Error('没能打开「课程考试」模块。');
      error.code = 'PAGE_UNRECOGNIZED';
      error.hint = '用 henu-cli exam tabs --headed 观察页面，确认首页 tile 编码是否变化。';
      error.details = listed;
      throw error;
    }

    const hasSchedule = listed.tabs.some((tab) => /考试安排|考场|考试查询/.test(tab.label));

    return {
      tile: HENU.jw.exam.tile,
      tabs: listed.tabs,
      examScheduleAvailable: hasSchedule,
      capability: hasSchedule
        ? '系统里出现了考试安排入口，可以用 exam tabs 的 menuCode 继续解析。'
        : '教务系统学生端没有「考试安排查询」入口，只有缓考/补考申请与查看。',
      note: hasSchedule
        ? undefined
        : '期末考试安排由教务处/学院另行发布（教务处通知公告、学院群、辅导员通知），教务系统里查不到考场和座位。'
    };
  } finally {
    await context.close().catch(() => {});
  }
}

export function formatExamTabsText(result) {
  const lines = [];
  lines.push(`「课程考试」模块（tile ${result.tile}）可用入口：`);
  for (const tab of result.tabs) {
    lines.push(`  ${tab.menuCode ?? '-'}  ${tab.label}`);
  }
  lines.push('');
  lines.push(result.capability);
  if (result.note) lines.push(result.note);
  return lines.join('\n');
}
