// 输出脱敏：无论成功还是失败，写出去的 JSON 里都不该出现票据/口令。
//
// 为什么放在输出层而不是数据源：模块内部要拿 token 去调下一个接口，
// 在数据源就打码会把自己也堵死；只有「要给人看」这一步才需要拦。
//
// 判定用小写 key 名，password / Authorization 这类大小写混写的也能拦住。

// 精确 key：这些必须原样拦。
const SENSITIVE_KEYS = new Set([
  'password',
  'passwd',
  'secret',
  'cookie',
  'cookies',
  'set-cookie',
  'token',
  'access_token',
  'accessToken',
  'refresh_token',
  'refreshToken',
  'authorization',
  'ticket',
  'castgc',
  'tgc',
  'ssessionid',
  'jsessionid',
  'sessionid',
  'route',
  'deskey'
]);

// 前缀/后缀变化的 key（_v4_token、x-token、userTicket 这类）：靠包含式兜住。
// 宁可多打码几个内部字段，也不能让一张票据混出去。
const SENSITIVE_PARTS = ['token', 'cookie', 'ticket', 'password', 'passwd', 'secret', 'sessionid', 'castgc'];

const MAX_DEPTH = 12;

// 值层面的票据：dump 里常见整段 HTML / Set-Cookie，字段名过滤拦不住混在文本里的它们。
// 只擦一次性凭证，业务数据（学号、房间名、时间）一律不动，否则排障就失明了。
// 顺序有讲究：CASTGC= 要先于 TGT- 处理，否则 TGT 规则会把 cookie 值啃掉一半，
// 剩下的半截又会被前一条再替换一次，出现「<redacted><redacted>」这种叠字。
const VALUE_PATTERNS = [
  [/bearer\s+[A-Za-z0-9._-]{20,}/gi, 'bearer <redacted>'],
  // bearer 后面可能没有空格（zwyy 的写法就是 bearer<jwt>），所以把它作为可选前缀吃掉
  [/\b(?:bearer\s*)?eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}/gi, '<jwt:redacted>'],
  [/\bST-\d{4,8}-[A-Za-z0-9]+-[A-Za-z0-9-]+/g, 'ST-<redacted>'],
  [/\bCASTGC=[A-Za-z0-9._-]+/gi, 'CASTGC=<redacted>'],
  [/\bJSESSIONID=[A-Za-z0-9._-]+/gi, 'JSESSIONID=<redacted>'],
  [/\bTGT-\d+-[A-Za-z0-9-]+/g, 'TGT-<redacted>']
];

export function redactSecrets(value, depth = 0) {
  if (depth > MAX_DEPTH) return '[truncated]';
  if (value === null || value === undefined) return value;

  if (Array.isArray(value)) return value.map((item) => redactSecrets(item, depth + 1));
  if (Buffer.isBuffer(value)) return '<redacted>';

  if (typeof value === 'object') {
    const out = {};
    for (const [key, item] of Object.entries(value)) {
      out[key] = isSensitiveKey(key) ? '<redacted>' : redactSecrets(item, depth + 1);
    }
    return out;
  }

  // 裸字符串里的 bearer 头/JWT/CAS 票据也拦一层：dump 里经常是一整段 header 或 HTML 文本。
  if (typeof value === 'string') {
    let text = value;
    for (const [pattern, replacement] of VALUE_PATTERNS) {
      text = text.replace(pattern, replacement);
    }
    return text;
  }

  return value;
}

function isSensitiveKey(key) {
  const normalized = String(key).trim().toLowerCase();
  return SENSITIVE_KEYS.has(normalized)
    || SENSITIVE_PARTS.some((part) => normalized.includes(part));
}
