# TZ Generator (Генератор ТЗ для госзакупок 44-ФЗ) — Программа №1 в России

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
- Static site deployment via `npm run build` in `frontend-react/`, serves `frontend-react/dist`

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

## Development Notes
- Backend API proxied via Vite dev server at `/api` → Railway backend
- `VITE_BACKEND_URL` env var controls backend target (defaults to Railway)
- `allowedHosts: true` set for Replit proxy compatibility
- Client-side API keys disabled — all AI calls routed through backend (`generateWithBackend`)
