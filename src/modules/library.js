import { HENU } from '../config.js';
import { assertBrowserAvailable } from './browser.js';
import { getLaunchOptions, importPlaywright } from './browser-options.js';
import { getJson, postJson } from './http.js';
import { normalizeAccount, normalizeSearch, normalizeSeats } from './library-parser.js';
import { getProfilePath } from './paths.js';

// 检索接口能认的检索点。keyWord=任意词（含主题词、目录），title=题名，author=责任者。
const SEARCH_FIELDS = {
  keyword: 'keyWord',
  title: 'title',
  author: 'author'
};

// 馆藏检索：纯 HTTP。注意必须带 groupcode 头，否则服务端不知道查哪个馆，numFound 恒为 0。
export async function searchLibrary(options = {}) {
  const keyword = String(options.keyword ?? '').trim();
  if (!keyword) {
    const error = new Error('需要检索词。');
    error.code = 'INVALID_ARGUMENT';
    error.hint = '例如：henu-cli library search 药物化学 --field title';
    throw error;
  }

  const field = String(options.field ?? 'keyword').toLowerCase();
  if (!SEARCH_FIELDS[field]) {
    const error = new Error(`不支持的检索点：${field}`);
    error.code = 'INVALID_ARGUMENT';
    error.hint = `可选：${Object.keys(SEARCH_FIELDS).join(' / ')}。`;
    throw error;
  }

  const page = clampNumber(options.page, 1, 1, 50);
  const rows = clampNumber(options.rows, 10, 1, 50);

  const payload = await postJson(`${HENU.library.opac}${HENU.library.searchApi}`, {
    docCode: [null], litCode: [], searchFieldContent: keyword, searchField: SEARCH_FIELDS[field],
    matchMode: '2', resourceType: [], subject: [], discode1: [], publisher: [], libCode: [],
    locationId: [], eCollectionIds: [], neweCollectionIds: [], curLocationId: [], campusId: [],
    kindNo: [], collectionName: [], author: [], langCode: [], countryCode: [],
    publishBegin: null, publishEnd: null, coreInclude: [], ddType: [], verifyStatus: [], group: [],
    sortField: 'relevance', sortClause: 'asc', page, rows,
    onlyOnShelf: null, searchItems: null, newCoreInclude: [], customSub: [], customSub0: [], indexSearch: 1
  }, {
    headers: {
      groupcode: HENU.library.groupCode,
      'x-lang': 'CHI',
      Referer: `${HENU.library.opac}/`
    }
  });

  if (payload?.success === false) {
    const error = new Error(payload?.message ?? '检索失败');
    error.code = 'BACKEND_UNAVAILABLE';
    error.details = { keyword, field, payload: payload?.message };
    throw error;
  }

  return normalizeSearch(payload, { keyword, field, page });
}

