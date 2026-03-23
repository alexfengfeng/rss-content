# AGENTS.md - AI Coding Agent Guidelines

> This file contains essential context for AI coding agents working on this project. It supplements README.md with agent-specific instructions and conventions.

## Project Overview

**News to WeChat** (`news-to-wechat`) is a Node.js automation tool for news aggregation, AI rewriting, and publishing to WeChat Official Accounts (微信公众号).

### Core Workflow
```
RSS/GitHub Sources → Fetch → AI Rewrite → Publish to WeChat Drafts
```

### Key Capabilities
- **RSS News Fetching**: Supports standard RSS feeds and RSSHub routes
- **GitHub Trending**: Scrapes GitHub trending repositories with detailed metadata
- **AI Rewriting**: Uses LLM APIs (DeepSeek, OpenAI-compatible) to rewrite content for WeChat
- **WeChat Publishing**: Publishes to WeChat Official Account drafts via official API
- **Web Admin UI**: Express-based management interface with EJS templates
- **Scheduled Jobs**: Cron-based automatic fetching, rewriting, and publishing

---

## Technology Stack

| Layer | Technology |
|-------|------------|
| Runtime | Node.js (CommonJS modules) |
| Web Framework | Express.js 5.x |
| Template Engine | EJS with express-ejs-layouts |
| Database | SQLite3 (local file-based) |
| HTTP Client | Axios |
| Task Scheduler | node-cron |
| RSS Parsing | rss-parser |
| Image Processing | canvas (for cover generation) |

---

## Project Structure

```
news-to-wechat/
├── src/
│   ├── index.js                    # Main entry: scheduler + web server
│   ├── db/
│   │   └── database.js             # SQLite operations, schema, templates
│   ├── services/
│   │   ├── rssService.js           # RSS/RSSHub fetching logic
│   │   ├── githubTrendingService.js # GitHub scraping & project rewrite
│   │   ├── llmService.js           # LLM API integration for rewriting
│   │   ├── wechatService.js        # WeChat API (drafts, media upload)
│   │   └── jobService.js           # Job orchestration (fetch/rewrite/publish)
│   ├── scripts/
│   │   ├── fetchNews.js            # Manual fetch runner
│   │   ├── fetchGithubTrending.js  # Manual GitHub fetch
│   │   ├── rewriteNews.js          # Manual rewrite runner
│   │   ├── rewriteGithubProjects.js # Manual GitHub project rewrite
│   │   ├── publishToWechat.js      # Manual publish runner
│   │   ├── retryFailedNews.js      # Retry failed items
│   │   ├── initSources.js          # Seed sources from config
│   │   ├── migrate.js              # Database migrations
│   │   ├── viewNews.js             # CLI news viewer
│   │   ├── devMode.js              # Interactive dev mode
│   │   └── testGithubTrending.js   # GitHub trending validation
│   ├── web/
│   │   ├── server.js               # Express app with routes
│   │   ├── index.js                # Web server entry point
│   │   ├── views/                  # EJS templates (kebab-case naming)
│   │   │   ├── layout.ejs          # Base layout
│   │   │   ├── dashboard.ejs       # Admin dashboard
│   │   │   ├── news.ejs            # News list
│   │   │   ├── news-detail.ejs     # News detail
│   │   │   ├── news-edit.ejs       # News editor
│   │   │   ├── sources.ejs         # Source management
│   │   │   ├── source-form.ejs     # Source form
│   │   │   ├── templates.ejs       # Rewrite templates
│   │   │   ├── template-form.ejs   # Template form
│   │   │   ├── jobs.ejs            # Job run logs
│   │   │   ├── job-detail.ejs      # Job detail
│   │   │   ├── settings.ejs        # System settings view
│   │   │   └── error.ejs           # Error page
│   │   └── public/                 # Static assets
│   │       ├── css/style.css
│   │       └── js/app.js
│   └── utils/
│       ├── logger.js               # Simple leveled logger
│       ├── articleFormatter.js     # Content formatting for WeChat
│       └── coverGenerator.js       # Cover image generation
├── config/
│   ├── sources.json                # News source configuration
│   └── sources.example.json        # Example sources
├── data/                           # SQLite database directory
│   └── news.db                     # Main database (gitignored)
├── docs/                           # Documentation
│   ├── OPERATIONS.md              # Runtime, deployment, and configuration
│   └── DEVELOPMENT.md             # Development workflow and template layering
├── publish-subscription.js         # Standalone subscription account publisher
├── .env                            # Environment variables (gitignored)
├── .env.example                    # Environment template
└── package.json
```

