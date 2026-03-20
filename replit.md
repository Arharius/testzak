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

## Development Notes
- Backend API proxied via Vite dev server at `/api` → Railway backend
- `VITE_BACKEND_URL` env var controls backend target (defaults to Railway)
- `allowedHosts: true` set for Replit proxy compatibility
- Client-side API keys disabled — all AI calls routed through backend (`generateWithBackend`)
