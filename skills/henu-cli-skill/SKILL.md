---
name: henu-cli-skill
description: 河南大学校园服务命令行工具的使用指南。当用户需要查询河南大学课表、课程安排、导出课表到日历（.ics）、空教室/自习教室、成绩与绩点、毕业学分缺口、培养方案（任意专业/年级）、第二课堂专项学分、校内通知公告（公文通：学校公告/学术公告/教务处，含标题检索）、图书馆馆藏检索与借阅、图书馆座位空闲，或需要登录河南大学统一身份认证（ids.henu.edu.cn）与教务系统（xk.henu.edu.cn）时使用。包含环境检查、登录态复用、错误码解释与安全边界。
---

# henu-cli 使用指南

`henu-cli` 把河南大学校园网页能力封装成稳定命令，输出结构化 JSON。
登录由用户在浏览器里完成，CLI 复用本地 profile，不保存账号密码。

## 何时使用

- 用户问"今天有什么课""这学期课表""哪几节课""这门课在哪个教室"
- 用户问某门课的任课教师、学分、周次
- 用户说"把课表导到手机日历""生成 ics""每天提醒我上课"（`course ics`）
- 用户问"哪里有空的教室""哪个自习室还能去""金明综合楼第 3 节有位置吗"
- 用户问"我成绩怎么样""这门课过了吗""绩点多少"
- 用户问"还差多少学分毕业""我修够了没有""还有哪些必修课没修"
- 用户问"XX 专业要修多少学分""别的专业怎么算"（用 `plan` 命令族，任意专业/年级）
- 用户问"第二课堂学分够不够""社会实践/讲座/竞赛能顶多少分"
- 用户问"考试安排在哪个考场"（河大教务系统**查不到**，见下）
- 用户问"学校有什么通知""教务处发通知了吗""最近有什么讲座"（`notice`）
- 用户问"图书馆有没有这本书""在哪个书库""能借吗"（`library search`）
- 用户问"我借了什么书""什么时候到期""还能借几本"（`library account`）
- 用户问"图书馆还有座吗""金明几楼有空位"（`library seat`）
- 登录态失效，需要重新登录

## 标准调用顺序

先确认命令本身可用：

```bash
henu-cli --version           # 输出 0.3.x 表示已安装
```

如果提示 `henu-cli: command not found` / 「不是内部或外部命令」，说明没全局安装。
这时**把安装命令交给用户自己在终端执行**，不要代为运行：

```bash
npx henu-cli@latest install
```

（它会全局装 CLI 并把本 skill 拷到 `~/.workbuddy/skills/`；装完要新开一个会话，
Agent 才能在技能列表里看到它。）

在装好之前，用项目里的入口脚本代替：

```bash
node <项目目录>/src/cli.js <同样的参数>
```

例如 `node "D:/buddy工作空间/2026-10-25-22-53-27/henu-cli/src/cli.js" course today`。
下文的 `henu-cli` 都可以这样等价替换。

```bash
henu-cli doctor              # 环境、浏览器、网络
henu-cli auth status         # 登录态是否有效
henu-cli course today        # 今天的课
henu-cli course next         # 下一节课：哪门、几点、在哪、还有多久（回答「我接下来上什么」优先用它）
henu-cli course list         # 本学期全部课表
henu-cli course list --weekday 3   # 只看周三（1=周一 … 7=周日）
henu-cli course next --refresh     # 跳过本地缓存，强制回教务系统重取
```

首次使用或 `auth status` 返回 `unauthenticated`：

```bash
henu-cli auth login          # 会打开浏览器，请用户自己完成登录，然后关闭窗口
henu-cli auth status         # 验证
```

**不要尝试代用户输入账号密码，也不要处理验证码。**

## 关键事实

- 课表、成绩、考试都在**教务系统** `xk.henu.edu.cn`（青果软件），**不在**办事大厅。
  办事大厅 `ehall.henu.edu.cn` 只有办事事项，`/jwapp/sys/*` 全部 404，不要去那里找教务数据。
