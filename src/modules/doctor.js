import { existsSync, mkdirSync, accessSync, constants } from 'node:fs';

import { HENU } from '../config.js';
import { getBrowserStatus, getSelectedBrowser } from './browser.js';
import { formatAge, listCache } from './cache.js';
import { getHenuHome, getProfilePath } from './paths.js';

const MIN_NODE_MAJOR = 20;

export async function getDoctorReport(options = {}) {
  const checks = [];

  checks.push(checkNode());
  checks.push(await checkPlaywright());
  checks.push(checkBrowser());
  checks.push(checkProfile());
  checks.push(checkHomeWritable());
  checks.push(checkCache());
  checks.push(...await checkNetwork());

  const failed = checks.filter((check) => !check.ok);
  return {
    checks,
    summary: {
      ok: failed.length === 0,
      failed: failed.map((check) => check.id)
    },
    ...(options.verbose ? { home: getHenuHome(), profile: getProfilePath(getSelectedBrowser().id) } : {})
  };
}

/**
 * 缓存不是「必须项」：没有缓存照样能用，只是第一次查询更慢。
 * 所以这项永远 ok，只把「有哪些数据、多久前的」说清楚，
 * 免得用户看到旧数据却不知道旧到什么程度。
 */
function checkCache() {
  const entries = listCache();
  if (entries.length === 0) {
    return { id: 'cache', ok: true, detail: '暂无本地缓存（首次查询会现抓）' };
  }

  const summary = entries
    .map((entry) => `${entry.key} ${entry.readable ? formatAge(entry.ageSeconds) : '文件损坏'}前`)
    .join(' · ');

  const broken = entries.filter((entry) => !entry.readable);
  return {
    id: 'cache',
    ok: true,
    detail: `${entries.length} 项本地缓存（${summary}）`,
    ...(broken.length > 0
      ? { hint: `有 ${broken.length} 个缓存文件读不出来，运行 henu-cli cache clear 重建即可。` }
      : {})
  };
}

function checkNode() {
  const major = Number(process.versions.node.split('.')[0]);
  return {
    id: 'node',
    ok: major >= MIN_NODE_MAJOR,
    detail: `Node ${process.versions.node}`,
    ...(major >= MIN_NODE_MAJOR ? {} : { hint: `需要 Node ${MIN_NODE_MAJOR} 或更高版本。` })
  };
}

async function checkPlaywright() {
  try {
    await import('playwright');
    return { id: 'playwright', ok: true, detail: 'playwright 可用' };
  } catch {
    return { id: 'playwright', ok: false, detail: 'playwright 未安装', hint: '在项目目录运行 npm install。' };
  }
}

function checkBrowser() {
  const status = getBrowserStatus();
  const selected = status.selected;
  return {
    id: 'browser',
    ok: Boolean(status.browsers[selected.id]?.installed),
    detail: `${selected.label}（${selected.source}）`,
    ...(status.browsers[selected.id]?.installed
      ? {}
      : { hint: '安装 Chrome 或 Edge，或运行 henu-cli browser install chromium --yes。' })
  };
}

function checkProfile() {
  const profilePath = getProfilePath(getSelectedBrowser().id);
  const exists = existsSync(profilePath);
  return {
    id: 'profile',
    ok: true,
    detail: exists ? '已存在浏览器 profile' : '尚未登录（首次使用属正常）',
    profilePath
  };
}

function checkHomeWritable() {
  const home = getHenuHome();
  try {
    mkdirSync(home, { recursive: true });
    accessSync(home, constants.W_OK);
    return { id: 'home', ok: true, detail: home };
  } catch {
    return { id: 'home', ok: false, detail: home, hint: '目录不可写，检查 HENU_CLI_HOME 或权限。' };
  }
}

async function checkNetwork() {
  // 教务的老地址是 HENU.jw.base（config 里没有顶层 jwUrl），
  // 之前误写成 HENU.jwUrl → fetch(undefined) 必失败，doctor 一直报教务不可达。
  const targets = [
    { id: 'network-ehall', label: '办事大厅', url: HENU.ehallHome },
    { id: 'network-cas', label: '统一身份认证', url: HENU.casUrl },
    { id: 'network-jw', label: '教务系统', url: HENU.jw.base },
    { id: 'network-notice', label: '学校公告', url: HENU.notice.sources.school.listUrl },
    { id: 'network-jwc', label: '教务处通知', url: HENU.notice.sources.jwc.listUrl },
    { id: 'network-library', label: '图书馆检索', url: HENU.library.opac },
    { id: 'network-seat', label: '座位预约', url: HENU.library.seat.base }
  ];

  return Promise.all(targets.map(async (target) => {
    const started = Date.now();
    try {
      const response = await fetch(target.url, {
        redirect: 'manual',
        signal: AbortSignal.timeout(8000),
        headers: { 'user-agent': 'Mozilla/5.0 henu-cli' }
      });
      return {
        id: target.id,
        ok: response.status > 0 && response.status < 500,
        detail: `${target.label} HTTP ${response.status}，${Date.now() - started}ms`
      };
    } catch (cause) {
      // 公文通 / 图书馆 / 座位是公网可访问的，失败就只是网络问题；
      // 教务和办事大厅在校外可能受限，提示校园网或 VPN。
      const campusOnly = /^network-(jw|ehall|cas)$/.test(target.id);
      return {
        id: target.id,
        ok: false,
        detail: `${target.label} 不可达`,
        hint: campusOnly
          ? `${cause.message}。校外访问可能需要校园网或 VPN。`
          : `${cause.message}。这个站点公网即可访问，检查网络或代理设置。`
      };
    }
  }));
}