---

## Database Schema

### Tables

**sources** - News source configuration
- `id`, `name`, `type` (rsshub/rss/github), `route`, `enabled`
- `keywords`, `blacklist` (JSON arrays)
- `config` (JSON for source-specific settings)

**news** - Fetched articles
- `id`, `source_id`, `guid` (unique), `title`, `description`, `link`, `pub_date`
- `image_url`, `project_meta` (JSON for GitHub projects)
- `rewritten_title`, `rewritten_content`, `rewritten_at`
- `status` (pending/rewritten/published/failed)
- `published_at`, `wechat_media_id`, `error_message`

**rewrite_templates** - AI prompt templates
- `id`, `name`, `description`, `system_prompt`, `user_prompt`
- `is_enabled`, `is_default`
- Built-in templates: 默认公众号模板, 新闻资讯模板, 深度分析模板, 开源项目改写模板, 快讯精编模板

**job_runs** - Background job execution logs
- `id`, `job_type` (fetch/rewrite/publish/reset_failed), `scope`, `trigger_type`
- `status` (running/success/partial/failed)
- `total_count`, `success_count`, `failed_count`, `message`, `details` (JSON)

---

## Environment Variables

### Required
| Variable | Description |
|----------|-------------|
| `LLM_API_KEY` | API key for LLM service |
| `LLM_MODEL` | Model name (e.g., `deepseek-chat`) |
| `LLM_BASE_URL` | LLM API base URL (e.g., `https://api.deepseek.com`) |
| `WECHAT_APPID` | WeChat Official Account APPID |
| `WECHAT_APPSECRET` | WeChat Official Account APPSECRET |

### Optional
| Variable | Default | Description |
|----------|---------|-------------|
| `RSSHUB_URL` | `http://localhost:1200` | RSSHub instance URL |
| `GITHUB_TOKEN` | - | GitHub API token (for higher rate limits) |
| `DB_PATH` | `./data/news.db` | SQLite database path |
| `WEB_PORT` | `3000` | Admin UI port |
| `LOG_LEVEL` | `info` | debug/info/warn/error |
| `FETCH_LIMIT` | `20` | Items per fetch |
| `REWRITE_BATCH_SIZE` | `5` | Items per rewrite batch |
| `PUBLISH_BATCH_SIZE` | `3` | Items per publish batch |
| `FETCH_CRON` | `0 */2 * * *` | Fetch schedule (cron) |
| `PUBLISH_CRON` | `0 9 * * *` | Publish schedule (cron) |

---

## Build, Test, and Development Commands

No separate build step required (interpreted Node.js).

```bash
# Installation
npm install

# Database initialization
npm run init                    # Seed sources from config/sources.json

# Development
npm run dev                     # Web hot reload
npm run dev:all                 # Unified entry hot reload (web + local RSSHub)
npm run web                     # Start only the admin UI at http://localhost:3000
npm start                       # Start full service (scheduler + web UI)

# Manual pipeline execution
npm run fetch                   # Fetch RSS news
npm run fetch:github            # Fetch GitHub Trending
npm run rewrite                 # Rewrite pending news
npm run rewrite:github          # Rewrite GitHub projects
npm run publish                 # Publish rewritten news to WeChat
npm run publish:sub             # Publish for subscription accounts (no drafts)

# Utility
npm run dev:cli                 # Interactive CLI mode
npm run view                    # CLI news viewer
npm run view stats              # View statistics
npm run retry:failed            # Reset failed items to pending
npm run migrate                 # Apply database migrations
npm run test:github             # Validate GitHub trending logic
```

---

## Coding Style & Naming Conventions

- **Module System**: CommonJS (`require`/`module.exports`)
- **Indentation**: 2 spaces
- **Quotes**: Single quotes for strings
- **Semicolons**: Required
- **File Naming**:
  - Scripts/Services: camelCase (`fetchNews.js`, `githubTrendingService.js`)
  - EJS Views: kebab-case (`news-detail.ejs`, `source-form.ejs`)
- **SQL Columns**: snake_case (matches existing schema)
- **Functions**: Prefer small, focused functions over inline route logic

---

## Testing Guidelines

This project uses **script-driven verification** rather than Jest/Vitest.

### RSS/GitHub Changes
```bash
# Run the affected script directly
npm run fetch
npm run fetch:github
# Verify records appear in data/news.db
```