- 教务系统支持 CAS 单点：CLI 会自动点击登录页上的「统一认证登录」。
  所以用户只要在统一身份认证登录过，课表命令通常能直接跑。
- 教务会话空闲会过期，但 CAS 会话还在，CLI 会自动重新单点，不需要用户再登一次。

## 本地缓存（回答"数据新不新"必看）

课表和成绩默认走本地缓存：课表保鲜 6 小时、成绩 12 小时，所以第二条命令通常 0.3 秒出结果。

- 命中缓存时，JSON 里多一个 `cache: { hit: true, stale: false, ageSeconds, savedAt, ttlSeconds }`，
  文本输出第一行会写「数据来自本地缓存（N 分钟前写入）」。
- 抓取失败但手上有旧缓存时，**不会报错**，而是返回旧数据 + `cache.stale = true` + `warning` 字段，
  文本首行是 `⚠ … 实时刷新失败`。向用户转述时**必须**说明数据可能不是最新。
- 用户问"是不是最新的/刚改的课怎么没变"→ 加 `--refresh` 重跑，不要说系统坏了。
- 用户问"缓存占多大/想清掉"→ `henu-cli cache status --text`、`henu-cli cache clear`。

## 输出约定

```json
{ "ok": true, "data": { "term": "2026-2027学年第一学期", "items": [], "total": 0 },
  "meta": { "cli": "henu-cli", "command": "course.list" } }
```

课表 item 结构：`courseCode`、`courseName`、`className`、`credits`、`teachers[]`、
`sessions[]`（每段含 `weekday`、`periods.start/end`、`weeks.start/end/parity`、`location`）。

`sessions` 可能有多段，代表同一门课不同时间地点。回答"什么时候上"要把 sessions 全部说出来。

## 课表导出到日历

用户说"导到手机日历""生成 ics""做个课程表提醒"时用这个：

```bash
henu-cli course ics --week-now 8 --text    # 第一次：说明今天是第几周
henu-cli course ics --text                 # 之后同一学期直接导
henu-cli course ics --start 2026-09-07 --out ~/Desktop/课表.ics --text
```

- **教务系统里没有「第 1 周是几号」这个信息**，所以必须由用户提供 `--start`（第 1 周周一）
  或 `--week-now`（今天第几周）。没有这两个又没有本地缓存时会返回 `INVALID_ARGUMENT`，
  这时直接问用户"现在是第几周"，不要去猜日期。
- 给过一次就按学期记在 `~/.henu-cli/calendar-terms.json`，后续自动复用（`startDateSource: "remembered"`）。
- 输出里的 `path` 是生成的 .ics 路径，`events` 是日程数。跨过 10 月 1 日的课会被拆成两段
  （夏令/冬令作息不同），所以 `events` 可能大于 `courses`，这是正常的。
- 上课时刻来自《河南大学教学时间设置列表》（校发〔2018〕300 号）：10/1–4/30 冬季作息，
  其余夏季作息（整体后推 30 分钟）。

## 空教室查询

两种问法，**"某间教室某节课空不空"用 `room grid`**，`room free` 只适合粗筛。

```bash
henu-cli room options                                  # 先看合法取值，别猜
henu-cli room grid --building 金明综合楼5 --week 9 --weekday 3 --text
henu-cli room grid --building 金明综合楼5 --week 9 --weekday 3 --period 3-4 --text
henu-cli room free --campus 金明 --week 9 --period 3-4 --text
henu-cli room free --building 计算机大楼 --week 9 --period 5
```

### room grid（推荐）

按小节给出「教室 × 节次」占用矩阵，`--period` 给定时直接列出该时段全空的教室。

- `--building` **必填**，`--week` 也**必填**（服务端按周取数，不给周次会返回 1-18 周的全部格子）
- `--weekday` 缺省今天，只支持单个星期；`--period` 支持 `3` / `3-4`
- `--campus` 缺省 `金明`；楼在别的校区时必须显式给，否则查不到教室
- 输出 `rooms[].grid` 是 13 位网格，`.` = 空闲、`X` = 占用（有课 / 预约 / 留用）
- 固定带 `rad_jc=1`（按小节）+ `lyjc=1`（留用算非空闲），所以留用教室不会被报成空

