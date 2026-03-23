# News to WeChat

一个用于“抓取新闻 / GitHub 开源项目 -> AI 改写 -> 推送到微信公众号草稿箱”的自动化工具。

## 你需要知道的三件事

- 正式运行用 `npm start`
- 日常开发 Web 用 `npm run dev`
- 详细说明只保留两份文档：
  - [运行与配置说明](docs/OPERATIONS.md)
  - [开发与模板说明](docs/DEVELOPMENT.md)

## 核心能力

- 支持标准 RSS 和 RSSHub 新闻源
- 支持 GitHub Trending 抓取与开源项目解读
- 支持多套改写模板和发布样式模板
- 支持微信公众号草稿箱发布
- 支持本地 SQLite 存储
- 提供 Web 管理后台

## 快速开始

```bash
npm install
cp .env.example .env
npm run init
npm start
```

默认后台地址：

```text
http://localhost:3000
```

## 常用命令

```bash
# 正式运行
npm start

# Web 开发热重载
npm run dev

# 全量联调热重载（Web + 统一入口 + 本地 RSSHub）
npm run dev:all

# 手动执行流程
npm run fetch
npm run fetch:github
npm run rewrite
npm run rewrite:github
npm run publish
```

## 文档

- [运行与配置说明](docs/OPERATIONS.md)
- [开发与模板说明](docs/DEVELOPMENT.md)

## License

MIT
