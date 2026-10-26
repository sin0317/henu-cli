// 统一身份认证登录失败时，页面把原因藏在 HTML 里，直接把整页 HTML 抛回给人
// 等于没说。这里把「密码错误 / 需要验证码 / 账号已锁定」这类常见原因抽成人话。
//
// 判定顺序：先找页面里明确的错误容器（id=msg、showErrorTip 等），
// 找不到再退到「去掉所有标签后在正文里找关键词」，最后看有没有验证码控件。

const ERROR_CONTAINERS = [
  /id="msg"[^>]*>\s*([^<]{1,120})\s*</i,
  /id="showErrorTip"[^>]*>\s*([^<]{1,120})\s*</i,
  /class="errors?"[^>]*>\s*([^<]{1,120})\s*</i,
  /class="authError"[^>]*>\s*([^<]{1,120})\s*</i,
  /"message"\s*:\s*"([^"]{1,120})"/i,
  /'message'\s*:\s*'([^']{1,120})'/i
];

// 顺序即优先级：「账号或密码错误」要排在「密码错误」前面，否则只会命中后者。
const KEYWORDS = [
  '账号或密码错误',
  '用户名或密码错误',
  '密码错误',
  '验证码错误',
  '用户不存在',
  '账户不存在',
  '账号已锁定',
  '账户已锁定',
  '访问过于频繁',
  '需要验证码',
  '请输入验证码',
  '短信验证',
  '手机验证',
  '登录失败',
  '认证失败'
];

const CAPTCHA_CONTROL = /<img[^>]*captcha[^>]*>|<input[^>]*captcha[^>]*>|id=["']captcha["']/i;

export function describeCasPage(htmlText) {
  const text = String(htmlText ?? '');
  if (text.trim() === '') return '';

  for (const pattern of ERROR_CONTAINERS) {
    const matched = pattern.exec(text);
    if (matched?.[1]) {
      const cleaned = collapse(unescapeEntities(matched[1]));
      if (cleaned) return cleaned;
    }
  }

  const plain = collapse(unescapeEntities(text.replace(/<[^>]+>/g, ' ')));
  for (const keyword of KEYWORDS) {
    if (plain.includes(keyword)) return keyword;
  }

  if (CAPTCHA_CONTROL.test(text)) return '需要验证码';
  return '';
}

/** 把它塞进一句完整的话里，避免返回孤零零的四个字。 */
export function describeCasFailure({ html, missingFields = [] } = {}) {
  const reason = describeCasPage(html);
  if (reason) return `登录失败：${reason}`;

  if (missingFields.length > 0) {
    return `登录页缺少 ${missingFields.join(' / ')} 字段，页面可能改版或返回了中间页`;
  }
  return '';
}

function collapse(text) {
  return String(text ?? '').replace(/\s+/g, ' ').trim();
}

function unescapeEntities(text) {
  return String(text ?? '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}
