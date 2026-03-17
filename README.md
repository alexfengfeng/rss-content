# News to WeChat

一个自动化新闻抓取、AI 改写并发布到微信公众号的工具。

参考自 [AutoContents](https://github.com/comeonzhj/AutoContents) 项目，专注于新闻抓取 + AI 改写 + 公众号发布的完整工作流。

## 功能特性

- 📰 **RSS 新闻抓取** - 支持 RSSHub 和标准 RSS 源
- 🤖 **AI 智能改写** - 使用大模型改写新闻内容
- 📱 **公众号自动发布** - 一键发布到微信公众号草稿箱
- ⏰ **定时任务** - 支持自动抓取和定时发布
- 🗃️ **本地数据库** - SQLite 存储，无需额外配置
- 🔍 **关键词过滤** - 支持正向/黑名单关键词筛选

## 快速开始

### 1. 安装依赖

```bash
npm install
```

### 2. 配置环境变量

```bash
cp .env.example .env
# 编辑 .env 文件，填入你的 API Keys
```

**必需配置：**

| 变量 | 说明 | 获取方式 |
|------|------|----------|
| `LLM_API_KEY` | 大模型 API Key | DeepSeek/通义千问等 |
| `LLM_MODEL` | 模型名称 | 如 `deepseek-chat` |
| `LLM_BASE_URL` | API 地址 | 如 `https://api.deepseek.com` |
| `WECHAT_APPID` | 公众号 APPID | 微信公众平台 -> 开发 -> 基本配置 |
| `WECHAT_APPSECRET` | 公众号密钥 | 微信公众平台 -> 开发 -> 基本配置 |

**可选配置：**
- `RSSHUB_URL` - RSSHub 地址（默认 `http://localhost:1200`）

📖 **详细配置指南：** 查看 [docs/WECHAT_OFFICIAL_SETUP.md](docs/WECHAT_OFFICIAL_SETUP.md)

### 3. 初始化新闻源

```bash
npm run init
```

这会从 `config/sources.json` 加载新闻源配置到数据库。

### 4. 启动服务

**方式 A：启动 Web 管理界面（推荐）**
```bash
npm run web
```
访问 http://localhost:3000 打开管理界面。

**方式 B：启动后台服务（带定时任务 + Web）**
```bash
npm start
```
启动后会：
1. 启动 Web 管理界面 http://localhost:3000
2. 立即抓取一次新闻
3. 自动改写新闻
4. 按设定时间定时执行（默认每2小时抓取，每天9点发布）

## 使用方式

### 方式一：全自动模式（推荐）

```bash
npm start
```

启动后程序会在后台运行，按设定时间自动：
- 抓取新闻
- AI 改写
- 发布到公众号草稿箱

### 方式二：手动分步执行

#### 抓取新闻
```bash
npm run fetch
```

#### AI 改写
```bash
npm run rewrite
```

#### 发布到公众号
```bash
npm run publish
```

### 方式三：交互式开发模式

```bash
npm run dev
```

提供菜单式交互，可以：
- 查看待改写/已改写新闻
- 单条或批量改写
- 单条或批量发布
- 查看公众号账号

### 方式四：Web 管理界面（推荐）

启动 Web 管理界面，通过浏览器全面管理：

```bash
# 方式 1：仅启动 Web 界面
npm run web

# 方式 2：启动后台服务（带定时任务 + Web 界面）
npm start
```

访问 `http://localhost:3000` 打开管理界面。

**功能特性：**
- 📊 **仪表盘** - 实时统计、快捷操作、最新动态
- 📰 **新闻管理** - 查看、筛选、批量改写和发布
- 📡 **信源管理** - 添加、编辑、删除 RSS 源
- ⚙️ **系统配置** - 查看当前配置状态

**界面预览：**
```
┌─────────────────────────────────────────────────────────┐
│  [侧边栏]          News to WeChat                        │
│  - 仪表盘                                               │
│  - 新闻管理   ┌──────────────────────────────────────┐  │
│  - 信源管理   │  统计卡片: 总新闻 | 待改写 | 已改写   │  │
│  - 系统配置   ├──────────────────────────────────────┤  │
│               │  最新抓取列表        已改写待发布     │  │
│               │  ┌─────────────┐    ┌─────────────┐   │  │
│               │  │ 新闻 1      │    │ 新闻 A      │   │  │
│               │  │ 新闻 2      │    │ 新闻 B      │   │  │
│               │  └─────────────┘    └─────────────┘   │  │
│               └──────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
```

### 方式五：命令行查看（备用）

```bash
# 快速概览
npm run view

# 查看统计信息
npm run view stats

# 查看待改写新闻
npm run view pending 20

# 查看单条新闻详情
npm run view detail 35

# 查看信源列表
npm run view sources
```

## 配置新闻源

编辑 `config/sources.json`：

```json
[
  {
    "name": "36氪快讯",
    "type": "rsshub",
    "route": "/36kr/newsflashes",
    "enabled": true,
    "keywords": ["AI", "人工智能", "科技"],
    "blacklist": ["广告", "推广"]
  },
  {
    "name": "虎嗅",
    "type": "rss",
    "route": "https://www.huxiu.com/rss",
    "enabled": true
  }
]
```

字段说明：
- `name` - 新闻源名称
- `type` - 类型: `rsshub` 或 `rss`
- `route` - RSSHub 路由或 RSS 地址
- `enabled` - 是否启用
- `keywords` - 正向关键词（只抓取包含这些关键词的新闻，空数组表示全部抓取）
- `blacklist` - 黑名单关键词（包含这些关键词的新闻会被过滤）

修改后需要重新初始化：
```bash
npm run init
```

## 常用 RSS 源推荐

```json
[
  {
    "name": "36氪快讯",
    "type": "rsshub",
    "route": "/36kr/newsflashes"
  },
  {
    "name": "虎嗅",
    "type": "rss",
    "route": "https://www.huxiu.com/rss"
  },
  {
    "name": "Solidot",
    "type": "rsshub",
    "route": "/solidot/www"
  },
  {
    "name": "TechCrunch中文",
    "type": "rsshub",
    "route": "/techcrunch/news"
  },
  {
    "name": "HackerNews",
    "type": "rsshub",
    "route": "/hackernews"
  },
  {
    "name": "机器之心",
    "type": "rsshub",
    "route": "/jiqizhixin"
  },
  {
    "name": "量子位",
    "type": "rsshub",
    "route": "/量子位"
  }
]
```

## 环境变量详解

| 变量 | 说明 | 必填 | 默认值 |
|------|------|------|--------|
| `LLM_API_KEY` | 大模型 API Key | 是 | - |
| `LLM_MODEL` | 模型名称 | 是 | `deepseek-chat` |
| `LLM_BASE_URL` | API 基础 URL | 是 | `https://api.deepseek.com` |
| `WECHAT_API_KEY` | 微信公众号 API Key | 是 | - |
| `WECHAT_APPID` | 公众号 APPID | 否 | - |
| `RSSHUB_URL` | RSSHub 地址 | 否 | `http://localhost:1200` |
| `WEB_PORT` | Web 管理界面端口 | 否 | `3000` |
| `FETCH_LIMIT` | 每次抓取数量 | 否 | `20` |
| `REWRITE_BATCH_SIZE` | 每次改写数量 | 否 | `5` |
| `PUBLISH_BATCH_SIZE` | 每次发布数量 | 否 | `3` |
| `FETCH_CRON` | 抓取定时 (Cron) | 否 | `0 */2 * * *` |
| `PUBLISH_CRON` | 发布定时 (Cron) | 否 | `0 9 * * *` |
| `LOG_LEVEL` | 日志级别 | 否 | `info` |

## 项目结构

```
news-to-wechat/
├── src/
│   ├── index.js                 # 主入口 (定时任务 + Web)
│   ├── db/
│   │   └── database.js          # SQLite 数据库操作
│   ├── services/
│   │   ├── rssService.js        # RSS 抓取服务
│   │   ├── llmService.js        # AI 改写服务
│   │   └── wechatService.js     # 公众号发布服务
│   ├── scripts/
│   │   ├── fetchNews.js         # 抓取脚本
│   │   ├── rewriteNews.js       # 改写脚本
│   │   ├── publishToWechat.js   # 发布脚本
│   │   ├── initSources.js       # 初始化新闻源
│   │   ├── viewNews.js          # 查看新闻脚本
│   │   └── devMode.js           # 交互式开发模式
│   ├── web/                     # Web 管理界面
│   │   ├── server.js            # Express 服务器
│   │   ├── index.js             # Web 启动入口
│   │   ├── views/               # EJS 模板
│   │   │   ├── layout.ejs       # 布局模板
│   │   │   ├── dashboard.ejs    # 仪表盘
│   │   │   ├── news.ejs         # 新闻列表
│   │   │   ├── news-detail.ejs  # 新闻详情
│   │   │   ├── sources.ejs      # 信源管理
│   │   │   ├── source-form.ejs  # 信源表单
│   │   │   ├── settings.ejs     # 系统配置
│   │   │   └── error.ejs        # 错误页面
│   │   └── public/              # 静态资源
│   └── utils/
│       └── logger.js            # 日志工具
├── config/
│   └── sources.json             # 新闻源配置
├── data/                        # 数据库目录
├── .env                         # 环境变量
├── .env.example                 # 环境变量模板
├── .gitignore
├── package.json
└── README.md
```

## 工作流程

```
┌─────────────┐    ┌─────────────┐    ┌─────────────┐    ┌─────────────┐
│  RSS 源     │───>│  抓取新闻   │───>│  AI 改写    │───>│  公众号发布 │
│             │    │             │    │             │    │             │
│ - 36氪      │    │ - 去重      │    │ - 重写标题  │    │ - 草稿箱    │
│ - 虎嗅      │    │ - 关键词过滤│    │ - 改写正文  │    │ - 手动发布  │
│ - RSSHub    │    │ - 存数据库  │    │ - 风格优化  │    │             │
└─────────────┘    └─────────────┘    └─────────────┘    └─────────────┘
```

## 微信公众号配置（官方 API）

### ⚠️ 重要：公众号类型限制

本项目使用微信官方 **草稿箱接口** (`/cgi-bin/draft/add`)，该接口有以下限制：

| 公众号类型 | 草稿箱接口支持 | 说明 |
|-----------|--------------|------|
| ✅ 认证服务号 | 支持 | 推荐使用，完整 API 支持 |
| ❌ 订阅号 | 不支持 | 会返回 `40007` 或 `48001` 错误 |

**如果你是订阅号用户：**
- 可以使用 `npm run publish:sub` 直接发布，不保存草稿
- 或生成 HTML 后手动复制到公众号编辑器

### 获取 APPID 和 APPSECRET

1. 登录微信公众平台：https://mp.weixin.qq.com
2. 点击左侧菜单 **开发** -> **基本配置**
3. 复制 **APPID(应用 ID)** -> 填入 `.env` 的 `WECHAT_APPID`
4. 点击 **生成并重置** 获取 **APPSECRET(应用密钥)** -> 填入 `.env` 的 `WECHAT_APPSECRET`

⚠️ **重要提示：**
- APPSECRET 只显示一次，请妥善保存！
- 建议配置 IP 白名单增强安全性
- 确保你的公众号是**认证服务号**，否则草稿箱接口无法使用

📖 **详细步骤：** 查看 [docs/WECHAT_OFFICIAL_SETUP.md](docs/WECHAT_OFFICIAL_SETUP.md)

## 常见问题

### Q: 如何部署 RSSHub?

A: RSSHub 可以用 Docker 一键部署：
```bash
docker run -d --name rsshub -p 1200:1200 diygod/rsshub
```

### Q: 支持哪些大模型?

A: 支持所有 OpenAI 兼容接口的模型，如：
- DeepSeek (推荐)
- 通义千问
- Kimi
- OpenAI

### Q: 发布到公众号后需要做什么?

A: 文章会保存到公众号草稿箱，你需要：
1. 登录微信公众平台
2. 进入"内容与互动" -> "草稿箱"
3. 预览并编辑文章
4. 手动发布或定时发布

### Q: 如何避免发布重复内容?

A: 系统会自动根据 GUID 去重，同一篇文章不会重复抓取和发布。

### Q: 如何调试?

A: 使用开发模式：
```bash
npm run dev
```
可以查看每一步的中间结果。

## 许可证

MIT

## 致谢

- 参考项目: [AutoContents](https://github.com/comeonzhj/AutoContents)
- RSSHub: [DIYgod/RSSHub](https://github.com/DIYgod/RSSHub)
