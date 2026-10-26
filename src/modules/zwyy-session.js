// zwyy（座位/研讨室预约系统）的会话。
//
// 难点：这套系统的登录态既不在 cookie 里，也不走密码。
// 实测出来的链路是：
//   1. 打开 https://zwyy.henu.edu.cn/h5/index.html
//   2. 页面自己发现没登录，跳 CAS；因为浏览器 profile 里已有统一身份认证会话，
//      一路 302 回来，前端拿 ticket 调 /v4/login/user 换 JWT
//   3. JWT 写进 sessionStorage.token，之后所有请求带 authorization: bearer<JWT>
// 所以只要把它从 sessionStorage 里读出来，后面就能用纯 HTTP 快调，不必一直挂着浏览器。
//
// 边界：
//   - token 只在内存里传递，不落盘（我们本来也不保存账号密码）；
//   - 失效时最多重新取一次再重试，不做循环重试——循环重试遇到「需要验证码」
//     会把用户锁在外面，还可能触发风控。

import { HENU } from '../config.js';
import { assertBrowserAvailable } from './browser.js';
import { getLaunchOptions, importPlaywright } from './browser-options.js';
import { getProfilePath } from './paths.js';

const BASE = HENU.library.seat.base;

export async function getZwyyToken(options = {}) {
  const browser = assertBrowserAvailable();
  const profilePath = getProfilePath(browser.id);
  const { chromium } = await importPlaywright();

  const context = await chromium.launchPersistentContext(profilePath, {
    ...getLaunchOptions({ headless: options.headless ?? true }),
    ignoreHTTPSErrors: true,
    viewport: { width: 1400, height: 950 }
  });

  try {
    const page = context.pages()[0] ?? await context.newPage();
    await page.goto(HENU.library.seat.home.split('#')[0], {
      waitUntil: 'domcontentloaded',
      timeout: options.timeoutMs ?? 45000
    });

    // 单点要跳好几跳（CAS → ticket → /v4/login/user → 首页），500ms 轮询比猜选择器稳。
    const deadline = Date.now() + (options.settleMs ?? 25000);
    let token = '';
    let sawAuthPage = false;

    while (Date.now() < deadline) {
      token = await readToken(page);
      if (token) break;

      const url = page.url();
      if (/authserver\/login|ids\.henu\.edu\.cn/.test(url)) sawAuthPage = true;
      await page.waitForTimeout(500);
    }

    if (!token) {
      throw authError(sawAuthPage, page.url(), options);
    }

    const user = await readUser(page);
    return { token, user, source: 'browser-profile' };
  } finally {
    await context.close().catch(() => {});
  }
}

/**
 * 带 token 调一次 zwyy 接口。
 * 10001（未登录）时重新取一次 token 再重试一次，仍然失败才抛出。
 */
export async function callZwyy(path, payload = {}, options = {}) {
  const token = await ensureToken(options);
  let response = await post(token, path, payload);

  if (response?.code === 10001 && options.retry !== false) {
    options.token = null;
    const fresh = await ensureToken({ ...options, retry: false });
    response = await post(fresh, path, payload);
  }

  if (response?.code !== 0) {
    const error = new Error(response?.message ?? '座预约系统返回异常');
    error.code = response?.code === 10001 ? 'AUTH_REQUIRED' : 'BACKEND_UNAVAILABLE';
    error.hint = response?.code === 10001
      ? '浏览器里的统一身份认证登录态可能过期了，运行 henu-cli auth login 重新登录一次。'
      : '接口可能改版或临时故障，稍后重试。';
    error.details = { path, code: response?.code, message: response?.message };
    throw error;
  }

  return response;
}

async function ensureToken(options) {
  if (options.token) return options.token;
  const session = await getZwyyToken(options);
  options.token = session.token;
  options._user = session.user;
  return session.token;
}

async function post(token, path, payload) {
  const response = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json;charset=UTF-8',
      authorization: `bearer${token}`,
      Referer: BASE,
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
        + '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 henu-cli'
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const error = new Error(`请求返回 ${response.status}：${path}`);
    error.code = 'BACKEND_UNAVAILABLE';
    error.details = { path, status: response.status };
    throw error;
  }

  try {
    return await response.json();
  } catch {
    const error = new Error(`返回内容不是 JSON：${path}`);
    error.code = 'PAGE_UNRECOGNIZED';
    error.hint = '座位预约系统接口可能改版，提 issue 时把这条命令的 --dump 结果带上。';
    error.details = { path };
    throw error;
  }
}

async function readToken(page) {
  return page.evaluate(() => sessionStorage.getItem('token') || '').catch(() => '');
}

async function readUser(page) {
  const raw = await page.evaluate(() => sessionStorage.getItem('UserInfo') || '').catch(() => '');
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return {
      id: parsed?.id ?? null,
      name: parsed?.name ?? null,
      role: parsed?.roleName ?? null,
      dept: parsed?.deptName ?? null
    };
  } catch {
    return null;
  }
}

function authError(sawAuthPage, finalUrl, options) {
  const error = new Error(sawAuthPage
    ? '浏览器里没有可用的统一身份认证登录态。'
    : '没能拿到座位预约系统的 token，通常是单点没走完。');
  error.code = 'AUTH_REQUIRED';
  error.hint = sawAuthPage
    ? '运行 henu-cli auth login 在浏览器里登录一次统一身份认证，再重试。'
    : '用 --headed 重跑一次看页面停在哪一步；也可以先 henu-cli auth status 确认登录态。';
  error.details = { finalUrl, headless: options.headless ?? true };
  return error;
}
