# TZ Generator (Генератор ТЗ для госзакупок 44-ФЗ) — Программа №1 в России

## Replit Environment Setup
- Python packages installed via `pip install` (fastapi, uvicorn, sqlalchemy, alembic, psycopg2-binary, pyjwt, python-multipart, slowapi, httpx)
- Node packages installed via `npm install` in `frontend-react/`
- Database: Replit PostgreSQL (DATABASE_URL set as a secret)
- Backend runs on port 8000, Frontend runs on port 5000
- Vite proxies `/api` and `/health` to `http://localhost:8000`


## Project Overview
A market-leading tool for Russian government procurement specialists to generate zero-FAS-risk technical specifications (ТЗ) for IT equipment and software under FZ-44, FZ-223, and PP 1875.

Core differentiators: Double-Equivalent algorithm (ensures ≥2 competing manufacturers), Web-Truth verification against manufacturer datasheets, GOST-compliant DOCX output (no KTRU/OKPD2 in text, DXA column widths), exhaustive measurable specs (MTBF, TDP, USB version, Wi-Fi IEEE, operating temperature, power efficiency).

## Architecture

### Frontend (`frontend-react/`)
- **Framework**: React 18 + TypeScript
- **Build Tool**: Vite (configured on port 5000, host 0.0.0.0)
- **State**: TanStack Query (React Query)
- **Forms**: React Hook Form + Zod
- **Exports**: docx.js, jsPDF
- **API Client**: Axios

### Backend (`backend/`)
- **Framework**: FastAPI (Python 3.12)
- **Server**: Uvicorn
- **Database**: SQLAlchemy + PostgreSQL/SQLite, Alembic migrations
- **Auth**: PyJWT, Magic Links
- **Rate Limiting**: Slowapi
- **DOCX Parser**: python-docx (server-side table extraction via `/api/parse-docx`)
- **DOCX Compliance Post-processor**: `/api/fix-docx` — Run-aware regex replacements preserving formatting (brands → «или эквивалент», выписки → реестровые записи, НДВ → уровень доверия, etc.)

### Legacy
- `index.html`: Original monolithic SPA (~2700 lines)
- `netlify/`: Serverless functions for Netlify deployment

## External Services
- **AI**: Groq, DeepSeek, OpenRouter
- **Search**: Serper.dev, EIS (Zakupki.gov.ru)
- **Payments**: YooKassa

## Workflows
- **Start application**: `cd frontend-react && npm run dev` → port 5000

## Deployment
- **Docker** (production): Multi-stage Dockerfile builds React frontend + FastAPI backend into a single container. FastAPI serves static files from `static/` directory.
- **Render.com**: `render.yaml` Blueprint — web service + PostgreSQL, free tier. Auto-deploy from GitHub.
- **Railway.app**: `railway.json` — Dockerfile builder, health check at `/health`.
- **Dev mode**: Vite dev server on port 5000 with API proxy to backend on port 8000.
- Dynamic PORT via `os.environ.get("PORT", 8000)` for PaaS compatibility.
- Static file serving: FastAPI mounts `static/assets/` and serves SPA fallback `index.html` for all non-API routes (only when `static/` directory exists in production build).

## Key Features (after refactoring)
- **Legal OS UI**: Inter font, Deep Blue `#1e293b` theme, high-contrast data tables
- **Double-Equivalent Algorithm**: Auto-verifies ≥2 manufacturers match each spec after generation; auto-triggers via backend AI; shows validation dashboard (`DoubleEquivalentReport`)
- **Exhaustive Spec Generation**: System prompt enforces MTBF, interface standards, power efficiency, TDP, Wi-Fi/USB/HDMI versions, measurable parameters (≥25 specs for hardware)
- **No KTRU/OKPD2 in DOCX**: Codes stripped from final document text and summary tables; still used internally for classification routing
- **Web-Truth Verification**: `fetch-specs.ts` verifies specs against manufacturer datasheets via AI; conflict detection with legally-safe reformulation
- **spec-processor.ts**: Postprocessing enforces "не менее/не более" language, removes brands, normalizes Russian units, adds "или эквивалент" for specific technologies
- **Dual DOCX Parsing**: Server-side via `python-docx` (`/api/parse-docx`) + client-side via JSZip (`row-import.ts`). Server path is preferred, client fallback if unavailable. Both handle `<w:sdt>` wrapped tables.
- **Spec Table Detection**: Two-tier header aliases (Характеристика/Параметр/Показатель + Значение/Требуемое значение/Спецификация) + headerless heuristic for tables without recognized column names
- **Number-Preserving LLM Prompt**: AI must preserve exact numeric values from imported specs (e.g. "16 ГБ" → "не менее 16 ГБ", never "не менее 8 ГБ"); only brand names stripped

