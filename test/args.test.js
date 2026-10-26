import assert from 'node:assert/strict';
import test from 'node:test';

import { collectList, firstPositional, getOption, hasFlag } from '../src/modules/args.js';

test('firstPositional 跳过选项，不会把 --text 当成检索词', () => {
  assert.equal(firstPositional(['--text']), undefined);
  assert.equal(firstPositional(['--text', '药物化学']), '药物化学');
  assert.equal(firstPositional(['药物化学', '--text']), '药物化学');
  assert.equal(firstPositional([]), undefined);
});

test('firstPositional 也跳过单横线短选项', () => {
  assert.equal(firstPositional(['-v']), undefined);
  assert.equal(firstPositional(['-h', 'chinese']), 'chinese');
});

test('firstPositional 只认字符串，其他类型直接跳过', () => {
  assert.equal(firstPositional([null, undefined, 42, 'x']), 'x');
  assert.equal(firstPositional([null, 42]), undefined);
  assert.equal(firstPositional(undefined), undefined);
});

test('getOption 取值，遇到下一个选项视为未提供', () => {
  assert.equal(getOption(['--field', 'title'], '--field'), 'title');
  assert.equal(getOption(['--field'], '--field'), undefined);
  assert.equal(getOption(['--field', '--text'], '--field'), undefined);
  assert.equal(getOption(['--other', 'x'], '--field'), undefined);
});

test('hasFlag 只做精确匹配', () => {
  assert.equal(hasFlag(['--text'], '--text'), true);
  assert.equal(hasFlag(['--textual'], '--text'), false);
  assert.equal(hasFlag(undefined, '--text'), false);
});

test('collectList 支持逗号分隔与重复传参', () => {
  assert.deepEqual(collectList(['--items', 'a,b'], '--items'), ['a', 'b']);
  assert.deepEqual(collectList(['--items', 'a', '--items', 'b'], '--items'), ['a', 'b']);
  assert.deepEqual(collectList(['--items', 'a，b'], '--items'), ['a', 'b'], '中文逗号也要认');
  assert.deepEqual(collectList(['--items', '--text'], '--items'), [], '后面紧跟选项时不当成值');
  assert.deepEqual(collectList([], '--items'), []);
});
