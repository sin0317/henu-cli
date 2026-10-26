// 河南大学「第二课堂」专项学分项目标准。
// 数据来源：河南大学教务处《附件6 河南大学"第二课堂"专项学分项目一览表》。
// 这是全校统一口径，不随专业变化，因此独立成数据文件，不放进培养方案。
//
// 学分区间：同一项目按级别/角色不同，记分不同，min-max 表示区间。

export const SECOND_CLASSROOM = {
  title: '河南大学「第二课堂」专项学分项目一览表',
  requiredCredits: 5,
  mandatoryCredits: 1,
  innovationMinCredits: 1,
  innovationCategories: ['发明专利', '学术论文(作品)', '学科专业竞赛创新创业大赛', '大学生创新创业训练计划项目'],
  rules: [
    '本科生在校学习期间，至少需获得 5 个「第二课堂」专项学分方可毕业，其中包括 1 个必修学分。',
    '创新创业教育类中，至少从 4 个分类中获得 1 个学分。',
    '专项学分的申请在达到规定数量后，对于超出部分同样进行客观记录。',
    '专项学分获得以单次活动为记录单位，不清算。'
  ],
  items: [
    {
      id: 'social-practice',
      type: '必修',
      name: '社会实践活动',
      minCredits: 1,
      maxCredits: 1,
      requirement: '学生参加 1 次社会实践活动，并提交较为详细的实践报告。'
    },
    {
      id: 'patent',
      type: '选修',
      name: '发明专利',
      minCredits: 3,
      maxCredits: 5,
      requirement: '发明专利或实用新型专利，按署名顺位记分。',
      levels: [
        { level: '发明专利', role: '第一署名人', credits: 5 },
        { level: '发明专利', role: '其他署名人', credits: 4 },
        { level: '实用新型专利', role: '第一署名人', credits: 4 },
        { level: '实用新型专利', role: '其他署名人', credits: 3 }
      ]
    },
    {
      id: 'paper',
      type: '选修',
      name: '学术论文(作品)',
      minCredits: 1,
      maxCredits: 4,
      requirement: '在期刊发表专业学术论文，按期刊层次与作者顺位记分。',
      levels: [
        { level: '全国中文核心期刊', role: '第一作者', credits: 4 },
        { level: '全国中文核心期刊', role: '第二作者', credits: 2 },
        { level: '一般 CN 学术期刊', role: '第一作者', credits: 2 },
        { level: '一般 CN 学术期刊', role: '第二作者', credits: 1 }
      ]
    },
    {
      id: 'competition',
      type: '选修',
      name: '学科专业竞赛创新创业大赛',
      minCredits: 1,
      maxCredits: 4,
      requirement: '同一个学科专业竞赛活动，按最高级别记学分一次。',
      levels: [
        { level: '国家级', role: '个人二等及以上', credits: 4 },
        { level: '国家级', role: '个人三等奖', credits: 3 },
        { level: '国家级', role: '团体二等及以上（每人）', credits: 3 },
        { level: '国家级', role: '团体三等奖（每人）', credits: 2 },
        { level: '省级', role: '个人二等及以上', credits: 3 },
        { level: '省级', role: '个人三等奖', credits: 2 },
        { level: '省级', role: '团体二等及以上（每人）', credits: 2 },
        { level: '省级', role: '团体三等奖（每人）', credits: 1 },
        { level: '校级', role: '个人二等及以上', credits: 2 },
        { level: '校级', role: '个人三等奖', credits: 1 },
        { level: '院级', role: '个人二等及以上', credits: 1 }
      ]
    },
    {
      id: 'training-project',
      type: '选修',
      name: '大学生创新创业训练计划项目',
      minCredits: 1,
      maxCredits: 3,
      requirement: '参加并验收通过的项目，同一项目按最高级别记学分一次。',
      levels: [
        { level: '国家级', role: '主持人', credits: 3 },
        { level: '国家级', role: '其他参与者', credits: 2 },
        { level: '省级', role: '主持人', credits: 2 },
        { level: '省级', role: '其他参与者', credits: 1 },
        { level: '校级', role: '主持人及其他参与者', credits: 1 }
      ]
    },
    {
      id: 'mandarin',
      type: '选修',
      name: '普通话',
      minCredits: 1,
      maxCredits: 1,
      requirement: '普通话测试达到二级乙等以上。'
    },
    {
      id: 'reading',
      type: '选修',
      name: '扩展阅读',
      minCredits: 1,
      maxCredits: 1,
      requirement: '每读完学院推荐书目中的 5 本，且每本均有 1500 字左右的读书笔记和心得体会，记 1 学分。'
    },
    {
      id: 'lecture',
      type: '选修',
      name: '学科前沿讲座',
      minCredits: 1,
      maxCredits: 1,
      requirement: '参加 5 次学科前沿讲座，并提交较为详细的笔记。'
    }
  ]
};

// 常见简称归一，方便命令行里少打字
const ALIASES = {
  社会实践: 'social-practice',
  社会实践活动: 'social-practice',
  专利: 'patent',
  发明专利: 'patent',
  论文: 'paper',
  学术论文: 'paper',
  竞赛: 'competition',
  创新创业大赛: 'competition',
  大创: 'training-project',
  大创项目: 'training-project',
  创新创业训练计划项目: 'training-project',
  普通话: 'mandarin',
  扩展阅读: 'reading',
  读书: 'reading',
  讲座: 'lecture',
  学科前沿讲座: 'lecture'
};

