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
- **Top Navigation** (`App.tsx`): Fixed top nav bar replacing auth-rail + theme-rail. Logo left, nav links center (Создать ТЗ / Мои ТЗ / Тарифы), user menu right (details/summary dropdown with email, AI-provider, theme toggle, logout).
- **Light Theme Default**: `contrast` theme is now the default. Theme toggle moved into user menu (not visible in top-level UI). `sapphire` dark theme still supported.
- **Hero Simplification**: "Техническое задание за 3 минуты" H1. Simple description without technical jargon. Proof chips: Импорт DOCX/XLSX, Проверка конкуренции, Проверка характеристик, Готовый документ. CTA button "Попробовать бесплатно →" for guests.
- **Feature Cards**: "Проверка конкуренции" (was "Двойной эквивалент"), "Проверка характеристик" (was "Web-Truth"), "Готовый документ" (was "ГОСТ-совместимый DOCX").
- **How-It-Works**: Steps renamed to user-friendly Russian without technical terms (ДЭ-алгоритм → Проверяем соответствие 44-ФЗ, ГОСТ DOCX → Скачайте готовый DOCX).
- **Smart Toolbar** (`Workspace.tsx`): `uiPhase` ('empty'|'working'|'ready') controls button visibility. Generate button label → "▶ Сгенерировать ТЗ". Internet search + EIS buttons hidden when phase=ready. Начать заново shown only when phase=ready or working.
- **Onboarding Modal** (`OnboardingModal.tsx`): 3-step modal on first login (if orgName + customerInn empty). Step 1: org name + INN. Step 2: delivery address + signatory. Step 3: success + CTA. Saves to platformSettings. Marks done via `tz_onboarding_done` localStorage key.
- **ProcessStepper** (`ProcessStepper.tsx`): Visual 4-step process indicator — Исходные данные → Характеристики → ТЗ → Проверка. Steps auto-update based on workspace state (done/active).
- **EntryChoice** (`EntryChoice.tsx`): Entry screen with 3 clear paths:
  1. "У меня есть файл ТЗ" — triggers DOCX/XLSX upload
  2. "Только тип товара / модель" — manual type+model entry
  3. "Готовый шаблон закупки" — template packs
  - Includes law mode switch (44-ФЗ / 223-ФЗ)
  - Auto-dismissed once user has data
- **Procurement-friendly copy**: Russian labels use закупочная vocabulary, not developer terms.