## Compliance & UX Improvements (Latest)
- **Enhanced AI Prompts**: `buildPrompt` and `buildImportedSpecsPromptBlock` now enforce strict rules per lawMode (44-FZ strict, 223-FZ flexible). 5 numbered rules for DOCX-imported specs, explicit OKPD2/KTRU prohibition in spec text.
- **Compliance Summary Bar**: Visual panel above rows table showing legal checks (brands, OKPD2/KTRU, competition ≥2 manufacturers, anti-corruption score, import/AI source counts).
- **Source Tags**: Each row shows DOCX/AI/Catalog source tag with color-coded badges (green=DOCX import, blue=AI generated, purple=catalog).
- **Import Detail Panel**: Enhanced with confidence badges (high/medium/low), AI processing summary, review warnings.
- **Context-Aware Buttons**: "Нормализовать ТЗ" for DOCX-imported rows vs "Сгенерировать ТЗ" for new rows, with descriptive tooltips.
- **Admin-only features**: Validation modal, system panels, trial banner hidden from non-admin users.

## UX Redesign for Procurement Specialists
- **ProcessStepper** (`ProcessStepper.tsx`): Visual 4-step process indicator — Исходные данные → Характеристики → ТЗ → Проверка. Steps auto-update based on workspace state (done/active).
- **EntryChoice** (`EntryChoice.tsx`): Entry screen with 3 clear paths:
  1. "У меня есть файл ТЗ" — triggers DOCX/XLSX upload
  2. "Только тип товара / модель" — manual type+model entry
  3. "Готовый шаблон закупки" — template packs
  - Includes law mode switch (44-ФЗ / 223-ФЗ)
  - Auto-dismissed once user has data; "◀ Выбор способа" button returns to it
- **Procurement-friendly copy**: Russian labels use закупочная vocabulary, not developer terms. Model field explained as "only an example, won't appear in TZ".
- **Simplified toolbar**: "Добавить позицию", "Загрузить файл", "Подготовить характеристики", "Проверить ТЗ на ФАС-риски"

## AI Review Mode (Проверить и исправить ТЗ)
- **Backend**: `POST /api/review-tz` — LLM-powered review of TZ text. Accepts `{tzText, lawMode}`, returns `{issues[], summary}`.
  - Issue levels: `blocking` (FAS risks), `legal` (law inaccuracies), `technical` (logic errors)
  - Each issue has `originalText`, `suggestedText`, `autoSafe` flag
  - Fallback providers: deepseek → groq → openrouter
- **Frontend**: `TZReviewPanel` component — modal overlay with grouped issues, checkbox selection, diff view (old→new), batch apply
  - API client: `reviewTz()` in `backendApi.ts` (120s timeout)
  - Button "🔍 Проверить и исправить ТЗ" in workspace toolbar, enabled when `docxReady=true`
  - Apply fixes: replaces `originalText` with `suggestedText` in row specs, reruns compliance gate

## Centralized Compliance Engine (`legal-rules.ts`)
- **Architecture**: Centralized rule registry in `frontend-react/src/utils/legal-rules.ts`, structured by four legal pillars:
  - **БЛОК 1 — Практика ФАС** (защита конкуренции): 10 правил замены (выписки, оригиналы, свежесть ПО, НДВ, торговые марки)
  - **БЛОК 2 — ПП РФ № 1875** (национальный режим): 2 обязательных условия (реестр ПО, реестр промпродукции)
  - **БЛОК 3 — 44-ФЗ / 223-ФЗ** (описание объекта закупки): плейсхолдеры [!], твёрдая цена