**回答"哪间教室空"之前先想清楚周期**：`--week` 猜错会拿到另一周的数据。当前是第几周
教务系统不直接给，需要用户确认（或从 `course ics` 的 `--week-now` 记录里取）。

### room free

- `--period` 是小节号 `1`-`13`（河大一天 13 小节；服务端接受 1-15，但 14/15 无真实排课）
- `--week` 缺省 `1-18`，含义是**每一周都空**的交集，不是本周；查具体某周务必显式给
- 默认排除「设置为留用」的教室（`5301/5302` 这类自习/专用教室），`--include-reserved` 可放开
- `--weekday` 缺省今天，也可 `周一` 或 `1-5`；`--campus` 取 `明伦` / `金明` / `郑州` / `其他`
- `--type` 取 `一般教室` / `多媒体` / `师范` / `不安排教室`；缺省 `--max 100` 会滤掉大教室

输出结构：`byPeriod[]` 是每个节次的教室数，`groups[]` 每项带 `period`、`campus`、`roomType`、`rooms[]`。
`total` 是「教室 × 节次」累计，同一间教室在多个节次都空会重复计数——回答"有多少间"时说清这一点，
或按 `rooms[].name` 去重后再给数字。

**别把"教务系统说空"直接当成"能进去自习"**：留用教室、临时借用、手机端标「冲突」的教室都可能进不去，
拿不准就用 `room grid` 看格子，或者干脆告诉用户"以现场门牌/门口通知为准"。

## 成绩与毕业学分

```bash
henu-cli grade plan                 # 内置培养方案要求，先看它有哪些平台和学分数
henu-cli grade list                 # 入学以来全部成绩（有效成绩 + 主修）
henu-cli grade audit                # 对照培养方案核对缺口
henu-cli grade audit --text         # 人读核对表，适合直接念给用户
henu-cli grade gpa                  # 平均学分绩点、加权平均分、按平台绩点（保研/评奖学金场景）
henu-cli grade gpa --refresh        # 刚出分、怀疑缓存旧了时用
```

`grade audit` 的关键字段：

- `earnedCredits` 已获学分，`remainingCredits` 距总学分的差额
- `remainingByBucket` 按平台逐项补齐需要的学分，通常 ≥ `remainingCredits`，
  差额是选修课超修部分（`surplus`）的抵扣 —— **两个数字都要说，只说一个会被用户当成矛盾**
- `buckets[].missing[]` 该平台还缺哪些课，`reason` 为 `not-taken`（未修）/ `not-passed`（未通过）/
  `no-grade-record`（成绩单里查不到，如第二课堂专项学分，需用户自己去「到梦空间」确认）

回答"够不够毕业"时必须区分三种状态：已达标（`status: done`）、部分完成（`partial`）、完全未动（`untouched`）。
`partial` 里既有"这学期正在修"也有"大四才修"的，要结合 `grade plan` 的课程计划学期判断是否正常。

## 培养方案（任意专业 / 任意年级）

```bash
henu-cli plan depts                                  # 院系代码
henu-cli plan majors --dept 0031                     # 该院系下的专业代码
henu-cli plan show --dept 0031 --major 0116 --year 2023 --text
henu-cli plan audit --elective-major 17 --elective-general 10 --text
```

- 不传 `--dept/--major/--year` 时，用当前登录账号自己的院系/专业/年级
- `plan audit` 的必修要求由方案池求和，是**估算**；精确核对用 `grade audit`
- 方案池里选修课是「可选全集」，最低学分必须由 `--elective-major` / `--elective-general` 给，
  没给时该平台 `requiredCredits: null`、`status: 'unknown'`——**不要把它当成 0 学分要求**
- 「已通过」列是当前登录账号的成绩，只是换个专业看方案时这一列没有参考意义
- `PLAN_NOT_FOUND` 表示该年级/专业在教务系统里没配方案，不是抓取失败

