// 超星 LSP 的返回值字段名很“图书馆业务化”（onShelfCountI / callNo / docName），
// 这里统一收敛成人类可读的字段，顺便把空值清掉，避免 JSON 里一堆 null。

export function normalizeSearch(payload, options = {}) {
  const data = payload?.data ?? {};
  const items = (data.searchResult ?? []).map(normalizeRecord);
  return {
    keyword: options.keyword ?? '',
    field: options.field ?? 'keyword',
    page: options.page ?? 1,
    total: data.numFound ?? items.length,
    count: items.length,
    items
  };
}

export function normalizeRecord(record) {
  const callNo = Array.isArray(record?.callNo) ? record.callNo.filter(Boolean).join(' / ') : record?.callNo;
  const item = {
    recordId: record?.recordId ?? null,
    title: record?.title ?? '',
    author: emptyToNull(record?.author),
    publisher: emptyToNull(record?.publisher),
    year: emptyToNull(record?.publishYear),
    callNo: emptyToNull(callNo ?? record?.callNoOne),
    isbn: emptyToNull(record?.isbn ?? firstOf(record?.isbns)),
    docType: emptyToNull(record?.docName),
    subject: emptyToNull(record?.subjectWord),
    holdings: numberOrNull(record?.physicalCount),
    available: numberOrNull(record?.onShelfCountI)
  };
  return item;
}

// 「我的借阅」：账号信息来自 userInfo，借阅来自 loanList，历史来自 loanHistoryList。
export function normalizeAccount({ userInfo, loan, history }) {
  const user = userInfo?.data?.user ?? {};
  const loanData = loan?.data ?? {};

  return {
    profile: {
      name: emptyToNull(user.name),
      studentId: emptyToNull(user.primaryId ?? user.userBarcode),
      dept: emptyToNull(user.collegeDept),
      major: emptyToNull(user.majorName),
      grade: emptyToNull(user.collegeYear),
      group: emptyToNull(user.userGroupName),
      cardStatus: user.cardStatus === '1' ? '正常' : (emptyToNull(user.cardStatus) ?? '未知'),
      validFrom: emptyToNull(user.startDate),
      validTo: emptyToNull(user.endDate),
      deposit: numberOrNull(user.deposit)
    },
    loan: {
      remaining: numberOrNull(loanData.loanNum),
      total: loanData.numFound ?? 0,
      current: (loanData.searchResult ?? []).map(normalizeLoan)
    },
    ...(history ? {
      history: {
        total: history?.data?.numFound ?? 0,
        items: (history?.data?.searchResult ?? []).map(normalizeLoan)
      }
    } : {})
  };
}

// 借阅记录的字段名没在文档里，按常见命名多路兜底；取不到的字段直接置空，
// 不猜一个看起来像的字段填进去。
export function normalizeLoan(record) {
  return {
    title: emptyToNull(record?.title ?? record?.bookName ?? record?.name),
    barcode: emptyToNull(record?.barcode ?? record?.barCode),
    callNo: emptyToNull(Array.isArray(record?.callNo) ? record.callNo.join(' / ') : record?.callNo),
    loanDate: emptyToNull(record?.loanDate ?? record?.borrowDate),
    dueDate: emptyToNull(record?.returnDate ?? record?.dueDate ?? record?.shouldReturnDate),
    renewCount: numberOrNull(record?.renewCount ?? record?.renewNum),
    location: emptyToNull(record?.location ?? record?.libName ?? record?.roomName)
  };
}

export function normalizeSeats(payload, options = {}) {
  const data = payload?.data ?? {};
  const campuses = (data.list ?? []).map((campus) => ({
    name: campus.name ?? '',
    free: numberOrNull(campus.free_num) ?? 0,
    total: numberOrNull(campus.total_num) ?? 0,
    floors: (campus.children ?? []).map((floor) => ({
      name: floor.name ?? '',
      free: numberOrNull(floor.free_num) ?? 0,
      total: numberOrNull(floor.total_num) ?? 0
    }))
  }));

  return {
    day: options.day ?? (data.date?.[0] ?? null),
    days: data.date ?? [],
    campuses
  };
}