- **Key exports**: `COMPLIANCE_RULES[]`, `MANDATORY_CLAUSES[]`, `applyComplianceFixes(text)`, `validateDocumentText(fullText, context)`, `getDetectionRules()`, `getAllRulesSummary()`
- **Integration points**:
  - `compliance.ts`: `FORBIDDEN_PHRASES` now sourced from `getDetectionRules()` (centralized)
  - `buildAntiFasAutoFixes()`: uses `applyComplianceFixes()` for all rule-based replacements
  - `buildDocx()`: runs `validateDocumentText()` on full document text before export, logging violations/passed checks
- **Console logging**: `[ФАС Compliance]`, `[ПП1875 Compliance]`, `[44-ФЗ Compliance]` prefixes in console
- **Template corrections applied** in `npa-blocks.ts` and `Workspace.tsx`:
  - Section 2: «Участник закупки указывает номер реестровой записи» (not «Поставщик представляет выписку»)
  - Appendix 7 year: «актуальная стабильная версия, поддерживаемая производителем» (not «не ранее 12 мес.»)
  - FSTEC crypto: «уровень доверия не ниже 4-го» (not «контроль отсутствия НДВ»)
  - Licensing: «Архитектурная возможность масштабирования» (not «Максимальный объём лицензирования»)

## Russian Morphology (Genitive Declension)
- **`morph.ts`** (`frontend-react/src/utils/morph.ts`): Rule-based Russian noun/adjective declension to genitive plural case.
  - `toGenitive(name)` — converts procurement object name from nominative to genitive plural (e.g. «ноутбук» → «ноутбуков», «системный блок» → «системных блоков»)
  - Dictionary of ~70 known IT procurement nouns with pre-computed genitive forms
  - Rule-based fallback: handles masculine (-ов/-ев/-ей), feminine (-∅/-ей/-ий), neuter (-∅/-й) endings + adjective declension (-ый→-ых, -ий→-их)
  - Applied in `getProcurementObjectName()` in `Workspace.tsx` for DOCX title page: «Техническое задание на поставку {genitive}»

## Production Security (Implemented)
- **JWT_SECRET**: Cryptographically-random 96-char hex secret set as env var (no more default fallback warning)
- **Security Headers Middleware**: `SecurityHeadersMiddleware` added after CORS middleware; sets on every response:
  - `X-Content-Type-Options: nosniff`
  - `X-Frame-Options: DENY`
  - `X-XSS-Protection: 1; mode=block`
  - `Referrer-Policy: strict-origin-when-cross-origin`
  - `Permissions-Policy: camera=(), microphone=(), geolocation=()`
- **Rate Limiting**: Slowapi with `200/minute` global default; AI endpoints `3-15/minute`; auth endpoints `5/minute`
- **File Size Limits**: All upload endpoints enforce 20-50 MB limits before reading file content
- **Global Error Handler**: All unhandled exceptions return `500` with generic Russian message (no stack traces leaked)
- **TypeScript**: 0 compilation errors (`noUnusedLocals: true`, `noUnusedParameters: true` both pass)

## QA Audit System
- **`POST /api/qa-check`**: 8 validation checks (brand_name, exact_value, emoji, meta_comment, subjective_color, no_ktru, no_warranty, no_country). Score = 100 − errors×15 − warnings×5, passed if score ≥ 80.
- **`POST /api/qa-autofix`**: Auto-fixes emoji removal, adds «не менее» to bare numeric values, simplifies subjective colours, fixes typography. Returns `auto_fixed` list and `manual_required` list for brands/meta-comments.
- **`QaAuditBlock.tsx`**: Sidecar component shown after `docxReady`, between publication readiness card and export buttons. Run check → see score ring + issue list → optionally run autofix → score updates in place.
- Integrated via `buildTzTextForReview` function from `Workspace.tsx` → passed as `buildTzText` prop through `WorkspaceSidePanels`.

