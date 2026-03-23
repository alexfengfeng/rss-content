# 开发与模板说明

这份文档只管“怎么开发”和“模板在哪一层生效”。

## 1. 开发命令

### Web 热重载

```bash
npm run dev
```

等价于：

```bash
npm run dev:web
```

适合修改：

- EJS 页面
- 样式
- 后台接口
- 默认图文模板

### 全量联调热重载

```bash
npm run dev:all
```

这个模式会走统一入口，并带上本地 RSSHub。为了避免每次保存都触发自动流程，默认行为是：

- `ENABLE_CRON=false`
- `SKIP_BOOTSTRAP_TASKS=true`

也就是：

- 不跑 cron
- 不在启动时自动抓取 / 改写 / 发布

### 正式运行

```bash
npm start
```

正式运行才用于验证完整自动任务链路。

## 2. 模板分层

项目里现在有两套模板，职责已经拆开：

### 改写模板

作用：

- 控制 LLM 提示词
- 控制改写口吻、篇幅、结构要求

存储位置：

- 数据库 `rewrite_templates` 表
- Web 后台里的“改写模板”菜单

典型代码入口：

- `src/services/llmService.js`

### 发布样式模板

作用：

- 控制最终 HTML 结构
- 控制头图、摘要、导语卡片、正文版式

存储位置：

- 数据库 `publish_templates` 表
- Web 后台里的“发布样式模板”菜单

实际渲染位置：

- 普通新闻样式：`src/utils/articleFormatter.js`
- GitHub 开源项目样式：`src/services/githubTrendingService.js`
- 发布落地：`src/services/jobService.js`

结论很直接：

- 模板选择是“数据库关联”
- 最终 HTML 是“代码渲染”
- 不是把整段 HTML 直接存数据库自由编辑

## 3. 当前默认样式

### 普通新闻

- 使用默认图文模板
- 走 `articleFormatter.js`
- 当前风格是窄边框、宽正文、适合手机阅读

### GitHub 开源项目

- 使用 `open_source_infoq`
- 走 `githubTrendingService.js`
- 当前风格是 InfoQ 风正文模板 + 专用头图
- README 插图会尝试抓取，并在发布时上传到微信正文图片接口

## 4. 你通常会改哪些文件

### 改发布样式

- `src/utils/articleFormatter.js`
- `src/services/githubTrendingService.js`
- `src/utils/coverGenerator.js`

### 改发布流程

- `src/services/jobService.js`
- `src/services/wechatService.js`

### 改改写逻辑

- `src/services/llmService.js`
- `src/db/database.js`
- `src/web/server.js`

### 改后台页面

- `src/web/views/*.ejs`

## 5. 新增模板的建议方式

### 新增改写模板

1. 在 `src/db/database.js` 的内置模板种子里加入新模板
2. 重启服务或执行迁移
3. 在后台选择并验证改写效果

### 新增发布样式模板

1. 在 `src/db/database.js` 的 `publish_templates` 种子里增加记录
2. 给出新的 `style_key`
3. 在代码里实现这个 `style_key` 对应的渲染逻辑
4. 在模板预览页补上对应预览

## 6. 验证建议

改完页面或样式，优先这样验证：

```bash
npm run dev
```

改完统一入口、RSSHub 或启动流程，优先这样验证：

```bash
npm run dev:all
```

改完发布链路或微信兼容性，最后用：

```bash
npm start
```

再推一篇真实草稿验证。
