import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  defaultUserPrefix,
  findAllExistingPrefixes,
  findExistingPrefix,
  formatInstallText,
  globalBinPath,
  isPrefixOnPath,
  orderByPath,
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

test('findExistingPrefix 找已经有 henu-cli 可执行文件的前缀', () => {
  const SEP = String.fromCharCode(92); // 反斜杠：避免在源码里写转义，容易被工具改写
  const same = (actual, expected) => actual.split(SEP).join('/').toLowerCase() === expected.toLowerCase();

  const found = findExistingPrefix(['C:/node/npm', 'C:/Users/me/AppData/Roaming/npm'], {
    platform: 'win32',
    exists: (file) => same(file, 'C:/Users/me/AppData/Roaming/npm/henu-cli.cmd')
  });
  assert.equal(found, 'C:/Users/me/AppData/Roaming/npm');

  assert.equal(
    findExistingPrefix(['C:/a', 'C:/b'], { platform: 'win32', exists: () => false }),
    null,
    '都没有安装过时要返回 null，交给 PATH 推断'
  );

  assert.equal(
    findExistingPrefix([null, undefined, ''], { platform: 'win32', exists: () => true }),
    null,
    '空前缀要跳过'
  );
});

test('findExistingPrefix 不区分大小写、同一目录只查一次', () => {
  const calls = [];
  const found = findExistingPrefix(['C:/NPM', 'c:/npm'], {
    platform: 'win32',
    exists: (file) => {
      calls.push(file);
      return true;
    }
  });

  assert.equal(found, 'C:/NPM');
  assert.equal(calls.length, 1, '大小写不同但指向同一目录，只应检查一次');
});

test('findAllExistingPrefixes 会列出所有装过的前缀，而不是只挑第一个', () => {
  const SEP = String.fromCharCode(92);
  const same = (actual, expected) => actual.split(SEP).join('/').toLowerCase() === expected.toLowerCase();

  const found = findAllExistingPrefixes(['C:/node/npm', 'C:/Users/me/AppData/Roaming/npm'], {
    platform: 'win32',
    // 两份都有 henu-cli.cmd
    exists: (file) => /henu-cli\.cmd$/.test(file)
  });
  assert.equal(found.length, 2);
});

test('orderByPath：PATH 靠前的排前面，不在 PATH 里的排最后', () => {
  const pathValue = ['/usr/bin', 'C:/node/npm', 'C:/Users/me/AppData/Roaming/npm'].join(';');
  const ordered = orderByPath(['C:/Users/me/AppData/Roaming/npm', 'C:/node/npm', 'C:/orphan'], {
    platform: 'win32',
    pathValue
  });
  assert.deepEqual(ordered, ['C:/node/npm', 'C:/Users/me/AppData/Roaming/npm', 'C:/orphan']);
});

test('formatInstallText 多份并存时把所有位置都列出来', () => {
  const text = formatInstallText({
    version: '0.6.0',
    prefix: 'C:/node/npm',
    prefixes: ['C:/node/npm', 'C:/Users/me/AppData/Roaming/npm'],
    onPath: true,
    skill: { skipped: '--no-skill' },
    warnings: ['装着 2 份']
  });
  assert.match(text, /C:\/node\/npm/);
  assert.match(text, /AppData\\?\/Roaming\\?\/npm/i);
  assert.match(text, /装着 2 份/);
});

test('formatInstallText 只有一份时仍按原样输出', () => {
  const text = formatInstallText({ version: '0.6.0', prefix: 'C:/node/npm', onPath: true, skill: { skipped: 'x' } });
  assert.match(text, /位置：C:\/node\/npm/);
  assert.doesNotMatch(text, /多份并存/);
});

test('normalizePathEntry 把正斜杠和反斜杠当同一个目录', () => {
  const SEP = String.fromCharCode(92);
  const withBackslashes = ['C:', 'Users', 'me', 'npm'].join(SEP);

  assert.equal(normalizePathEntry(withBackslashes, 'win32'), 'c:' + SEP + 'users' + SEP + 'me' + SEP + 'npm');
  assert.equal(
    normalizePathEntry('C:/Users/me/npm', 'win32'),
    normalizePathEntry(withBackslashes, 'win32'),
    '正斜杠写法必须和反斜杠写法归一化到同一个值'
  );
  assert.equal(normalizePathEntry('C:/Users/me/npm/', 'win32'), normalizePathEntry('C:/Users/me/npm', 'win32'));
  assert.equal(normalizePathEntry('/usr/local/bin/', 'linux'), '/usr/local/bin');
});