## Generations History
- **Table**: `generations` (id, user_id, created_at, title, source_type, text, docx_path, qa_score, word_count)
- **Storage limits by plan**: trial=3, start=50, base=200, team/corp=unlimited. Auto-prunes oldest on overflow.
- **DOCX storage**: blobs saved to `backend/storage/generations/` as `{user_id}_{timestamp}.docx`
- **Endpoints**: `POST /api/generations` (save, auth required), `GET /api/generations?page&limit` (list, paginated), `GET /api/generations/{id}` (full), `GET /api/generations/{id}/download` (serve file or regenerate DOCX via python-docx), `DELETE /api/generations/{id}`
- **Frontend**: `HistoryPage.tsx` — cards with title, date, source_type, word_count, QA score (color-coded: ≥80 green, 60-79 amber, <60 red), Download + Delete buttons, pagination. Accessible via "📋 История" button in auth-rail for logged-in users.
- **Save hook**: After DOCX export in `Workspace.tsx/exportDocx`, auto-saves generation (title from first row model, text from `buildTzTextForReview`, DOCX as base64).

## Email Notifications
- Module: `backend/email_service.py`
- Config env vars: `SMTP_HOST`, `SMTP_PORT` (587 default), `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM`
- Optional: `APP_URL`, `PRICING_URL` for links in emails
- Templates (inline strings): `welcome`, `trial_warning`, `trial_expired`, `payment_success`, `subscription_warning`
- Port 465 → SMTP_SSL; port 587 → STARTTLS. Both supported automatically.
- All sends are fire-and-forget via daemon threads (never blocks request)
- Results logged to `email_log` table (user_id, template, sent_at, success, error)
- **Hooks**: welcome → new user registration in `auth.py`; payment_success → YooKassa webhook + admin plan-change endpoint in `main.py`
- **APScheduler** (daily 10:00 UTC): trial_warning (3 days before end), trial_expired (on expiry), subscription_warning (5 days before sub end)
- If SMTP not configured: sends are silently skipped and logged with `success=False, error="SMTP not configured"`

## DOCX Product Name Extraction (Smart Import)
- **Type flag**: `ImportedProcurementRow.nameNeedsReview?: boolean` — set when auto-extraction fails
- **`cleanProductName(raw)`** in `row-import.ts`: strips служебные слова (закупка/поставка/приобретение/расходных/материалов/в интересах/для нужд), strips plural endings (-ов/-ев/-ей)
- **`extractDocxProductName(paragraphs, blocks)`** — 4-priority search:
  1. `Наименование <слово>: <значение>` regex across all paragraphs
  2. `закупку/поставку/приобретение X` pattern with `cleanProductName()`
  3. First non-header row of spec table (before the параметр/значение header)
  4. Falls back to `{ name: 'Свой товар', needsReview: true }`
- **`parseDocxFallbackRows()`** integration:
  - Calls `extractDocxProductName` when objectName is not found by existing patterns
  - When spec table has no merged product name row, also uses the 4-priority extractor
  - Returns `{ ...specRow, nameNeedsReview: true }` when needsReview
- **`Workspace.tsx`** import mapper: propagates `item.nameNeedsReview → meta.name_needs_review: 'true'`
- **`handleRowModelChange`** in `Workspace.tsx`: clears `name_needs_review` from meta when user manually edits the model field
- **`handleSearchOkpd2ForRow(rowId, query)`** in `Workspace.tsx`: calls `searchOkpd2(query, 3)`, updates row meta `okpd2_code`/`okpd2_name`, shows toast notification
- **`WorkspaceRowsTable.tsx`** UI:
  - Model input: yellow border + yellow bg (`#fef3c7`-like) + tooltip "Уточните наименование" when `meta.name_needs_review === 'true'`; clears after user edits
  - ОКПД2 area: shows "🔍 Найти ОКПД2" inline button when ОКПД2 not set and model is non-empty; calls `onSearchOkpd2` prop (optional)

## Development Notes
- Backend API proxied via Vite dev server at `/api` → Railway backend
- `VITE_BACKEND_URL` env var controls backend target (defaults to Railway)
- `allowedHosts: true` set for Replit proxy compatibility
- Client-side API keys disabled — all AI calls routed through backend (`generateWithBackend`)
