import { HENU } from '../config.js';
import { classifyAuthPage } from './auth-detector.js';
import { readPageState, settlePage } from './page.js';

// 打开教务系统某个页面；若未登录，尝试通过登录页上的“统一认证登录”走 CAS 单点。
// 这里不碰账号密码：单点依赖浏览器 profile 里已有的 CAS 会话。
export async function openJwPage(page, targetUrl, options = {}) {
  const settleMs = options.settleMs ?? 6000;

  await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await settlePage(page, { timeoutMs: settleMs });

  let pageState = await readPageState(page);
  let authState = classifyAuthPage(pageState);
  if (authState.loggedIn) {
    return { pageState, authState };
  }

  const sso = await trySsoLogin(page);

  // 单点成功后浏览器停在教务首页，青果的会话跟当前页面绑定，
  // 这里不能为了“回到目标页”再跳一次首页，否则会把刚建立的会话丢掉。
  pageState = await readPageState(page);
  authState = classifyAuthPage(pageState);
  if (!authState.loggedIn) {
    return { pageState, authState, sso };
  }

  if (targetUrl !== HENU.jw.base) {
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await settlePage(page, { timeoutMs: settleMs });
    pageState = await readPageState(page);
    authState = classifyAuthPage(pageState);
  }

  return { pageState, authState, sso };
}

// 青果教务的功能页不允许深链（直接 GET 会 405），必须从左侧菜单点进去。
export async function openJwMenuApp(page, options = {}) {
  const group = options.group;
  const item = options.item;
  const dataMarker = options.dataMarker;

  const menuFrame = await waitForFrame(page, options.menuMarker ?? '/menu/', options.menuTimeoutMs ?? 20000);
  if (!menuFrame) {
    return { ok: false, reason: 'menu-frame-missing' };
  }

  await clickByText(menuFrame, group);
  await page.waitForTimeout(options.expandWaitMs ?? 1500);
  await clickByText(menuFrame, item);

  const dataFrame = await waitForFrame(page, dataMarker, options.dataTimeoutMs ?? 20000);
  if (!dataFrame) {
    return { ok: false, reason: 'data-frame-missing', menuFrame: menuFrame.url() };
  }

  await settlePage(page, { timeoutMs: 3000 });
  return { ok: true, dataFrame, menuFrame: menuFrame.url() };
}

// 青果首页的“公共查询”这类入口是首页 tile 卡片：点 #SB 后菜单帧会导航到
// frame/menus/SVGSB.jsp，菜单项用绝对定位布局且默认 visibility:hidden，
// 所以必须 force 点击，不能依赖可见性判断。
export async function openJwPublicQuery(page, options = {}) {
  const menuCode = options.menuCode;
  const moduleId = options.moduleId;
  const formMarker = options.formMarker;
  const timeoutMs = options.timeoutMs ?? 25000;

  const menuFrame = await waitForFrame(page, options.menuMarker ?? '/menu/', options.menuTimeoutMs ?? 20000);
  if (!menuFrame) {
    return { ok: false, reason: 'menu-frame-missing' };
  }

  const tile = menuFrame.locator(`#${menuCode}`).first();
  if ((await tile.count()) === 0) {
    return { ok: false, reason: `menu-tile-missing:${menuCode}` };
  }
  await tile.click({ timeout: 15000, force: true });

  // 菜单帧会导航到 SVGSB.jsp，等模块卡片出现
  const item = menuFrame.locator(`#${moduleId}`).first();
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if ((await item.count()) > 0) break;
    await page.waitForTimeout(300);
  }
  if ((await item.count()) === 0) {
    return { ok: false, reason: `module-missing:${moduleId}`, menuFrame: menuFrame.url() };
  }

  await item.click({ timeout: 15000, force: true });

  const formFrame = await waitForFrame(page, formMarker, timeoutMs);
  if (!formFrame) {
    return { ok: false, reason: 'form-frame-missing', menuFrame: menuFrame.url() };
  }

  await settlePage(page, { timeoutMs: 1500 });
  return { ok: true, formFrame: formFrame.url(), menuFrame: menuFrame.url() };
}