export function formatSearchText(result) {
  const lines = [];
  lines.push(`馆藏检索「${result.keyword}」（${fieldLabel(result.field)}）命中 ${result.total} 条，显示 ${result.count} 条`);
  lines.push('');

  if (result.count === 0) {
    lines.push('没有命中，换个关键词或把 --field 改成 keyword（任意词匹配）。');
    return lines.join('\n');
  }

  result.items.forEach((item, index) => {
    const meta = [item.author, item.publisher, item.year].filter(Boolean).join(' / ');
    const holding = item.holdings === null
      ? '馆藏信息未知'
      : `馆藏 ${item.holdings} 册，在架 ${item.available ?? 0} 册`;
    lines.push(`${String(index + 1).padStart(2, ' ')}. ${item.title}`);
    if (meta) lines.push(`    ${meta}`);
    lines.push(`    ${holding}${item.callNo ? ` · 索书号 ${item.callNo}` : ''}${item.isbn ? ` · ISBN ${item.isbn}` : ''}`);
  });
  return lines.join('\n');
}

export function formatAccountText(account) {
  const { profile, loan } = account;
  const lines = [];
  lines.push('图书馆 · 我的借阅');
  const who = [profile.name, profile.studentId, profile.dept, profile.major].filter(Boolean).join(' / ');
  if (who) lines.push(who);
  const card = [profile.cardStatus && `证件${profile.cardStatus}`, profile.validTo && `有效期至 ${profile.validTo}`, profile.group]
    .filter(Boolean).join(' · ');
  if (card) lines.push(card);
  lines.push('');

  const remain = loan.remaining === null ? '未知' : `${loan.remaining} 本`;
  lines.push(`当前借阅 ${loan.total} 条（还能借 ${remain}）`);
  if (loan.current.length === 0) {
    lines.push('  没有在借图书。');
  } else {
    for (const item of loan.current) {
      lines.push(`  ${item.title ?? '(无题名)'}  ${item.loanDate ?? ''} → 应还 ${item.dueDate ?? '?'}${item.renewCount ? ` · 已续借 ${item.renewCount} 次` : ''}`);
    }
  }

  if (account.history) {
    lines.push('');
    lines.push(`借阅历史 ${account.history.total} 条`);
    for (const item of account.history.items.slice(0, 10)) {
      lines.push(`  ${item.title ?? '(无题名)'}  ${item.loanDate ?? ''} → ${item.dueDate ?? ''}`);
    }
  }
  return lines.join('\n');
}

export function formatSeatText(seats) {
  const lines = [];
  const scope = seats.filter?.campus ? ` · ${seats.filter.campus}` : '';
  lines.push(`图书馆座位${scope} · ${seats.day ?? ''}（可预约日期 ${seats.days.join(' / ') || '未知'}）`);
  lines.push('');

  for (const campus of seats.campuses) {
    const ratio = campus.total > 0 ? Math.round((campus.free / campus.total) * 100) : 0;
    lines.push(`${campus.name}  空闲 ${campus.free} / 总数 ${campus.total}（${ratio}% 可用）`);
    for (const floor of campus.floors) {
      lines.push(`  ${floor.name}  空闲 ${floor.free} / ${floor.total}`);
    }
  }
  if (seats.campuses.length === 0) lines.push('没有取到座位数据。');
  return lines.join('\n');
}

function fieldLabel(field) {
  const labels = { keyword: '任意词', title: '题名', author: '作者' };
  return labels[field] ?? field;
}

function emptyToNull(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text === '' ? null : text;
}

function numberOrNull(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function firstOf(value) {
  if (Array.isArray(value)) return value[0];
  return value;
}