## 第二课堂专项学分

```bash
henu-cli second standard                     # 标准全文（8 个项目、学分档位、4 条说明）
henu-cli second check --items 社会实践,竞赛:4  # 达标核对
```

三条判定是分开的：总分 ≥ 5、含必修（社会实践活动）≥ 1、创新创业教育类 ≥ 1（4 个分类中任一）。
**不要只报总分**——只凑 5 分但没做社会实践仍然不达标。

## 考试安排

```bash
henu-cli exam tabs
```

河大教务系统「课程考试」只有缓考/补考申请与查看，**没有考试安排查询**（`ksap.*` 下 22 个候选页全 404）。
用户问考场/座位时：明确说系统里查不到，建议看教务处通知公告、学院或辅导员通知。
不要反复重试，也不要推测考场。

## 公文通（通知公告）

```bash
henu-cli notice list --text                       # 三个栏目混排，按日期倒序
henu-cli notice list --channel jwc --limit 20 --text   # 只看教务处
henu-cli notice search 考试 --days 30 --text      # 标题检索，最近 30 天
henu-cli notice search 讲座 --channel academic --pages 5 --text
henu-cli notice show --url "<list 里的 url>" --text     # 取正文
```

`--channel` 取值：`all`（默认）、`school`（学校公告）、`academic`（学术公告）、`jwc`（教务处通知）。

回答"最近有什么通知"时，按日期倒序列 5~10 条，带上栏目名和日期；
用户追问细节再 `notice show` 取正文，不要一次抓十篇。

**要找特定主题的通知，用 `notice search` 而不是把 `list` 翻到底**：检索是本地按标题过滤，
多个关键词用空格分隔表示「且」，`--days` / `--since` 限定时间窗口，`--pages` 控制翻几页（默认 3）。
返回里的 `scanned` 是扫描条数、`count` 是命中条数——命中 0 条时先加大 `--pages`，别急着说"没有"。

两个必须知道的事实：

- **教务处列表里 `content.jsp?urltype=news.NewsContentUrl&...` 的链接取不到正文**（被学校 WAF 拦成 405）。
  命令会返回 `BACKEND_UNAVAILABLE` 并说明原因。这时把链接直接给用户，让他在浏览器打开，不要说"没有这篇公告"。
- **整篇是海报图的公告**（很多学术公告）提取不到文字，`notice show` 会返回
  `[正文为图片，共 N 张]` 加图片地址。这也是正常结果。

河大没有独立「公文通」站点，`oa.henu.edu.cn` 是教职工用的通达 OA（学生无权限），不要往那里查。

## 图书馆

```bash
henu-cli library search 药物化学 --field title --rows 5 --text
henu-cli library account --text                # 我的借阅
henu-cli library account --history --text      # 加借阅历史
henu-cli library seat --text                   # 今天各校区/楼层空位
henu-cli library seat --day 2026-10-27 --text
henu-cli library seat --campus 金明 --text     # 只看一个校区
```

- `--field`：`keyword`（任意词，默认）、`title`（题名）、`author`（作者）。
  `keyword` 召回最多；用户说"书名是 XXX"时用 `title` 更准。
- 检索结果里有 `holdings`（馆藏册数）和 `available`（在架册数）。
  `available = 0` 表示全被借走或在别处，要明确说出来，不要让用户白跑。
- `library seat` 输出到楼层级（金明二楼/明伦三层…），**只读不下单**，不能替用户占座。
- `--campus` 支持「金明」「明伦」这类片段匹配；校区名写错会返回 `INVALID_ARGUMENT` 并列出可选校区。

`library account` 需要登录态（复用浏览器里的 CAS 会话）；`library search` / `seat` 是公开接口，很快。

## 错误码处理