## 12-Test EIS Validation System (Проверка перед ЕИС)
- **Backend**: `backend/tz_validator.py` — полноценный валидатор ТЗ по 12 тестам
  - TEST-01: Мета-комментарии ([!], TODO, FIXME, [Требуется уточнить])
  - TEST-02: Запрещённые формулировки 44-ФЗ ст. 33 (по требованиям заказчика, уточняется при поставке и т.д.)
  - TEST-03: Товарные знаки без «или эквивалент» (словарь 35+ брендов, исключения для стандартов)
  - TEST-04: Неизмеримые характеристики (не прошедшие VALID_PATTERNS)
  - TEST-05: Дублирующиеся характеристики (нормализованное сравнение имён)
  - TEST-06: Логические конфликты (TDP vs БП, диагональ vs разрешение, отклик vs матрица)
  - TEST-07: Корректность количеств (qty > 0, единицы измерения)
  - TEST-08: Нормативная база (устаревшие ПП №878/616/925, обязательные ссылки для ТОВАР/УСЛУГА/ПО)
  - TEST-09: Структура документа (7 обязательных разделов + приложения)
  - TEST-10: Класс энергоэффективности (мониторы, ПК, принтеры, ИБП)
  - TEST-11: Ограничение конкуренции ФАС (RAM > 64 ГБ, SSD > 2 ТБ для офисного ПК, монитор > 32")
  - TEST-12: Читаемость DOCX (корректность файла, кодировка, размер, шрифт)
- **Backend endpoint**: `POST /api/tz/validate/full` → `FullValidationResultOut`
- **Frontend**: `FullValidationPanel.tsx` — тёмная модальная панель с перечнем 12 тестов
  - Статусы: ✅ ПРОЙДЕН / ❌ ОШИБКА / ⚠️ ПРЕДУПРЕЖДЕНИЕ / ⏭️ ПРОПУЩЕН
  - Счётчик прошедших тестов, ошибок, предупреждений
  - Раскрываемые детали каждого теста с полем и контекстом
  - Кнопки: «Исправить автоматически», «Скачать DOCX», «Скачать всё равно ⚠️»
  - Красный баннер при force-download: предупреждение о возможном отклонении ЕИС/ФАС
- **Уровень 3 — Авто-исправление** (`POST /api/tz/auto-fix`):
  - Детерминированные фиксы: TEST-01 (удалить мета), TEST-02 (удалить запрещённые), TEST-03 (добавить «или эквивалент»), TEST-05 (дедуплицировать)
  - LLM-фикс для TEST-04 (неизмеримые характеристики): вызывает AI, получает измеримую формулировку
  - Возвращает `{rows, fix_report[{test_id, field, action, before, after}], validation}`
  - Фронтенд: цикл до 3 итераций (`runAutoFix`), обновляет `rows` state и показывает прогресс
  - `FixReportPanel` в модале: зелёный блок с перечнем всех исправлений после итерации
  - Кнопка меняется: «Исправить автоматически» → «Повторить исправление (2/3)» → «Все 3 итерации выполнены»
- **Уровень 4 — Сценарные тесты** (`GET /api/tz/scenario-test/{id}`, тесты A–F):
  - A: Базовый товар (системный блок) — 7 проверок
  - B: Восстановление количеств — 3 проверки
  - C: Услуга (нет ПП №1875/719 для услуг) — 4 проверки
  - D: ПО (Kaspersky с эквивалентом, ПП №1236) — 4 проверки
  - E: Стрессовый 10 позиций — 4 проверки
  - F: ФАС-риск MacBook Pro — 3 проверки
  - Все 6 тестов пройдены: 25/25 проверок ✅
- **Batch search toolbar**: кнопки «🌐 Интернет» и «🏛️ ЕИС / КТРУ» появляются когда хотя бы одна строка заполнена
- **Mobile responsiveness**: медиа-запросы 640px и 480px для тулбаров, кнопок, модалей

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
- **`POST /api/qa-check`**: 9 validation checks: brand_name, exact_value, emoji, meta_comment, subjective_color, no_ktru, no_warranty, no_country, **old_law** (ПП №878/616/925 = -15 penalty). Score = 100 − errors×15 − warnings×5, passed if score ≥ 80.
- **`POST /api/qa-autofix`**: Auto-fixes emoji removal, adds «не менее» to bare numeric values, simplifies subjective colours, fixes typography. Returns `auto_fixed` list and `manual_required` list for brands/meta-comments.
- **`QaAuditBlock.tsx`**: Sidecar component shown after `docxReady`. Supports `autoRunKey` prop — when incremented, auto-runs the check without user interaction.
- **Auto-run after generation**: `Workspace.tsx` increments `qaAutoRunKey` after generation completes (`doneRows.length > 0`) → QA check runs automatically.
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

## Admin Users Management Page
- **`GET /api/admin/users`**: Lists all users, supports `?search=email&plan=trial` filters. Returns up to 500 users ordered by creation date. Admin role required.
- **`PATCH /api/admin/users/{user_id}/plan`**: Sets user plan + subscription_until. Handles all plans including `pilot` (always 90 days). Returns full user dict via `_user_to_admin_dict()`. Sends email notification on non-trial plan change.
- **`AdminUsersPage.tsx`**: Full admin table at `/admin` route (accessible via ⚙️ Администрирование in user dropdown, admin-only).
  - Search bar with 400ms debounce + plan filter dropdown
  - Table: Email, Тариф (color-coded), Активен до, Зарегистрирован, Последний вход, Действия
  - Plan badge colors: trial=серый, pilot=фиолетовый, start=зелёный, base=синий, team=оранжевый, corp=золотой
  - [Тариф ▾] dropdown → 6 options (Пилот 90 дней bold, Старт/Базовый/Команда/Корп 1 мес, Сбросить в триал)
  - Confirm modal: shows plan name, user email, computed expiry date before applying
  - Row highlights green on successful plan change (2s flash), updates in-place without reload
  - Dark theme (sapphire) fully supported
- **Duplicate PATCH removed**: Cleaned up duplicate `/api/admin/users/{user_id}/plan` endpoint that was added at end of main.py

## Team Management & Pilot Plan (Block 8+9)
- **`pilot` plan**: Added to `PLAN_TZ_LIMITS` (unlimited ТЗ, 90 days). `TEAM_MEMBER_LIMITS` exported from `auth.py` (team/pilot=5, corp=None).
- **`org_id`** and **`org_role`** fields added to `User` model (auto-migrated).
- **`trial_started_at`** field added to `User` model (auto-migrated).
- **`POST /api/team/invite`**: Owner (team/pilot/corp/admin plan) can invite users by email. Checks member limits, creates user if not exists, sets org_id/org_role.
- **`GET /api/team/members`**: Returns list of all members in the owner's organization.
- **`DELETE /api/team/members/{user_id}`**: Removes a member from the organization.
- **`PATCH /api/admin/users/{user_id}/plan`**: Admin sets a user's plan (trial/start/base/team/pilot/corp/admin) with optional duration override.
- **Pilot Feedback**: `PilotFeedback` table (id, user_id, created_at, answers JSON).
  - **`POST /api/pilot/feedback`**: Submit feedback (auth required).
  - **`GET /api/admin/pilot-feedback`**: Admin view of all submissions.
  - **`PilotFeedbackModal.tsx`**: 5-question form (scale, text, choice). Auto-shows for pilot users every 14 days (biweekly).

## Error Logging (Block 12)
- **`ErrorLog` table**: (id, timestamp, user_id, endpoint, error_type, message, traceback). Auto-created.
- **Global exception handler updated**: All 500 errors now logged to `error_log` table in addition to logger.
- **YooKassa IP whitelist**: Webhook at `POST /api/payment/webhook` validates `X-Forwarded-For`/client IP against official YooKassa CIDR ranges (185.71.76.0/27, 185.71.77.0/27, 77.75.153.0/25, /32 hosts). Override with `YOOKASSA_IP_CHECK=0` env var for testing.
- **DOCX upload MIME validation**: `POST /api/parse-docx` validates content-type and enforces 10MB max (was 50MB).

## Payment Success Page (Block 11)
- **`PaymentSuccessPage.tsx`**: Full-page success screen with ✅ icon, activation confirmation, and "Перейти в рабочую область" button.
- **Route**: `/payment/success` — handled in `App.tsx` via `currentPage === 'payment-success'` state with URL sync.

## Product Name Singularization (Block 1.2)
- **`toNominativeSingular(name)`** added to `morph.ts`: Reverses genitive plural → nominative singular using `SINGULAR_DICT` (reverse of `GENITIVE_DICT`) plus regex rules for common Russian endings (-ов→∅, -ей→ь, -ев→∅, -ий→ие).
- Applied in `makeImportedRow()` in `row-import.ts` to normalize `rawType` (e.g. мониторов→монитор, клавиатуры→клавиатура).

## Development Notes
- Backend API proxied via Vite dev server at `/api` → Railway backend
- `VITE_BACKEND_URL` env var controls backend target (defaults to Railway)
- `allowedHosts: true` set for Replit proxy compatibility
- Client-side API keys disabled — all AI calls routed through backend (`generateWithBackend`)
