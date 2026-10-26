import assert from 'node:assert/strict';
import test from 'node:test';

import { describeCasFailure, describeCasPage } from '../src/modules/cas-errors.js';

test('页面里有明确错误容器时，取容器里的文字', () => {
  assert.equal(describeCasPage('<div id="msg" class="error">用户名或密码错误</div>'), '用户名或密码错误');
  assert.equal(describeCasPage('<span id="showErrorTip">验证码错误</span>'), '验证码错误');
});

test('容器里的 HTML 实体会被还原', () => {
  assert.equal(describeCasPage('<div id="msg">账号&amp;密码不匹配</div>'), '账号&密码不匹配');
});

test('没有容器时在正文里找关键词，长句优先于短句', () => {
  assert.equal(describeCasPage('<p>抱歉，账号或密码错误，请重新输入</p>'), '账号或密码错误');
  assert.equal(describeCasPage('<div>对不起，您的账号已锁定</div>'), '账号已锁定');
});

test('出现验证码控件但没报错文字时，提示需要验证码', () => {
  assert.equal(describeCasPage('<input id="captcha" name="captcha">'), '需要验证码');
});

test('认不出原因就返回空，交给调用方兜底，不硬编造', () => {
  assert.equal(describeCasPage(''), '');
  assert.equal(describeCasPage('<html><body>登录</body></html>'), '');
});

test('describeCasFailure 把原因拼成一句完整的话', () => {
  assert.equal(describeCasFailure({ html: '<div id="msg">密码错误</div>' }), '登录失败：密码错误');
});

test('describeCasFailure 认不出原因时说清楚是页面结构变了', () => {
  const message = describeCasFailure({ html: '<body>hi</body>', missingFields: ['execution', 'pwdEncryptSalt'] });
  assert.match(message, /execution \/ pwdEncryptSalt/);
  assert.match(message, /改版/);
});