// 首页 tile 点开后，菜单帧会换成 teacherstudentmenu.jsp?menucode=xxx 的 tab 页，
// tab 用 onclick="switchMenu('1','S40303','学业成绩')" 切换内容帧。
// 这和左侧菜单树的 openJwMenuApp 不是一套结构，必须分开处理。
export async function openJwTabApp(page, options = {}) {
  const tile = options.tile;
  const menuCode = options.menuCode;
  const formMarker = options.formMarker;

  const menuFrame = await waitForFrame(page, options.menuMarker ?? '/menu/', options.menuTimeoutMs ?? 20000);
  if (!menuFrame) {
    return { ok: false, reason: 'menu-frame-missing' };
  }

  const tileNode = menuFrame.locator(`#${tile}`).first();
  if ((await tileNode.count()) === 0) {
    return { ok: false, reason: `menu-tile-missing:${tile}` };
  }
  await tileNode.click({ timeout: 15000, force: true });
  await page.waitForTimeout(options.tileWaitMs ?? 3000);

  const tab = menuFrame.locator(`a[onclick*="${menuCode}"]`).first();
  if ((await tab.count()) === 0) {
    return { ok: false, reason: `menu-tab-missing:${menuCode}`, menuFrame: menuFrame.url() };
  }
  await tab.click({ timeout: 15000, force: true });

  const formFrame = await waitForFrame(page, formMarker, options.formTimeoutMs ?? 25000);
  if (!formFrame) {
    return { ok: false, reason: 'form-frame-missing', menuFrame: menuFrame.url() };
  }

  await settlePage(page, { timeoutMs: 2000 });
  return { ok: true, formFrame, menuFrame: menuFrame.url() };
}

// 只点开首页 tile，把 tab 列表读出来，不进入具体功能页。
// 用途：确认某个业务下到底有哪些入口（例如「课程考试」只有缓考/补考）。
export async function listJwTileTabs(page, options = {}) {
  const tile = options.tile;
  const menuFrame = await waitForFrame(page, options.menuMarker ?? '/menu/', options.menuTimeoutMs ?? 20000);
  if (!menuFrame) {
    return { ok: false, reason: 'menu-frame-missing' };
  }

  const tileNode = menuFrame.locator(`#${tile}`).first();
  if ((await tileNode.count()) === 0) {
    return { ok: false, reason: `menu-tile-missing:${tile}`, menuFrame: menuFrame.url() };
  }
  await tileNode.click({ timeout: 15000, force: true });
  await page.waitForTimeout(options.tileWaitMs ?? 2500);

  const tabs = await menuFrame.evaluate(() => [...document.querySelectorAll('a[onclick*="switchMenu"]')]
    .map((node) => {
      const onclick = node.getAttribute('onclick') || '';
      const match = onclick.match(/switchMenu\('(\d+)','([^']+)','([^']*)'\)/);
      return {
        index: match ? Number(match[1]) : null,
        menuCode: match ? match[2] : null,
        label: match ? match[3] : (node.innerText || '').trim(),
        onclick
      };
    }));

  return { ok: true, tile, menuFrame: menuFrame.url(), tabs };
}

async function waitForFrame(page, marker, timeoutMs) {  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const frame = page.frames().find((candidate) => candidate.url().includes(marker));
    if (frame) {
      return frame;
    }
    await page.waitForTimeout(400);
  }
  return null;
}

async function clickByText(frame, text) {
  const target = frame.locator(`text=${text}`).first();
  await target.click({ timeout: 10000 });
}

async function trySsoLogin(page) {
  try {
    await page.goto(HENU.jw.base, { waitUntil: 'domcontentloaded', timeout: 30000 });
    // 登录按钮的 click 处理器由 loginbar.js 绑定，等它加载完再点。
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(1200);

    const byId = page.locator(HENU.jw.ssoSelector).first();
    const trigger = (await byId.count()) > 0 ? byId : page.getByText('统一认证登录').first();
    if ((await trigger.count()) === 0) {
      return { ok: false, reason: 'no-sso-button' };
    }

    await trigger.click({ timeout: 10000 });
    await page.waitForURL(/frame\/homes/, { timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(1500);

    const state = await readPageState(page);
    const auth = classifyAuthPage(state);
    return { ok: auth.loggedIn, reason: auth.reason, finalUrl: state.url };
  } catch (cause) {
    return { ok: false, reason: cause.message };
  }
}
