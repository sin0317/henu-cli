import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildRoomQuery,
  parseFreeRooms,
  periodLabel,
  resolveBuilding,
  resolveCampus,
  resolveParity,
  resolvePeriods,
  resolveRoomType,
  resolveWeekdayRange,
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

test('resolvePeriods 按小节展开，缺省为全部 8 节', () => {
  assert.deepEqual(resolvePeriods('1-4'), { periods: [1, 2, 3, 4] });
  assert.deepEqual(resolvePeriods('3'), { periods: [3] });
  assert.deepEqual(resolvePeriods('7~8'), { periods: [7, 8] });
  assert.deepEqual(resolvePeriods(undefined).periods, [1, 2, 3, 4, 5, 6, 7, 8]);

  assert.equal(resolvePeriods('0-3'), null);
  assert.equal(resolvePeriods('9'), null);
  assert.equal(resolvePeriods('5-3'), null);
  assert.equal(resolvePeriods('abc'), null);
});

test('periodLabel 输出节次文案', () => {
  assert.equal(periodLabel(1), '1节');
  assert.equal(periodLabel(8), '8节');
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
    hidMAX: '300'
  });

  assert.match(buildRoomQuery({ campus: '火星' }).error, /未知校区/);
  assert.match(buildRoomQuery({ period: '99' }).error, /节次参数不合法/);
  assert.match(buildRoomQuery({ weekday: '9' }).error, /星期参数不合法/);
  assert.match(buildRoomQuery({ max: '-5' }).error, /容量上限不合法/);
});

test('buildRoomQuery 不指定条件时不下发任何覆盖', () => {
  const built = buildRoomQuery({});
  assert.deepEqual(built.overrides, {});
  assert.equal(built.periods.length, 8);
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
