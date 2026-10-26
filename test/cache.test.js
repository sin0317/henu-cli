// 缓存层的单测：全部用临时目录，不碰真实 ~/.henu-cli，也不联网。
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  cacheDir,
  cachePath,
  describeCache,
  dropAllCache,
  dropCache,
  formatAge,
  formatCacheListText,
  listCache,
  readCache,
  readThroughCache,
  safeName,
  writeCache
} from '../src/modules/cache.js';

function tempHome() {
  return mkdtempSync(join(tmpdir(), 'henu-cache-'));
}

test('writeCache 之后 readCache 能读回同样的数据', () => {
  const home = tempHome();
  try {
    writeCache('timetable', { term: '2026-2027学年第一学期', table: { rows: [['a']] } }, { home, now: 1_000_000 });
    const entry = readCache('timetable', { home, now: 1_000_000 });
    assert.ok(entry);
    assert.equal(entry.data.term, '2026-2027学年第一学期');
    assert.deepEqual(entry.data.table.rows, [['a']]);
    assert.equal(entry.savedAt, 1_000_000);
    assert.equal(entry.ageSeconds, 0);
    assert.equal(entry.expired, false);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('ageSeconds 按 now 与 savedAt 的差算，过期由 ttlSeconds 决定', () => {
  const home = tempHome();
  try {
    writeCache('grades', { ok: true }, { home, now: 0 });

    const fresh = readCache('grades', { home, now: 60_000, ttlSeconds: 3600 });
    assert.equal(fresh.ageSeconds, 60);
    assert.equal(fresh.expired, false);

    const stale = readCache('grades', { home, now: 7_200_000, ttlSeconds: 3600 });
    assert.equal(stale.ageSeconds, 7200);
    assert.equal(stale.expired, true);
    assert.deepEqual(stale.data, { ok: true }, '过期也要能读到数据，留给降级兜底用');

    const noTtl = readCache('grades', { home, now: 999_999_999 });
    assert.equal(noTtl.expired, false, '不传 ttl 时不判过期');
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('缓存文件损坏时当作没有缓存，不抛异常', () => {
  const home = tempHome();
  try {
    mkdirSync(cacheDir({ home }), { recursive: true });
    writeFileSync(cachePath('timetable', { home }), '{"version":1,"savedAt":', 'utf8');
    assert.equal(readCache('timetable', { home }), null);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('版本号不符或缺少 savedAt 一律不认', () => {
  const home = tempHome();
  try {
    mkdirSync(cacheDir({ home }), { recursive: true });

    writeFileSync(cachePath('a', { home }), JSON.stringify({ version: 99, savedAt: 1, data: 1 }), 'utf8');
    assert.equal(readCache('a', { home }), null);

    writeFileSync(cachePath('b', { home }), JSON.stringify({ version: 1, data: 1 }), 'utf8');
    assert.equal(readCache('b', { home }), null);

    writeFileSync(cachePath('c', { home }), JSON.stringify({ version: 1, savedAt: 1 }), 'utf8');
    assert.equal(readCache('c', { home }), null);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('缓存文件名只保留安全字符，挡住路径穿越', () => {
  assert.equal(safeName('timetable'), 'timetable');
  assert.equal(safeName('../../etc/passwd'), 'etc-passwd');
  assert.equal(safeName('a b/c'), 'a-b-c');
  assert.equal(safeName(''), 'unnamed');
  assert.equal(safeName('..'), 'unnamed', '全是点号时不能退化成上级目录');

  const home = tempHome();
  try {
    const written = writeCache('../../evil', { x: 1 }, { home });
    assert.ok(
      written.path.startsWith(cacheDir({ home })),
      `缓存文件必须落在缓存目录内，实际是 ${written.path}`
    );
    assert.deepEqual(listCache({ home }).map((entry) => entry.key), ['evil']);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('readThroughCache 命中缓存时不再调用 loader', async () => {
  const home = tempHome();
  try {
    writeCache('timetable', { rows: ['cached'] }, { home, now: 1000 });

    let called = 0;
    const result = await readThroughCache({
      key: 'timetable',
      ttlSeconds: 3600,
      home,
      now: 2000,
      loader: async () => {
        called += 1;
        return { rows: ['network'] };
      }
    });

    assert.equal(called, 0);
    assert.equal(result.cache.hit, true);
    assert.equal(result.cache.stale, false);
    assert.equal(result.cache.ageSeconds, 1);
    assert.deepEqual(result.data.rows, ['cached']);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('readThroughCache 没缓存时跑 loader 并落盘', async () => {
  const home = tempHome();
  try {
    const result = await readThroughCache({
      key: 'grades',
      ttlSeconds: 3600,
      home,
      now: 5000,
      loader: async () => ({ records: [1, 2, 3] })
    });

    assert.equal(result.cache.hit, false);
    assert.equal(result.cache.savedAt, 5000);
    assert.deepEqual(result.data.records, [1, 2, 3]);
    assert.deepEqual(readCache('grades', { home }).data.records, [1, 2, 3], '结果要写进缓存');
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('refresh=true 绕过未过期的缓存', async () => {
  const home = tempHome();
  try {
    writeCache('timetable', { rows: ['old'] }, { home, now: 1000 });

    const result = await readThroughCache({
      key: 'timetable',
      ttlSeconds: 3600,
      refresh: true,
      home,
      now: 2000,
      loader: async () => ({ rows: ['new'] })
    });

    assert.equal(result.cache.hit, false);
    assert.deepEqual(result.data.rows, ['new']);
    assert.deepEqual(readCache('timetable', { home }).data.rows, ['new'], '新数据要覆盖旧缓存');
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('过期且 loader 失败时退回旧缓存，并带 warning', async () => {
  const home = tempHome();
  try {
    writeCache('timetable', { rows: ['stale'] }, { home, now: 0 });

    const error = new Error('登录失效');
    error.code = 'AUTH_REQUIRED';

    const result = await readThroughCache({
      key: 'timetable',
      ttlSeconds: 60,
      home,
      now: 600_000,
      loader: async () => {
        throw error;
      }
    });

    assert.equal(result.cache.hit, true);
    assert.equal(result.cache.stale, true);
    assert.deepEqual(result.data.rows, ['stale']);
    assert.match(result.warning, /AUTH_REQUIRED/);
    assert.match(result.warning, /可能不是最新/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('没有缓存时 loader 失败要照原样抛出，不能吞错', async () => {
  const home = tempHome();
  try {
    const error = new Error('后端 405');
    error.code = 'BACKEND_UNAVAILABLE';

    await assert.rejects(
      () => readThroughCache({
        key: 'grades',
        ttlSeconds: 60,
        home,
        loader: async () => {
          throw error;
        }
      }),
      (thrown) => thrown.code === 'BACKEND_UNAVAILABLE'
    );
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('dropCache 只删指定键，dropAllCache 清空目录', () => {
  const home = tempHome();
  try {
    writeCache('timetable', { a: 1 }, { home });
    writeCache('grades', { b: 2 }, { home });

    assert.equal(dropCache('timetable', { home }), true);
    assert.equal(readCache('timetable', { home }), null);
    assert.ok(readCache('grades', { home }), '别的键不能受影响');

    assert.equal(dropAllCache({ home }), 1);
    assert.equal(listCache({ home }).length, 0);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('listCache 给出大小和年龄，坏文件标记为不可解析', () => {
  const home = tempHome();
  try {
    writeCache('timetable', { rows: ['x'.repeat(200)] }, { home, now: 0 });
    mkdirSync(cacheDir({ home }), { recursive: true });
    writeFileSync(cachePath('broken', { home }), 'not json', 'utf8');

    const entries = listCache({ home, now: 7200_000 });
    const timetable = entries.find((entry) => entry.key === 'timetable');
    const broken = entries.find((entry) => entry.key === 'broken');

    assert.ok(timetable.sizeBytes > 200);
    assert.equal(timetable.readable, true);
    assert.equal(timetable.ageSeconds, 7200);

    assert.equal(broken.readable, false);
    assert.equal(broken.ageSeconds, null);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('formatAge 覆盖秒/分/时/天四档', () => {
  assert.equal(formatAge(0), '刚刚');
  assert.equal(formatAge(59), '刚刚');
  assert.equal(formatAge(60), '1 分钟');
  assert.equal(formatAge(3599), '60 分钟');
  assert.equal(formatAge(3600), '1 小时');
  assert.equal(formatAge(86_399), '24 小时');
  assert.equal(formatAge(86_400), '1 天');
  assert.equal(formatAge(null), '未知时间');
  assert.equal(formatAge(NaN), '未知时间');
});

test('describeCache 只在真的走缓存时说话', () => {
  assert.equal(describeCache(undefined), null);
  assert.equal(describeCache({ hit: false, stale: false }), null);

  assert.match(describeCache({ hit: true, stale: false, ageSeconds: 120, ttlSeconds: 21600 }), /2 分钟/);
  assert.match(describeCache({ hit: true, stale: false, ageSeconds: 120, ttlSeconds: 21600 }), /--refresh/);

  const stale = describeCache({ hit: true, stale: true, ageSeconds: 9000 }, { label: '成绩' });
  assert.match(stale, /^⚠/);
  assert.match(stale, /成绩/);
  assert.match(stale, /实时刷新失败/);
});

test('formatCacheListText 空列表与非空列表都有可读输出', () => {
  assert.match(formatCacheListText([]), /暂无缓存/);

  const text = formatCacheListText([
    { key: 'timetable', sizeBytes: 2048, readable: true, ageSeconds: 100 },
    { key: 'grades', sizeBytes: 40, readable: false, ageSeconds: null }
  ]);
  assert.match(text, /timetable/);
  assert.match(text, /2\.0 kB/);
  assert.match(text, /40 B/);
  assert.match(text, /无法解析/);
});

test('写入采用临时文件改名，目录里不留 .tmp', () => {
  const home = tempHome();
  try {
    writeCache('timetable', { a: 1 }, { home });
    writeCache('timetable', { a: 2 }, { home });

    const leftovers = listCache({ home }).length;
    assert.equal(leftovers, 1, '重复写同一个键只能留一个文件');
    assert.equal(JSON.parse(readFileSync(cachePath('timetable', { home }), 'utf8')).data.a, 2);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
