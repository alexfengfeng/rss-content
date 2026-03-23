# 运行与配置说明

这份文档只管“怎么跑起来”和“线上怎么维护”。

## 1. 环境准备

先安装依赖：

```bash
npm install
```

复制环境变量模板：

```bash
cp .env.example .env
```

至少需要配置：

- `LLM_API_KEY`
- `LLM_MODEL`
- `LLM_BASE_URL`
- `WECHAT_APPID`
- `WECHAT_APPSECRET`

常用可选项：

- `RSSHUB_URL`
  默认是 `http://localhost:1200`
- `WEB_PORT`
  默认是 `3000`
- `DB_PATH`
  默认是 `./data/news.db`

## 2. 初始化

首次运行先把新闻源写入数据库：

```bash
npm run init
```

数据库默认在：

```text
data/news.db
```

## 3. 启动方式

### 正式运行

```bash
npm start
```

这一条命令会统一启动：

- Web 管理后台
- 定时抓取
- 定时改写
- 定时发布
- 本地 RSSHub 自动拉起逻辑（当 `RSSHUB_URL` 指向 `http://localhost:1200` 时）

### 只启动后台

```bash
npm run web
```

适合只看后台页面，不想启动整套自动任务时使用。

## 4. 手动执行命令

```bash
# 抓取
npm run fetch
npm run fetch:github

# 改写
npm run rewrite
npm run rewrite:github

# 发布
npm run publish
npm run publish:sub

# 查看与重试
npm run view
npm run retry:failed
```

## 5. 微信公众号要求

当前发布走微信官方接口，推送到草稿箱需要：

- 正确配置 `WECHAT_APPID` 和 `WECHAT_APPSECRET`
- 公众号具备对应接口权限
- 图片上传和草稿接口可正常调用

常见限制：

- 标题不宜过长
- 摘要长度有限
- 正文图片需要先上传到微信，再能稳定显示

## 6. RSSHub 说明

项目已经支持把 RSSHub 作为内置运行时随 `npm start` 一起启动。

只有在下面这个条件成立时，才会自动拉起本地 RSSHub：

```env
RSSHUB_URL=http://localhost:1200
```

如果你改成别的 RSSHub 地址，项目会直接使用你配置的远端服务。

## 7. 常见问题

### `ECONNREFUSED`

通常是本地 RSSHub 没起来，或者 `RSSHUB_URL` 指向了一个没人监听的地址。

### 图片在微信正文里不显示

不能直接依赖 GitHub 外链。当前发布流程会先把正文图片上传到微信，再替换为微信自己的图片地址。

### 草稿已经发过，但还想再推一次

现在已发布文章也保留“重新推送到公众号草稿箱”入口，不需要重新改写。

### 改写结果里带了原平台说明

当前改写和发布前清洗都已经做了兜底，不会默认带出“文章来源”“原文链接”“免责声明”这类尾巴。
