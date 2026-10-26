// 解析博达 VSB 站群的公告列表页与详情页。
// 三个来源（学校公告 / 学术公告 / 教务处）模板不同，但骨架一致：
// 列表是 <li> → <a href="...info/NNNN/MMMM.htm" title="标题"> → 标题 + 日期；
// 详情是 <h1>标题</h1> + <div id="vsb_content">正文</div>。
// 所以这里不按站点写三套正则，而是按“块内找链接、找标题、找日期”的通用方式抽。

const BLOCK = /<li\b[\s\S]*?<\/li>/gi;
const ANCHOR = /<a\b[^>]*href="([^"#]+)"[^>]*>([\s\S]*?)<\/a>/i;
const TITLE_ATTR = /\btitle="([^"]*)"/i;
const TITLE_SPAN = /class="[^"]*article-title[^"]*"[^>]*>([\s\S]*?)<\/span>/i;
const TITLE_H4 = /<h4[^>]*>([\s\S]*?)<\/h4>/i;
const DATE = /(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})/;

export function parseNoticeList(html, options = {}) {
  const pageUrl = options.pageUrl ?? '';
  const source = options.source ?? null;
  const items = [];
  const seen = new Set();

  for (const block of html.match(BLOCK) ?? []) {
    const anchor = ANCHOR.exec(block);
    if (!anchor) continue;

    const href = anchor[1].trim();
    if (!/info\/|content\.jsp/i.test(href)) continue;

    const title = cleanText(
      firstMatch(TITLE_ATTR, block)
      ?? firstMatch(TITLE_SPAN, block)
      ?? firstMatch(TITLE_H4, block)
      ?? stripTags(anchor[2])
    );
    if (!title) continue;

    const dateMatch = DATE.exec(stripTags(block));
    const url = resolveUrl(href, pageUrl);
    if (!url || seen.has(url)) continue;
    seen.add(url);

    items.push({
      title,
      date: dateMatch ? toIsoDate(dateMatch) : null,
      url,
      ...(source ? { source } : {})
    });
  }

  return items;
}

export function parseNoticeDetail(html, options = {}) {
  const title = cleanText(firstMatch(/<h1[^>]*>([\s\S]*?)<\/h1>/i, html)
    ?? firstMatch(/<title>([\s\S]*?)<\/title>/i, html) ?? '');

  const bodyHtml = extractContent(html);
  const images = collectImages(bodyHtml, options.url);
  const text = htmlToText(bodyHtml);

  // 详情页的发布单位/日期通常在标题下方，取标题之后最早出现的日期
  const tail = html.slice(html.search(/<\/h1>/i) >= 0 ? html.search(/<\/h1>/i) : 0);
  const dateMatch = DATE.exec(stripTags(tail).slice(0, 400));

  // 不少学术公告整篇是一张海报图，正文提取不到文字是正常的，
  // 这时把图片地址交出去，不要当成解析失败。
  const body = text === '' && images.length > 0
    ? `[正文为图片，共 ${images.length} 张，请在浏览器里看图或用 OCR]\n${images.join('\n')}`
    : text;

  return {
    title,
    ...(options.url ? { url: options.url } : {}),
    ...(dateMatch ? { date: toIsoDate(dateMatch) } : {}),
    text: body,
    chars: text.length,
    images,
    ...(options.source ? { source: options.source } : {})
  };
}

function collectImages(html, pageUrl) {
  const urls = [];
  for (const match of html.matchAll(/<img\b[^>]*\bsrc="([^"]+)"/gi)) {
    const src = match[1].trim();
    if (!src || /^data:/i.test(src)) continue;
    try {
      const absolute = new URL(src, pageUrl ?? 'https://www.henu.edu.cn/').toString();
      if (!urls.includes(absolute)) urls.push(absolute);
    } catch {
      // 相对地址都拼不上就跳过，不影响正文
    }
  }
  return urls;
}

// 正文容器：博达默认 id="vsb_content"，部分模板用 class="v_news_content"。
// 容器里还有嵌套 div，正则截不准，改成按标签深度配对。
function extractContent(html) {
  const idIndex = html.search(/<div[^>]*id="vsb_content"/i);
  const classIndex = idIndex === -1 ? html.search(/<div[^>]*class="[^"]*v_news_content/i) : -1;
  const start = idIndex !== -1 ? idIndex : classIndex;
  if (start === -1) return html;
  return sliceBalancedDiv(html, start);
}

function sliceBalancedDiv(html, start) {
  const re = /<div\b[^>]*>|<\/div>/gi;
  re.lastIndex = start;
  let depth = 0;
  let match;
  while ((match = re.exec(html))) {
    depth += match[0][1] === '/' ? -1 : 1;
    if (depth === 0) return html.slice(start, match.index + match[0].length);
  }
  return html.slice(start);
}

export function htmlToText(html) {
  return decodeEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|h[1-6]|tr|table|section)>/gi, '\n')
      .replace(/<li[^>]*>/gi, '\n- ')
      .replace(/<[^>]+>/g, '')
  )
    .split('\n')
    .map((line) => line.replace(/[ \t\u00a0]+/g, ' ').trim())
    .filter((line, index, all) => line !== '' || (all[index - 1] ?? '') !== '')
    .join('\n')
    .trim();
}

export function stripTags(html) {
  return html.replace(/<[^>]+>/g, ' ');
}

export function cleanText(value) {
  return decodeEntities(stripTags(value ?? '')).replace(/\s+/g, ' ').trim();
}

export function decodeEntities(text) {
  return text
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&amp;/gi, '&')
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => safeChar(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => safeChar(Number(dec)));
}

function safeChar(code) {
  try {
    return String.fromCodePoint(code);
  } catch {
    return '';
  }
}

function firstMatch(pattern, text) {
  const match = pattern.exec(text ?? '');
  return match ? match[1] : null;
}

function resolveUrl(href, pageUrl) {
  try {
    return new URL(href, pageUrl).toString();
  } catch {
    return null;
  }
}

function toIsoDate(match) {
  const [, year, month, day] = match;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}
