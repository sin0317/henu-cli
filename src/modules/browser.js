import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import readline from 'node:readline/promises';

import { getHenuHome, getProfilePath } from './paths.js';

const require = createRequire(import.meta.url);
const CONFIG_FILE = 'browser.json';
export const BROWSER_IDS = ['chrome', 'edge', 'chromium'];

const DEFINITIONS = {
  chrome: { label: 'Google Chrome', channel: 'chrome' },
  edge: { label: 'Microsoft Edge', channel: 'msedge' },
  chromium: { label: 'Playwright Chromium', channel: null }
};

export function normalizeBrowserId(value) {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (normalized === 'msedge' || normalized === 'microsoft-edge') {
    return 'edge';
  }
  if (normalized === 'google-chrome') {
    return 'chrome';
  }
  return BROWSER_IDS.includes(normalized) ? normalized : null;
}

export function getSelectedBrowser(options = {}) {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;

  const fromEnv = normalizeBrowserId(env.HENU_BROWSER ?? env.HENU_BROWSER_CHANNEL);
  if (fromEnv) {
    return buildSelection(fromEnv, 'environment');
  }

  const saved = readBrowserConfig({ env });
  if (saved && BROWSER_IDS.includes(saved.browser)) {
    return buildSelection(saved.browser, 'saved');
  }

  const available = ['chrome', 'edge'].find((id) => isBrowserInstalled(id, { platform, env }));
  if (available) {
    const selection = buildSelection(available, 'first-available');
    saveBrowserConfig(selection.id, { env });
    return selection;
  }

  // 没有系统 Chrome/Edge 时才落到托管 Chromium，且仅在被实际使用前提示安装。
  return buildSelection('chromium', 'fallback');
}

export function getBrowserStatus(options = {}) {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const selected = getSelectedBrowser({ env, platform });

  return {
    selected,
    browsers: Object.fromEntries(BROWSER_IDS.map((id) => [id, {
      id,
      label: DEFINITIONS[id].label,
      installed: isBrowserInstalled(id, { platform, env }),
      profilePath: getProfilePath(id, { env })
    }]))
  };
}

export function selectBrowser(browser, options = {}) {
  const id = normalizeBrowserId(browser);
  if (!id) {
    throwCliError('BROWSER_SELECTION_INVALID', `浏览器只能是 ${BROWSER_IDS.join(' / ')}。`);
  }

  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  if (!isBrowserInstalled(id, { platform, env })) {
    throwBrowserUnavailable(id);
  }

  const selection = buildSelection(id, 'explicit');
  saveBrowserConfig(id, { env });
  return selection;
}

export function assertBrowserAvailable(options = {}) {
  const selection = getSelectedBrowser(options);
  if (!isBrowserInstalled(selection.id, options)) {
    throwBrowserUnavailable(selection.id);
  }
  return selection;
}

export function isBrowserInstalled(browser, options = {}) {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;

  if (browser === 'chromium') {
    return isManagedChromiumInstalled();
  }
  return browserExecutableCandidates(browser, platform, env).some((candidate) => existsSync(candidate));
}

export async function installManagedChromium(options = {}) {
  if (!options.yes) {
    if (!process.stdin.isTTY || !process.stdout.isTTY) {
      throwCliError(
        'BROWSER_INSTALL_CONFIRM_REQUIRED',
        '安装 Playwright Chromium 需要显式确认。',
        '确认后重跑：henu-cli browser install chromium --yes'
      );
    }

    const prompt = readline.createInterface({ input: process.stdin, output: process.stderr });
    const answer = await prompt.question('将下载 Playwright Chromium，继续？[y/N] ');
    prompt.close();
    if (!/^y(es)?$/i.test(answer.trim())) {
      throwCliError('BROWSER_INSTALL_CANCELLED', '已取消安装。');
    }
  }

  let cliPath;
  try {
    cliPath = join(dirname(require.resolve('playwright/package.json')), 'cli.js');
  } catch {
    throwCliError('BACKEND_UNAVAILABLE', 'Playwright 未安装，请先在项目目录执行 npm install。');
  }

  await runCommand(process.execPath, [cliPath, 'install', 'chromium']);
  saveBrowserConfig('chromium', { env: process.env });
  return { installed: true, browser: 'chromium', profilePath: getProfilePath('chromium') };
}

function buildSelection(id, source) {
  return {
    id,
    label: DEFINITIONS[id].label,
    channel: DEFINITIONS[id].channel,
    source,
    profilePath: getProfilePath(id)
  };
}

function browserExecutableCandidates(browser, platform, env) {
  if (platform === 'win32') {
    const roots = [env.LOCALAPPDATA, env.PROGRAMFILES, env['PROGRAMFILES(X86)']].filter(Boolean);
    const relative = browser === 'chrome'
      ? ['Google', 'Chrome', 'Application', 'chrome.exe']
      : ['Microsoft', 'Edge', 'Application', 'msedge.exe'];
    return roots.map((root) => join(root, ...relative));
  }

  if (platform === 'darwin') {
    const app = browser === 'chrome'
      ? 'Google Chrome.app/Contents/MacOS/Google Chrome'
      : 'Microsoft Edge.app/Contents/MacOS/Microsoft Edge';
    return [`/Applications/${app}`, join(homedir(), 'Applications', app)];
  }

  return browser === 'chrome'
    ? ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable']
    : ['/usr/bin/microsoft-edge', '/usr/bin/microsoft-edge-stable'];
}

function isManagedChromiumInstalled() {
  try {
    const { chromium } = require('playwright');
    return existsSync(chromium.executablePath());
  } catch {
    return false;
  }
}

function readBrowserConfig(options = {}) {
  try {
    const raw = readFileSync(join(getHenuHome(options), CONFIG_FILE), 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function saveBrowserConfig(browser, options = {}) {
  const home = getHenuHome(options);
  try {
    mkdirSync(home, { recursive: true });
    writeFileSync(join(home, CONFIG_FILE), `${JSON.stringify({ browser }, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600
    });
  } catch {
    // 配置写入失败不影响本次运行，只是下次需要重新探测。
  }
}

function runCommand(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: false });
    child.stdout.on('data', (chunk) => process.stderr.write(chunk));
    child.stderr.on('data', (chunk) => process.stderr.write(chunk));
    child.once('error', (cause) => rejectCliError('BROWSER_INSTALL_FAILED', `安装 Chromium 失败：${cause.message}`));
    child.once('close', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      rejectCliError('BROWSER_INSTALL_FAILED', `Playwright Chromium 安装失败（exit code ${code}）。`);
    });
  });
}

function throwBrowserUnavailable(browser) {
  const error = new Error(`没有找到可用的 ${DEFINITIONS[browser].label}。`);
  error.code = 'BROWSER_UNAVAILABLE';
  error.hint = '安装 Chrome 或 Edge，或运行 henu-cli browser install chromium --yes。';
  error.details = { browser, status: getBrowserStatus() };
  throw error;
}

function throwCliError(code, message, hint) {
  const error = new Error(message);
  error.code = code;
  if (hint) {
    error.hint = hint;
  }
  throw error;
}
