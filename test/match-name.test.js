import assert from 'node:assert/strict';
import test from 'node:test';

import { listNames, normalizeName, pickByName } from '../src/modules/match-name.js';

const CAMPUSES = [
  { id: '1', name: '金明校区' },
  { id: '32', name: '明伦校区' }
];

test('归一化：去空格、去括号补充、去默认前缀', () => {
  assert.equal(normalizeName(' 金明 三楼 '), '金明三楼');
  assert.equal(normalizeName('金明三楼（东）'), '金明三楼');
  assert.equal(normalizeName('河南大学图书馆金明校区'), '金明校区');
  assert.equal(normalizeName('Jinming Campus'), 'jinming');
});

test('精确匹配优先，大小写外的写法不误伤', () => {
  assert.equal(pickByName(CAMPUSES, '金明校区')?.id, '1');
  assert.equal(pickByName(CAMPUSES, '明伦校区')?.id, '32');
});

test('归一化相等：省略校名后缀也能命中', () => {
  assert.equal(pickByName(CAMPUSES, '金明')?.id, '1');
  assert.equal(pickByName(CAMPUSES, '河南大学金明校区图书馆')?.id, '1');
});

test('子串兜底落到多个候选时不猜，直接返回 null', () => {
  const floors = [{ name: '一楼' }, { name: '二楼' }];
  assert.equal(pickByName(floors, '楼'), null);
  assert.equal(pickByName([{ name: '金明三楼' }], '三楼')?.name, '金明三楼');
});

test('空值不入第三级：目标归一化为空时直接返回 null', () => {
  assert.equal(pickByName(CAMPUSES, ''), null);
  assert.equal(pickByName(CAMPUSES, '（全校区）'), null);
  assert.equal(pickByName([], '金明'), null);
});

test('listNames 用于出错时告诉用户有哪些可选值', () => {
  assert.deepEqual(listNames(CAMPUSES), ['金明校区', '明伦校区']);
  assert.deepEqual(listNames([{ label: 'x' }], (row) => row.label), ['x']);
});
