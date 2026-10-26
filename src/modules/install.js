import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, posix, resolve, win32 } from 'node:path';
import { fileURLToPath } from 'node:url';
import { installSkill, getSkillTargets } from './skill.js';

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const BIN_NAME = 'henu-cli';

export function getPackageRoot() {
  return PACKAGE_ROOT;
}

export function readPackageMeta() {
  return JSON.parse(readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8'));
}

/**
 * Node 20.12+ 在 Windows 上禁止直接 spawn .cmd/.bat（EINVAL），
 * 因此统一用当前 node 解释器 + npm-cli.js 启动 npm。
 */
export function resolveNpmEntry({ execPath = process.execPath, npmExecpath = process.env.npm_execpath } = {}) {
  if (npmExecpath && npmExecpath.endsWith('.js') && existsSync(npmExecpath)) {
    return { command: execPath, args: [npmExecpath] };
  }
  const bundled = join(dirname(execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
  if (existsSync(bundled)) {
    return { command: execPath, args: [bundled] };
  }
  return null;
}

export function normalizePathEntry(entry, platform = process.platform) {
  // 斜杠统一成反斜杠：用户手敲的 --prefix 常写 C:/Users/...，
  // PATH 里存的是 C:\Users\...，不统一就会把同一个目录判成两个。
  const unified = platform === 'win32' ? entry.replace(/\//g, '\\') : entry;
  const trimmed = unified.replace(/[\\/]+$/, '');
  return platform === 'win32' ? trimmed.toLowerCase() : trimmed;
}

/** 判断 npm 全局前缀目录（也就是 henu-cli 可执行文件所在目录）是否在 PATH 中。 */
export function isPrefixOnPath(prefix, { pathValue = process.env.PATH ?? '', platform = process.platform } = {}) {
  if (!prefix) return false;
  const target = normalizePathEntry(prefix, platform);
  const separator = platform === 'win32' ? ';' : ':';
  return pathValue
    .split(separator)
    .filter(Boolean)
    .some((entry) => normalizePathEntry(entry, platform) === target);
}

/** 用户级、通常已在 PATH 中的 npm 前缀（Windows 是 %APPDATA%\npm）。 */
export function defaultUserPrefix({ platform = process.platform, env = process.env, home = homedir() } = {}) {
  if (platform === 'win32') {
    const appData = env.APPDATA ?? win32.join(home, 'AppData', 'Roaming');
    return win32.join(appData, 'npm');
  }
  return posix.join(home, '.npm-global');
}

/** 全局可执行文件路径，用于安装后自检。 */
export function globalBinPath(prefix, platform = process.platform) {
  if (!prefix) return null;
  return platform === 'win32' ? win32.join(prefix, `${BIN_NAME}.cmd`) : posix.join(prefix, 'bin', BIN_NAME);
}

/**
 * 这个前缀里是不是已经装过本 CLI。
 *
 * 用来实现「上次装哪就继续装哪」：判断 PATH 只能看当前进程的 PATH，
 * 而被 Agent/IDE 拉起时看到的 PATH 往往和用户自己终端里的不一样，
 * 于是升级会散成两份（本机就出现过 0.3.0 与 0.4.0 并存、用户敲到的还是旧的）。
 * 已经有安装记录的前缀比 PATH 推断更可信。
 */
export function findAllExistingPrefixes(prefixes, { platform = process.platform, exists = existsSync } = {}) {
  const found = [];
  const seen = new Set();
  for (const prefix of prefixes) {
    if (!prefix) continue;
    const key = normalizePathEntry(prefix, platform);
    if (seen.has(key)) continue;
    seen.add(key);
    const bin = globalBinPath(prefix, platform);
    if (bin && exists(bin)) found.push(prefix);
  }
  return found;
}

/**
 * 按 PATH 先后顺序重排前缀。
 *
 * 决定「装到哪」时，真正重要的是用户敲 henu-cli 时命中哪一份：
 * PATH 靠前的那份会把后面的全挡住。所以多份并存时按 PATH 排序，
 * 而不是假定某个固定目录更优先。
 */
export function orderByPath(prefixes, { pathValue = process.env.PATH ?? '', platform = process.platform } = {}) {
  const separator = platform === 'win32' ? ';' : ':';
  const entries = pathValue.split(separator).filter(Boolean).map((entry) => normalizePathEntry(entry, platform));
  const rank = (prefix) => {
    const index = entries.indexOf(normalizePathEntry(prefix, platform));
    return index < 0 ? Number.MAX_SAFE_INTEGER : index;
  };
  return [...prefixes].sort((a, b) => rank(a) - rank(b));
}

export function findExistingPrefix(prefixes, options = {}) {
  return findAllExistingPrefixes(prefixes, options)[0] ?? null;
}

export function resolveSkillTargets(target) {
  const available = getSkillTargets();
  if (!target) return ['workbuddy'];
  if (target === 'all') return available;
  if (!available.includes(target)) {
    const error = new Error(`不支持的 target：${target}`);
    error.code = 'SKILL_TARGET_INVALID';
    error.hint = `可选值：${available.join(' / ')} / all`;
    throw error;
  }
  return [target];
}

export async function installGlobal(options = {}) {
  const meta = readPackageMeta();
  const warnings = [];
  const platform = process.platform;
  const npm = resolveNpmEntry();

  if (!npm) {
    const error = new Error('找不到 npm，无法完成全局安装。');
    error.code = 'INSTALL_FAILED';
    error.hint = '请确认 Node.js 安装完整（本机缺少 node_modules/npm/bin/npm-cli.js）。';
    throw error;
  }

  const runNpm = (args, options) => spawnCapture(npm.command, [...npm.args, ...args], options);

  // 1) 先打 tarball：装目录时 npm 会做符号链接，从 npx 缓存安装的话，
  //    缓存被清理后全局命令就失效了。装 tarball 才是真正拷贝一份。
  const staging = await mkdtemp(join(tmpdir(), 'henu-cli-install-'));
  let tarball = null;
  try {
    tarball = await packTarball(runNpm, staging);
  } catch (cause) {
    warnings.push(`打包失败，改为直接从目录安装：${cause.message}`);
  }

  const source = tarball ?? PACKAGE_ROOT;

  try {
    // 2) 挑「装完就能直接用」的前缀
    let targets = options.prefix ? [options.prefix] : null;
    let needsExplicitPrefix = Boolean(options.prefix);

    if (!targets) {
      const defaultPrefix = await resolveGlobalPrefix(runNpm);
      const userPrefix = defaultUserPrefix({ platform });

      const existing = orderByPath(
        findAllExistingPrefixes([userPrefix, defaultPrefix], { platform }),
        { platform }
      );

      if (existing.length > 0) {
        // 已经装过的每一份都要更新到同一版本。
        // 只更新一份是不行的：不同终端的 PATH 顺序不一样，
        // 排在前面的旧副本会把刚装好的新版本挡住，用户敲到的还是旧的。
        targets = existing;
        needsExplicitPrefix = true;
        if (existing.length > 1) {
          warnings.push(`这台机器上装着 ${existing.length} 份，全部更新到 ${meta.version}（不必在意 PATH 里谁在前了）`);
        }
      } else if (isPrefixOnPath(defaultPrefix, { platform })) {
        targets = [defaultPrefix];
      } else if (userPrefix !== defaultPrefix && isPrefixOnPath(userPrefix, { platform })) {
        targets = [userPrefix];
        needsExplicitPrefix = true;
        warnings.push(`默认全局目录 ${defaultPrefix ?? '(未知)'} 不在 PATH 中，已改装到 ${userPrefix}`);
      } else {
        targets = [userPrefix];
        needsExplicitPrefix = true;
        warnings.push(`${userPrefix} 也不在 PATH 中，装完可能需要加入 PATH 或重开终端`);
      }
    }

    for (const prefix of targets) {
      const args = ['install', '--global', source];
      if (needsExplicitPrefix) args.push('--prefix', prefix);
      await runNpm(args);

      const binPath = globalBinPath(prefix, platform);
      if (binPath && !existsSync(binPath)) {
        warnings.push(`未在 ${prefix} 找到 ${BIN_NAME} 可执行文件`);
      }
    }

    // 3) 顺手装上随包 skill（失败只记 warning，不影响 CLI 安装结果）
    const skill = await installBundledSkill({ target: options.target, skip: options.skipSkill, warnings });
    const primary = targets[0];

    return {
      installed: true,
      command: BIN_NAME,
      package: meta.name,
      version: meta.version,
      prefix: primary,
      prefixes: targets,
      onPath: targets.some((prefix) => isPrefixOnPath(prefix, { platform })),
      source: tarball ? 'tarball' : 'directory',
      skill,
      warnings
    };
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

async function packTarball(runNpm, destination) {
  // 必须显式指定 cwd：npm pack 默认打包当前工作目录，而调用者可能在任意目录
  await runNpm(['pack', '--pack-destination', destination, '--silent'], { cwd: PACKAGE_ROOT });
  const entries = await readdir(destination);
  const tarball = entries.find((name) => name.endsWith('.tgz'));
  if (!tarball) {
    const error = new Error('npm pack 没有产出 .tgz 包');
    error.code = 'INSTALL_FAILED';
    error.hint = '先在包目录手动运行 npm pack --dry-run 看具体报错：常见原因是磁盘空间不足，'
      + '或 package.json 的 files 字段把 src/ 排除了。';
    throw error;
  }
  return join(destination, tarball);
}

async function resolveGlobalPrefix(runNpm) {
  try {
    const { stdout } = await runNpm(['prefix', '--global']);
    return stdout.trim().split(/\r?\n/).filter(Boolean).pop() ?? null;
  } catch {
    return null;
  }
}

async function installBundledSkill({ target, skip, warnings }) {
  if (skip) {
    return { installed: false, targets: [], skipped: '--no-skill' };
  }

  let targets;
  try {
    targets = resolveSkillTargets(target);
  } catch (error) {
    warnings.push(`skill 未安装：${error.message}`);
    return { installed: false, targets: [], error: error.message };
  }

  const done = [];
  for (const name of targets) {
    try {
      const result = await installSkill({ target: name });
      done.push({ target: name, destination: result.destination });
    } catch (error) {
      warnings.push(`skill 安装到 ${name} 失败：${error.message}`);
    }
  }

  return { installed: done.length > 0, targets: done };
}

function spawnCapture(command, args, options = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, ...options });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.once('error', (cause) => {
      const error = new Error(`执行 npm 失败：${cause.message}`);
      error.code = 'INSTALL_FAILED';
      reject(error);
    });
    child.once('close', (code) => {
      if (code === 0) {
        resolvePromise({ stdout, stderr });
        return;
      }
      const tail = stderr.trim().split(/\r?\n/).slice(-3).join(' ');
      const error = new Error(`npm 退出码 ${code}${tail ? `：${tail}` : ''}`);
      error.code = 'INSTALL_FAILED';
      error.hint = '可手动执行：npm install --global .';
      reject(error);
    });
  });
}

export function formatInstallText(result) {
  const all = result.prefixes?.length ? result.prefixes : [result.prefix];
  const lines = [`henu-cli ${result.version} 已安装`];
  if (all.length > 1) {
    lines.push('  位置（多份并存，都已更新到同一版本）：');
    for (const prefix of all) lines.push(`    ${prefix}`);
  } else {
    lines.push(`  位置：${result.prefix ?? '(未知)'}`);
  }
  lines.push(`  PATH：${result.onPath ? '已可用，直接运行 henu-cli' : '不在 PATH 中，需重开终端或手动加入 PATH'}`);

  if (result.skill?.installed) {
    lines.push('随包 skill：');
    for (const item of result.skill.targets) {
      lines.push(`  ${item.target} → ${item.destination}`);
    }
    lines.push('  新开一个 Agent 会话后 skill 才会生效。');
  } else {
    lines.push(`随包 skill：未安装${result.skill?.skipped ? `（${result.skill.skipped}）` : ''}`);
  }

  if (result.warnings?.length) {
    lines.push('提示：');
    for (const warning of result.warnings) {
      lines.push(`  - ${warning}`);
    }
  }

  return `${lines.join('\n')}\n`;
}
