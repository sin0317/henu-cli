import { HENU } from '../config.js';
import { fetchText } from './http.js';
import { parseNoticeDetail, parseNoticeList } from './notice-parser.js';

export const NOTICE_CHANNELS = Object.entries(HENU.notice.sources).map(([id, source]) => ({
  id,
  label: source.label,
  listUrl: source.listUrl
}));

// 公文通 = 学校公告 + 学术公告 + 教务处通知。三处都是公开页面，
// 所以这里不碰浏览器，直接抓 HTML 解析，单次请求 100~300ms。
export async function listNotices(options = {}) {
  const channel = normalizeChannel(options.channel);
  const limit = clampNumber(options.limit, 10, 1, 50);
  const startPage = clampNumber(options.page, 1, 1, 50);

  const ids = channel === 'all' ? Object.keys(HENU.notice.sources) : [channel];
  const collected = [];

  for (const id of ids) {
    const source = HENU.notice.sources[id];
    const items = await collectFromSource(id, source, channel === 'all' ? Math.min(limit, 7) : limit, startPage);
    collected.push(...items);
  }

  const merged = dedupe(collected).sort(byDateDesc).slice(0, limit);
  return {
    channel,
    channels: NOTICE_CHANNELS,
    page: startPage,
    count: merged.length,
    items: merged
  };
}

// 关键词检索：公告没有搜索接口，只能把最近若干页抓下来在本地过滤。
// 因为列表是日期倒序的，扫到比 --since 更早的一页就可以停。
export async function searchNotices(options = {}) {
  const keyword = String(options.keyword ?? '').trim();
  if (!keyword) {
    const error = new Error('需要检索关键词。');
    error.code = 'INVALID_ARGUMENT';
    error.hint = '例如：henu-cli notice search 考试 --days 30 --text';
    throw error;
  }

  const terms = keyword.split(/[\s+，,]+/).filter(Boolean);
  const channel = normalizeChannel(options.channel);
  const limit = clampNumber(options.limit, 10, 1, 50);
  const maxPages = clampNumber(options.pages, 3, 1, 20);
  const since = normalizeSince(options);

  const match = (item) => noticeMatches(item, terms);

  const ids = channel === 'all' ? Object.keys(HENU.notice.sources) : [channel];
  const stats = { scanned: 0 };
  const collected = [];

  for (const id of ids) {
    const source = HENU.notice.sources[id];
    const items = await collectFromSource(id, source, limit, 1, { maxPages, since, match, stats });
    collected.push(...items);
  }

  const matched = dedupe(collected)
    .filter(match)
    .filter((item) => !since || !item.date || item.date >= since)
    .sort(byDateDesc)
    .slice(0, limit);

  return {
    keyword,
    terms,
    channel,
    ...(since ? { since } : {}),
    pages: maxPages,
    scanned: stats.scanned,
    count: matched.length,
    items: matched
  };
}

// 检索规则：只比标题，多个关键词之间是「且」，大小写不敏感。
export function noticeMatches(item, terms) {
  const title = String(item?.title ?? '').toLowerCase();
  return (terms ?? []).every((term) => title.includes(String(term).toLowerCase()));
}

export async function getNotice(options = {}) {
  const url = String(options.url ?? '').trim();
  if (!url) {
    const error = new Error('需要公告地址。');
    error.code = 'INVALID_ARGUMENT';
    error.hint = '先运行 henu-cli notice list 拿到 url，再 notice show --url <地址>。';
    throw error;
  }

  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    const error = new Error(`不是合法的公告地址：${url}`);
    error.code = 'INVALID_ARGUMENT';
    error.hint = '地址要以 http:// 或 https:// 开头，可以直接用 notice list 输出里的 url。';
    throw error;
  }
  if (!/\.henu\.edu\.cn$/i.test(parsed.hostname)) {
    const error = new Error(`只支持河大域名下的公告：${parsed.hostname}`);
    error.code = 'INVALID_ARGUMENT';
    error.hint = '公告正文只在校内站群，外部链接请直接在浏览器打开。';
    throw error;
  }

  const html = await fetchText(parsed.toString());

  // 教务处的 content.jsp 是动态页：直连会被学校接的电信云 WAF 拦成 405，
  // 服务端拿到的则是博达的「系统提示 / 抱歉」占位页（浏览器里也一样）。
  // 这类地址只能人工在浏览器打开，直接说清楚，别让 Agent 以为是自己解析错了。
  if (/NWAF页面|Method Not Allowed|网站安全防护/.test(html.slice(0, 4000))
    || /<title>\s*系统提示\s*<\/title>/i.test(html)) {
    const error = new Error('该公告地址是动态页（content.jsp），被网站安全防护拦截，取不到正文。');
    error.code = 'BACKEND_UNAVAILABLE';
    error.hint = '教务处列表里 content.jsp 开头的链接都是这个情况；优先用 info/ 开头的公告地址，'
      + '或者直接把链接发给用户，让他在浏览器里打开。';
    error.details = { url: parsed.toString() };
    throw error;
  }

  const detail = parseNoticeDetail(html, { url: parsed.toString(), source: guessSource(parsed.hostname) });
  if (!detail.text) {
    const error = new Error('没能从页面里取到正文。');
    error.code = 'PAGE_UNRECOGNIZED';
    error.hint = '页面模板可能改版，用浏览器打开确认正文容器是否还是 #vsb_content。';
    error.details = { url: parsed.toString(), chars: detail.chars };
    throw error;
  }
  return detail;
}

