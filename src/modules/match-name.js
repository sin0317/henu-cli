// 名称匹配的归一化与三级匹配，学自 HENU_Assistant 的 LocationMixin._normalize_area_name：
// 用户口里的地名（「金明校区图书馆三楼」「三楼(东)」「金明三楼 」）几乎不会和接口里的
// 名字逐字相同，逐字相等匹配必然漏。
//
// 归一化还原的是「人说话时会省略什么」：大小写、空格、括号里的补充说明、
// 「河南大学」「图书馆」这类默认就带的前缀。做完还比不上，才退到子串包含。

const DROP_TOKENS = ['河南大学', '图书馆', 'library', 'campus'];

export function normalizeName(value) {
  let text = String(value ?? '').trim().toLowerCase();
  text = text.replace(/\s+/g, '');
  text = text.replace(/[（(][^（()）]*[）)]/g, '');
  for (const token of DROP_TOKENS) {
    text = text.split(token).join('');
  }
  return text;
}

/**
 * 三级匹配：精确 → 归一化后相等 → 归一化后子串包含。
 *
 * 为什么要分三级：前两级不会误伤（「金明三楼」只能对上「金明三楼」），
 * 第三级是为了兜住「三楼」这种省略写法，代价是可能命中多个，
 * 所以只在前面都没结果时才用，并且要求两侧归一化结果都非空。
 */
export function pickByName(rows, wanted, getValue) {
  const target = String(wanted ?? '').trim();
  if (!target || !Array.isArray(rows) || rows.length === 0) return null;

  const targetNorm = normalizeName(target);
  const extract = getValue ?? ((row) => row?.name ?? row);

  for (const row of rows) {
    if (target === String(extract(row) ?? '').trim()) return row;
  }
  if (!targetNorm) return null;

  for (const row of rows) {
    if (targetNorm === normalizeName(extract(row))) return row;
  }

  const contains = rows.filter((row) => {
    const norm = normalizeName(extract(row));
    return norm !== '' && (norm.includes(targetNorm) || targetNorm.includes(norm));
  });
  return contains.length === 1 ? contains[0] : null;
}

/** 归一化后的可以取值清单，用于报错里告诉用户「到底有哪些」。 */
export function listNames(rows, getValue) {
  const extract = getValue ?? ((row) => row?.name ?? row);
  return (rows ?? []).map((row) => String(extract(row) ?? '').trim()).filter(Boolean);
}
