import assert from 'node:assert/strict';
import test from 'node:test';

import {
  beginRun,
  defaultHintFor,
  errorEnvelope,
  getRequestId,
  newRequestId,
  resetRequestId,
  successEnvelope,
  toErrorShape
} from '../src/modules/output.js';

test('newRequestId 结构固定：req_ + 时间戳 8 位 + 序号 2 位 + 随机 4 位', () => {
  const id = newRequestId();
  assert.match(id, /^req_[0-9a-z]{8}[0-9a-z]{2}[0-9a-f]{4}$/, `实际值 ${id}`);
  assert.equal(id.length, 4 + 8 + 2 + 4);
});

test('newRequestId 同一毫秒内不重复（进程内序号保证）', () => {
  const now = 1799000000000;
  const ids = new Set(Array.from({ length: 200 }, () => newRequestId(now)));
  assert.equal(ids.size, 200);
});

test('newRequestId 时间在序号与随机位之前，字符串排序等于时间顺序', () => {
  const early = newRequestId(1799000000000);
  const late = newRequestId(1799000005000);
  assert.ok(early.slice(4, 12) < late.slice(4, 12), `${early} 应排在 ${late} 之前`);
  assert.ok(early < late, '整个 id 的字典序也应与时间一致（同长度前提下）');
});

test('newRequestId 传入 Date 与毫秒等价', () => {
  const ms = 1799000000000;
  assert.equal(newRequestId(new Date(ms)).slice(4, 12), newRequestId(ms).slice(4, 12));
});

test('beginRun 之后，成功与失败信封共用同一个 requestId', () => {
  resetRequestId();
  const id = beginRun();
  assert.equal(getRequestId(), id);
  assert.equal(successEnvelope({ a: 1 }).meta.requestId, id);
  assert.equal(errorEnvelope({ code: 'X' }).meta.requestId, id);
  resetRequestId();
});

test('没有 beginRun 时信封也会带上 requestId，不至于缺字段', () => {
  resetRequestId();
  const envelope = successEnvelope([]);
  assert.match(envelope.meta.requestId, /^req_/);
  resetRequestId();
});

test('显式传入的 requestId 优先于进程级的', () => {
  const id = beginRun();
  assert.equal(successEnvelope({}, { requestId: 'req_fixed' }).meta.requestId, 'req_fixed');
  assert.notEqual(id, 'req_fixed');
  resetRequestId();
});

test('toErrorShape 对未知异常兜底出 hint，不能只说失败了', () => {
  const shape = toErrorShape(new Error('boom'));
  assert.equal(shape.code, 'INTERNAL_ERROR');
  assert.equal(shape.message, 'boom');
  assert.match(shape.hint, /requestId/, '兜底提示要告诉用户把 requestId 一起贴上');
});

test('toErrorShape 保留自带的 hint，不被兜底覆盖', () => {
  const error = new Error('登录态失效');
  error.code = 'AUTH_REQUIRED';
  error.hint = '先运行 henu-cli auth login。';
  const shape = toErrorShape(error);
  assert.equal(shape.hint, '先运行 henu-cli auth login。');
});

test('toErrorShape 对参数类错误指向 --help 而不是 --dump', () => {
  const shape = toErrorShape(Object.assign(new Error('缺少参数'), { code: 'INVALID_ARGUMENT' }));
  assert.match(shape.hint, /--help/);
  assert.doesNotMatch(shape.hint, /diagnostics/);
});

test('defaultHintFor 对未知错误码也给建议', () => {
  assert.match(defaultHintFor('SOMETHING_NEW'), /--dump/);
  assert.match(defaultHintFor('BROWSER_SELECTION_INVALID'), /--help/);
});

test('toErrorShape 透传 details，非 Error 值也能序列化', () => {
  const error = new Error('页面不对');
  error.code = 'PAGE_UNRECOGNIZED';
  error.details = { finalUrl: 'https://example.test' };
  assert.deepEqual(toErrorShape(error).details, { finalUrl: 'https://example.test' });

  const plain = toErrorShape('字符串错误');
  assert.equal(plain.code, 'INTERNAL_ERROR');
  assert.equal(plain.message, '字符串错误');
});