async function collectFromSource(id, source, limit, startPage, extra = {}) {
  const firstUrl = source.listUrl;
  let firstHtml;
  try {
    firstHtml = await fetchText(firstUrl);
  } catch (cause) {
    if (cause?.code === 'BACKEND_UNAVAILABLE') return [];
    throw cause;
  }

  const { maxPages = 8, since = null, match = null, stats = null } = extra;
  const items = [];
  const push = (list) => {
    for (const item of list) {
      if (!items.some((known) => known.url === item.url)) items.push(item);
    }
  };

  // 博达的分页是「倒着编号」的：最新的在第 754 页，第 1 页是 2007 年的存档。
  // 所以第 1 页用栏目首页，第 k 页（k>=2）对应 total-k+1 这个物理页码。
  const total = findLastPage(firstHtml, source);
  let scanned = 0;
  const firstPage = parseNoticeList(firstHtml, { pageUrl: firstUrl, source: id });
  scanned += firstPage.length;
  if (startPage <= 1) {
    push(firstPage);
  }

  let emptyPages = 0;
  const lastWanted = Math.min(startPage + Math.max(maxPages, 1) - 1, total);
  for (let page = Math.max(startPage, 2); page <= lastWanted; page += 1) {
    // 检索时按「已经找到足够条数」或「已经翻过 since」提前停
    if (match && items.filter(match).length >= limit) break;
    if (!match && items.length >= limit) break;

    const physical = total - page + 1;
    if (physical < 1) break;

    const pageUrl = new URL(source.pagePattern.replace('{page}', physical), firstUrl).toString();
    let parsedItems = [];
    try {
      parsedItems = parseNoticeList(await fetchText(pageUrl), { pageUrl, source: id });
    } catch (cause) {
      if (cause?.code !== 'BACKEND_UNAVAILABLE') throw cause;
      break;
    }
    scanned += parsedItems.length;

    const before = items.length;
    push(parsedItems);
    emptyPages = items.length === before ? emptyPages + 1 : 0;
    // 连续两页都是重复内容，说明已经翻到重叠区，停
    if (emptyPages >= 2) break;
    // 本页最早的一条已经早于 since，后面的只会更早，停
    if (since && oldestDate(parsedItems) && oldestDate(parsedItems) < since) break;
  }

  if (stats) stats.scanned += scanned;
  return items;
}

function oldestDate(items) {
  const dates = items.map((item) => item.date).filter(Boolean).sort();
  return dates[0] ?? null;
}

// 从列表页的「尾页」链接里读出最大页码（也就是最新一页的物理编号）
function findLastPage(html, source) {
  const folder = source.pagePattern.split('/')[0];
  const pattern = new RegExp(`${folder}/(\\d+)\\.htm`, 'g');
  let max = 1;
  for (const match of html.matchAll(pattern)) {
    max = Math.max(max, Number(match[1]));
  }
  return max;
}

