import assert from 'node:assert/strict';
import test from 'node:test';

import { formatNoticeListText, formatNoticeSearchText, formatNoticeText, noticeMatches } from '../src/modules/notice.js';
import { parseNoticeDetail, parseNoticeList } from '../src/modules/notice-parser.js';

// 真实结构：博达 VSB 新闻网列表页（<a title> + <h4> + <time class="sys"><i></i>日期）
const NEWS_LIST = `
<ul class="mytzlist">
  <li class="uani fadeInUp">
    <a href="../../info/1111/202277.htm" title="袁正宏：践行颜福庆教育理念（时间：10月27日）" target="_blank">
      <div class="txt">
         <h4>袁正宏：践行颜福庆教育理念（时间：10月27日）</h4>
         <p class="l2"></p>
         <time class="sys"><i class="swiper-icons swi-shijian"></i>2026-10-23</time>
      </div>
    </a>
  </li>
  <li class="uani fadeInUp">
    <a href="../../info/1111/202147.htm" title="吴多才：当代中国风格合唱作品（时间：10.24）">
      <div class="txt">
         <h4>吴多才：当代中国风格合唱作品（时间：10.24）</h4>
         <time class="sys"><i class="swiper-icons swi-shijian"></i>2026-10-22</time>
      </div>
    </a>
  </li>
  <li><a href="../../index.htm" title="首页">首页</a></li>
</ul>`;

// 真实结构：教务处列表页（span.article-title + span.article-date，含 content.jsp 动态链接）
const JWC_LIST = `
<div class="article-list">
  <ul>
    <li>
      <a href="info/2357/23133.htm">
        <span class="article-title">巡察公告</span>
        <span class="article-date">2026-10-20</span>
      </a>
    </li>
    <li>
      <a href="content.jsp?urltype=news.NewsContentUrl&wbtreeid=2357&wbnewsid=23163">
        <span class="article-title">关于做好2026年下半年普通话水平测试报名工作的通知</span>
        <span class="article-date">2026-10-23</span>
      </a>
    </li>
  </ul>
</div>`;

const DETAIL = `
<h1>巡察公告</h1>
<span>2026-10-20</span>
<div id="vsb_content" class="arc-con"><div class="v_news_content">
  <p>按照学校党委统一部署，<strong>2026年10月</strong>开展专项巡察。</p>
  <p>第一巡察组：纳米科学与材料工程学院党委<br>第二巡察组：地理科学学院党委</p>
  <img src="/__local/B/2A/57/poster.jpg">
</div></div>
<div class="share">-分享-</div>`;

const IMAGE_ONLY = `
<h1>冼劲松：德奥古典风格</h1>
<div id="vsb_content"><div class="v_news_content">
  <p style="text-align: center"><img src="/__local/8/3D/6E/poster2.jpg" class="img_vsb_content"></p>
  <p><br></p>
</div></div>`;

test('解析新闻网公告列表：标题、日期、绝对地址', () => {
  const items = parseNoticeList(NEWS_LIST, {
    pageUrl: 'http://news.henu.edu.cn/hdzx/tzgg/xsgg.htm',
    source: 'academic'
  });
  assert.equal(items.length, 2);
  assert.equal(items[0].title, '袁正宏：践行颜福庆教育理念（时间：10月27日）');
  assert.equal(items[0].date, '2026-10-23');
  assert.equal(items[0].url, 'http://news.henu.edu.cn/info/1111/202277.htm');
  assert.equal(items[0].source, 'academic');
});

test('解析教务处列表：span 标题 + 动态页链接也保留', () => {
  const items = parseNoticeList(JWC_LIST, { pageUrl: 'https://jwc.henu.edu.cn/tzgg.htm', source: 'jwc' });
  assert.equal(items.length, 2);
  assert.equal(items[0].title, '巡察公告');
  assert.equal(items[0].url, 'https://jwc.henu.edu.cn/info/2357/23133.htm');
  assert.match(items[1].url, /content\.jsp\?urltype=news\.NewsContentUrl/);
});