export function resolveItem(input) {
  const text = String(input ?? '').trim();
  if (!text) return null;
  const byId = SECOND_CLASSROOM.items.find((item) => item.id === text);
  if (byId) return byId;
  const byName = SECOND_CLASSROOM.items.find((item) => item.name === text);
  if (byName) return byName;
  const aliasId = ALIASES[text];
  if (aliasId) return SECOND_CLASSROOM.items.find((item) => item.id === aliasId) ?? null;
  const fuzzy = SECOND_CLASSROOM.items.find((item) => item.name.includes(text) || text.includes(item.name));
  return fuzzy ?? null;
}

// items 支持「社会实践」「普通话:1」「竞赛=3」三种写法；不写学分就用项目的下限。
export function checkSecondClassroom(inputs = []) {
  const claimed = [];
  const unknown = [];

  for (const raw of inputs) {
    const [namePart, creditPart] = String(raw).split(/[:=：]/);
    const item = resolveItem(namePart);
    if (!item) {
      unknown.push(String(raw));
      continue;
    }
    const declared = creditPart !== undefined && creditPart !== '' ? Number(creditPart) : null;
    const credits = Number.isFinite(declared) ? declared : item.minCredits;
    claimed.push({
      id: item.id,
      name: item.name,
      type: item.type,
      credits,
      creditSource: Number.isFinite(declared) ? 'declared' : 'min'
    });
  }

  const total = round(claimed.reduce((sum, item) => sum + item.credits, 0));
  const mandatory = claimed.filter((item) => item.type === '必修');
  const innovation = claimed.filter((item) => SECOND_CLASSROOM.innovationCategories.includes(item.name));
  const innovationCredits = round(innovation.reduce((sum, item) => sum + item.credits, 0));

  const checks = [
    {
      id: 'total',
      label: `专项学分合计 ≥ ${SECOND_CLASSROOM.requiredCredits}`,
      passed: total >= SECOND_CLASSROOM.requiredCredits,
      actual: total,
      required: SECOND_CLASSROOM.requiredCredits
    },
    {
      id: 'mandatory',
      label: `含必修学分（社会实践活动）≥ ${SECOND_CLASSROOM.mandatoryCredits}`,
      passed: mandatory.reduce((sum, item) => sum + item.credits, 0) >= SECOND_CLASSROOM.mandatoryCredits,
      actual: round(mandatory.reduce((sum, item) => sum + item.credits, 0)),
      required: SECOND_CLASSROOM.mandatoryCredits
    },
    {
      id: 'innovation',
      label: `创新创业教育类 ≥ ${SECOND_CLASSROOM.innovationMinCredits}（4 个分类中至少 1 个）`,
      passed: innovationCredits >= SECOND_CLASSROOM.innovationMinCredits,
      actual: innovationCredits,
      required: SECOND_CLASSROOM.innovationMinCredits
    }
  ];

  return {
    requiredCredits: SECOND_CLASSROOM.requiredCredits,
    earnedCredits: total,
    remainingCredits: round(Math.max(0, SECOND_CLASSROOM.requiredCredits - total)),
    enough: checks.every((check) => check.passed),
    checks,
    claimed,
    unknown,
    note: unknown.length > 0 ? `没认出的项目：${unknown.join('、')}。用 henu-cli second standard 看可用名称。` : undefined
  };
}

export function formatSecondStandardText(standard = SECOND_CLASSROOM) {
  const lines = [];
  lines.push(standard.title);
  lines.push(`毕业要求：至少 ${standard.requiredCredits} 学分，其中必修 ${standard.mandatoryCredits} 学分；创新创业教育类至少 ${standard.innovationMinCredits} 学分。`);
  lines.push('');
  lines.push('类型   学分    项目                          内容与要求');
  for (const item of standard.items) {
    const credits = item.minCredits === item.maxCredits ? String(item.minCredits) : `${item.maxCredits}-${item.minCredits}`;
    lines.push(`${item.type}   ${credits.padStart(4)}    ${item.name.padEnd(28)}  ${item.requirement}`);
    for (const level of item.levels ?? []) {
      lines.push(`                            └ ${level.level} ${level.role}：${level.credits} 学分`);
    }
  }
  lines.push('');
  lines.push('说明：');
  standard.rules.forEach((rule, index) => lines.push(`  ${index + 1}. ${rule}`));
  return lines.join('\n');
}

export function formatSecondCheckText(result) {
  const lines = [];
  lines.push(`第二课堂专项学分核对：${result.earnedCredits} / ${result.requiredCredits} 学分`);
  lines.push(result.enough ? '结论：满足毕业要求' : `结论：还差 ${result.remainingCredits} 学分或未满足分项要求`);
  lines.push('');
  for (const check of result.checks) {
    lines.push(`${check.passed ? '✓' : '✗'} ${check.label}（实际 ${check.actual}）`);
  }
  if (result.claimed.length > 0) {
    lines.push('');
    lines.push('已申报：');
    for (const item of result.claimed) {
      lines.push(`  ${item.name} ${item.credits} 学分${item.creditSource === 'min' ? '（按最低档计）' : ''}`);
    }
  }
  if (result.note) {
    lines.push('');
    lines.push(result.note);
  }
  return lines.join('\n');
}

function round(value, digits = 1) {
  const factor = 10 ** digits;
  return Math.round((Number(value) + Number.EPSILON) * factor) / factor;
}
