# 微信公众号配置指南（官方 API）

## 配置步骤

### 1. 登录微信公众平台

访问：https://mp.weixin.qq.com

使用管理员微信扫码登录。

### 2. 获取 APPID 和 APPSECRET

1. 登录后，点击左侧菜单 **开发** -> **基本配置**
2. 找到 **开发者 ID** 部分
3. 复制 **APPID(应用 ID)** -> 填入 `.env` 的 `WECHAT_APPID`
4. 点击 **生成并重置** 获取 **APPSECRET(应用密钥)** -> 填入 `.env` 的 `WECHAT_APPSECRET`

⚠️ **重要提示：**
- APPSECRET 只显示一次，请妥善保存！
- 如果泄露，请立即重置
- 不要将 `.env` 文件提交到 Git

### 3. 配置 IP 白名单（可选但推荐）

在 **基本配置** 页面：
1. 找到 **IP 白名单** 设置
2. 添加你的服务器 IP 地址
3. 本地开发可以添加公网 IP（查询：https://ip138.com）

### 4. 编辑 .env 文件

在项目根目录编辑 `.env` 文件：

```bash
# 填入你的公众号 APPID
WECHAT_APPID=wx1234567890abcdef

# 填入你的公众号 APPSECRET
WECHAT_APPSECRET=your_appsecret_here_32chars
```

### 5. 验证配置

运行以下命令测试配置：

```bash
npm run dev
```

选择 **查看公众号账号** 选项，如果能看到账号信息说明配置成功。

---

## API 说明

### 使用的微信官方接口

| 接口 | 用途 | 文档 |
|------|------|------|
| `cgi-bin/token` | 获取 access_token | [文档](https://developers.weixin.qq.com/doc/offiaccount/Basic_Information/Get_access_token.html) |
| `cgi-bin/media/uploadimg` | 上传图片 | [文档](https://developers.weixin.qq.com/doc/offiaccount/Basic_Information/Upload-Download_Media_Files.html) |
| `cgi-bin/draft/add` | 新增草稿 | [文档](https://developers.weixin.qq.com/doc/offiaccount/Draft_Box/Add_draft.html) |

### 频率限制

- access_token 调用：无限制
- 素材上传：每天 1000 次
- 草稿箱操作：无明确限制

### 内容限制

| 字段 | 限制 |
|------|------|
| 标题 | 最多 64 字 |
| 摘要 | 最多 120 字 |
| 作者 | 最多 20 字 |
| 正文 | 最多 20000 字 |
| 图片 | 最多 8 张（封面 + 正文） |

---

## 常见问题

### Q: access_token 过期了怎么办？

A: 代码会自动处理 token 刷新和缓存，无需手动操作。token 有效期 2 小时，代码会提前 5 分钟刷新。

### Q: 发布失败，提示"不合法的 appid"？

A: 检查：
1. APPID 是否正确复制（没有多余空格）
2. 公众号是否已认证
3. 是否在服务者模式（需要切换为开发者模式）

### Q: 图片上传失败？

A: 检查：
1. 图片大小不超过 2MB
2. 图片格式为 JPG/PNG
3. IP 是否在白名单内

### Q: 如何发布到多个公众号？

A: 当前版本支持单个公众号。如需多账号，需要：
1. 为每个公众号配置独立的 APPID 和 APPSECRET
2. 修改代码支持多账号切换

### Q: 草稿箱发布后在哪里查看？

A: 登录微信公众平台 -> **内容与互动** -> **草稿箱**

---

## 与第三方 API 的区别

| 特性 | 官方 API | 第三方 API (wx.limyai.com) |
|------|----------|---------------------------|
| 安全性 | ⭐⭐⭐⭐⭐ 完全可控 | ⭐⭐⭐ 需要信任第三方 |
| 稳定性 | ⭐⭐⭐⭐⭐ 官方保障 | ⭐⭐⭐ 依赖第三方服务 |
| 成本 | 免费 | 可能收费 |
| 功能 | 完整支持 | 部分功能 |
| 配置复杂度 | 中等 | 简单 |

---

## 代码修改说明

### 主要变更

1. **移除第三方依赖**：不再使用 `wx.limyai.com` API
2. **使用官方微信接口**：`api.weixin.qq.com`
3. **添加 token 缓存**：避免频繁请求 access_token
4. **图片上传支持**：自动处理封面和正文图片
5. **草稿箱接口**：使用 `draft/add` 接口保存草稿

### 环境变量变更

| 旧配置 | 新配置 | 说明 |
|--------|--------|------|
| `WECHAT_API_KEY` | `WECHAT_APPID` + `WECHAT_APPSECRET` | 使用官方凭证 |

---

## 下一步

配置完成后，运行：

```bash
# 启动 Web 管理界面
npm run web

# 或者启动完整服务（带定时任务）
npm start
```

访问 http://localhost:3000 管理新闻和发布。
