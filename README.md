# News to WeChat

一个自动化新闻抓取、AI 改写并发布到微信公众号的工具。

参考自 [AutoContents](https://github.com/comeonzhj/AutoContents) 项目，专注于新闻抓取 + AI 改写 + 公众号发布的完整工作流。

## 功能特性

- 📰 **RSS 新闻抓取** - 支持 RSSHub 和标准 RSS 源
- 🐙 **GitHub Trending** - 自动抓取 GitHub/Gitee 每日/每周/每月热门项目
- 🤖 **AI 智能改写** - 使用大模型改写新闻内容，支持模板系统
- 📱 **公众号自动发布** - 一键发布到微信公众号草稿箱
- ⏰ **定时任务** - 支持自动抓取和定时发布
- 🗃️ **本地数据库** - SQLite 存储，无需额外配置
- 🔍 **关键词过滤** - 支持正向/黑名单关键词筛选
- 🎨 **封面生成** - 自动为文章生成封面图片
- 📝 **模板管理** - 内置多种改写模板，支持自定义 Prompt

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

### 方式六：订阅账号发布（无草稿箱支持）

如果你的公众号是订阅号（无草稿箱权限），使用以下命令直接发布：
```bash
npm run publish:sub
```

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

#### 抓取 GitHub Trending
```bash
npm run fetch:github
```

#### AI 改写
```bash
npm run rewrite
```

#### 改写 GitHub 项目
```bash
npm run rewrite:github
```

#### 发布到公众号
```bash
npm run publish
```

#### 订阅账号直接发布（无草稿箱）
```bash
npm run publish:sub
```

#### 重试失败的项目
```bash
npm run retry:failed
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
- 📝 **模板管理** - 管理 AI 改写模板和 Prompt
- 📋 **任务日志** - 查看后台任务执行记录
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

### GitHub Trending 配置

GitHub Trending 源支持额外的配置选项：

```json
{
  "name": "GitHub Trending Daily",
  "type": "github",
  "route": "https://github.com/trending",
  "enabled": true,
  "since": "daily",
  "language": "",
  "spokenLanguage": "zh",
  "keywords": [],
  "blacklist": []
}
```

**GitHub 源特有字段：**
- `since` - 时间范围：`daily`（每日）、`weekly`（每周）、`monthly`（每月）
- `language` - 编程语言筛选（如 `Python`、`JavaScript`，留空表示全部）
- `spokenLanguage` - 用户语言筛选（如 `zh` 表示中文用户）

**抓取的数据字段：**
- 项目名、作者
- 项目描述
- Star 数、Fork 数
- 编程语言
- 今日新增 Star 数

**示例配置：**

```json
[
  {
    "name": "GitHub Trending Daily",
    "type": "github",
    "route": "https://github.com/trending",
    "enabled": true,
    "since": "daily",
    "spokenLanguage": "zh"
  },
  {
    "name": "GitHub Trending Python",
    "type": "github",
    "route": "https://github.com/trending",
    "enabled": false,
    "since": "daily",
    "language": "Python"
  },
  {
    "name": "GitHub Trending Weekly",
    "type": "github",
    "route": "https://github.com/trending",
    "enabled": false,
    "since": "weekly"
  }
]
```

单独执行 GitHub Trending 抓取：
```bash
npm run fetch:github
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
| `DB_PATH` | SQLite 数据库路径 | 否 | `./data/news.db` |
| `FETCH_LIMIT` | 每次抓取数量 | 否 | `20` |
| `REWRITE_BATCH_SIZE` | 每次改写数量 | 否 | `5` |
| `PUBLISH_BATCH_SIZE` | 每次发布数量 | 否 | `3` |
| `FETCH_CRON` | 抓取定时 (Cron) | 否 | `0 */2 * * *` |
| `PUBLISH_CRON` | 发布定时 (Cron) | 否 | `0 9 * * *` |
| `LOG_LEVEL` | 日志级别 | 否 | `info` |
| `GITHUB_TOKEN` | GitHub API Token | 否 | - |

## 项目结构

```
news-to-wechat/
├── src/
│   ├── index.js                 # 主入口 (定时任务 + Web)
│   ├── db/
│   │   └── database.js          # SQLite 数据库操作
│   ├── services/
│   │   ├── rssService.js        # RSS 抓取服务
│   │   ├── githubTrendingService.js  # GitHub Trending 抓取服务
│   │   ├── llmService.js        # AI 改写服务
│   │   ├── wechatService.js     # 公众号发布服务
│   │   └── jobService.js        # 任务编排服务
│   ├── scripts/
│   │   ├── fetchNews.js         # 抓取脚本
│   │   ├── fetchGithubTrending.js  # GitHub Trending 抓取脚本
│   │   ├── rewriteNews.js       # 改写脚本
│   │   ├── rewriteGithubProjects.js # GitHub 项目改写脚本
│   │   ├── publishToWechat.js   # 发布脚本
│   │   ├── retryFailedNews.js   # 重试失败项目
│   │   ├── initSources.js       # 初始化新闻源
│   │   ├── viewNews.js          # 查看新闻脚本
│   │   ├── devMode.js           # 交互式开发模式
│   │   ├── migrate.js           # 数据库迁移脚本
│   │   └── testGithubTrending.js # GitHub Trending 测试
│   ├── web/                     # Web 管理界面
│   │   ├── server.js            # Express 服务器
│   │   ├── index.js             # Web 启动入口
│   │   ├── views/               # EJS 模板
│   │   │   ├── layout.ejs       # 布局模板
│   │   │   ├── dashboard.ejs    # 仪表盘
│   │   │   ├── news.ejs         # 新闻列表
│   │   │   ├── news-detail.ejs  # 新闻详情
│   │   │   ├── news-edit.ejs    # 新闻编辑
│   │   │   ├── sources.ejs      # 信源管理
│   │   │   ├── source-form.ejs  # 信源表单
│   │   │   ├── templates.ejs    # 模板管理
│   │   │   ├── template-form.ejs # 模板表单
│   │   │   ├── jobs.ejs         # 任务日志
│   │   │   ├── job-detail.ejs   # 任务详情
│   │   │   ├── settings.ejs     # 系统配置
│   │   │   └── error.ejs        # 错误页面
│   │   └── public/              # 静态资源
│   └── utils/
│       ├── logger.js            # 日志工具
│       ├── articleFormatter.js  # 内容格式化
│       └── coverGenerator.js    # 封面图片生成
├── config/
│   ├── sources.json             # 新闻源配置
│   └── sources.example.json     # 新闻源配置示例
├── data/                        # 数据库目录
├── docs/                        # 文档目录
├── publish-subscription.js      # 订阅账号发布入口
├── .env                         # 环境变量
├── .env.example                 # 环境变量模板
├── .gitignore
├── package.json
└── README.md
```

## 工作流程

```
┌─────────────┐    ┌─────────────┐    ┌─────────────┐    ┌─────────────┐
│  RSS/GitHub │───>│  抓取新闻   │───>│  AI 改写    │───>│  公众号发布 │
│   数据源    │    │             │    │             │    │             │
│ - 36氪      │    │ - 去重      │    │ - 重写标题  │    │ - 草稿箱    │
│ - 虎嗅      │    │ - 关键词过滤│    │ - 改写正文  │    │ - 直接发布  │
│ - RSSHub    │    │ - 存数据库  │    │ - 风格优化  │    │             │
│ - GitHub    │    │             │    │             │    │             │
└─────────────┘    └─────────────┘    └─────────────┘    └─────────────┘
```

## 数据库表结构

### sources - 新闻源配置
- `id`, `name`, `type` (rsshub/rss/github), `route`, `enabled`
- `keywords`, `blacklist` (JSON 数组)
- `config` (JSON，源特定配置)

### news - 抓取的文章
- `id`, `source_id`, `guid` (唯一标识), `title`, `description`, `link`, `pub_date`
- `image_url`, `project_meta` (GitHub 项目 JSON 数据)
- `rewritten_title`, `rewritten_content`, `rewritten_at`
- `status` (pending/rewritten/published/failed)
- `published_at`, `wechat_media_id`, `error_message`

### rewrite_templates - AI 改写模板
- `id`, `name`, `description`, `system_prompt`, `user_prompt`
- `is_enabled`, `is_default`
- 内置模板：默认公众号模板、新闻资讯模板、深度分析模板、开源项目改写模板、快讯精编模板

### job_runs - 后台任务执行日志
- `id`, `job_type` (fetch/rewrite/publish/reset_failed), `scope`, `trigger_type`
- `status` (running/success/partial/failed)
- `total_count`, `success_count`, `failed_count`, `message`, `details` (JSON)

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

## 安全注意事项

### 永远不要提交的内容
- `.env` - 包含 API Key 和公众号密钥
- `data/news.db` - 本地数据库
- WeChat 密钥 (APPID/APPSECRET)

### API Key 处理
- 使用 `.env.example` 作为新配置项的模板
- 日志中不要输出完整的 API Key（使用 `***` + 后4位）

### 公众号 API 限制
- 草稿箱 API (`draft/add`) 仅适用于**认证服务号**
- 订阅号必须使用 `publish:sub` 或直接发布 API
- 常见错误：`40007` (无效的 media_id)、`48001` (未授权 API)

## 故障排除快速参考

| 问题 | 解决方案 |
|------|---------|
| `LLM_API_KEY not configured` | 在 `.env` 文件中设置 |
| `draft/add 40007 error` | 账号是订阅号，使用 `npm run publish:sub` |
| RSS 抓取失败 | 检查 RSSHub URL，验证源路由 |
| 图片无法显示 | 验证图片 URL 可访问，格式为 JPG/PNG |
| 数据库锁定 | 确保只有一个进程访问 `data/news.db` |

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

### Q: 如何测试 GitHub Trending 抓取?

A: 运行测试脚本：
```bash
npm run test:github
```

### Q: 如何添加自定义改写模板?

A: 
1. 通过 Web 界面访问 `/templates`
2. 点击"新建模板"
3. 填写模板名称、描述、System Prompt 和 User Prompt
4. 使用 `{{title}}`、`{{content}}` 等变量占位符

## 技术栈

| 层级 | 技术 |
|------|------|
| 运行时 | Node.js (CommonJS) |
| Web 框架 | Express.js 5.x |
| 模板引擎 | EJS + express-ejs-layouts |
| 数据库 | SQLite3 |
| HTTP 客户端 | Axios |
| 任务调度 | node-cron |
| RSS 解析 | rss-parser |
| 图片处理 | canvas |

## 许可证

MIT

## 致谢

- 参考项目: [AutoContents](https://github.com/comeonzhj/AutoContents)
- RSSHub: [DIYgod/RSSHub](https://github.com/DIYgod/RSSHub)
