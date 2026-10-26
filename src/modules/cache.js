// 本地缓存：把「必须开浏览器才拿得到」的数据存进 ~/.henu-cli/cache。
// 两个作用：一是重复查询秒出（课表抓一次要十几秒），
// 二是抓取失败时还能拿旧数据兜底，不至于什么都看不到。
//
// 设计上的几条硬规矩：
//   - 过期不等于不能用：过期数据只在「新数据取失败」时作为降级结果返回，并带上 warning。
//   - 缓存文件坏掉（手工改坏、断电截断）不能抛出异常，一律当没有缓存。
//   - 写入走「临时文件 + rename」，避免读到写了一半的 JSON。
import { mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { getHenuHome } from './paths.js';

const CACHE_VERSION = 1;
const DIR = 'cache';

/** 各类数据的保鲜期（秒）。过期后仍会保留，只用于降级兜底。 */
export const CACHE_TTL = {
  timetable: 6 * 3600,
  grades: 12 * 3600
};

export const CACHE_KEYS = {
  timetable: 'timetable',
  grades: 'grades'
};

/** 缓存文件位置（默认 ~/.henu-cli/cache），传入 home 便于测试。 */
export function cacheDir({ home } = {}) {
  return join(home ?? getHenuHome(), DIR);
}

export function cachePath(key, { home } = {}) {
  return join(cacheDir({ home }), `${safeName(key)}.json`);
}

/** 键名会落成文件名，只保留安全字符，避免路径穿越。 */
export function safeName(key) {
  return String(key ?? '')
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^[-.]+/, '')
    || 'unnamed';
}

export function writeCache(key, data, { home, now = Date.now() } = {}) {
  const dir = cacheDir({ home });
  mkdirSync(dir, { recursive: true });

  const file = cachePath(key, { home });
  const temp = `${file}.${process.pid}.tmp`;
  writeFileSync(temp, `${JSON.stringify({ version: CACHE_VERSION, savedAt: now, data })}\n`, 'utf8');

  try {
    renameSync(temp, file);
  } catch {
    // Windows 上偶尔会因为杀软占用导致 rename 失败，退一步先删再改名
    rmSync(file, { force: true });
    renameSync(temp, file);
  }

  return { path: file, savedAt: now };
}

/**
 * 读取缓存。返回 null 表示「没有可用缓存」（不存在 / 坏文件 / 版本不符）。
 * 是否过期由 ttlSeconds 决定，过期条目仍然返回，交给调用方决定怎么用。
 */
export function readCache(key, { home, now = Date.now(), ttlSeconds } = {}) {
  let raw;
  try {
    raw = readFileSync(cachePath(key, { home }), 'utf8');
  } catch {
    return null;
  }

  let entry;
  try {
    entry = JSON.parse(raw);
  } catch {
    return null;
  }

  if (!entry || typeof entry !== 'object') return null;
  if (entry.version !== CACHE_VERSION) return null;
  if (typeof entry.savedAt !== 'number' || !Number.isFinite(entry.savedAt)) return null;
  if (!('data' in entry)) return null;

  const ageSeconds = Math.max(0, Math.round((now - entry.savedAt) / 1000));
  return {
    data: entry.data,
    savedAt: entry.savedAt,
    ageSeconds,
    expired: ttlSeconds === undefined ? false : ageSeconds > ttlSeconds
  };
}

export function dropCache(key, { home } = {}) {
  const file = cachePath(key, { home });
  try {
    rmSync(file, { force: true });
    return true;
  } catch {
    return false;
  }
}

export function dropAllCache({ home } = {}) {
  let names = [];
  try {
    names = readdirSync(cacheDir({ home }));
  } catch {
    return 0;
  }

  let removed = 0;
  for (const name of names) {
    if (!name.endsWith('.json') && !name.endsWith('.tmp')) continue;
    try {
      rmSync(join(cacheDir({ home }), name), { force: true });
      removed += 1;
    } catch {
      // 单个文件删不掉不影响其它缓存
    }
  }
  return removed;
}

