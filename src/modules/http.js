// 轻量 HTTP 客户端：公文通与图书馆的部分接口是公开的，不需要浏览器，
// 用 fetch 直连比开 Playwright 快两个数量级。这里只做三件事：
// 统一 UA、按 charset 解码（博达站群有 GBK 的页面）、把网络错误转成结构化错误码。

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
  + '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 henu-cli';

export async function fetchText(url, options = {}) {
  const timeoutMs = options.timeoutMs ?? 20000;
  let response;
  try {
    response = await fetch(url, {
      method: options.method ?? 'GET',
      headers: {
        'User-Agent': UA,
        Accept: options.accept ?? 'text/html,application/xhtml+xml,application/json,*/*',
        ...(options.body ? { 'Content-Type': 'application/json;charset=UTF-8' } : {}),
        ...(options.headers ?? {})
      },
      ...(options.body ? { body: typeof options.body === 'string' ? options.body : JSON.stringify(options.body) } : {}),
      redirect: 'follow',
      signal: AbortSignal.timeout(timeoutMs)
    });
  } catch (cause) {
    const error = new Error(`请求失败：${url}`);
    error.code = 'BACKEND_UNAVAILABLE';
    error.hint = '检查网络连通性（校外访问校内站点可能需要 VPN）；也可以用 --headed 观察浏览器里的实际行为。';
    error.details = { url, reason: cause?.message ?? String(cause) };
    throw error;
  }

  if (!response.ok) {
    const error = new Error(`请求返回 ${response.status}：${url}`);
    error.code = 'BACKEND_UNAVAILABLE';
    error.hint = '目标站点可能改版或临时故障，稍后重试。';
    error.details = { url, status: response.status };
    throw error;
  }

  const buffer = await response.arrayBuffer();
  return decodeBuffer(buffer, response.headers.get('content-type'));
}

export async function postJson(url, payload, options = {}) {
  const text = await fetchText(url, {
    method: 'POST',
    body: payload ?? {},
    accept: 'application/json, text/plain, */*',
    timeoutMs: options.timeoutMs,
    headers: options.headers
  });
  return parseJson(text, url);
}

export async function getJson(url, options = {}) {
  const text = await fetchText(url, { accept: 'application/json, text/plain, */*', timeoutMs: options.timeoutMs, headers: options.headers });
  return parseJson(text, url);
}

function parseJson(text, url) {
  try {
    return JSON.parse(text);
  } catch {
    const error = new Error(`返回内容不是 JSON：${url}`);
    error.code = 'PAGE_UNRECOGNIZED';
    error.hint = '接口可能要求登录态或已改版，用 henu-cli library ... 观察真实返回。';
    error.details = { url, preview: text.slice(0, 200) };
    throw error;
  }
}

// 博达站群混用 UTF-8 与 GBK，教务老系统都是 GBK；先看响应头里的 charset。
function decodeBuffer(buffer, contentType) {
  const declared = /charset=([\w-]+)/i.exec(contentType ?? '')?.[1]?.toLowerCase();
  const charset = declared === 'gbk' || declared === 'gb2312' || declared === 'gb18030'
    ? 'gbk'
    : declared === 'utf-8'
      ? 'utf-8'
      : sniffCharset(buffer);

  const decoder = new TextDecoder(charset === 'gbk' ? 'gbk' : 'utf-8');
  return decoder.decode(buffer).replace(/^\uFEFF/, '');
}

// 没有声明 charset 时：UTF-8 中文是合法多字节，GBK 解码成 UTF-8 会出现替换字符，
// 用 fatal 模式试一次就能判定。
function sniffCharset(buffer) {
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(buffer);
    return 'utf-8';
  } catch {
    return 'gbk';
  }
}
