import { getSelectedBrowser } from './browser.js';

export function getLaunchOptions(options = {}) {
  const browser = getSelectedBrowser();
  return {
    ...(browser.channel ? { channel: browser.channel } : {}),
    headless: options.headless ?? false,
    locale: 'zh-CN',
    timezoneId: 'Asia/Shanghai'
  };
}

export async function importPlaywright() {
  try {
    return await import('playwright');
  } catch {
    const error = new Error('Playwright 未安装，请先在项目目录执行 npm install。');
    error.code = 'BACKEND_UNAVAILABLE';
    throw error;
  }
}
