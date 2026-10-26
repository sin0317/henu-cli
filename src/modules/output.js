import { randomBytes } from 'node:crypto';

/**
 * 生成一次执行的对账 id。
 *
 * 为什么需要：用户报障时通常只贴一段报错文字，维护者没法确认「这是哪一次运行、
 * 和 dump 文件里的记录对不对得上」。给每个响应带上一个短 id，用户贴一行就能锚定。
 *
 * 结构：`req_` + 毫秒时间戳（base36，8 位）+ 进程内序号（base36，2 位）+ 2 字节随机。
 * - 时间在前，维护者按字符串排序就能看出先后；
 * - 序号保证同毫秒内连续多次调用不重复（只靠随机时 200 次约 30% 会撞）；
 * - 随机位兜住「同一毫秒、两个进程各自生成」的情况。
 */
let sequence = 0;

export function newRequestId(now = Date.now()) {
  const ms = now instanceof Date ? now.getTime() : Number(now);
  const stamp = (Number.isFinite(ms) && ms > 0 ? Math.floor(ms) : 0).toString(36).padStart(8, '0');
  sequence = (sequence + 1) % 1296; // 1296 = 36^2，序号固定两位
  return `req_${stamp}${sequence.toString(36).padStart(2, '0')}${randomBytes(2).toString('hex')}`;
}

export function successEnvelope(data, meta = {}) {
  return {
    ok: true,
    data,
    meta: withDefaults(meta)
  };
}

/**
 * 一次进程执行共用一个 requestId。
 *
 * 粒度选「一次命令」而不是「一次响应」，是因为诊断文件是在命令执行中途写出的
 * （`describeDiagnostics` 那几处），如果 id 在响应阶段才生成，dump 文件和最终
 * 报错就对不上了。调用方在入口 `beginRun()` 一次即可。
 */
let currentRequestId = null;

export function beginRun(now = Date.now()) {
  currentRequestId = newRequestId(now);
  return currentRequestId;
}

export function getRequestId() {
  return currentRequestId;
}

/** 测试用：清掉进程级状态，避免用例之间互相影响。 */
export function resetRequestId() {
  currentRequestId = null;
}

export function errorEnvelope(error, meta = {}) {
  return {
    ok: false,
    error,
    meta: withDefaults(meta)
  };
}

export function writeJson(payload) {
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
}

/**
 * 没有自述 hint 时的兜底建议。
 *
 * 原则：错误信息必须包含「下一步做什么」。只说「失败了」等于把问题丢回给用户。
 * 已知错误码各自写了具体 hint（`error.hint`），这里只兜住漏写和未知异常。
 */
const ARGUMENT_CODES = new Set(['INVALID_ARGUMENT', 'BROWSER_SELECTION_INVALID']);

export function defaultHintFor(code) {
  if (ARGUMENT_CODES.has(code)) {
    return '看 henu-cli --help 里对应命令的参数说明，或加 --text 用人类可读方式重跑一次。';
  }
  return '加 --dump 重跑一次，把 ~/.henu-cli/diagnostics-*.json 和 meta.requestId 一起提给维护者；'
    + '也可以加 --headed 观察浏览器实际停在哪一步。';
}

export function toErrorShape(error) {
  const code = error?.code ?? 'INTERNAL_ERROR';
  return {
    code,
    message: error instanceof Error ? error.message : String(error),
    hint: error?.hint || defaultHintFor(code),
    ...(error?.details ? { details: error.details } : {})
  };
}

/**
 * 把错误信封渲染成人能读的几行，给 `--text` 模式用。
 *
 * 三段固定：出了什么错（code + message）、下一步做什么（hint）、怎么和日志对上（requestId）。
 * 缺了「下一步」的报错等于把问题原样退回给用户，所以 hint 为空时兜底也补上。
 */
export function formatErrorText(envelope) {
  const error = envelope?.error ?? {};
  const code = error.code ?? 'INTERNAL_ERROR';
  const message = String(error.message ?? '').trim();
  const lines = [`✗ 出错：${code}`];
  for (const line of message.split(/\r?\n/)) {
    lines.push(`  ${line}`);
  }
  lines.push(`  下一步：${error.hint || defaultHintFor(code)}`);
  const requestId = envelope?.meta?.requestId;
  if (requestId) {
    lines.push(`  对账 id：${requestId}（报障时把这个和 --dump 生成的诊断文件一起贴上）`);
  }
  return lines.join('\n');
}

function withDefaults(meta) {
  return {
    cli: 'henu-cli',
    gateway: 'auto',
    backend: process.env.HENU_BROWSER_BACKEND === 'mock' ? 'mock' : 'playwright',
    requestId: meta.requestId ?? currentRequestId ?? newRequestId(),
    ...meta
  };
}
