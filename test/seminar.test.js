import assert from 'node:assert/strict';
import test from 'node:test';

import {
  complementSlots,
  formatSeminarAreasText,
  formatSeminarDatesText,
  formatSeminarRoomsText,
  mergeSlots,
  normalizeRoom,
  normalizeRooms,
  normalizeSift,
  normalizeSlots
} from '../src/modules/seminar.js';

// 真实返回：POST /v4/seminar/sift（免登录，字段名保持原样）
const SIFT = {
  code: 0,
  message: '操作成功',
  data: {
    premises: [
      { id: '1', name: '金明校区', levels: '1', enname: 'Jinming Campus', parentId: '0', sort: '1' },
      { id: '32', name: '明伦校区', levels: '1', enname: 'Minglun Campus', parentId: '0', sort: '2' }
    ],
    storey: [
      { id: '3', name: '金明三楼', levels: '2', enname: '3F', parentId: '1', sort: '13', list: [{ id: '3', parentId: '1' }] },
      { id: '35', name: '明伦四层', levels: '2', enname: '4F', parentId: '32', sort: '24', list: [{ id: '35', parentId: '32' }] },
      { id: '36', name: '明伦五层', levels: '2', enname: '5F', parentId: '32', sort: '25', list: [{ id: '36', parentId: '32' }] }
    ],
    category: [],
    boutique: [
      { id: '2', name: '耳语', enname: 'whisper', icon: 'https://zwyy.henu.edu.cn/icon/ske-icon-whisper.png' }
    ],
    date: ['2026-10-26', '2026-10-27'],
    members: { min: 0, max: 10, step: 1 },
    time: { start_time: '08:00:00', end_time: '22:00:00', start_num: 480, end_num: 1320 }
  }
};

// 真实返回：POST /v4/seminar/list 里的一间（id=53，2026-10-27）
const ROOM_BUSY = {
  id: '53',
  name: '研讨间301（4-8人使用，最少4人预约、签到）',
  enname: 'Seminar Room 301',
  nameMerge: '金明校区-金明三楼-研讨间301（4-8人使用，最少4人预约、签到）',
  minPerson: '4',
  maxPerson: '8',
  step: '15',
  start_timestamp: '2026-10-27 08:00:00',
  end_timestamp: '2026-10-27 22:00:00',
  begin_num: 480,
  end_num: 1320,
  top_name: '金明校区',
  storey_name: '金明三楼',
  date: [
    { areaId: '53', begin_timestamp: '2026-10-27 08:30:00', end_timestamp: '2026-10-27 10:30:00', begin_num: 510, end_num: 630 },
    { areaId: '53', begin_timestamp: '2026-10-27 10:30:00', end_timestamp: '2026-10-27 12:15:00', begin_num: 630, end_num: 735 },
    { areaId: '53', begin_timestamp: '2026-10-27 15:00:00', end_timestamp: '2026-10-27 16:59:59', begin_num: 900, end_num: 1019 },
    { areaId: '53', begin_timestamp: '2026-10-27 18:00:00', end_timestamp: '2026-10-27 19:59:59', begin_num: 1080, end_num: 1199 }
  ]
};

test('sift：楼层按 parentId 挂到对应校区下', () => {
  const result = normalizeSift(SIFT);
  assert.equal(result.source, 'live');
  assert.deepEqual(result.campuses.map((campus) => campus.name), ['金明校区', '明伦校区']);
  assert.deepEqual(result.campuses[0].storeys.map((item) => item.name), ['金明三楼']);
  assert.deepEqual(result.campuses[1].storeys.map((item) => item.name), ['明伦四层', '明伦五层']);
  assert.deepEqual(result.campuses[0].storeys[0], { id: '3', name: '金明三楼', enname: '3F' });
});

test('sift：开放时间与人数区间来自 time / members', () => {
  const result = normalizeSift(SIFT);
  assert.deepEqual(result.rules.open, { start: '08:00', end: '22:00' });
  assert.deepEqual(result.rules.members, { min: 0, max: 10, step: 1 });
  assert.deepEqual(result.dates, ['2026-10-26', '2026-10-27']);
  assert.deepEqual(result.facilities, [{ id: '2', name: '耳语' }]);
});

test('sift：time 里没有干净时间串时退回 start_num 换算', () => {
  const result = normalizeSift({ data: { premises: [], storey: [], time: { start_num: 480, end_num: 1320 } } });
  assert.deepEqual(result.rules.open, { start: '08:00', end: '22:00' });
});

test('占用时段：结束时间是 xx:59:59 时进位，否则 FOR 短线用错', () => {
  const slots = normalizeSlots([
    { begin_timestamp: '2026-10-27 15:00:00', end_timestamp: '2026-10-27 16:59:59', begin_num: 900, end_num: 1019 }
  ]);
  assert.equal(slots.length, 1);
  assert.deepEqual(slots[0], { startNum: 900, endNum: 1020 });
});

test('合并：首尾相接的占用连成一段', () => {
  const merged = mergeSlots([
    { startNum: 510, endNum: 630 },
    { startNum: 630, endNum: 735 }
  ], 480, 1320);
  assert.deepEqual(merged, [{ startNum: 510, endNum: 735 }]);
});

