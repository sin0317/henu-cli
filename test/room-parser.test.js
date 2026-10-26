import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildRoomQuery,
  parseFreeRooms,
  parseRoomGrid,
  periodLabel,
  resolveBuilding,
  resolveCampus,
  resolveParity,
  resolvePeriods,
  resolveRoomType,
  resolveWeekdayRange,
  roomGridForWeekday,
  formatRoomGridText,
  summarizeRooms
} from '../src/modules/room-parser.js';

// 真实结果页结构（河大青果 kbbp/dykb.fzcjcckkxjsi_data.jsp，GBK 转码后）
const RESULT_HTML = `
<!DOCTYPE HTML PUBLIC "-//W3C//DTD HTML 4.01 Transitional//EN">
<html><head><meta http-equiv="Content-Type" content="text/html; charset=GBK" /></head>
<body style="font-size:12px">
	<div pagetitle="pagetitle" style="width:189mm;font-size:20px;font-weight:bold;">
		 河南大学2026-2027学年第一学期空闲教室一览表<br>
		 <font style="font-size:13px;font-weight:bold;">
		 第1-18周&ensp;
		 星期三&ensp;[1节]</font>
	</div>

	<div style="height:30px;width:100%"></div>
	<div group="group" style="width:189mm;text-align:left;font-size:12px;font-weight:bold;">
		<div style="float:left;width:30%;">校区：金明校区</div>
		<div style="float:left;width:30%;">教室类型：多媒体教室</div>
		<div style="float:left;width:30%;text-align: right;">空闲教室数：2</div>
	</div>
	<table style="clear:left;width:189mm;font-size:12px">
		<thead>
			<tr>
				<td style="width:47mm;">教室</td>
				<td style="width:9mm;">容量</td>
				<td style="width:47mm;">教室</td>
				<td style="width:9mm;">容量</td>
				<td style="width:47mm;">教室</td>
				<td style="width:9mm;">容量</td>
			</tr>
		</thead>
		<tbody>
			<tr>
				<td>计算机大楼<br>计算机大楼101</td>
				<td>150</td>
				<td>计算机大楼<br>计算机大楼102</td>
				<td>150</td>
				<td></td>
				<td></td>
			</tr>
		</tbody>
	</table>

	<div style="height:30px;width:100%"></div>
	<div group="group" style="width:189mm;text-align:left;font-size:12px;font-weight:bold;">
		<div style="float:left;width:30%;">校区：金明校区</div>
		<div style="float:left;width:30%;">教室类型：师范生实训中心教室</div>
		<div style="float:left;width:30%;text-align: right;">空闲教室数：4</div>
	</div>
	<table style="clear:left;width:189mm;font-size:12px">
		<thead>
			<tr>
				<td>教室</td><td>容量</td><td>教室</td><td>容量</td><td>教室</td><td>容量</td>
			</tr>
		</thead>
		<tbody>
			<tr>
				<td>7号教学楼<br>7号教学楼7#402（7#402）</td>
				<td>16</td>
				<td>7号教学楼<br>板书室（7#403）</td>
				<td>45</td>
				<td>7号教学楼<br>名师工作室（7#405）</td>
				<td>1</td>
			</tr>
			<tr>
				<td>7号教学楼<br>微格教室1（7#404-1）</td>
				<td>16</td>
				<td></td>
				<td></td>
				<td></td>
				<td></td>
			</tr>
		</tbody>
	</table>
</body></html>`;

const EMPTY_HTML = `
<!DOCTYPE HTML PUBLIC "-//W3C//DTD HTML 4.01 Transitional//EN">
<html><head><meta http-equiv="Content-Type" content="text/html; charset=GBK" /></head>
<body><div>没有检索到记录!</div></body></html>`;

