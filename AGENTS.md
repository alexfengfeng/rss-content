# Repository Guidelines

## Project Structure & Module Organization
`src/` contains the application code. Use `src/services/` for feed, LLM, GitHub trending, and WeChat integrations; `src/db/` for SQLite access; `src/scripts/` for runnable task scripts; and `src/web/` for the Express admin UI plus EJS views and static assets. Keep source definitions in `config/sources.json`, local data in `data/news.db`, and setup notes in `docs/`. The root-level `publish-subscription.js` is a maintained entry point for subscription-account publishing.

## Build, Test, and Development Commands
There is no separate build step.

- `npm install`: install dependencies.
- `npm run init`: seed sources from `config/sources.json`.
- `npm start`: run the scheduler and web UI together.
- `npm run web`: run only the admin UI at `http://localhost:3000`.
- `npm run fetch` / `npm run rewrite` / `npm run publish`: execute the RSS -> rewrite -> publish stages manually.
- `npm run fetch:github` / `npm run rewrite:github`: run the GitHub trending pipeline.
- `npm run publish:sub`: publish for subscription accounts without draft-box support.
- `npm run migrate`: apply SQLite schema updates.
- `npm run test:github`: validate GitHub trending fetch and rewrite behavior.

## Coding Style & Naming Conventions
Use CommonJS modules, 2-space indentation, semicolons, and single quotes to match the codebase. Prefer small service functions over large inline route logic. Name scripts and services in camelCase (`fetchNews.js`, `githubTrendingService.js`); use kebab-case for EJS view files (`news-detail.ejs`, `source-form.ejs`). Keep SQL column names snake_case to match the existing schema.

## Testing Guidelines
This repository currently uses script-driven verification rather than Jest/Vitest. When changing RSS or GitHub ingestion, run the affected script directly and confirm records appear in `data/news.db`. For UI or API changes, start `npm run web` and verify the relevant page and endpoint manually. Add focused validation scripts under `src/scripts/` instead of creating disposable root-level test files.

## Commit & Pull Request Guidelines
Follow the existing commit style: short Conventional Commit subjects such as `feat: ...`, `fix: ...`, or `style(views): ...`. Keep messages imperative and scoped to one change. PRs should include a concise summary, any `.env` or schema impact, the commands you ran to verify the change, and screenshots when `src/web/` output changes.

## Security & Configuration Tips
Never commit real `.env` values, WeChat secrets, or `data/news.db`. Prefer `.env.example` for new config keys. If you change RSSHub behavior, verify both `RSSHUB_URL` and direct RSS feeds still work.