### UI/API Changes
```bash
npm run web
# Manually verify pages and endpoints at http://localhost:3000
```

### Adding Tests
- Add focused validation scripts under `src/scripts/`
- Avoid creating disposable root-level test files
- Example: `src/scripts/testGithubTrending.js`

---

## Key Service Patterns

### RSS Service (`rssService.js`)
- Fetches from RSSHub or direct RSS feeds
- Filters by keywords/blacklists
- Deduplicates via GUID
- HTML stripping for clean description

### GitHub Trending (`githubTrendingService.js`)
- Scrapes GitHub trending pages
- Enriches with GitHub API data (README, repo metadata)
- Generates structured project outlines via LLM
- Renders styled HTML for WeChat

### LLM Service (`llmService.js`)
- OpenAI-compatible API interface
- Template-based prompting with variable substitution (`{{variable}}`)
- Default and custom rewrite templates
- Output parsing for title/content extraction

### WeChat Service (`wechatService.js`)
- Access token caching (refresh 5 min before expiry)
- Permanent material upload for cover images
- Draft creation via `draft/add` API
- Subscription account fallback support

### Job Service (`jobService.js`)
- Job run tracking with start/finish states
- Batch processing with configurable delays
- Error handling with status updates

---

## Security Considerations

### Critical: Never Commit Secrets
- `.env` - Contains API keys and WeChat credentials
- `data/news.db` - Local database with content
- WeChat secrets (APPID/APPSECRET)

### API Key Handling
- Use `.env.example` for new configuration keys
- Never log full API keys (mask with `***` + last 4 chars)

### WeChat API Limitations
- Draft box API (`draft/add`) only works for **verified service accounts** (认证服务号)
- Subscription accounts (订阅号) must use `publish:sub` or direct publish API
- Common errors: `40007` (invalid media_id), `48001` (unauthorized API)

### Input Validation
- RSS content is HTML-stripped before storage
- SQL parameters are always parameterized (sqlite3 prepared statements)
- File uploads validate image formats (JPG/PNG, max 2MB)

---

## Configuration Files

### `config/sources.json`
```json
[
  {
    "name": "Source Name",
    "type": "rsshub|rss|github",
    "route": "/route/path or https://...",
    "enabled": true,
    "keywords": ["AI", "tech"],
    "blacklist": ["ad", "promo"]
  }
]
```

**GitHub-specific fields:**
- `since`: daily/weekly/monthly
- `language`: Programming language filter
- `spokenLanguage`: User language (e.g., "zh")

After modifying sources, run `npm run init` to sync to database.

---

## Commit & Pull Request Guidelines

- Follow **Conventional Commits**: `feat:`, `fix:`, `style(views):`, etc.
- Keep messages imperative and scoped to one change
- PRs should include:
  - Concise summary
  - `.env` or schema impact notes
  - Commands run to verify
  - Screenshots for `src/web/` changes

---

## Common Development Tasks

### Adding a New Rewrite Template
1. Edit `src/db/database.js` - add to `BUILTIN_TEMPLATE_SEEDS`
2. Run `npm run migrate` or restart to seed
3. Test via Web UI at `/templates`

### Adding a New API Endpoint
1. Add route in `src/web/server.js`
2. Use `normalize*Payload` patterns for request parsing
3. Return `{ success: true, data: ... }` or `{ success: false, error: ... }`

### Modifying Database Schema
1. Add CREATE TABLE/ALTER TABLE in `src/db/database.js` initialization
2. Add migration logic for existing data if needed
3. Run `npm run migrate`

### Debugging GitHub Trending
```bash
npm run test:github
# Check output for parsed projects and metadata
```

---

## External Dependencies & APIs

| Service | Usage | Documentation |
|---------|-------|---------------|
| RSSHub | RSS aggregation | https://github.com/DIYgod/RSSHub |
| DeepSeek/OpenAI | Content rewriting | OpenAI-compatible API |
| WeChat Official | Article publishing | https://developers.weixin.qq.com |
| GitHub API | Repo metadata | https://docs.github.com/rest |

---

## Troubleshooting Quick Reference

| Issue | Solution |
|-------|----------|
| `LLM_API_KEY not configured` | Set in `.env` file |
| `draft/add 40007 error` | Account is subscription type, use `npm run publish:sub` |
| RSS fetch fails | Check RSSHub URL, verify source route |
| Images not showing | Verify image URL is accessible, format is JPG/PNG |
| Database locked | Ensure only one process accessing `data/news.db` |

---

*Last updated: 2026-03-18*