test('parseFreeRooms 解析真实结果页', () => {
  const parsed = parseFreeRooms(RESULT_HTML);

  assert.equal(parsed.title, '河南大学2026-2027学年第一学期空闲教室一览表');
  assert.equal(parsed.weekLabel, '第1-18周');
  assert.equal(parsed.weekdayLabel, '星期三');
  assert.equal(parsed.periodTag, '[1节]');
  assert.equal(parsed.groups.length, 2);
  assert.equal(parsed.total, 6);

  const [multi, normal] = parsed.groups;
  assert.equal(multi.campus, '金明校区');
  assert.equal(multi.roomType, '多媒体教室');
  assert.equal(multi.declaredCount, 2);
  assert.deepEqual(multi.rooms[0], {
    building: '计算机大楼',
    name: '计算机大楼101',
    capacity: 150
  });

  assert.equal(normal.roomType, '师范生实训中心教室');
  assert.equal(normal.rooms.length, 4);
  assert.equal(normal.rooms[1].name, '板书室（7#403）');
  assert.equal(normal.rooms[1].capacity, 45);
});

test('parseFreeRooms 空结果不报错且没有分组', () => {
  const parsed = parseFreeRooms(EMPTY_HTML);
  assert.equal(parsed.total, 0);
  assert.deepEqual(parsed.groups, []);
});

test('resolvePeriods 按小节展开，缺省为全部 13 节', () => {
  assert.deepEqual(resolvePeriods('1-4'), { periods: [1, 2, 3, 4] });
  assert.deepEqual(resolvePeriods('3'), { periods: [3] });
  assert.deepEqual(resolvePeriods('7~8'), { periods: [7, 8] });
  // 河大作息一天 13 小节，晚上 9-13 也要能查
  assert.deepEqual(resolvePeriods('9-13'), { periods: [9, 10, 11, 12, 13] });
  assert.deepEqual(
    resolvePeriods(undefined).periods,
    [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]
  );

  assert.equal(resolvePeriods('0-3'), null);
  assert.equal(resolvePeriods('14'), null);
  assert.equal(resolvePeriods('5-3'), null);
  assert.equal(resolvePeriods('abc'), null);
});

test('periodLabel 输出节次文案', () => {
  assert.equal(periodLabel(1), '1节');
  assert.equal(periodLabel(13), '13节');
});

test('resolveWeekdayRange 支持单个与区间', () => {
  assert.deepEqual(resolveWeekdayRange('3'), { from: 3, to: 3 });
  assert.deepEqual(resolveWeekdayRange('周三'), { from: 3, to: 3 });
  assert.deepEqual(resolveWeekdayRange('一-五'), { from: 1, to: 5 });
  assert.deepEqual(resolveWeekdayRange('1-7'), { from: 1, to: 7 });
  assert.equal(resolveWeekdayRange('8'), null);
  assert.equal(resolveWeekdayRange('五-一'), null);
});

test('编码映射命中真实表单取值', () => {
  assert.equal(resolveCampus('金明'), '02');
  assert.equal(resolveCampus('明伦校区'), '01');
  assert.equal(resolveCampus('火星'), null);

  assert.equal(resolveRoomType('多媒体'), '05');
  assert.equal(resolveRoomType('师范生实训中心教室'), '06');
  assert.equal(resolveRoomType('体育馆'), null);

  assert.equal(resolveBuilding('计算机大楼'), '0002');
  assert.equal(resolveBuilding('金明综合楼5'), '20');
  assert.equal(resolveBuilding('不存在的楼'), null);

  assert.equal(resolveParity('单周'), '1');
  assert.equal(resolveParity('even'), '2');
  assert.equal(resolveParity(''), '');
  assert.equal(resolveParity('隔周'), null);
});

test('buildRoomQuery 组装表单字段并校验非法参数', () => {
  const ok = buildRoomQuery({
    campus: '金明',
    weekday: '3',
    period: '1-2',
    week: '1-18',
    roomType: '多媒体',
    building: '计算机大楼',
    min: '1',
    max: '300'
  });
  assert.equal(ok.error, undefined);
  assert.deepEqual(ok.periods, [1, 2]);
  assert.deepEqual(ok.overrides, {
    selXQ: '02',
    selJSLX: '05',
    sel_lf: '0002',
    selZ: '3',
    selZ2: '3',
    txtZC: '1-18',
    hidMIN: '1',
    hidMAX: '300',
    chkBHSZWLYDJS: 'on'
  });

  // 默认不含留用教室；显式关掉时不下发这个字段
  assert.equal(buildRoomQuery({}).overrides.chkBHSZWLYDJS, 'on');
  assert.equal(
    buildRoomQuery({ excludeReserved: false }).overrides.chkBHSZWLYDJS,
    undefined
  );

  assert.match(buildRoomQuery({ campus: '火星' }).error, /未知校区/);
  assert.match(buildRoomQuery({ period: '99' }).error, /节次参数不合法/);
  assert.match(buildRoomQuery({ weekday: '9' }).error, /星期参数不合法/);
  assert.match(buildRoomQuery({ max: '-5' }).error, /容量上限不合法/);
});

