import { cp, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SKILL_NAME = 'henu-cli-skill';

const TARGETS = {
  workbuddy: () => join(homedir(), '.workbuddy', 'skills'),
  claude: () => join(homedir(), '.claude', 'skills'),
  codex: () => join(homedir(), '.codex', 'skills'),
  cursor: () => join(homedir(), '.cursor', 'skills')
};

export function getSkillPath() {
  return join(PACKAGE_ROOT, 'skills', SKILL_NAME);
}

export function getSkillTargets() {
  return Object.keys(TARGETS);
}

export async function installSkill(options = {}) {
  const target = options.target ?? 'workbuddy';
  if (!TARGETS[target]) {
    const error = new Error(`不支持的 target：${target}`);
    error.code = 'SKILL_TARGET_INVALID';
    error.hint = `可选值：${Object.keys(TARGETS).join(' / ')}`;
    throw error;
  }

  const source = getSkillPath();
  if (!existsSync(source)) {
    const error = new Error('随包 skill 目录不存在。');
    error.code = 'SKILL_SOURCE_MISSING';
    throw error;
  }

  const destination = join(TARGETS[target](), SKILL_NAME);
  await mkdir(dirname(destination), { recursive: true });
  await cp(source, destination, { recursive: true, force: true });

  return { installed: true, target, destination, source };
}
