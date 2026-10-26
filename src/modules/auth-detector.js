const CAS_HOST = 'ids.henu.edu.cn';
const CAS_HINT = '统一身份认证';
const LOGGED_IN_HINTS = ['安全退出', '个人中心', '注销'];

export function classifyAuthPage(pageState = {}) {
  const url = pageState.url ?? '';
  const title = pageState.title ?? '';
  const text = pageState.text ?? '';

  if (url.includes(`authserver/login`) || /ids\.henu\.edu\.cn\/authserver/.test(url)) {
    return { loggedIn: false, reason: 'cas-login-page' };
  }
  if (url.includes('personalInfo/personCenter')) {
    return { loggedIn: true, reason: 'cas-personal-center' };
  }
  if (url.includes(CAS_HOST) || title.includes(CAS_HINT) || text.includes(CAS_HINT)) {
    return { loggedIn: false, reason: 'cas-login-page' };
  }

  // 教务系统（青果）：未登录停在 cas/login.action，登录后进入 frame/homes
  if (url.includes('cas/login.action') || url.includes('/caslogin')) {
    return { loggedIn: false, reason: 'jw-login-page' };
  }
  if (url.includes('frame/homes')) {
    return { loggedIn: true, reason: 'jw-home' };
  }
  if (url.includes('xk.henu.edu.cn')) {
    if (text.includes('统一认证登录') || text.includes('免验证码')) {
      return { loggedIn: false, reason: 'jw-login-page' };
    }
    return { loggedIn: true, reason: 'jw-page' };
  }

  // 办事大厅
  if (url.includes('/ywtb-portal/')) {
    if (LOGGED_IN_HINTS.some((hint) => text.includes(hint))) {
      return { loggedIn: true, reason: 'ehall-logged-in' };
    }
    return { loggedIn: false, reason: 'ehall-login-prompt' };
  }

  return { loggedIn: false, reason: 'unknown' };
}
