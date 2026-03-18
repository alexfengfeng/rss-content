# GitHub Trending 优化说明

## 🎯 优化内容

本次优化针对 GitHub Trending 功能进行了全面升级，使其更适合微信公众号发布。

### 主要改进

1. **项目图片抓取** ✨
   - 自动提取项目的 OG Image 或仓库图标
   - 支持在改写文章中自动插入项目图片
   - 图片样式优化，适配移动端阅读

2. **专用改写模板** 📝
   - 为 GitHub 项目定制的 LLM 改写提示词
   - 突出项目亮点和技术特点
   - 合理使用 Star/Fork 数据说明项目热度
   - 介绍使用场景和解决的痛点

3. **独立改写脚本** 🚀
   - `npm run rewrite:github` - 批量改写待处理的 GitHub 项目
   - 自动解析项目元数据（作者、Stars、Forks、语言等）
   - 智能错误处理和重试机制

## 📦 新增文件

```
src/
├── services/
│   └── githubTrendingService.js    # 优化后的抓取服务（含图片抓取和改写功能）
├── scripts/
│   └── rewriteGithubProjects.js    # GitHub 项目专用改写脚本
└── db/
    └── database.js                  # 添加 image_url 字段支持
```

## 🔧 使用方法

### 1. 抓取 GitHub Trending

```bash
# 抓取每日热门项目
npm run fetch:github

# 查看抓取结果
npm run view
```

### 2. 改写为项目介绍文章

```bash
# 批量改写所有待处理的 GitHub 项目
npm run rewrite:github

# 或在 Web 界面点击"改写"按钮
```

### 3. 查看改写结果

```bash
# 查看已改写的 GitHub 项目
npm run view detail <ID>
```

## 📊 输出示例

### 改写前（原始描述）
```
A Simple and Universal Swarm Intelligence Engine, Predicting Anything. 简洁通用的群体智能引擎，预测万物
```

### 改写后（项目介绍文章）
```markdown
标题：群体智能预测引擎 MiroFish 问世，能否实现"预测万物"？

正文：
<img src="https://avatars.githubusercontent.com/u/xxxxx" alt="MiroFish" style="max-width: 100%; height: auto; display: block; margin: 20px auto; border-radius: 8px;">

在人工智能技术快速发展的今天，一项名为 MiroFish 的新项目近日在 GitHub 上悄然发布...

**项目核心：简洁通用的群体智能引擎**

根据项目主页介绍，MiroFish 被定义为一个"简单而通用的群体智能引擎"...

**数据支撑**
- Stars: 1,234
- Forks: 567
- 今日新增：89 stars

**使用场景**
适用于金融预测、物流优化、科研分析等领域...
```

## 🎨 文章结构

优化后的 GitHub 项目介绍文章包含以下要素：

1. **项目图片** - 自动插入在文章开头
2. **吸引人的标题** - 突出核心价值，不超过 30 字
3. **导语** - 1-2 句话概括项目是什么
4. **项目亮点** - 核心功能和技术特点
5. **数据支撑** - Stars、Forks、今日新增等
6. **使用场景** - 解决什么痛点，适合什么场景
7. **总结** - 项目前景和展望

## ⚙️ 配置说明

在 `config/sources.json` 中可以配置：

```json
{
  "name": "GitHub Trending Daily",
  "type": "github",
  "route": "https://github.com/trending",
  "enabled": true,
  "config": {
    "since": "daily",        // daily/weekly/monthly
    "language": "JavaScript", // 筛选编程语言（可选）
    "spokenLanguage": "zh"    // 筛选语言社区（可选）
  }
}
```

## 📝 数据库变更

新增 `image_url` 字段用于存储项目图片地址：

```sql
ALTER TABLE news ADD COLUMN image_url TEXT;
```

迁移脚本：`src/scripts/migrate.js`（如需要）

## 🔍 技术细节

### 图片抓取逻辑

1. 优先提取页面 OG Image 元标签
2. 如果不存在，尝试从 article 中提取 SVG 图标
3. 将图片 URL 存储到数据库的 `image_url` 字段
4. 改写时自动将图片插入文章开头

### 改写提示词优化

使用专门的系统提示词 `GITHUB_PROJECT_PROMPT`，包含：
- 标题要求（吸引人但不做标题党）
- 结构要求（导语、亮点、数据、场景、总结）
- 风格要求（专业但易懂，适合公众号）
- 长度要求（600-1000 字）

## 🚀 后续优化方向

- [ ] 支持抓取项目 README 内容
- [ ] 提取项目截图/演示 GIF
- [ ] 分析项目依赖和技术栈
- [ ] 生成项目对比分析
- [ ] 自动添加相关项目推荐

## 📞 问题反馈

如有问题或建议，请在项目中提 Issue。
