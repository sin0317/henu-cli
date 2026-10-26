import { existsSync } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';

import { AUTH_CHECK_URL, CAS_CHECK_URL, HENU } from '../config.js';
import { classifyAuthPage } from './auth-detector.js';
import { assertBrowserAvailable, getSelectedBrowser } from './browser.js';
import { getLaunchOptions, importPlaywright } from './browser-options.js';
import { getProfilePath } from './paths.js';
import { readPageState, settlePage } from './page.js';

export async function loginWithBrowserProfile(options = {}) {
  const browser = getSelectedBrowser();
  const profilePath = getProfilePath(browser.id);
  const url = options.url ?? HENU.casUrl;

  await mkdir(profilePath, { recursive: true });

  const { chromium } = await importPlaywright();
  const context = await chromium.launchPersistentContext(profilePath, getLaunchOptions({ headless: false }));

  try {
    const page = context.pages()[0] ?? await context.newPage();
    await page.goto(url, { waitUntil: 'domcontentloaded' });

    if (options.waitForClose !== false) {
      await new Promise((resolve) => context.once('close', resolve));
    }

    return {
      opened: true,
      closed: true,
      browser: browser.id,
      profilePath,
      url: page.url(),
      message: '请在打开的浏览器里正常登录，完成后关闭窗口，再运行 henu-cli auth status 验证。'
    };
  } finally {
    await context.close().catch(() => {});
  }
}

export async function getAuthStatus(options = {}) {
  const browser = assertBrowserAvailable({ persist: false });
  const profilePath = getProfilePath(browser.id);
  const checkedUrl = options.url ?? AUTH_CHECK_URL;

  if (!existsSync(profilePath)) {
    return withLoginHint({
      loggedIn: false,
      reason: 'profile-missing',
      profileExists: false,
      profilePath,
      checkedUrl
    });
  }

  const { chromium } = await importPlaywright();
  const context = await chromium.launchPersistentContext(
    profilePath,
    getLaunchOptions({ headless: options.headless ?? true })
  );

  try {
    const page = context.pages()[0] ?? await context.newPage();

    const jw = await probe(page, checkedUrl);
    if (jw.loggedIn) {
      return withLoginHint({
        loggedIn: true,
        reason: 'jw-session',
        jw: jw.reason,
        profileExists: true,
        profilePath,
        checkedUrl,
        finalUrl: jw.finalUrl
      });
    }

    const cas = await probe(page, CAS_CHECK_URL);
    return withLoginHint({
      loggedIn: cas.loggedIn,
      reason: cas.loggedIn ? 'cas-session-only' : jw.reason,
      jw: jw.reason,
      cas: cas.reason,
      profileExists: true,
      profilePath,
      checkedUrl,
      finalUrl: jw.finalUrl
    });
  } finally {
    await context.close().catch(() => {});
  }
}

export async function logoutBrowserProfile() {
  const browser = getSelectedBrowser();
  const profilePath = getProfilePath(browser.id);
  const profileExisted = existsSync(profilePath);

  try {
    await rm(profilePath, { recursive: true, force: true });
  } catch (cause) {
    const error = new Error('清理登录态失败。');
    error.code = 'AUTH_LOGOUT_FAILED';
    error.hint = '请先关闭 henu-cli 打开的浏览器窗口，再执行 henu-cli auth logout。';
    error.cause = cause;
    throw error;
  }

  return { loggedOut: true, profileExisted, profilePath };
}

async function probe(page, url) {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await settlePage(page, { timeoutMs: 5000 });
  const state = await readPageState(page);
  return { ...classifyAuthPage(state), finalUrl: state.url };
}

function withLoginHint(status) {
  const hintoFor = () => {
    switch (status.reason) {
      case 'profile-missing':
        return '还没有登录过，先运行 henu-cli auth login。';
      case 'cas-session-only':
        return '统一身份认证已登录，但教务系统会话尚未建立；直接运行 course list 会自动单点。';
      case 'unknown':
        return '无法确认登录态，可用 henu-cli auth login 重新登录一次。';
      default:
        return '登录态无效，运行 henu-cli auth login 登录一次。';
    }
  };

  return {
    ...status,
    status: status.loggedIn
      ? 'authenticated'
      : status.reason === 'unknown' ? 'unknown' : 'unauthenticated',
    ...(status.loggedIn ? {} : { hint: hintoFor() })
  };
}