test('buildRoomQuery 不指定条件时只下发“不含留用教室”', () => {
  const built = buildRoomQuery({});
  assert.deepEqual(built.overrides, { chkBHSZWLYDJS: 'on' });
  assert.equal(built.periods.length, 13);
});

test('summarizeRooms 输出节次与分组', () => {
  const parsed = parseFreeRooms(RESULT_HTML);
  const text = summarizeRooms({
    term: parsed.title,
    weekLabel: parsed.weekLabel,
    weekdayLabel: parsed.weekdayLabel,
    total: parsed.total,
    groups: parsed.groups.map((group) => ({ period: '1节', ...group }))
  });

  assert.match(text, /金明校区/);
  assert.match(text, /多媒体教室/);
  assert.match(text, /计算机大楼 · 计算机大楼101 \(150人\)/);
  assert.match(text, /合计 6 间/);
});

// 真实结构片段（kbbp/dykb.fjsickkxzcjc_data.jsp，按小节、lyjc=1）
const GRID_HTML = `
<html><body topmargin="0">
	<div id="kxjc">
		&ensp;校区：金明校区&ensp;&ensp;楼房：金明综合楼5<br>
		<TABLE WIDTH=100% border='1'>
			<tr class=H><td rowspan=2 >教室名称</td><td rowspan=2 >教室类型</td><td rowspan=2 >教室容量</td><td rowspan=2 >周次</td><td colspan=8 >空闲节次</td></tr>
			<tr class=H><td >节次</td><td >星期一</td><td >星期二</td><td >星期三</td><td >星期四</td><td >星期五</td><td >星期六</td><td >星期日</td></tr>
			<tr id=zc_1 class=O><td width=20% align=left rowspan='15'>金明综合楼5201</td><td width=10% align=left rowspan='15'>多媒体教室</td><td width=8% align=right rowspan='15'>96</td><td width=6% align=center rowspan='15' >第9周</td><td>1</td><td style="background-color:red;">&ensp;</td><td>&ensp;</td><td>&ensp;</td><td style="background-color:red;">&ensp;</td><td>&ensp;</td><td>&ensp;</td><td>&ensp;</td></tr>
			<tr><td>2</td><td style="background-color:red;">&ensp;</td><td>&ensp;</td><td>&ensp;</td><td style="background-color:red;">&ensp;</td><td>&ensp;</td><td>&ensp;</td><td>&ensp;</td></tr>
			<tr><td>3</td><td>&ensp;</td><td style="background-color:red;">&ensp;</td><td>&ensp;</td><td>&ensp;</td><td style="background-color:red;">&ensp;</td><td>&ensp;</td><td>&ensp;</td></tr>
			<tr><td>4</td><td>&ensp;</td><td style="background-color:red;">&ensp;</td><td>&ensp;</td><td>&ensp;</td><td style="background-color:red;">&ensp;</td><td>&ensp;</td><td>&ensp;</td></tr>
			<tr id=zc_2 class=O><td width=20% align=left rowspan='15'>金明综合楼5301</td><td width=10% align=left rowspan='15'>多媒体教室</td><td width=8% align=right rowspan='15'>96</td><td width=6% align=center rowspan='15' >第9周</td><td>1</td><td style="background-color:red;">&ensp;</td><td style="background-color:red;">&ensp;</td><td style="background-color:red;">&ensp;</td><td style="background-color:red;">&ensp;</td><td style="background-color:red;">&ensp;</td><td style="background-color:red;">&ensp;</td><td style="background-color:red;">&ensp;</td></tr>
			<tr><td>2</td><td style="background-color:red;">&ensp;</td><td style="background-color:red;">&ensp;</td><td style="background-color:red;">&ensp;</td><td style="background-color:red;">&ensp;</td><td style="background-color:red;">&ensp;</td><td style="background-color:red;">&ensp;</td><td style="background-color:red;">&ensp;</td></tr>
			<tr><td>3</td><td style="background-color:red;">&ensp;</td><td style="background-color:red;">&ensp;</td><td style="background-color:red;">&ensp;</td><td style="background-color:red;">&ensp;</td><td style="background-color:red;">&ensp;</td><td style="background-color:red;">&ensp;</td><td style="background-color:red;">&ensp;</td></tr>
			<tr><td>4</td><td style="background-color:red;">&ensp;</td><td style="background-color:red;">&ensp;</td><td style="background-color:red;">&ensp;</td><td style="background-color:red;">&ensp;</td><td style="background-color:red;">&ensp;</td><td style="background-color:red;">&ensp;</td><td style="background-color:red;">&ensp;</td></tr>
		</TABLE>
	</div>
</body></html>`;