export function formatNoticeListText(result) {
  const lines = [];
  const label = result.channel === 'all'
    ? '全部栏目'
    : (result.channels.find((item) => item.id === result.channel)?.label ?? result.channel);
  lines.push(`公文通 · ${label}（第 ${result.page} 页起，共 ${result.count} 条）`);
  lines.push('');

  if (result.count === 0) {
    lines.push('没有取到公告，稍后重试或换个栏目。');
    return lines.join('\n');
  }

  for (const item of result.items) {
    const tag = item.source ? `[${result.channels.find((c) => c.id === item.source)?.label ?? item.source}] ` : '';
    lines.push(`${item.date ?? '----------'}  ${tag}${item.title}`);
    lines.push(`            ${item.url}`);
  }
  return lines.join('\n');
}

export function formatNoticeSearchText(result) {
  const lines = [];
  const label = result.channel === 'all'
    ? '全部栏目'
    : (NOTICE_CHANNELS.find((item) => item.id === result.channel)?.label ?? result.channel);
  const window = result.since ? `${result.since} 之后` : `最近 ${result.pages} 页/栏目`;
  lines.push(`公文通检索「${result.keyword}」· ${label} · ${window}`);
  lines.push(`扫描 ${result.scanned} 条，命中 ${result.count} 条`);
  lines.push('');

  if (result.count === 0) {
    lines.push('没有命中。可以放宽条件：加大 --pages（翻更多页）、去掉 --days，或换更短的词。');
    return lines.join('\n');
  }

  for (const item of result.items) {
    const tag = item.source ? `[${NOTICE_CHANNELS.find((c) => c.id === item.source)?.label ?? item.source}] ` : '';
    lines.push(`${item.date ?? '----------'}  ${tag}${item.title}`);
    lines.push(`            ${item.url}`);
  }
  return lines.join('\n');
}

export function formatNoticeText(detail) {
  const lines = [];
  lines.push(detail.title);
  if (detail.date || detail.source) {
    lines.push([detail.date, detail.source].filter(Boolean).join(' · '));
  }
  if (detail.url) lines.push(detail.url);
  lines.push('');
  lines.push(detail.text);
  return lines.join('\n');
}

function normalizeChannel(value) {
  const raw = String(value ?? 'all').trim();
  if (!raw || raw === 'all' || raw === '全部') return 'all';

  const byId = Object.keys(HENU.notice.sources).find((id) => id === raw);
  if (byId) return byId;

  const byLabel = Object.entries(HENU.notice.sources).find(([, source]) => source.label === raw);
  if (byLabel) return byLabel[0];

  const error = new Error(`未知栏目：${raw}`);
  error.code = 'INVALID_ARGUMENT';
  error.hint = `可选：${NOTICE_CHANNELS.map((c) => `${c.id}(${c.label})`).join('、')}。`;
  throw error;
}

// --since / --days 都归一成一个日期下限；不传则不限时间。
function normalizeSince(options = {}) {
  const raw = String(options.since ?? '').trim();
  if (raw) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(raw) || Number.isNaN(Date.parse(`${raw}T00:00:00Z`))) {
      const error = new Error(`--since 日期格式不对：${raw}`);
      error.code = 'INVALID_ARGUMENT';
      error.hint = '用 --since 2026-09-01 这种格式，或者改用 --days 30。';
      throw error;
    }
    return raw;
  }

  const daysRaw = String(options.days ?? '').trim();
  if (daysRaw === '') return null;

  const days = Number(daysRaw);
  if (!Number.isFinite(days) || days < 1 || days > 365) {
    const error = new Error(`--days 取值不合法：${daysRaw}`);
    error.code = 'INVALID_ARGUMENT';
    error.hint = '--days 是「最近多少天」，取值 1~365。';
    throw error;
  }

  // 按东八区算「今天」，再往前推 N-1 天，这样 --days 30 正好覆盖 30 个自然日（含今天）
  const today = new Date(Date.now() + 8 * 3600 * 1000);
  today.setUTCDate(today.getUTCDate() - (Math.trunc(days) - 1));
  return today.toISOString().slice(0, 10);
}

function guessSource(hostname) {
  if (/^jwc\./i.test(hostname)) return 'jwc';
  return undefined;
}

function dedupe(items) {
  const seen = new Set();
  return items.filter((item) => {
    if (seen.has(item.url)) return false;
    seen.add(item.url);
    return true;
  });
}

function byDateDesc(a, b) {
  return String(b.date ?? '').localeCompare(String(a.date ?? ''));
}

function clampNumber(value, fallback, min, max) {
  const text = String(value ?? '').trim();
  if (text === '') return fallback;
  const parsed = Number(text);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(Math.trunc(parsed), min), max);
}
