# dsh-usage-trends

> DeepSeek Harness(DSH)Web 客户端插件:用量趋势视图。
> 在会话的「聊天 / 轨迹」旁新增「趋势」标签页,把持久化会话日志里的逐请求用量数据画成 SVG 图表:**每请求 Token 流量堆叠柱**、**累计输入/输出曲线**、**每请求耗时柱**,外加会话聚合统计卡片。

![DSH](https://img.shields.io/badge/DSH-0.1.0--rc.6-blue) ![version](https://img.shields.io/badge/version-1.1.0-green) ![license](https://img.shields.io/badge/license-MIT-lightgrey) ![platform](https://img.shields.io/badge/platform-web%20client-orange)

---

## 与官方功能的关系

DSH 官方客户端的**轨迹视图**以表格形式给出逐请求的 Token 明细(本请求 + 会话累计),
但没有图形视图。本插件把同一批持久化数据画成图:

| 视角 | 官方轨迹 | 本插件「趋势」 |
| --- | --- | --- |
| 逐请求 Token | 表格数字 | 堆叠柱状图(缓存读/未缓存输入/缓存写/输出) |
| 会话累计 | 明细行 | 累计曲线 + 聚合卡片 |
| 请求耗时 | 时间戳 | 墙钟耗时柱状图 |

两个标签页互补:看单个请求的细节去「轨迹」,看整体走势和分布来「趋势」。

## 特性

- **第一公民视图标签**:注册在官方 `conversation.view` 槽位,与「聊天」「轨迹」并列,无任何官方界面被替换
- **每请求 Token 流量**:堆叠柱把计费输入拆成缓存读 / 未缓存输入 / 缓存写三段,顶部叠加输出;悬停任意柱显示该次请求的完整明细
- **固定列宽 + 横向滚动**:柱状图每根柱固定 8px 宽、10px 槽位,问答轮次再多也不会挤成细线;请求较多时图表横向滚动,悬浮命中与逐请求精度始终不变
- **累计曲线**:计费输入(带面积填充)与输出随请求推进的累计走势
- **耗时分布**:每请求墙钟耗时柱,悬停显示起止时间
- **聚合统计卡片**:请求数、用户轮次、计费输入/输出合计、缓存命中率、单请求峰值、总耗时、平均耗时
- **持久化数据源**:经标准连接层 `connection.api.sessions.history` 读取会话日志,重启 DSH 后无需新对话即可恢复
- **主题自适应**:全部颜色使用 `--dsw-alias-*` / `--dsw-static-*` 主题 token,自动跟随明暗主题
- **零后端逻辑**:Host 半身是空插件,无网络请求之外的副作用、无轮询(仅打开标签页时取数,回合结束自动刷新一次,可手动刷新)

## 界面

```
┌──────────────────────────────────────────────────────────┐
│  用量趋势              数据来自持久化会话日志 · 更新于 17:32:05   [刷新] │
│                                                            │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐          │
│  │ 请求数   │ │ 用户轮次 │ │ 计费输入 │ │  输出   │ …        │
│  │   42    │ │   7     │ │ 1.2M   │ │  85.4k │          │
│  └─────────┘ └─────────┘ └─────────┘ └─────────┘          │
│                                                            │
│  每请求 Token 流量         ■未缓存输入 ■缓存读 ■缓存写 ■输出   │
│  ▁▃▅▇▅▂▁▃▅█▅▃▁▂▅▇█▇▅▂▁ …                                   │
│  第 12 / 42 次请求 · T3·S1 · 17:28:11 · 计费输入 32.4k …    │
│                                                            │
│  累计 Token 曲线               ■计费输入 ■输出               │
│  ╭────────────────────────────╮                            │
│  │                      ___---´´                            │
│  │            __-------´                                    │
│  │     ,----´´                                              │
│  ╰────────────────────────────╯                            │
│                                                            │
│  每请求耗时(墙钟)               ■请求耗时                    │
│  ▂▃▁▅▂▁▃▂▄▂▁▃▅▂▁▂▃▂▁▄▂▁▂ …                               │
└──────────────────────────────────────────────────────────┘
```

## 目录结构

```
dsh-usage-trends/
├── package.json          # 插件包清单:dsh.client(web 平台)、dsh.bundle.patch、exports
├── cordis.patch.yml      # bundle patch:向 profile 组装插入一行插件引用
├── lib/
│   ├── index.js          # Host 半身(空插件,仅维持 loader 条目有效)
│   └── client.js         # 浏览器端 bundle(预构建,接收方无需编译)
├── install.sh            # 接收方一键安装脚本(patch 层合并方式)
├── LICENSE
└── README.md
```

## 安装

### 前提

- DeepSeek Harness(`dsh`)0.1.x —— 在 **0.1.0-rc.6** 上开发并测试
- 使用 **web profile**(默认 `dsh web` 启动方式)

### 方式一:克隆仓库 + 一键脚本(推荐)

```bash
git clone https://github.com/Scholaar/dsh-usage-trends.git
cd dsh-usage-trends
./install.sh                 # 等价于 ./install.sh --profile web --home ~/.dsh
```

脚本只做两件事(幂等,可重复执行):

1. 把插件包复制到 `$DSH_HOME/profiles/web/node_modules/@local/usage-trends/`
2. 把 `cordis.patch.yml` 里的 `insert` 条目合并进 `$DSH_HOME/profiles/web/cordis.patch.yml`(若已存在则跳过)

装完**重启 DSH 服务器**,刷新页面即可生效。

### 方式二:pnpm 安装 + patch 合并

```bash
dsh plugin --profile web add github:Scholaar/dsh-usage-trends
# 然后把本仓库 cordis.patch.yml 的 insert 段合并进 profile 的 cordis.patch.yml:
#   $DSH_HOME/profiles/web/cordis.patch.yml
# 重启 DSH 服务器
```

> 为什么 pnpm 安装后还要合并 patch?DSH 的组合树是「分层 patch」模型:bundle 层只包含
> `dsh.profile.bundles` 里列出的包,而 `cordis.patch.yml` 是用户自己的补丁层。
> pnpm 只负责把包放进 `node_modules`,把插件行挂进组合树需要 patch 层的 `insert`。

### 验证安装

```bash
dsh web --dump-config | grep -A2 "usage-trends"
# 应能看到 id: usage-trends 的条目及其来源层
```

## 卸载

```bash
rm -rf $DSH_HOME/profiles/web/node_modules/@local/usage-trends
# 从 $DSH_HOME/profiles/web/cordis.patch.yml 删除 usage-trends 那段 insert
# 重启 DSH 服务器
```

## 工作原理

### 注册的槽位

| 槽位 | 内容 | 作用 |
| --- | --- | --- |
| `conversation.view` | 「趋势」视图标签 | 与官方「聊天」「轨迹」并列的会话视图,官方槽位协议为 list + `only: <active id>`,新增 id 即新增标签页,不替换任何现有视图 |

### 数据来源

数据来自标准连接层 `connection.api.sessions.history`(与官方轨迹视图同一数据源):

- 分页拉取全部会话事件(每页 100 条,上限 200 页),按 `seq` 升序去重后折叠
- `assistant/chunk` 的 `usage` 分片逐请求累加;`assistant/message` 的最终 `usage` 为权威值
- 每个数据点包含:轮次/步号、起止时间(事件 `time`)、输入/输出/缓存读/缓存写 token

取数只在「趋势」标签页激活时发生;打开标签页、切换会话、回合结束(运行 → 空闲)时各触发
一次刷新,另有手动「刷新」按钮。20 秒内的取数结果有模块级缓存,避免来回切标签页重复拉取。

### 图表实现

全部为手写 SVG(无第三方图表库):固定 viewBox + `preserveAspectRatio="none"` 适配容器宽度,
文字说明放在 HTML 层,悬停明细用 SVG `<title>` + 图表下方详情行双通道展示。

## 兼容性与已知限制

- 在 **DSH 0.1.0-rc.6** 上开发并测试
- 依赖内置槽位 `conversation.view`、标准连接层 `connection` 与主题 token。DSH 版本差异可能
  导致标签页不出现;插件做了防御式处理,失败只会报 console 错误,**不影响页面其余功能**
- 图表只统计上报过用量的请求;某些 provider 不上报 usage 时,对应柱为空、统计按 0 计
- 墙钟耗时 = 日志事件时间戳之差(与官方轨迹的 "Session timestamps" 口径一致),不等于纯模型耗时
- 纯 web 客户端插件,对 headless / tui profile 无效

## 常见问题

**Q:装完重启了,头部没有「趋势」标签页?**
A:确认插件包确实在 `$DSH_HOME/profiles/web/node_modules/@local/usage-trends/`,且
`cordis.patch.yml` 里有 `usage-trends` 的 insert 段;再用 `dsh web --dump-config` 检查
组合结果。标签页挂载在官方 `conversation.view` 槽位,DSH 版本不同可能槽位名称有变。

**Q:图表是空的?**
A:本会话还没有已完成并上报用量的模型请求。发一条消息跑完一个回合后点「刷新」。

**Q:为什么「趋势」和「轨迹」的数字看起来是同一批?**
A:两者读的是同一份持久化会话日志,口径一致;轨迹是逐请求明细表格,趋势是图形化走势,
用途不同,可以放心交叉对照。

**Q:可以调整图表高度吗?**
A:可以。改 `lib/client.js` 顶部 `CSS` 字符串里 `.utx-chart-svg` 的 `height` 即可,
替换包目录后重启 DSH。柱状图的列宽在组件内 `SLOT`/`BAR_W` 常量处调整。

**Q:想在 headless/tui 下用?**
A:不支持。图表是浏览器 UI,只对 web profile 有意义。

## 开发指南

### 修改与本地生效

`lib/client.js` 是预构建的**自注册 bundle**(遵循 `window.__ModuleLoader__.load` 格式),
没有编译步骤,直接编辑即可:

1. 修改 `lib/client.js`(CSS 在文件顶部 `CSS` 字符串,界面结构在 `apply()` 内)
2. 替换 `$DSH_HOME/profiles/web/node_modules/@local/usage-trends/lib/client.js`
3. 重启 DSH 服务器,刷新页面

### 发布新版本

1. 修改 `package.json` 的 `version`,同步更新本 README 的版本徽章
2. `npm pack`(或直接在 GitHub 打 Release,附上自动生成的 tarball)
3. 更新版本历史章节

## 版本历史

- **1.1.0**(2026-08):柱状图改为固定列宽(8px/根)+ 横向滚动,大量请求下不再
  挤成细线,悬浮查看恢复舒适;Token 柱与耗时柱共用同一列宽规格。
- **1.0.1**(2026-08):修复视图崩溃——图表组件改为经 `createElement` 渲染,消除
  「Rendered more hooks than during the previous render」导致的标签页空白。
- **1.0.0**(2026-08):开源发布版本。会话「趋势」视图标签页:每请求 Token 堆叠柱、
  累计输入/输出曲线、墙钟耗时柱、聚合统计卡片;持久化会话日志数据源。

## 安全提示

该插件会以脚本形式挂载到浏览器页面(客户端半身),并以空插件挂载到 DSH 的 Node
进程(Host 半身)。客户端代码对所在会话有完整读取能力(它本来就需要读会话历史来画图)。
**请只从可信来源安装**;`lib/client.js` 是明文 JavaScript,安装前可以直接审查全部代码。

## 许可

[MIT](./LICENSE) © 2026 Scholaar
