import assert from 'node:assert/strict';
import test from 'node:test';

import {
  formatAccountText,
  formatSearchText,
  formatSeatText,
  normalizeAccount,
  normalizeSeats,
  normalizeSearch
} from '../src/modules/library-parser.js';

// 真实返回：POST /find/unify/search（截取两条，字段名保持原样）
const SEARCH = {
  success: true,
  data: {
    numFound: 121,
    searchResult: [
      {
        recordId: 375846,
        title: '药物化学',
        author: '尤启冬主编',
        publisher: '化学工业出版社',
        publishYear: '2004.01',
        callNo: ['R914/Y615'],
        isbn: '7-5025-4976-5',
        docName: '图书',
        subjectWord: '药物化学',
        physicalCount: 4,
        onShelfCountI: 4
      },
      {
        recordId: 307445,
        title: '药物化学. 2版',
        author: '',
        publisher: null,
        publishYear: '2012',
        callNo: [],
        isbn: null,
        docName: '图书',
        physicalCount: 2,
        onShelfCountI: 1
      }
    ]
  }
};

// 真实返回：/find/userInfo/getUserInfo + /find/loanInfo/loanList
const USER_INFO = {
  success: true,
  data: {
    user: {
      name: '*同学',
      primaryId: '2310200001',
      collegeDept: '药学院',
      majorName: '药学',
      collegeYear: '2023',
      userGroupName: '本科生',
      cardStatus: '1',
      startDate: '2023-09-01',
      endDate: '2027-06-10',
      deposit: 0
    }
  }
};

const LOAN = { success: true, data: { searchResult: [], loanNum: 8, numFound: 0 } };

const SEATS = {
  code: 0,
  data: {
    date: ['2026-10-26', '2026-10-27'],
    list: [
      {
        name: '金明校区',
        free_num: 2337,
        total_num: 3312,
        children: [
          { name: '金明二楼', free_num: 608, total_num: 832 },
          { name: '金明三楼', free_num: 196, total_num: 434 }
        ]
      }
    ]
  }
};

test('检索结果收敛字段：空作者/空索书号置 null，不编造', () => {
  const result = normalizeSearch(SEARCH, { keyword: '药物化学', field: 'title', page: 1 });
  assert.equal(result.total, 121);
  assert.equal(result.count, 2);

  const [first, second] = result.items;
  assert.equal(first.title, '药物化学');
  assert.equal(first.callNo, 'R914/Y615');
  assert.equal(first.holdings, 4);
  assert.equal(first.available, 4);

  assert.equal(second.author, null);
  assert.equal(second.publisher, null);
  assert.equal(second.callNo, null);
  assert.equal(second.available, 1);
});

test('账号信息：证件状态翻译成人话，可借数来自 loanNum', () => {
  const account = normalizeAccount({ userInfo: USER_INFO, loan: LOAN });
  assert.equal(account.profile.cardStatus, '正常');
  assert.equal(account.profile.dept, '药学院');
  assert.equal(account.profile.major, '药学');
  assert.equal(account.profile.group, '本科生');
  assert.equal(account.loan.remaining, 8);
  assert.equal(account.loan.total, 0);
  assert.deepEqual(account.loan.current, []);
  assert.equal('history' in account, false);
});

test('账号信息：不给 --history 时不该带 history 字段', () => {
  const withHistory = normalizeAccount({
    userInfo: USER_INFO,
    loan: LOAN,
    history: { data: { numFound: 3, searchResult: [] } }
  });
  assert.equal(withHistory.history.total, 3);
});

test('座位：校区带楼层，空闲/总数取整', () => {
  const seats = normalizeSeats(SEATS, { day: '2026-10-26' });
  assert.equal(seats.day, '2026-10-26');
  assert.deepEqual(seats.days, ['2026-10-26', '2026-10-27']);
  assert.equal(seats.campuses[0].name, '金明校区');
  assert.equal(seats.campuses[0].free, 2337);
  assert.equal(seats.campuses[0].floors.length, 2);
  assert.equal(seats.campuses[0].floors[1].total, 434);
});

test('文本视图：检索/借阅/座位都带关键数字', () => {
  const searchText = formatSearchText(normalizeSearch(SEARCH, { keyword: '药物化学', field: 'title' }));
  assert.match(searchText, /命中 121 条/);
  assert.match(searchText, /在架 4 册 · 索书号 R914\/Y615/);

  const accountText = formatAccountText(normalizeAccount({ userInfo: USER_INFO, loan: LOAN }));
  assert.match(accountText, /\*同学 \/ 2310200001 \/ 药学院 \/ 药学/);
  assert.match(accountText, /还能借 8 本/);
  assert.match(accountText, /没有在借图书/);

  const seatText = formatSeatText(normalizeSeats(SEATS, { day: '2026-10-26' }));
  assert.match(seatText, /金明校区 {2}空闲 2337 \/ 总数 3312/);
  assert.match(seatText, /金明二楼 {2}空闲 608 \/ 832/);
});

test('座位按校区过滤后只留该校区，标题带筛选条件', () => {
  const filtered = { ...normalizeSeats(SEATS, { day: '2026-10-26' }), filter: { campus: '金明' } };
  filtered.campuses = filtered.campuses.filter((item) => item.name.includes('金明'));

  const text = formatSeatText(filtered);
  assert.match(text, /图书馆座位 · 金明 · 2026-10-26/);
  assert.match(text, /（71% 可用）/);
  assert.ok(!text.includes('明伦校区'));
});
