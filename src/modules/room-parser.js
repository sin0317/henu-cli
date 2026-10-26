// 空闲教室查询：参数归一化 + 结果 HTML 解析。
// 结果页是青果打印版 HTML（GBK），结构为：
//   <div pagetitle>…第1-18周 星期三</div>
//   <div group="group">校区：… 教室类型：… 空闲教室数：N</div>
//   <table>（6 列 = 教室|容量 重复 3 组）</table>
//   …… 同结构重复

const CAMPUS_MAP = new Map([
  ['明伦', '01'], ['明伦校区', '01'], ['01', '01'],
  ['金明', '02'], ['金明校区', '02'], ['02', '02'],
  ['郑州', '03'], ['郑州校区', '03'], ['03', '03'],
  ['其他', '04'], ['其他校区', '04'], ['04', '04']
]);

const ROOM_TYPE_MAP = new Map([
  ['不安排教室', '00'], ['不安排', '00'], ['00', '00'],
  ['一般教室', '01'], ['一般', '01'], ['01', '01'],
  ['多媒体教室', '05'], ['多媒体', '05'], ['05', '05'],
  ['师范生实训中心教室', '06'], ['师范', '06'], ['师范生实训中心', '06'], ['06', '06']
]);

// 楼房名 → 表单里的楼号。表单是动态下拉，这里只做常见楼宇的前缀匹配，
// 匹配不上时原样传空，让页面按“全部楼房”查询。
const BUILDING_MAP = new Map([
  ['7号教学楼', '0007'],
  ['计算机大楼', '0002'],
  ['金明综合楼1', '0006'],
  ['金明综合楼2', '17'],
  ['金明综合楼3', '18'],
  ['金明综合楼4', '19'],
  ['金明综合楼5', '20'],
  ['金明综合楼6', '21'],
  ['九章学堂北楼B座', '26'],
  ['九章学堂南楼B座', '24'],
  ['十号楼', '0013'],
  ['友兰学堂北楼B座', '25'],
  ['友兰学堂南楼B座', '22'],
  ['友兰学堂南楼C座', '23'],
  ['曾宪梓楼', '0001'],
  ['综合教学楼', '0003']
]);

const WEEKDAY_CHAR = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 7, 天: 7 };

function decodeEntities(text) {
  return text
    .replace(/&nbsp;|&ensp;|&emsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&amp;/gi, '&');
}

