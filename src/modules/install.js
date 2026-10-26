import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

export function getPackageRoot() {
  return PACKAGE_ROOT;
}

export async function installGlobal() {
  await runNpm(['install', '--global', PACKAGE_ROOT]);
  return {
    installed: true,
    target: 'global',
    source: PACKAGE_ROOT,
    message: '已全局安装，可直接使用 henu-cli 命令。'
  };
}

function runNpm(args) {
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  return new Promise((resolvePromise, reject) => {
    const child = spawn(npm, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: false });
    child.stdout.on('data', (chunk) => process.stderr.write(chunk));
    child.stderr.on('data', (chunk) => process.stderr.write(chunk));
    child.once('error', (cause) => {
      const error = new Error(`执行 npm 失败：${cause.message}`);
      error.code = 'INSTALL_FAILED';
      reject(error);
    });
    child.once('close', (code) => {
      if (code === 0) {
        resolvePromise();
        return;
      }
      const error = new Error(`npm 退出码 ${code}。`);
      error.code = 'INSTALL_FAILED';
      error.hint = '可手动执行：npm install --global .';
      reject(error);
    });
  });
}