test('导航链接与无日期条目不会混进列表', () => {
  const items = parseNoticeList(NEWS_LIST, { pageUrl: 'http://news.henu.edu.cn/hdzx/tzgg/xsgg.htm' });
  assert.ok(items.every((item) => !item.title.includes('首页')));
  assert.ok(items.every((item) => item.date !== null));
});

test('详情页取标题、日期与正文，嵌套 div 不会截断', () => {
  const detail = parseNoticeDetail(DETAIL, { url: 'https://jwc.henu.edu.cn/info/2357/23133.htm' });
  assert.equal(detail.title, '巡察公告');
  assert.equal(detail.date, '2026-10-20');
  assert.match(detail.text, /按照学校党委统一部署，2026年10月开展专项巡察。/);
  assert.match(detail.text, /第二巡察组：地理科学学院党委/);
  assert.ok(!detail.text.includes('分享'));
  assert.deepEqual(detail.images, ['https://jwc.henu.edu.cn/__local/B/2A/57/poster.jpg']);
});

test('整篇是海报图的公告不当成解析失败', () => {
  const detail = parseNoticeDetail(IMAGE_ONLY, { url: 'http://news.henu.edu.cn/info/1111/201947.htm' });
  assert.equal(detail.chars, 0);
  assert.equal(detail.images.length, 1);
  assert.match(detail.text, /正文为图片，共 1 张/);
  assert.match(detail.text, /http:\/\/news\.henu\.edu\.cn\/__local\/8\/3D\/6E\/poster2\.jpg/);
});

test('文本视图带栏目标签与地址', () => {
  const result = {
    channel: 'all',
    page: 1,
    count: 1,
    channels: [{ id: 'school', label: '学校公告' }],
    items: [{ title: '关于医保的通知', date: '2026-10-23', url: 'http://news.henu.edu.cn/info/1009/202207.htm', source: 'school' }]
  };
  const text = formatNoticeListText(result);
  assert.match(text, /2026-10-23 {2}\[学校公告\] 关于医保的通知/);
  assert.match(text, /http:\/\/news\.henu\.edu\.cn\/info\/1009\/202207\.htm/);

  const detail = formatNoticeText({ title: '巡察公告', date: '2026-10-20', source: 'jwc', url: 'https://jwc.henu.edu.cn/info/2357/23133.htm', text: '正文' });
  assert.match(detail, /^巡察公告\n2026-10-20 · jwc/);
});

test('检索只比标题，多个关键词之间是「且」', () => {
  const item = { title: '关于2026年上半年全国大学英语四、六级考试期间停课的通知' };
  assert.equal(noticeMatches(item, ['考试']), true);
  assert.equal(noticeMatches(item, ['英语', '考试']), true);
  assert.equal(noticeMatches(item, ['英语', '数学']), false);
  assert.equal(noticeMatches(item, ['english']), false);
  assert.equal(noticeMatches({ title: null }, ['考试']), false);
});

test('检索结果文本带扫描量、命中量与地址', () => {
  const text = formatNoticeSearchText({
    keyword: '考试',
    channel: 'all',
    pages: 3,
    scanned: 78,
    count: 1,
    items: [{
      title: '关于大学英语六级考试报名的紧急通知',
      date: '2026-09-22',
      url: 'https://jwc.henu.edu.cn/info/2357/23013.htm',
      source: 'jwc'
    }]
  });
  assert.match(text, /公文通检索「考试」· 全部栏目 · 最近 3 页\/栏目/);
  assert.match(text, /扫描 78 条，命中 1 条/);
  assert.match(text, /2026-09-22 {2}\[教务处通知\] 关于大学英语六级考试报名的紧急通知/);
  assert.match(text, /https:\/\/jwc\.henu\.edu\.cn\/info\/2357\/23013\.htm/);
});

test('检索无结果时给出放宽条件的提示', () => {
  const text = formatNoticeSearchText({ keyword: '不存在的词', channel: 'jwc', pages: 2, since: '2026-10-01', scanned: 24, count: 0, items: [] });
  assert.match(text, /2026-10-01 之后/);
  assert.match(text, /没有命中/);
  assert.match(text, /--pages/);
});
