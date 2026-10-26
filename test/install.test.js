import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  defaultUserPrefix,
  formatInstallText,
  globalBinPath,
  isPrefixOnPath,
  normalizePathEntry,
  resolveNpmEntry,
  resolveSkillTargets
} from '../src/modules/install.js';

test('normalizePathEntry 去掉尾部斜杠，Windows 下转小写', () => {
  assert.equal(normalizePathEntry('C:\\Users\\me\\npm\\', 'win32'), 'c:\\users\\me\\npm');
  assert.equal(normalizePathEntry('/usr/local/bin/', 'linux'), '/usr/local/bin');
  assert.equal(normalizePathEntry('/usr/local/bin/', 'linux'), '/usr/local/bin');
});

test('isPrefixOnPath 命中 PATH 中的目录', () => {
  const pathValue = ['C:\\Windows', 'C:\\Users\\me\\AppData\\Roaming\\npm', 'C:\\Tools'].join(';');
  assert.equal(isPrefixOnPath('C:\\Users\\me\\AppData\\Roaming\\npm', { pathValue, platform: 'win32' }), true);
  // 大小写与尾部分隔符不应影响判断
  assert.equal(isPrefixOnPath('c:\\users\\me\\appdata\\roaming\\npm\\', { pathValue, platform: 'win32' }), true);
});

test('isPrefixOnPath 未命中时返回 false', () => {
  const pathValue = ['C:\\Windows', 'C:\\Tools'].join(';');
  assert.equal(isPrefixOnPath('C:\\Users\\me\\AppData\\Roaming\\npm', { pathValue, platform: 'win32' }), false);
  assert.equal(isPrefixOnPath(null, { pathValue, platform: 'win32' }), false);
  assert.equal(isPrefixOnPath('', { pathValue, platform: 'win32' }), false);
});

test('defaultUserPrefix Windows 取 APPDATA\\npm，其他平台取 ~/.npm-global', () => {
  const win = defaultUserPrefix({ platform: 'win32', env: { APPDATA: 'C:\\Users\\me\\AppData\\Roaming' }, home: 'C:\\Users\\me' });
  assert.equal(win, 'C:\\Users\\me\\AppData\\Roaming\\npm');

  const winFallback = defaultUserPrefix({ platform: 'win32', env: {}, home: 'C:\\Users\\me' });
  assert.match(winFallback.replace(/\\/g, '/'), /AppData\/Roaming\/npm$/);

  const posix = defaultUserPrefix({ platform: 'linux', env: {}, home: '/home/me' });
  assert.equal(posix, '/home/me/.npm-global');
});

test('globalBinPath 在 Windows 指向 .cmd，在 POSIX 指向 bin 目录', () => {
  assert.equal(globalBinPath('C:\\npm', 'win32'), 'C:\\npm\\henu-cli.cmd');
  assert.equal(globalBinPath('/opt/npm', 'linux'), '/opt/npm/bin/henu-cli');
  assert.equal(globalBinPath(null, 'linux'), null);
});

test('resolveSkillTargets 默认装 workbuddy，支持 all 与非法值', () => {
  assert.deepEqual(resolveSkillTargets(), ['workbuddy']);
  assert.ok(resolveSkillTargets('all').length >= 4);
  assert.ok(resolveSkillTargets('all').includes('claude'));
  assert.deepEqual(resolveSkillTargets('cursor'), ['cursor']);
  assert.throws(() => resolveSkillTargets('vscode'), (error) => error.code === 'SKILL_TARGET_INVALID');
});

test('resolveNpmEntry 找不到 npm 时返回 null', () => {
  const entry = resolveNpmEntry({ execPath: '/definitely/not/node', npmExecpath: '' });
  assert.equal(entry, null);
});

test('resolveNpmEntry 优先使用 npm_execpath 指向的脚本', () => {
  const entry = resolveNpmEntry({ execPath: process.execPath, npmExecpath: fileURLToPath(import.meta.url) });
  assert.equal(entry.command, process.execPath);
  assert.deepEqual(entry.args, [fileURLToPath(import.meta.url)]);
});

test('formatInstallText 汇总位置、PATH、skill 与提示', () => {
  const text = formatInstallText({
    installed: true,
    version: '0.3.0',
    prefix: 'C:\\Users\\me\\AppData\\Roaming\\npm',
    onPath: true,
    skill: { installed: true, targets: [{ target: 'workbuddy', destination: 'C:\\Users\\me\\.workbuddy\\skills\\henu-cli-skill' }] },
    warnings: ['已经装好了，别重复装']
  });

  assert.match(text, /henu-cli 0\.3\.0 已安装/);
  assert.match(text, /AppData\\Roaming\\npm/);
  assert.match(text, /直接运行 henu-cli/);
  assert.match(text, /workbuddy → /);
  assert.match(text, /新开一个 Agent 会话/);
  assert.match(text, /已经装好了/);
});

test('formatInstallText 在跳过 skill 时说明原因', () => {
  const text = formatInstallText({
    version: '0.3.0',
    prefix: '/opt/npm',
    onPath: false,
    skill: { installed: false, targets: [], skipped: '--no-skill' },
    warnings: []
  });

  assert.match(text, /不在 PATH 中/);
  assert.match(text, /未安装（--no-skill）/);
});