test('parseRoomGrid 解析“分教室查看空闲周次/节次”结果', () => {
  const parsed = parseRoomGrid(GRID_HTML);

  assert.equal(parsed.campus, '金明校区');
  assert.equal(parsed.building, '金明综合楼5');
  assert.deepEqual(parsed.weeks, ['第9周']);
  assert.equal(parsed.periodCount, 4);
  assert.equal(parsed.rooms.length, 2);

  const [freeRoom, reservedRoom] = parsed.rooms;
  assert.equal(freeRoom.name, '金明综合楼5201');
  assert.equal(freeRoom.roomType, '多媒体教室');
  assert.equal(freeRoom.capacity, 96);
  assert.equal(freeRoom.week, '第9周');
  // 节次 1：周一、周四占用
  assert.deepEqual(freeRoom.busy[1], [true, false, false, true, false, false, false]);

  // 留用教室（5301）整周标占用，不会再被当成空教室
  assert.equal(reservedRoom.name, '金明综合楼5301');
  assert.deepEqual(reservedRoom.busy[3], [true, true, true, true, true, true, true]);
});

test('roomGridForWeekday 按星期压成网格', () => {
  const parsed = parseRoomGrid(GRID_HTML);
  const [freeRoom, reservedRoom] = parsed.rooms;

  // 星期三：5201 空闲，5301 占用
  const wednesday = roomGridForWeekday(freeRoom, 3, 4);
  assert.equal(wednesday.slots, '....');
  assert.deepEqual(wednesday.freePeriods, [1, 2, 3, 4]);

  // 星期一：5201 第 1、2 节有课
  const monday = roomGridForWeekday(freeRoom, 1, 4);
  assert.equal(monday.slots, 'XX..');
  assert.deepEqual(monday.freePeriods, [3, 4]);

  assert.equal(roomGridForWeekday(reservedRoom, 3, 4).slots, 'XXXX');
});

test('formatRoomGridText 输出空闲节次与指定节次清单', () => {
  const parsed = parseRoomGrid(GRID_HTML);
  const rooms = parsed.rooms.map((room) => {
    const grid = roomGridForWeekday(room, 3, parsed.periodCount);
    return {
      name: room.name,
      roomType: room.roomType,
      capacity: room.capacity,
      grid: grid.slots,
      freePeriods: grid.freePeriods
    };
  });
  const data = {
    query: {
      campus: parsed.campus,
      building: parsed.building,
      weekday: '星期三',
      mode: '按小节',
      periods: ['3节', '4节']
    },
    weeks: parsed.weeks,
    rooms,
    free: rooms.filter((room) => [3, 4].every((period) => room.freePeriods.includes(period)))
  };
  const text = formatRoomGridText(data);

  assert.match(text, /金明校区 金明综合楼5 第9周 星期三（按小节/);
  assert.match(text, /金明综合楼5201（96人 \/ 多媒体教室）\s+空闲：1-4/);
  assert.match(text, /金明综合楼5301（96人 \/ 多媒体教室）\s+空闲：无/);
  assert.match(text, /第 3、4 节全空的教室 1 间：金明综合楼5201（96人）/);
  assert.match(text, /合计 2 间教室/);
});