/** 列出缓存条目，供 cache status 展示。 */
export function listCache({ home, now = Date.now() } = {}) {
  const dir = cacheDir({ home });
  let names = [];
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }

  const entries = [];
  for (const name of names) {
    if (!name.endsWith('.json')) continue;
    const file = join(dir, name);
    const key = name.slice(0, -'.json'.length);
    let sizeBytes = 0;
    let mtimeMs = null;
    try {
      const stat = statSync(file);
      sizeBytes = stat.size;
      mtimeMs = stat.mtimeMs;
    } catch {
      continue;
    }
    const entry = readCache(key, { home, now });
    entries.push({
      key,
      path: file,
      sizeBytes,
      savedAt: entry?.savedAt ?? null,
      ageSeconds: entry?.ageSeconds ?? null,
      readable: Boolean(entry),
      ...(mtimeMs !== null ? { mtime: new Date(mtimeMs).toISOString() } : {})
    });
  }

  return entries.sort((a, b) => (b.savedAt ?? 0) - (a.savedAt ?? 0));
}

/**
 * 「读缓存，否则跑 loader」的通用外壳。
 *
 * @returns {{ data: any, cache: { hit: boolean, stale: boolean, ageSeconds: number|null, savedAt: number|null, ttlSeconds: number }, warning?: string }}
 *   hit=true 表示本次没有联网，数据直接来自缓存；
 *   stale=true 表示联网失败了，返回的是缓存里的旧数据（此时一定有 warning）。
 */
export async function readThroughCache({
  key,
  ttlSeconds,
  refresh = false,
  loader,
  home,
  now = Date.now()
}) {
  const cached = readCache(key, { home, now, ttlSeconds });
  const fresh = cached && !cached.expired && !refresh;

  if (fresh) {
    return {
      data: cached.data,
      cache: {
        hit: true,
        stale: false,
        ageSeconds: cached.ageSeconds,
        savedAt: cached.savedAt,
        ttlSeconds
      }
    };
  }

  try {
    const data = await loader();
    const written = writeCache(key, data, { home, now });
    return {
      data,
      cache: { hit: false, stale: false, ageSeconds: 0, savedAt: written.savedAt, ttlSeconds }
    };
  } catch (error) {
    if (!cached) throw error;
    return {
      data: cached.data,
      cache: {
        hit: true,
        stale: true,
        ageSeconds: cached.ageSeconds,
        savedAt: cached.savedAt,
        ttlSeconds
      },
      warning: `实时取数失败（${error?.code ?? error?.message ?? '未知错误'}），`
        + `下面是 ${formatAge(cached.ageSeconds)}前的本地缓存，可能不是最新。`
    };
  }
}

export function formatAge(seconds) {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return '未知时间';
  const value = Math.max(0, Math.round(seconds));
  if (value < 60) return '刚刚';
  if (value < 3600) return `${Math.round(value / 60)} 分钟`;
  if (value < 86400) return `${Math.round(value / 3600)} 小时`;
  return `${Math.round(value / 86400)} 天`;
}

/** 给人看的一行时效说明；没走缓存就返回 null。 */
export function describeCache(cache, { label = '数据' } = {}) {
  if (!cache?.hit) return null;
  const age = formatAge(cache.ageSeconds);
  if (cache.stale) return `⚠ ${label}取自 ${age}前的本地缓存（实时刷新失败）`;
  return `${label}来自本地缓存（${age}前写入，${
    cache.ttlSeconds ? `保鲜期 ${Math.round(cache.ttlSeconds / 3600)} 小时` : '长期有效'
  }）。要强制刷新加 --refresh`;
}

export function formatCacheListText(entries) {
  if (entries.length === 0) {
    return '本地暂无缓存。跑一次 course list 或 grade list 就会生成。';
  }

  const lines = [`本地缓存（${entries.length} 项）· 目录 ~/.henu-cli/cache`, ''];
  for (const entry of entries) {
    const size = entry.sizeBytes < 1024
      ? `${entry.sizeBytes} B`
      : `${(entry.sizeBytes / 1024).toFixed(1)} kB`;
    const age = entry.readable ? formatAge(entry.ageSeconds) : '无法解析';
    lines.push(`  ${entry.key.padEnd(12)} ${age.padEnd(8)} ${size}`);
  }
  lines.push('');
  lines.push('清理：henu-cli cache clear [--key timetable|grades|all]');
  return lines.join('\n');
}
