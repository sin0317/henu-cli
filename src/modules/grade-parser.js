// 解析青果「学生成绩明细」表格。
// 列序：序号 | 课程/环节 | 学分 | 总学时 | 类别 | 修读性质 | 考核方式 |
//       成绩 | 获得学分 | 绩点 | 学分绩点 | 备注
// 表格尾部还有若干行汇总（修读课程环节数 / 必修课 / 各平台课 / 合计），
// 列序与明细不同，要单独识别，不能当成课程行。

const COURSE_CELL = /^\[([A-Za-z0-9]+)\]\s*(.+)$/;

export function parseGradeRows(rows) {
  const records = [];
  const summary = { lines: [], total: null };

  for (const row of rows) {
    if (!Array.isArray(row) || row.length === 0) continue;
    const head = (row[0] ?? '').trim();

    // 明细行：首列是流水号，第二列是 [课程号]课程名
    const courseMatch = COURSE_CELL.exec((row[1] ?? '').trim());
    if (head !== '' && /^\d+$/.test(head) && courseMatch) {
      records.push({
        code: courseMatch[1],
        name: courseMatch[2].trim(),
        credit: num(row[2]),
        hours: num(row[3]),
        category: (row[4] ?? '').trim(),
        studyType: (row[5] ?? '').trim(),
        examType: (row[6] ?? '').trim(),
        score: (row[7] ?? '').trim(),
        earnedCredit: num(row[8]),
        gpa: num(row[9]),
        note: (row[11] ?? '').trim() || null
      });
      continue;
    }

    // 汇总行：修读课程环节数 / 必修课 / 选修课 / 各平台课小计 / 合计
    if (head === '' && (row[1] ?? '') === '修读课程环节数') continue;
    if (head !== '' && row.length >= 3 && /^\d+$/.test((row[1] ?? '').trim()) && num(row[2]) !== null) {
      // 汇总行的列序（含合并单元格占位）：
      // [1]=门数 [2]=学分 [3]=获得学分 [4]=获得绩点 [5]=获得学分绩点
      // [6]=平均成绩 [7]=加权平均成绩
      const line = {
        name: head,
        count: Number(row[1]),
        credits: num(row[2]),
        earnedCredits: num(row[3]),
        gpa: num(row[4]),
        creditGpa: num(row[5]),
        averageScore: num(row[6]),
        average: num(row[7])
      };
      summary.lines.push(line);
      if (head === '合计') summary.total = line;
    }
  }

  return { records, summary };
}

function num(value) {
  const text = (value ?? '').trim();
  if (text === '') return null;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
}

// 把「公共基础平台课/必修课」这类类别串拆成平台 + 性质。
export function splitCategory(category) {
  const [platform = '', nature = ''] = category.split('/');
  return { platform: platform.trim(), nature: nature.trim() };
}

// 按课程性质聚合：课程数、已修学分、是否有未通过。
export function summarizeByCategory(records) {
  const map = new Map();
  for (const record of records) {
    const key = record.category || '未分类';
    const bucket = map.get(key) ?? { category: key, courses: 0, credits: 0, failed: [] };
    bucket.courses += 1;
    bucket.credits += record.earnedCredit ?? 0;
    if ((record.earnedCredit ?? 0) === 0) bucket.failed.push(record.name);
    map.set(key, bucket);
  }
  return [...map.values()]
    .map((bucket) => ({ ...bucket, credits: round(bucket.credits) }))
    .sort((a, b) => (a.category < b.category ? -1 : 1));
}

export function sumCredits(records) {
  return round(records.reduce((sum, record) => sum + (record.earnedCredit ?? 0), 0));
}

export function round(value) {
  return Math.round(value * 100) / 100;
}

// 人读视图
export function formatGradeText(result) {
  const lines = [];
  lines.push(`${result.term || '入学以来'} 成绩明细，共 ${result.records.length} 门，合计 ${result.totalCredits} 学分`);
  if (result.weightedAverage !== null) lines.push(`加权平均成绩 ${result.weightedAverage}`);
  lines.push('');

  for (const bucket of result.byCategory) {
    lines.push(`【${bucket.category}】${bucket.courses} 门 / ${bucket.credits} 学分`);
    for (const record of result.records.filter((item) => item.category === bucket.category)) {
      const note = record.note ? ` (${record.note})` : '';
      lines.push(`  ${record.name}  ${record.credit} 学分  ${record.score}${note}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}
