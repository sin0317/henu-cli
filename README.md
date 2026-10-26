# henu-cli

[![test](https://github.com/sin0317/henu-cli/actions/workflows/test.yml/badge.svg)](https://github.com/sin0317/henu-cli/actions/workflows/test.yml)

面向 AI Agent 的河南大学校园服务命令行工具。设计参考 [szu-cli](https://github.com/AwesomeHou/szu-cli)（MIT）。

- 不保存账号密码：登录由你在浏览器里完成，CLI 只复用本地持久化 profile
- 所有命令输出结构化 JSON，便于 Agent 消费
- 默认只读，不绕过登录、验证码与校园网限制

## 安装与快速开始

要求 Node.js >= 20。

```bash
npm install            # 安装依赖（playwright）
node src/cli.js doctor # 检查环境
node src/cli.js auth login
node src/cli.js course today
```

一条命令装好 CLI + skill：

```bash
npx -y github:sin0317/henu-cli install
```

它会做三件事：把 CLI 装进 npm 全局前缀、自动挑一个**已经在 PATH 上**的前缀（Windows 下默认目录不可见时改投 `%APPDATA%\npm`）、把随包 skill 拷到 `~/.workbuddy/skills/`。

常用变体：

```bash
npx -y github:sin0317/henu-cli install --text         # 人类可读输出
npx -y github:sin0317/henu-cli install --no-skill     # 只装 CLI
npx -y github:sin0317/henu-cli install --target all   # skill 装到所有支持的 Agent 目录
npx -y github:sin0317/henu-cli install --prefix "C:\Users\me\AppData\Roaming\npm"
```

> `npx henu-cli@latest install` 要等包发布到 npm 才有，目前用上面的 GitHub 直连写法。

**为什么先 `npm pack` 再装**：`npm install -g <目录>` 在 npm 7+ 会建符号链接，从 npx 临时缓存装的话，缓存一清全局命令就失效。所以 `install` 先打 tarball 再装 `.tgz`，落盘的是真副本。

**Windows 上有个坑**：如果 `node` / `npm` 是某个应用自带的（比如 WorkBuddy、Trae 托管的 node），`npm config get prefix` 会指到那个应用的私有目录，装完的 `henu-cli.cmd` 只在该应用的运行环境里可见，你自己开 PowerShell 敲 `henu-cli` 会提示「不是内部或外部命令」。`install` 会检测到这点并自动改投 `%APPDATA%\npm`；也可以手动指定：

```powershell
npm install --global . --prefix "$env:APPDATA\npm"
```

全局安装是**复制**，改完源码要重装一次才生效：`node src/cli.js install`。或者开发时干脆用 `node src/cli.js <命令>` / `npm run henu-cli -- <命令>`，跳过安装。

只装 skill（不动 CLI）：

```bash
henu-cli skill install --target workbuddy|claude|codex|cursor|all
```

skill 会拷到 `~/.workbuddy/skills/henu-cli-skill/`。**技能列表在会话启动时扫描**，
装完要新开一个对话，Agent 才会在可用技能里看到它（当前会话看不到）。

## 命令

| 命令 | 说明 |
|---|---|
| `doctor` | 检查 Node、Playwright、浏览器、网络连通性 |
| `auth login` / `status` / `logout` | 登录、检查、清除登录态 |
| `browser status` / `use` / `install chromium` | 浏览器后端管理 |
| `course list` / `today` / `ics` / `status` | 课表查询、导出 .ics 日历、可读性检查 |
| `room free` / `options` | 空闲教室查询 |
| `grade list` / `audit` / `plan` | 成绩明细、毕业学分核对、培养方案要求 |
| `plan depts` / `majors` / `show` / `audit` | 全校任意专业、任意年级的培养方案与学分核对 |
| `second standard` / `check` | 第二课堂专项学分标准与达标核对 |
| `exam tabs` | 列出「课程考试」模块的真实入口（河大没有考试安排查询） |
| `notice list` / `search` / `show` | 公文通：学校公告、学术公告、教务处通知，支持标题检索 |
| `library search` / `account` / `seat` | 图书馆：馆藏检索、我的借阅、座位空闲 |
| `install` | 全局安装 CLI + 随包 skill（一条命令装好） |
| `skill path` / `install` | 只管理随包 skill |

常用参数：`--headed` 显示浏览器窗口排障，`--dump` 写诊断文件，`--weekday 1-7` 按星期过滤，
`--text` 输出人类可读文本（默认是 JSON）。

输出示例（真实数据）：

```json
{
  "ok": true,
  "data": {
    "term": "2026-2027学年第一学期",
    "items": [
      {
        "courseCode": "03100743",
        "courseName": "临床药物治疗学概论",
        "teachers": ["张伟", "李静", "王强"],
        "credits": 2,
        "sessions": [
          { "weekday": 3, "periods": { "start": 1, "end": 2 }, "weeks": { "start": 1, "end": 9 }, "location": "金明综合楼5206(138)" },
          { "weekday": 4, "periods": { "start": 1, "end": 2 }, "weeks": { "start": 1, "end": 9 }, "location": "计算机大楼101(150)" }
        ]
      }
    ],
    "total": 1
  }
}
```

## 空教室查询

分两种问法，**问“某间教室某节课空不空”请用 `room grid`**。

### room grid：按小节看整栋楼（推荐）

```bash
# 第 9 周周三，金明综合楼5 每间教室的空闲节次
node src/cli.js room grid --building 金明综合楼5 --week 9 --weekday 3 --text

# 只要第 3-4 节全空的教室
node src/cli.js room grid --building 金明综合楼5 --week 9 --weekday 3 --period 3-4 --text
```

| 参数 | 说明 | 默认 |
|---|---|---|
| `--building` | 楼房名，如 `金明综合楼5` | **必填** |
| `--week` | 单个教学周，如 `9` | **必填**（不给会返回 1-18 周的全部格子，没法用） |
| `--weekday` | `3` 或 `周三` | 今天 |
| `--period` | `3`、`3-4`（一天 13 小节） | 不指定则只输出网格 |
| `--campus` | 明伦 / 金明 / 郑州 / 其他 | 金明 |
| `--text` | 人读清单 | 关闭 |

这一页对应教务首页 `#SB → #module280`（分教室查看空闲周次/节次），结果天然是
「教室 × 节次 × 星期」的占用矩阵，红色 = 非空闲。请求里固定带两个字段：

- `rad_jc=1` —— 按小节。默认是 `rad_jc=0`（按大节），粒度对不上真实课表。
- `lyjc=1` —— 留用节次算非空闲。默认把留用教室当空闲，`5301/5302` 就是这么被误报的。

```json
{
  "ok": true,
  "data": {
    "query": { "campus": "金明校区", "building": "金明综合楼5", "week": "9", "weekday": "星期三", "periodCount": 13 },
    "roomsTotal": 34,
    "freeCount": 2,
    "free": [{ "name": "金明综合楼5201", "capacity": 96, "roomType": "多媒体教室" }],
    "rooms": [
      { "name": "金明综合楼5201", "grid": "......XXXX...", "freePeriods": [1,2,3,4,5,6,11,12,13], "busyPeriods": [7,8,9,10] }
    ]
  }
}
```

`grid` 是 13 位网格，`.` = 空闲、`X` = 占用（有课 / 预约 / 留用）。

### room free：按节次反查哪些教室空

```bash
# 今天、金明校区、第 1 节、多媒体教室，只看 100 人以上
node src/cli.js room free --campus 金明 --period 1 --type 多媒体 --min 100

# 周三 3-4 节的空闲教室，用人类可读格式
node src/cli.js room free --weekday 3 --period 3-4 --week 9 --text

# 只看计算机大楼
node src/cli.js room free --building 计算机大楼 --weekday 3 --period 1

# 列出资质：校区、教室类型、楼房有哪些合法取值
node src/cli.js room options
```

| 参数 | 说明 | 默认 |
|---|---|---|
| `--campus` | 明伦 / 金明 / 郑州 / 其他 | 全部校区 |
| `--weekday` | `3` 或 `周一` 或 `1-5` | 今天 |
| `--period` | 小节号 `1`、`3-4`（一天 13 小节） | 全部 13 节 |
| `--week` | `9` 或 `1-18` | `1-18`，含义是**每一周都空**，查具体某周务必显式给 |
| `--parity` | 单周 / 双周 | 不限 |
| `--type` | 一般教室 / 多媒体 / 师范 / 不安排教室 | 全部类型 |
| `--building` | 楼房名，如 `金明综合楼5` | 全部 |
| `--min` / `--max` | 容量范围 | 1 / 100 |
| `--include-reserved` | 连“设置为留用”的教室也算进来 | 关闭（默认排除） |
| `--text` | 输出人读清单而不是 JSON | 关闭 |

输出按「节次 → 校区 → 教室类型」分组，`byPeriod` 给出每个节次的教室数，
`total` 是「教室 × 节次」的累计数（同一间教室在多个节次都空会被计多次）。

```json
{
  "ok": true,
  "data": {
    "query": { "campus": "金明校区", "weekday": "星期三", "periods": ["1节"], "capacity": "1-300 人" },
    "weekLabel": "第1-18周",
    "weekdayLabel": "星期三",
    "total": 50,
    "byPeriod": [{ "period": "1节", "total": 50 }],
    "groups": [
      {
        "period": "1节",
        "campus": "金明校区",
        "roomType": "多媒体教室",
        "declaredCount": 50,
        "rooms": [{ "building": "计算机大楼", "name": "计算机大楼101", "capacity": 150 }]
      }
    ]
  }
}
```

## 课表导出到日历（ICS）

```bash
# 第一次：告诉它第 1 周周一是哪天（或者今天是第几周）
henu-cli course ics --week-now 8 --text

# 之后同一个学期直接导，不用再传
henu-cli course ics --text

# 指定输出路径、强制用某个作息
henu-cli course ics --start 2026-09-07 --schedule winter --out ~/Desktop/课表.ics
```

生成的 `.ics` 手机、电脑日历都能直接导入（日历 App → 添加日历 → 从文件导入）。
每个上课时段一个 `RRULE:FREQ=WEEKLY`，单双周用 `INTERVAL=2` 表达；教室、教师、课程号都写在描述里。

### 课表导出的三个坑

1. **教务系统里查不到「第 1 周是几号」。** 课表页只给 `2026-2027学年第一学期` 和周次（`1-9周`），
   没有任何日期。所以要么用 `--start` 给第 1 周周一，要么用 `--week-now` 说明今天第几周，
   CLI 自己往前推。给过一次就按学期记在 `~/.henu-cli/calendar-terms.json`，下次不用再传。
2. **上下课时间是两套作息。** 《河南大学教学时间设置列表》（校发〔2018〕300 号附件）规定：
   10 月 1 日至次年 4 月 30 日执行**冬季**作息，其余时间**夏季**作息，夏季整体后推 30 分钟
   （冬季 1-2 节 08:00–09:50，夏季 08:30–10:20）。一门从 9 月连上到 11 月的课会跨过切换点，
   所以导出时按日期把日程**拆成两段**，各自用自己的时刻，而不是按首次上课日一刀切。
3. **ICS 每行不能超过 75 个八位组。** 中文一个字 3 字节，按字符数折行会超；必须按字节折，
   且不能把一个多字节字符劈两半。折行时优先在描述里的换行处断开，日历里读起来才像自然段落。

## 成绩与毕业学分

```bash
# 入学以来全部成绩（自动选择：入学以来 + 有效成绩 + 主修）
node src/cli.js grade list
node src/cli.js grade list --text

# 对照培养方案核对毕业学分缺口
node src/cli.js grade audit
node src/cli.js grade audit --text

# 查看内置的培养方案要求（不含你的成绩）
node src/cli.js grade plan
```

`grade audit --text` 的真实输出：

```
药学专业（100701）2023级 毕业学分核对
培养方案要求 170 学分：必修124 + 选修27 + 集中性实践教学环节14 + 第二课堂5

平台/环节                      要求      已修     缺口
✓ 公共基础平台课（必修）              36      36      0
✓ 学科基础平台课（必修）            35.5    35.5      0
△ 专业基础平台课（必修）            52.5    50.5      2
✓ 专业选修课                    17    17.5      0
✓ 公共选修课（通识课程）              10      10      0
△ 集中性实践教学环节                14     1.5   12.5
✗ 第二课堂专项学分                  5       0      5

已获 151 / 170 学分，差 19 学分
（按平台逐项补齐需再修 19.5 学分，差额来自选修课超修 0.5 学分的抵扣）
```

`audit` 的输出字段：

| 字段 | 说明 |
|---|---|
| `earnedCredits` | 已获学分（含计划外课程） |
| `remainingCredits` | 距培养方案总学分的差额 |
| `remainingByBucket` | 按平台逐项补齐需要的学分（通常 ≥ `remainingCredits`，差额是选修超修部分） |
| `surplus` | 超修、可用于抵扣的学分 |
| `buckets[].missing` | 该平台还缺哪些课，`reason` 为 `not-taken` / `not-passed` / `no-grade-record` |
| `outsidePlan` | 培养方案外已修的课程，只计入总学分 |

**培养方案要求写在 `src/curriculum.js`**，一门课的归属按「成绩单上的类别串」或「课程号」匹配。
换专业、换年级版本时改这一个文件即可，核对逻辑不用动。

注意 `第二课堂专项学分` 在成绩明细里查不到（走「到梦空间」），`reason` 会标成 `no-grade-record`，
需要自己另行确认，不能当成"没修"。

## 培养方案：任意专业、任意年级

`plan` 命令族借用「学业成绩 → 专业培养方案达成度」这个页面。页面上的院系/专业/年级是三个可选项，
提交到 `/taglib/DataTable.jsp?tableId=xxx`（tableId 每次会话不同，从 form 的 action 现读），
返回该专业完整方案课程清单，并叠加当前登录账号自己的成绩与通过状态。

```bash
# 有哪些院系
node src/cli.js plan depts

# 药学院下面有哪些专业
node src/cli.js plan majors --dept 0031

# 任意专业的方案课程清单（不传参数 = 你自己的专业和年级）
node src/cli.js plan show --dept 0031 --major 0116 --year 2023 --text

# 通用学分核对：必修平台自动算，选修平台要你给最低学分
node src/cli.js plan audit --dept 0031 --major 0116 --year 2023 \
  --elective-major 17 --elective-general 10 --text
```

实测：药学 2023 是 95 门 / 239.5 学分，金融学 2023 是 71 门 / 178 学分，两套都取得到。
药物制剂 2023 返回 `PLAN_NOT_FOUND`——这是教务系统里确实没配方案，不是抓不到。

**三个必须知道的口径问题**（不写清就会算错）：

1. **方案池 ≠ 毕业要求。** 方案表里选修课列的是「可选课程全集」，药学专业选修挂了 42 门 84.5 学分，
   但实际只需修 17 学分。所以选修的最低学分要从培养方案正文取，用 `--elective-major` / `--elective-general` 传。
2. **方案池会混排新旧版本课程。** 药学公共基础平台课求和是 41 学分，培养方案正文写的是 36；
   通识必修里同时有「大学英语读写译」和「大学英语读写译(一)」。所以 `plan audit` 的必修要求只能当估算，
   精确核对仍用 `grade audit`（它按培养方案正文校准过）。
3. **通识选修（公选课）根本不在方案表里。** 所以那部分已修学分标成「待查」，要看 `grade list`。

## 第二课堂专项学分

标准来自教务处《附件6 河南大学"第二课堂"专项学分项目一览表》，全校统一，不随专业变。

```bash
node src/cli.js second standard                    # 完整标准：8 个项目 + 学分档位 + 4 条说明
node src/cli.js second check --items 社会实践,竞赛:4  # 核对是否达标
node src/cli.js second check --items 社会实践,普通话 --json
```

毕业要求是「至少 5 学分，含 1 个必修学分（社会实践活动），创新创业教育类 4 个分类中至少 1 个拿到 1 学分」。
`check` 会把这三条分开判定，不会用一个总分糊过去——只凑够 5 分但没做社会实践，仍然判不达标。

## 考试安排：河大教务系统里没有

`exam tabs` 会列出「课程考试」模块的真实入口，实测只有三项：

```
S20402  申请缓考
S20408  查看缓考信息
S20401  申请补考
```

没有「考试安排查询」。另外把 `ksap.*` 前缀下 22 个候选页面逐个请求过，全部 404；
左侧菜单树和首页 14 个 tile 里也没有考试安排入口。所以**期末考试时间与考场在教务系统里查不到**，
由教务处通知公告、学院和辅导员另行发布。这个命令的价值是给 Agent 一个确定性答案，
不要让它反复重试或编造考场。

## 公文通

河大没有独立的「公文通」域名（`gwt.` / `gw.` 都不解析，`oa.henu.edu.cn` 是通达 OA、面向教职工、
要单独账号和 RSA 加密密码）。师生实际看的是三个博达 VSB 站群栏目，**全部公开可读，不需要登录**：

```bash
# 三个栏目混排，按日期倒序
henu-cli notice list --text

# 只看教务处，取 20 条
henu-cli notice list --channel jwc --limit 20 --text

# 检索标题：最近 30 天内的「考试」相关通知
henu-cli notice search 考试 --days 30 --text

# 多个关键词是「且」：同时命中「英语」和「四级」
henu-cli notice search 英语 四级 --pages 5 --text

# 从某天起，只看学术公告
henu-cli notice search 讲座 --channel academic --since 2026-09-01 --text

# 取正文（地址直接用 list 输出里的 url）
henu-cli notice show --url "https://jwc.henu.edu.cn/info/2357/23133.htm" --text
```

栏目对应关系：

| channel | 栏目 | 地址 | 内容 |
|---|---|---|---|
| `school` | 学校公告 | `news.henu.edu.cn/hdzx/tzgg/xxgg.htm` | 医保、活动、评奖等校级通知 |
| `academic` | 学术公告 | `news.henu.edu.cn/hdzx/tzgg/xsgg.htm` | 讲座、报告（常带时间地点） |
| `jwc` | 教务处通知 | `jwc.henu.edu.cn/tzgg.htm` | 选课、考试、报名、学籍 |

因为走的是纯 HTTP（不起浏览器），`notice list` 单次约 0.3 秒，`notice show` 约 0.2 秒。

**检索没有服务端接口**，只能把最近几页抓下来在本地按标题过滤（`--pages` 默认 3 页/栏目）。
好在列表是日期倒序的，扫到比 `--since` 更早的一页就停，所以 `--days 14` 这种窗口通常只要 40 条左右。
实测 `notice search 考试 --pages 3` 扫描 78 条、命中 5 条，耗时约 1 秒。

### 公文通的三个坑

1. **分页是「倒着编号」的。** 首屏是 `xsgg.htm`（最新），而 `xsgg/754.htm` 才是最老的那页，
   `xsgg/1.htm` 是 2007 年的存档。所以「第 k 页」对应的物理页码是 `总页数 - k + 1`，
   总页数从列表页的「尾页」链接里读。照着正序去拼 `xsgg/2.htm` 会翻到十几年前的公告。
2. **正文容器是 `#vsb_content`，里面还有嵌套 div。** 正则按 `</div>` 截会截断，
   要按标签深度配对；正文里最常见的是 `class="v_news_content"` 那一层。
3. **教务处的 `content.jsp?urltype=news.NewsContentUrl&...` 拿不到正文。**
   这类动态页被学校接的电信云 WAF 拦截（浏览器里也是 405 / 「系统提示」），
   `notice show` 会直接返回 `BACKEND_UNAVAILABLE` 并说明原因。同一篇公告如果列表里给了 `info/` 地址，优先用那个。

另外，不少学术公告整篇就是一张海报图，提取不到文字是正常的：`notice show` 会返回
`[正文为图片，共 N 张]` 加上图片地址，而不是报解析失败。

## 图书馆

图书馆换了超星 LSP（新一代图书馆服务平台），馆藏在 `findhenu.libsp.cn`。
三个子命令里两个是纯 HTTP，只有「我的借阅」要浏览器（要复用 CAS 会话换超星票据）。

```bash
# 馆藏检索：题名/作者/任意词，返回馆藏册数、在架册数、索书号
henu-cli library search 药物化学 --field title --rows 5 --text

# 任意词（含主题词）检索，第 2 页
henu-cli library search 药剂学 --page 2 --text

# 我的借阅：证件状态、可借数、当前借阅（--history 追加借阅历史）
henu-cli library account --text
henu-cli library account --history --text

# 座位：各校区/楼层的空闲与总数
henu-cli library seat --text
henu-cli library seat --day 2026-10-27 --campus 金明 --text
```

真实输出（2026-10-26 实测）：

```text
馆藏检索「药物化学」（题名）命中 121 条，显示 5 条

 1. 药物化学
    尤启冬主编 / 化学工业出版社 / 2004.01
    馆藏 4 册，在架 4 册 · 索书号 R914/Y615 · ISBN 7-5025-4976-5

图书馆 · 我的借阅
*同学 / 2310200001 / 药学院 / 药学
证件正常 · 有效期至 2027-06-10 · 本科生

当前借阅 0 条（还能借 8 本）
  没有在借图书。

图书馆座位 · 2026-10-26（可预约日期 2026-10-26 / 2026-10-27）

金明校区  空闲 2337 / 总数 3312
  金明二楼  空闲 608 / 832
  明伦校区  空闲 682 / 总数 1160
```

### 图书馆的四个坑

1. **检索接口必须带 `groupcode` 头。** `POST /find/unify/search` 的请求体里没有馆别信息，
   少这个头（河大是 `200195`）时接口照样返回 `success: true`，但 `numFound` 恒为 0 —— 看起来像「没有这本书」。
2. **「我的借阅」不能直接访问。** 直接开 `findhenu.libsp.cn/find/sso/login/henu/0` 会报「参数缺失」，
   必须从 `lsp-s.chaoxing.com/login_auth/hndx/init?refer=...pageType=5` 进，让它自己带票据跳转。
3. **ELib 网关证书有空窗期。** `login.lib.henu.edu.cn` 换签时证书会对不上，校内用户点「继续访问」就过了；
   程序里对图书馆链路等效放行 `ignoreHTTPSErrors`（只作用于该命令的上下文）。
4. **借阅记录的字段名没有公开文档。** `normalizeLoan` 按常见命名多路兜底，取不到就置 `null`，
   不会拿一个“看着像”的字段硬填。当前账号无在借图书，所以这条只在有借阅时才能验证。

座位和空间预约的入口都在 `zwyy.henu.edu.cn`（超星），这是同一套书库账号体系；
`library seat` 只读校区/楼层空闲数，**不下单、不占座**。

## 河南大学系统对照

| 服务 | 入口 | 厂商 | 说明 |
|---|---|---|---|
| 统一身份认证 | `https://ids.henu.edu.cn/authserver/login` | 金智 CAS | 用户名密码只在这里输入 |
| 网上办事大厅 | `https://ehall.henu.edu.cn/ywtb-portal/...` | 金智 ywtb | 只有办事事项，**没有教务应用**（`/jwapp/sys/*` 全部 404） |
| 教务系统 | `https://xk.henu.edu.cn/` | 青果软件 KINGOSOFT | 课表、成绩、考试都在这里 |
| 教务登录页 | `https://xk.henu.edu.cn/cas/login.action` | 青果 + CAS | 点「统一认证登录」走单点 |
| 公文通（公告） | `news.henu.edu.cn/hdzx/tzgg/`、`jwc.henu.edu.cn/tzgg.htm` | 博达 VSB 站群 | 公开页面，无需登录 |
| 办公系统 OA | `https://oa.henu.edu.cn/` | 通达 OA | 教工公文流转，学生无权限，本工具不接 |
| 图书馆门户 | `https://lib.henu.edu.cn/` | 超星智慧门户 | 各系统的聚合导航页 |
| 馆藏 / 借阅 | `https://findhenu.libsp.cn/` | 超星 LSP | 检索、我的借阅、借阅历史 |
| 图书馆远程访问 | `https://login.lib.henu.edu.cn/` | ELib 授权访问 | OPAC 等老资源的网关，支持 CAS 单点 |
| 座位 / 空间预约 | `https://zwyy.henu.edu.cn/` | 超星座位预约 | 校区-楼层-座位空闲数 |

### 教务系统的三个坑

1. **不能深链功能页。** 直接 GET `student/xkjg.wdkb.jsp` 返回 405「无效访问请求」，必须从左侧菜单点进去（教学安排 → 个人课表）。
2. **会话跟当前页面绑定。** 单点登录成功后如果再跳一次首页，会话会丢。程序里通过“登录后不重新导航”规避。
3. **课表 iframe 会重新挂载。** 加载完成后帧句柄会 detached，取值必须每轮按 URL 重新取帧。

课表数据来自：`/wsxk/xkjg.ckdgxsxdkchj_data10319.jsp?params=<base64>`，
`params` 是 `xn=年份&xq=学期&xh=内部学号` 的 Base64。返回 HTML 表格，列含 `上课时间地点`：

```
1-9周 三[1-2] 金明综合楼5206(138)；1-9周 四[1-2] 计算机大楼101(150)
```

### 空教室查询的六个坑

1. **入口是首页卡片，不是左侧菜单。** 要依次点 `#SB`（公共查询）→ `#module270`（分周次/节次查看空闲教室）。
   这层菜单用绝对定位布局且默认 `visibility:hidden`，必须 `force: true` 点击，否则 Playwright 永远等不到可见。
2. **结果页是独立帧且是 GBK。** 提交目标是 `kbbp/dykb.fzcjcckkxjsi_data.jsp`，返回 HTML 声明 `charset=GBK`。
   用 `fetch().text()` 会按 UTF-8 解出乱码，必须 `arrayBuffer()` + `TextDecoder('gbk')`。
3. **只有 `hidDJ` 决定节次，而且它是小节号不是大节。** 页面代码里看着像节次字段的有三个：
   `selDJ`、`txtlsjc`、`txtXJXL`，实测**改了都不影响结果**；真正生效的是隐藏字段 `hidDJ`。
   代码注释里曾按「第几大节 1-4」理解，但实测传 `9`/`12`/`13` 都能返回对应的 `[9节]/[12节]/[13节]`，
   所以它是小节号（河大作息 13 节）。服务端接受 1-15，但 14/15 没有真实排课，对外按 1-13 收口。
4. **教室类型选项和直觉不符。** 表单虽列出「一般教室」，但河大实际排课几乎全归到「多媒体教室」和
   「师范生实训中心教室」，选「一般教室」会返回「没有检索到记录」，这是正常的，不是解析错误。
5. **留用教室会被算成“空闲教室”。** `5301/5302` 这类设置为留用（自习/专用）的教室，
   在 `module270` 的空闲教室表里是“空”的，实际进不去；手机端把它们标成「冲突」（蓝格）。
   默认请求带 `chkBHSZWLYDJS=on`（不含设置为留用的教室），`room grid` 则用 `lyjc=1`
   把留用节次直接标成占用。要复现旧行为加 `--include-reserved`。
6. **`--week` 缺省是“每一周都空”的交集，不是本周。** `txtZC=1-18` 在服务端是逐周求交，
   所以默认结果会明显少于某一周的真实空教室（例如第 9 周周三第 3 节，默认只给 5101/5201 两间，
   实际当周还有 5306 等）。查具体某天一定要显式 `--week`。


### 成绩查询的三个坑

1. **成绩不在左侧菜单树里，而在首页卡片 → tab 页。** 点 `#S403`（学业成绩）后菜单帧会换成
   `frame/jw/teacherstudentmenu.jsp?menucode=S403`，里面是两个 tab：`S40303` 学业成绩、`S40301` 专业培养方案达成度。
   tab 用 `onclick="switchMenu('1','S40303','学业成绩')"` 切换，和左侧菜单不是一套结构，得单独写导航。
2. **复选框默认就是勾选的。** 「主修」`#zxC` 默认 `checked`，直接 `click()` 会把它取消掉，
   结果就是「没有检索到记录」。必须判断 `checked` 再决定是否点击。
3. **汇总行的列序被合并单元格撑开。** 明细是 12 列，汇总行实际位置是
   `[1]=门数 [2]=学分 [3]=获得学分 [4]=获得绩点 [5]=获得学分绩点 [6]=平均成绩 [7]=加权平均成绩`，
   按明细的列序读会把「获得绩点」当成「加权平均」。

成绩结果提交到 `student/xscj.stuckcj_data10475.jsp`（学校号 `10475` 是硬编码在页面 JS 里的）。
一个页面会返回多张表（按学年学期切块、序号连续），要全部收集再一起解析，否则会漏课。

`S40301 专业培养方案达成度`（`student/wsxk.pyfadb.html`）看起来更适合直接问"还差多少学分"，
但河大这边打开就是「未设置学分要求」，所以本工具改成自己拿成绩单跟 `src/curriculum.js` 对账。

## 结构

```text
src/
  cli.js              入口
  main.js             命令路由与错误码映射
  config.js           所有校园入口 URL、菜单名、接口标记（改版优先改这里）
  curriculum.js       药学专业培养方案的毕业要求（正文口径，精确核对用）
  second-classroom.js 第二课堂专项学分标准（全校统一口径）
  modules/
    browser.js        浏览器探测与 profile 路径
    auth.js           登录 / 状态 / 退出
    auth-detector.js  页面状态判定（CAS / 教务 / 办事大厅）
    jw.js             教务会话：CAS 单点、菜单导航、tab 导航、公共查询入口
    page.js           页面读取、稳定等待
    course.js         课表业务：导航、判登录、取表、诊断
    course-parser.js  表头对齐、时间地点解析、按星期过滤、文本周视图
    course-ics.js     课表 → .ics：学期起始日期缓存、落盘
    ics.js            节次时刻表、按作息拆分日程、RFC 5545 折行
    room.js           空教室业务：按节次循环查询、合并结果、诊断
    room-parser.js    参数编码映射、结果页解析、人读输出
    grade.js          成绩业务：查询口径设置、取表、学分核对
    grade-parser.js   成绩明细与汇总行解析、按类别聚合
    plan.js           培养方案业务：任意专业查询、通用学分核对
    plan-parser.js    方案表格解析、平台归类、人读输出
    exam.js           「课程考试」入口枚举（河大无考试安排查询）
    notice.js         公文通业务：多栏目抓取、分页、正文
    notice-parser.js  博达列表/详情解析、正文容器按深度截取
    library.js        图书馆业务：馆藏检索、我的借阅、座位空闲
    library-parser.js LSP 字段收敛、借阅记录兜底映射、人读输出
    http.js           纯 HTTP 客户端（统一 UA、GBK/UTF-8 解码、错误码）
    doctor.js         自检
    install.js        全局安装
    skill.js          skill 分发
    output.js         JSON 信封
```

## 改版了怎么办

页面结构一变，解析就会失败并返回明确错误码。用诊断模式跑一次：

```bash
henu-cli course list --headed --dump
```

会写出 `~/.henu-cli/diagnostics-course.json`，里面有最终 URL、帧列表、表头和样例行。按它调整 `course-parser.js` 的 `HEADER_HINTS` 或 `TIME_PLACE_PATTERN`，通常不用动业务逻辑。

空教室同理（`room free` 走 `jw.room`，`room grid` 走 `jw.room.grid`，两个页面各自一套）：

```bash
henu-cli room free --period 1 --headed --dump
```

写出 `~/.henu-cli/diagnostics-room.json`，包含每个节次的响应长度、是否含结果表格、以及 HTML 前 800 字符。

成绩同理：

```bash
henu-cli grade audit --headed --dump
```

写出 `~/.henu-cli/diagnostics-grade.json`，包含查询口径、每张表的表头与样例行、以及结果页 HTML 前 4000 字符。

菜单名变了改 `config.js` 的 `jw.menu`；接口路径变了改 `jw.timetableMarker`；
空教室的应用码或接口路径变了改 `jw.room`（按节反查）或 `jw.room.grid`（按教室看格子）下的 `menuCode` / `moduleId` / `dataPath`；
成绩的 tab 码或查询口径变了改 `jw.grade`（`tile` / `menuCode` / `controls`）。
培养方案改版改 `src/curriculum.js`。

## 安全边界

- 不收集账号密码，不存储明文凭证
- 不绕过登录、验证码、校园网限制或访问控制
- 默认只读，不做高频抓取
- 状态变更类命令必须先支持 `--dry-run`
- 不提交 profile、cookie、截图、诊断文件到仓库

## 许可

MIT。本项目为个人作品，非河南大学官方工具。
