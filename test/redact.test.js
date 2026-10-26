import assert from 'node:assert/strict';
import test from 'node:test';

import { redactSecrets } from '../src/modules/redact.js';
import { errorEnvelope, successEnvelope, toErrorShape } from '../src/modules/output.js';

// 真实形态的 JWT（字符已改），用来确认票据不会原样出现在输出里
const JWT = 'eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJpZCI6IjIzMTAyMDAxNjkiLCJuYW1lIjoi5YiY5ZO25rqxIn0.fdcff1c2de29e648e2fa267a83dc5ab';

test('敏感字段按 key 名打码，大小写混写也一样', () => {
  assert.deepEqual(redactSecrets({ token: JWT }), { token: '<redacted>' });
  assert.deepEqual(redactSecrets({ accessToken: JWT }), { accessToken: '<redacted>' });
  assert.deepEqual(redactSecrets({ Authorization: `bearer${JWT}` }), { Authorization: '<redacted>' });
  assert.deepEqual(redactSecrets({ 'Set-Cookie': 'CASTGC=abc' }), { 'Set-Cookie': '<redacted>' });
});

test('业务字段一律不动，否则排障就瞎了', () => {
  const payload = { roomId: '53', name: '研讨间301', available: [{ label: '08:00-08:30' }], requestId: 'req_abc' };
  assert.deepEqual(redactSecrets(payload), payload);
});

test('嵌套与数组里藏着的票据也会被拦下', () => {
  const redacted = redactSecrets({ data: { rows: [{ cookie: 'x' }, { token: JWT }] } });
  assert.deepEqual(redacted, { data: { rows: [{ cookie: '<redacted>' }, { token: '<redacted>' }] } });
});

test('混在文本里的 bearer 头与 JWT 会被擦掉', () => {
  const text = `Authorization: bearer${JWT}`;
  assert.match(redactSecrets(text), /redacted/);
  assert.doesNotMatch(redactSecrets(text), /eyJ0eXAi/);
});

test('文本里的 CAS 票据与 sessionid 会被擦掉', () => {
  assert.equal(redactSecrets('ticket=ST-280816-KFk73qcIBosYEVc6GhYBr-Rapoccentos'), 'ticket=ST-<redacted>');
  assert.equal(redactSecrets('Cookie: CASTGC=TGT-123456-abc'), 'Cookie: CASTGC=<redacted>');
  assert.equal(redactSecrets('JSESSIONID=a1b2c3; path=/'), 'JSESSIONID=<redacted>; path=/');
});

test('null / undefined / 数字原样通过', () => {
  assert.equal(redactSecrets(null), null);
  assert.equal(redactSecrets(undefined), undefined);
  assert.equal(redactSecrets(42), 42);
});

test('循环引用不会把进程跑死：深度到上限后截断', () => {
  const cyclic = { name: 'x' };
  cyclic.self = cyclic;

  const redacted = redactSecrets(cyclic);
  let node = redacted;
  for (let i = 0; i < 20 && typeof node === 'object'; i += 1) node = node.self;

  assert.equal(node, '[truncated]');
  assert.doesNotThrow(() => JSON.stringify(redacted));
});

test('成功与失败信封经过 writeJson 前都要先脱敏：直接验 writeJson 的依赖链路', () => {
  const success = successEnvelope({ userInfo: { name: '李某' }, _v4_token: JWT });
  assert.equal(redactSecrets(success).data._v4_token, '<redacted>');
  assert.equal(redactSecrets(success).data.userInfo.name, '李某');

  const failure = errorEnvelope(toErrorShape(Object.assign(new Error('登录失败'), { details: { Authorization: 'x' } })));
  assert.equal(redactSecrets(failure).error.details.Authorization, '<redacted>');
  assert.equal(redactSecrets(failure).ok, false);
});
