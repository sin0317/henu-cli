// 河南大学校园网站的入口常量。改版时优先只改这里。
export const HENU = {
  schoolCode: '10475',
  name: '河南大学',

  // 统一身份认证（金智 CAS）
  casUrl: 'https://ids.henu.edu.cn/authserver/login',
  casHost: 'ids.henu.edu.cn',
  casPersonalCenter: 'https://ids.henu.edu.cn/personalInfo/personCenter/index.html',

  // 网上办事大厅（金智 ywtb-portal）：只承载办事事项，不含教务应用
  ehallHome: 'https://ehall.henu.edu.cn/ywtb-portal/standard/index.html',
  ehallHost: 'ehall.henu.edu.cn',

  // 教务系统（青果软件 KINGOSOFT 教学综合管理服务平台）
  jw: {
    base: 'https://xk.henu.edu.cn/',
    loginPath: 'https://xk.henu.edu.cn/cas/login.action',
    // 教务登录页上的“统一认证登录”按钮，点击后走 CAS 单点
    ssoSelector: '#pub-dl',
    homeMarker: 'frame/homes',
    // 功能页不允许深链（直接 GET 返回 405），必须从左侧菜单点进去
    menu: {
      group: '教学安排',
      timetable: '个人课表'
    },
    timetableMarker: 'xkjg.ckdgxsxdkchj_data',

    // 公共查询 → 分周次/节次查看空闲教室
    // 入口是首页 tile(#SB)，点开后菜单帧导航到 frame/menus/SVGSB.jsp，
    // 再点 #module270 才会在内容帧加载查询表单。
    room: {
      menuCode: 'SB',
      moduleId: 'module270',
      formMarker: 'dykb.fzcjcckkxjsi.html',
      dataPath: 'dykb.fzcjcckkxjsi_data.jsp',
      menuCodeCurrent: 'SB11',

      // 公共查询 → 分教室查看空闲周次/节次（module280）。
      // 这是唯一能按「小节」拿到某间教室某小节到底空不空的页面：
      // 结果是一张 教室 × 节次 × 星期 的占用矩阵，红底=非空闲。
      // 注意表单必须显式带 rad_jc=1（按小节）和 lyjc=1（留用计为非空闲），
      // 否则默认按大节、且把留用教室算成空闲，5301/5302 就是这么被误报的。
      grid: {
        moduleId: 'module280',
        formMarker: 'dykb.fjsickkxzcjc.html',
        dataPath: 'dykb.fjsickkxzcjc_data.jsp',
        menuCodeCurrent: 'SB12'
      }
    },

    // 学业成绩 → 学业成绩（tab 页，不是左侧菜单树）
    // 首页 tile #S403 点开后菜单帧变成 teacherstudentmenu.jsp?menucode=S403，
    // 里面是两个 tab：S40303 学业成绩、S40301 专业培养方案达成度。
    // 点 tab 后内容帧加载 xscj.stuckcj.jsp，再点「检索」把结果提交到
    // frmReport 内嵌帧（xscj.stuckcj_data10475.jsp，学校号后缀）。
    grade: {
      tile: 'S403',
      menuCode: 'S40303',
      formMarker: 'xscj.stuckcj.jsp',
      dataMarker: 'stuckcj_data',
      queryButton: '#btnQry',
      // 查询口径：入学以来 + 有效成绩 + 主修
      controls: { timeAll: 'sjxz1', effective: 'yxcj', mainMajor: 'zxC' }
    },

    // 学业成绩 → 专业培养方案达成度（同一 tile 的另一个 tab）
    // 页面 /student/wsxk.pyfadb.html 可以选择任意 年级/院系/专业，
    // 提交到 /taglib/DataTable.jsp?tableId=xxxx（tableId 每次会话不同，从 form action 现读），
    // 返回该专业完整方案课程清单，并叠加当前学生的成绩与通过状态。
    plan: {
      tile: 'S403',
      menuCode: 'S40301',
      formMarker: 'pyfadb'
    },

    // 课程考试：只有缓考/补考申请与查看，没有考试安排查询（已实测确认）
    exam: {
      tile: 'S204',
      tabs: {
        makeupApply: 'S20401',
        postponeApply: 'S20402',
        postponeView: 'S20408'
      }
    }
  },

  // 公文通：河大没有独立的「公文通」域名（gwt./gw. 都不解析），
  // 师生实际看的是三个博达 VSB 站群栏目，全部公开可读、无需登录：
  //   学校公告 news.henu.edu.cn/hdzx/tzgg/xxgg.htm
  //   学术公告 news.henu.edu.cn/hdzx/tzgg/xsgg.htm
  //   教务处 jwc.henu.edu.cn/tzgg.htm
  // 列表每页 7 条，分页编号是倒的：首页是 xxgg.htm（最新），xxgg/754.htm 才是最老一页，
  // 「第 k 页」的物理页码 = 总页数 - k + 1（总页数从尾页链接读）。
  // 详情页统一是 <h1> + #vsb_content。
  notice: {
    sources: {
      school: {
        label: '学校公告',
        listUrl: 'http://news.henu.edu.cn/hdzx/tzgg/xxgg.htm',
        pagePattern: 'xxgg/{page}.htm'
      },
      academic: {
        label: '学术公告',
        listUrl: 'http://news.henu.edu.cn/hdzx/tzgg/xsgg.htm',
        pagePattern: 'xsgg/{page}.htm'
      },
      jwc: {
        label: '教务处通知',
        listUrl: 'https://jwc.henu.edu.cn/tzgg.htm',
        pagePattern: 'tzgg/{page}.htm'
      }
    }
  },

  // 图书馆：新系统是超星 LSP（新一代图书馆服务平台），馆藏在 findhenu.libsp.cn。
  // 检索/座位接口无需登录；「我的借阅」要先经超星单点：
  //   lsp-s.chaoxing.com/login_auth/hndx/init?refer=...openType=pageType=5
  // 这条链路依赖浏览器里的 CAS 会话，所以在 CLI 里走 Playwright。
  library: {
    opac: 'https://findhenu.libsp.cn',
    groupCode: '200195',
    // 检索接口要带 groupcode 头，否则 numFound 恒为 0（踩过）
    searchApi: '/find/unify/search',
    loanApi: '/find/loanInfo/loanList',
    loanHistoryApi: '/find/loanInfo/loanHistoryList',
    userInfoApi: '/find/userInfo/getUserInfo',
    // 我的借阅的落地页；直接访问会报「参数缺失」，必须从下面的 init 地址进
    myLibraryUrl: 'https://findhenu.libsp.cn/#/personalExternal/5',
    ssoInitUrl: 'http://lsp-s.chaoxing.com/login_auth/hndx/init?isLogout=0'
      + '&refer=https%3A%2F%2Ffindhenu.libsp.cn%2Ffind%2Fsso%2Flogin%2Fhenu%2F0%3FpageType%3D5',
    seat: {
      base: 'https://zwyy.henu.edu.cn',
      home: 'https://zwyy.henu.edu.cn/h5/index.html#/mo/home',
      campusApi: '/v4/space/pcTopFor'
    }
  }
};

// 登录态探针：教务首页未登录会跳回教务登录页。
export const AUTH_CHECK_URL = HENU.jw.base;
export const CAS_CHECK_URL = HENU.casPersonalCenter;