| code | 含义 | 你该做什么 |
|---|---|---|
| `AUTH_REQUIRED` | 未登录且自动单点失败 | 让用户 `henu-cli auth login`，不要自己反复重试 |
| `INVALID_ARGUMENT` | 校区/节次/参数取值非法 | 先跑 `room options` 看合法取值，改参数重试 |
| `BROWSER_UNAVAILABLE` | 没有可用浏览器 | 提示装 Chrome/Edge，或 `browser install chromium --yes` |
| `BACKEND_UNAVAILABLE` | Playwright 未安装，或站点/接口不可用（含 WAF 拦截） | 先看 `error.hint`：缺依赖就 `npm install`；被 WAF 拦就把链接交给用户 |
| `PAGE_UNRECOGNIZED` | 菜单或表格结构变了 | 用 `--headed --dump` 跑一次，把 `~/.henu-cli/diagnostics-<命令>.json` 交给维护者 |
| `PLAN_NOT_FOUND` | 该年级/专业在教务系统里没有培养方案 | 用 `plan majors --dept <代码>` 核对专业代码，或换年级；不要反复重试 |
| 网络类失败 | 校外访问受限 | 提示连校园网或学校 VPN；不要尝试绕过 |

退出码：0 成功，2 用法错误，3 未登录，4 环境问题，5 页面未识别，6 培养方案不存在。

## 安全边界

- 不保存、不询问、不传输账号密码。
- 不绕过登录、验证码、校园网限制或访问频率限制。
- 默认只读。任何会改变状态的操作必须支持 `--dry-run`，真实执行需显式 `--confirm`。
- 不做高频轮询或批量抓取。
- 不把 profile、cookie、诊断文件提交到任何仓库。

## 当前实现状态

已实现：`doctor`、`auth login|status|logout`、`browser status|use|install`、
`course list|today|next|ics|status`、`room grid|free|options`、`grade list|gpa|audit|plan`、
`plan depts|majors|show|audit`、`second standard|check`、`exam tabs`、
`notice list|search|show`、`library search|account|seat`、`install`、`skill path|install`。

课表、空教室、成绩、学分核对、培养方案（含跨专业）、公文通、图书馆均已在真实数据下校准通过
（2026-2027-1 学期，2023 级药学；跨专业实测药学 95 门 / 239.5 学分、金融学 71 门 / 178 学分；
馆藏检索「药物化学」题名命中 121 条；座位 2026-10-26 金明校区空闲 2337 / 3312；
课表导出 4 个日程 / 2 个上课时段，跨 10 月 1 日自动拆成夏令+冬令两段）。

尚未实现的部分，原因不同，别混：

- **考试安排**：河大教务系统学生端没有入口（已穷举确认），不是没做
- **图书馆续借/预约座位**：接口已摸清但属于写操作，当前只做只读；需要时按"默认只读 + 显式确认"补
- **宿舍电费 / 体育场馆**：河大走「完美校园」「今日校园」App，没有网页端，不做
- **知网 / 万方**：需要机构订阅与校内 IP，属于授权范围问题，不在这个工具里做

新增功能时遵循同样结构：在 `src/config.js` 登记菜单名与接口标记，
在 `src/modules/<name>.js` 中用导航函数进入页面（**不要深链**，会 405），
解析层单独放 `<name>-parser.js` 并补单元测试。

三种导航入口各管一类，别用错：

| 页面形态 | 用什么 | 例 |
|---|---|---|
| 左侧菜单树（分组 → 子项） | `openJwMenuApp` | 课表：教学安排 → 个人课表 |
| 首页 tile → 卡片菜单 | `openJwPublicQuery` | 空教室：`#SB` → `#module270`（按节反查）/ `#SB` → `#module280`（按教室看格子） |
| 首页 tile → tab 页 | `openJwTabApp` | 成绩：`#S403` → `S40303`；培养方案：`#S403` → `S40301` |
| 只想看某个 tile 下有哪些入口 | `listJwTileTabs` | 考试：`#S204` |

药学专业的毕业要求（正文口径）写在 `src/curriculum.js`；
第二课堂标准写在 `src/second-classroom.js`（全校统一，不随专业变）。
任意专业的方案课程清单不需要落库——直接走 `plan show` 实时取。