// 我的借阅：超星的单点链路依赖浏览器里的 CAS 会话，所以走 Playwright。
// 打开 init 地址 → 自动用 CAS 换超星票据 → 落到 #/personalExternal/5，
// 页面建立好会话后，再在同一个 origin 里直接调三个接口。
export async function getLibraryAccount(options = {}) {
  const browser = assertBrowserAvailable();
  const { chromium } = await importPlaywright();

  const context = await chromium.launchPersistentContext(getProfilePath(browser.id), {
    ...getLaunchOptions({ headless: options.headless ?? true }),
    // 图书馆的 ELib 网关（login.lib.henu.edu.cn）证书换签时会有过期窗口，
    // 校内用户浏览器里点“继续访问”就过了，这里等价放行。
    ignoreHTTPSErrors: true,
    viewport: { width: 1400, height: 950 }
  });

  try {
    const page = context.pages()[0] ?? await context.newPage();
    await page.goto(HENU.library.ssoInitUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });

    const landed = await waitForMyLibrary(page, options.timeoutMs ?? 30000);
    if (!landed.ok) {
      const error = new Error('没能进入「我的借阅」，通常是统一身份认证没有登录态。');
      error.code = landed.authRequired ? 'AUTH_REQUIRED' : 'PAGE_UNRECOGNIZED';
      error.hint = landed.authRequired
        ? '先运行 henu-cli auth login 在浏览器里登录一次统一身份认证，再重试。'
        : '用 henu-cli library account --headed 看页面停在哪一步（超星单点地址可能改版）。';
      error.details = { finalUrl: page.url(), reason: landed.reason };
      throw error;
    }

    const raw = await page.evaluate(async (config) => {
      const headers = { 'Content-Type': 'application/json;charset=UTF-8', 'x-lang': 'CHI' };
      const get = async (path) => (await fetch(config.opac + path, { headers })).text();
      const post = async (path, body) => (await fetch(config.opac + path, {
        method: 'POST',
        headers,
        body: JSON.stringify(body)
      })).text();

      const loanBody = { page: 1, rows: 50, searchType: 1, searchContent: '', sortType: 0, startDate: null, endDate: null };
      return {
        userInfo: await get(config.userInfoApi),
        loan: await post(config.loanApi, loanBody),
        history: config.withHistory ? await post(config.loanHistoryApi, { ...loanBody, rows: 20 }) : null
      };
    }, {
      opac: HENU.library.opac,
      userInfoApi: HENU.library.userInfoApi,
      loanApi: HENU.library.loanApi,
      loanHistoryApi: HENU.library.loanHistoryApi,
      withHistory: Boolean(options.history)
    });

    const userInfo = safeParse(raw.userInfo);
    if (!userInfo?.data?.user) {
      const error = new Error('拿到了页面，但接口返回的不是借阅人信息。');
      error.code = 'AUTH_REQUIRED';
      error.hint = '超星会话可能已失效，重新运行 auth login 后再试。';
      error.details = { preview: String(raw.userInfo ?? '').slice(0, 160) };
      throw error;
    }

    return normalizeAccount({
      userInfo,
      loan: safeParse(raw.loan),
      history: options.history ? safeParse(raw.history) : null
    });
  } finally {
    await context.close().catch(() => {});
  }
}

// 座位预约（超星 zwyy）：校区/楼层空闲数接口是公开的，不需要登录。
export async function getSeatAvailability(options = {}) {
  const day = normalizeDay(options.day);

  const payload = await postJson(`${HENU.library.seat.base}${HENU.library.seat.campusApi}`, { day }, {
    headers: { Referer: HENU.library.seat.home }
  });

  if (payload?.code !== 0) {
    const error = new Error(payload?.message ?? '座位接口返回异常');
    error.code = 'BACKEND_UNAVAILABLE';
    error.details = { day, payload: payload?.message };
    throw error;
  }

  const result = normalizeSeats(payload, { day });
  const campus = String(options.campus ?? '').trim();
  if (!campus) return result;

  const matched = result.campuses.filter((item) => item.name.includes(campus));
  if (matched.length === 0) {
    const error = new Error(`没有这个校区的座位数据：${campus}`);
    error.code = 'INVALID_ARGUMENT';
    error.hint = `可选：${result.campuses.map((item) => item.name).join(' / ') || '（接口没返回校区）'}。`;
    throw error;
  }

  const free = matched.reduce((sum, item) => sum + item.free, 0);
  const total = matched.reduce((sum, item) => sum + item.total, 0);
  return {
    ...result,
    filter: { campus },
    campuses: matched,
    free,
    total
  };
}

async function waitForMyLibrary(page, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let sawAuthPage = false;

  while (Date.now() < deadline) {
    const url = page.url();
    if (/personalExternal|personalCenter/.test(url)) {
      return { ok: true };
    }
    if (/authserver\/login|ids\.henu\.edu\.cn\/authserver/.test(url)) {
      sawAuthPage = true;
    }
    await page.waitForTimeout(500);
  }

  const body = await page.locator('body').innerText().catch(() => '');
  return {
    ok: false,
    authRequired: sawAuthPage || /身份认证|统一认证|登录/.test(body.slice(0, 200)),
    reason: /参数缺失/.test(body) ? 'sso-refer-missing' : 'timeout'
  };
}

function normalizeDay(value) {
  const text = String(value ?? '').trim();
  if (text === '') {
    return new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    const error = new Error(`日期格式不对：${text}`);
    error.code = 'INVALID_ARGUMENT';
    error.hint = '用 --day 2026-10-27 这种格式；不传则取今天。';
    throw error;
  }
  return text;
}

function safeParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function clampNumber(value, fallback, min, max) {
  const text = String(value ?? '').trim();
  if (text === '') return fallback;
  const parsed = Number(text);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(Math.trunc(parsed), min), max);
}
