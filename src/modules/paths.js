import { homedir } from 'node:os';
import { join } from 'node:path';

const PROFILE_DIR = 'browser-profiles';

export function getHenuHome(options = {}) {
  const env = options.env ?? process.env;
  return env.HENU_CLI_HOME || join(homedir(), '.henu-cli');
}

export function getProfilePath(browserId, options = {}) {
  return join(getHenuHome(options), PROFILE_DIR, browserId);
}