test('合并：超出开放区间的占用被裁掉，不与另半段重叠', () => {
  const merged = mergeSlots([{ startNum: 100, endNum: 1400 }], 480, 1320);
  assert.deepEqual(merged, [{ startNum: 480, endNum: 1320 }]);
});

test('可用时段 = 开放区间减去已合并占用', () => {
  const free = complementSlots([{ startNum: 510, endNum: 735 }], 480, 1320);
  assert.deepEqual(free, [{ startNum: 480, endNum: 510 }, { startNum: 735, endNum: 1320 }]);
});

test('可用时段：开放区间缺失或不合法时返回空，不猜', () => {
  assert.deepEqual(complementSlots([], null, 1320), []);
  assert.deepEqual(complementSlots([], 1320, 480), []);
});

test('房间：xs:59:59 的占用不会漏出 1 分钟伪空闲', () => {
  const room = normalizeRoom(ROOM_BUSY);
  assert.equal(room.id, '53');
  assert.deepEqual(room.capacity, { min: 4, max: 8 });
  assert.deepEqual(room.occupied.map((slot) => slot.label), ['08:30-10:30', '10:30-12:15', '15:00-17:00', '18:00-20:00']);
  assert.deepEqual(room.available.map((slot) => slot.label), ['08:00-08:30', '12:15-15:00', '17:00-18:00', '20:00-22:00']);
  assert.equal(room.open.label, '08:00-22:00');
  // 08:00-22:00 共 840 分钟，减去 120+105+120+120 = 465
  assert.equal(room.freeMinutes, 375);
  assert.equal(room.freeLabel, '6 小时 15 分');
});

test('房间：全天没人约时标记为完全空闲', () => {
  const room = normalizeRoom({ ...ROOM_BUSY, date: [] });
  assert.equal(room.isFullyFree, true);
  assert.equal(room.freeMinutes, 840);
  assert.deepEqual(room.occupied, []);
});

test('房间：名字里的括号说明剥到 shortName，原文留在 name', () => {
  const room = normalizeRoom(ROOM_BUSY);
  assert.equal(room.shortName, '研讨间301');
  assert.match(room.name, /^金明校区-金明三楼-研讨间301（/);
});

test('房间：开放时间缺失时 begin/end 仍能解释', () => {
  const room = normalizeRoom({ ...ROOM_BUSY, begin_num: null, end_num: null, start_timestamp: '2026-10-27 08:00:00', end_timestamp: '2026-10-27 22:00:00' });
  assert.equal(room.open.label, '08:00-22:00');
});

test('列表：total 取接口的，房间缺省时按条数兜底', () => {
  const result = normalizeRooms({ data: { total: 6, data: [ROOM_BUSY] } }, { date: '2026-10-27' });
  assert.equal(result.total, 6);
  assert.equal(result.rooms.length, 1);
  assert.equal(result.date, '2026-10-27');

  const fallback = normalizeRooms({ data: { data: [ROOM_BUSY] } });
  assert.equal(fallback.total, 1);
});

test('文本：区域输出带上开放时间与「去哪查房间」的下一步', () => {
  const text = formatSeminarAreasText(normalizeSift(SIFT));
  assert.match(text, /开放 08:00-22:00/);
  assert.match(text, /单间最多 10 人/);
  assert.match(text, /金明三楼/);
  assert.match(text, /library seminar rooms/);
});

test('文本：兜底数据会把「不是实时」说在第一行', () => {
  const text = formatSeminarAreasText({
    ...normalizeSift(SIFT),
    source: 'static_fallback',
    warning: '实时接口取不到（超时）'
  });
  assert.match(text.split('\n')[0], /⚠/);
});

test('文本：日期输出标出今天', () => {
  const text = formatSeminarDatesText({ source: 'live', today: '2026-10-26', dates: ['2026-10-26', '2026-10-27'], count: 2, windowLabel: 'x' });
  assert.match(text, /2026-10-26\s+（今天）/);
  assert.match(text, /共 2 天/);
});

test('文本：房间输出先给可用时段，没空档时说清楚', () => {
  const busy = normalizeRooms({ data: { total: 1, data: [ROOM_BUSY] } }, { date: '2026-10-27' });
  const text = formatSeminarRoomsText({ ...busy, filter: { date: '2026-10-27' }, count: 1 });
  assert.match(text, /\[53\] 研讨间301/);
  assert.match(text, /可约 08:00-08:30/);
  assert.match(text, /已约 08:30-10:30/);
  assert.match(text, /只做查询/);

  const full = normalizeRooms({ data: { total: 1, data: [{ ...ROOM_BUSY, begin_num: 480, end_num: 1320, date: [{ begin_num: 480, end_num: 1320, begin_timestamp: '2026-10-27 08:00:00', end_timestamp: '2026-10-27 22:00:00' }] }] } }, { date: '2026-10-27' });
  assert.match(formatSeminarRoomsText({ ...full, filter: { date: '2026-10-27' }, count: 1 }), /全天已约满/);
});

test('文本：筛完一间不剩时给出放宽条件的提示', () => {
  const text = formatSeminarRoomsText({ rooms: [], count: 0, total: 6, filter: { date: '2026-10-27' } });
  assert.match(text, /--free-only/);
});