function stripTags(html) {
  return decodeEntities(String(html ?? '').replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

// 取一段 HTML 里最后一个匹配，因为同页多个分组时，离表格最近的那个才是它的标题。
function lastMatch(source, pattern) {
  const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`;
  const global = new RegExp(pattern.source, flags);
  let found = null;
  for (const match of source.matchAll(global)) {
    found = match;
  }
  return found;
}

export function resolveCampus(input) {
  if (input === undefined || input === null || input === '') return '';
  return CAMPUS_MAP.get(String(input).trim()) ?? null;
}

export function resolveRoomType(input) {
  if (input === undefined || input === null || input === '') return '';
  return ROOM_TYPE_MAP.get(String(input).trim()) ?? null;
}

export function resolveBuilding(input) {
  if (input === undefined || input === null || input === '') return '';
  const key = String(input).trim();
  if (BUILDING_MAP.has(key)) return BUILDING_MAP.get(key);
  for (const [name, code] of BUILDING_MAP) {
    if (key.includes(name) || name.includes(key)) return code;
  }
  return null;
}

// 支持 "3" / "周三" / "三" / "3-5"
export function resolveWeekdayRange(input) {
  if (input === undefined || input === null || input === '') return null;
  const raw = String(input).trim();
  const parts = raw.split(/\s*[-~到]\s*/);

  const parseOne = (value) => {
    const text = value.replace(/^(周|星期)/, '');
    if (/^[1-7]$/.test(text)) return Number(text);
    return WEEKDAY_CHAR[text] ?? null;
  };

  const from = parseOne(parts[0]);
  const to = parts.length > 1 ? parseOne(parts[1]) : from;
  if (from === null || to === null || from > to) return null;
  return { from, to };
}

// 支持 "1-4" / "3" / "1~2"。
// 河大一天 8 小节。服务端真正认的节次参数是 hidDJ（小节号 1-8），
// 页面上的 txtXJXL / txtlsjc 只是展示字段，传了不影响结果——实测已验证。
// 返回的标题里会带 [N节] 标注，可作为节次的确认。
export function resolvePeriods(input) {
  if (input === undefined || input === null || input === '') {
    return { periods: [1, 2, 3, 4, 5, 6, 7, 8] };
  }
  const match = String(input).trim().match(/^(\d{1,2})(?:\s*[-~到]\s*(\d{1,2}))?$/);
  if (!match) return null;
  const from = Number(match[1]);
  const to = match[2] ? Number(match[2]) : from;
  if (from < 1 || to > 8 || from > to) return null;

  const periods = [];
  for (let section = from; section <= to; section += 1) {
    periods.push(section);
  }
  return { periods };
}

export function periodLabel(period) {
  return `${period}节`;
}

// 支持 "5" / "1-18"
export function resolveWeekRange(input) {
  if (input === undefined || input === null || input === '') return '1-18';
  const match = String(input).trim().match(/^(\d{1,2})(?:\s*[-~到]\s*(\d{1,2}))?$/);
  if (!match) return null;
  const from = Number(match[1]);
  const to = match[2] ? Number(match[2]) : from;
  if (from < 1 || to > 30 || from > to) return null;
  return `${from}-${to}`;
}

export function resolveParity(input) {
  if (input === undefined || input === null || input === '') return '';
  const text = String(input).trim();
  if (['1', '单', '单周', 'odd'].includes(text)) return '1';
  if (['2', '双', '双周', 'even'].includes(text)) return '2';
  return null;
}

export function resolveCapacity(input) {
  if (input === undefined || input === null || input === '') return null;
  const value = Number.parseInt(String(input).trim(), 10);
  if (!Number.isFinite(value) || value < 0) return null;
  return value;
}

// 把 CLI 选项翻译成青果表单字段。返回 { error } 表示某个参数非法。
export function buildRoomQuery(options = {}) {
  const overrides = {};

  if (options.campus !== undefined && options.campus !== '') {
    const code = resolveCampus(options.campus);
    if (code === null) return { error: `未知校区：${options.campus}` };
    overrides.selXQ = code;
  }

  if (options.roomType !== undefined && options.roomType !== '') {
    const code = resolveRoomType(options.roomType);
    if (code === null) return { error: `未知教室类型：${options.roomType}` };
    overrides.selJSLX = code;
  }

  if (options.building !== undefined && options.building !== '') {
    const code = resolveBuilding(options.building);
    if (code === null) return { error: `未知楼房：${options.building}` };
    overrides.sel_lf = code;
  }

  if (options.weekday !== undefined && options.weekday !== '') {
    const range = resolveWeekdayRange(options.weekday);
    if (!range) return { error: `星期参数不合法：${options.weekday}（示例：3 或 3-5）` };
    overrides.selZ = String(range.from);
    overrides.selZ2 = String(range.to);
  }

  if (options.week !== undefined && options.week !== '') {
    const week = resolveWeekRange(options.week);
    if (!week) return { error: `周次参数不合法：${options.week}（示例：5 或 1-18）` };
    overrides.txtZC = week;
  }

  if (options.parity !== undefined && options.parity !== '') {
    const parity = resolveParity(options.parity);
    if (parity === null) return { error: `单双周参数不合法：${options.parity}（单周/双周）` };
    overrides.seldsz = parity;
  }

  if (options.min !== undefined && options.min !== '') {
    const min = resolveCapacity(options.min);
    if (min === null) return { error: `容量下限不合法：${options.min}` };
    overrides.hidMIN = String(min);
  }

  if (options.max !== undefined && options.max !== '') {
    const max = resolveCapacity(options.max);
    if (max === null) return { error: `容量上限不合法：${options.max}` };
    overrides.hidMAX = String(max);
  }

  const period = resolvePeriods(options.period);
  if (!period) {
    return { error: `节次参数不合法：${options.period}（一天 8 小节，示例：1-4）` };
  }

  return { overrides, periods: period.periods };
}

function splitRoomName(raw) {
  const text = String(raw ?? '').trim();
  if (!text) return null;
  const spaceAt = text.search(/\s/);
  if (spaceAt > 0) {
    return { building: text.slice(0, spaceAt), name: text.slice(spaceAt + 1).trim() };
  }
  return { building: null, name: text };
}

function parseRoomTable(tableHtml) {
  const rooms = [];
  for (const rowMatch of tableHtml.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [];
    for (const cellMatch of rowMatch[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)) {
      cells.push(stripTags(cellMatch[1]));
    }
    if (cells.length === 0) continue;

    // 跳过表头行
    if (cells.every((cell) => cell === '' || cell === '教室' || cell === '容量')) continue;

    // 每两列一组：教室名 + 容量
    for (let index = 0; index + 1 < cells.length; index += 2) {
      const parsed = splitRoomName(cells[index]);
      if (!parsed) continue;
      const capacity = Number.parseInt(cells[index + 1], 10);
      rooms.push({ ...parsed, capacity: Number.isFinite(capacity) ? capacity : null });
    }
  }
  return rooms;
}

export function parseFreeRooms(html) {
  const source = String(html ?? '');

  const titleMatch = source.match(/<div[^>]*pagetitle[^>]*>([\s\S]*?)<\/div>/i);
  const titleText = titleMatch ? stripTags(titleMatch[1]) : '';

  const weekLabel = (titleText.match(/第\s*\d+\s*[-–~]\s*\d+\s*周/) ?? titleText.match(/第\s*\d+\s*周/) ?? [])[0] ?? null;
  const weekdayLabel = (titleText.match(/星期[一二三四五六日天]/) ?? [])[0] ?? null;
  // 服务端会在标题里追加 [N节] 标注，节次已经在按大节分组里体现，这里剥掉
  const periodTag = (titleText.match(/\[[^\]]{1,12}节\]/) ?? [])[0] ?? null;
  const title = titleText
    .replace(periodTag ?? '', '')
    .replace(weekLabel ?? '', '')
    .replace(weekdayLabel ?? '', '')
    .trim();

  const groups = [];
  for (const tableMatch of source.matchAll(/<table[\s\S]*?<\/table>/gi)) {
    const context = source.slice(Math.max(0, tableMatch.index - 1600), tableMatch.index);

    const campus = lastMatch(context, /校\s*区\s*[：:]\s*([^<：:]{1,20})/)?.[1]?.trim() ?? null;
    const roomType = lastMatch(context, /教室类型\s*[：:]\s*([^<：:]{1,20})/)?.[1]?.trim() ?? null;
    const countText = lastMatch(context, /空闲教室数\s*[：:]\s*(\d+)/)?.[1];

    const rooms = parseRoomTable(tableMatch[0]);
    if (rooms.length === 0) continue;

    groups.push({
      campus,
      roomType,
      declaredCount: countText === undefined ? null : Number(countText),
      rooms
    });
  }

  const total = groups.reduce((sum, group) => sum + group.rooms.length, 0);
  return { title, weekLabel, weekdayLabel, periodTag, groups, total };
}

// 人读视图：把分组平铺成终端可读清单。
export function summarizeRooms(parsed, limit = 80) {
  const groups = parsed.groups ?? [];
  const lines = [];

  const context = [
    parsed.title ?? parsed.term ?? '空闲教室',
    parsed.weekLabel,
    parsed.weekdayLabel
  ].filter(Boolean).join(' ');
  lines.push(context);
  lines.push('');

  const shown = groups.slice(0, limit);
  for (const group of shown) {
    const header = [group.period, group.campus, group.roomType].filter(Boolean).join(' / ');
    lines.push(`【${header || '全部'}】${group.rooms.length} 间`);
    for (const room of group.rooms) {
      const capacity = room.capacity === null ? '' : ` (${room.capacity}人)`;
      lines.push(`  ${room.building ? `${room.building} · ` : ''}${room.name}${capacity}`);
    }
    lines.push('');
  }

  if (groups.length > shown.length) {
    lines.push(`（还有 ${groups.length - shown.length} 个分组未显示）`);
  }
  lines.push(`合计 ${parsed.total ?? 0} 间`);
  return lines.join('\n');
}
