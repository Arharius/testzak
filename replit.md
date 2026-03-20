# TZ Generator (Генератор ТЗ для госзакупок 44-ФЗ)

## Project Overview
A specialized tool for Russian government procurement officials to generate technical specifications (Terms of Reference / Техническое задание) for IT equipment and software. Targets Federal Law 44-FZ and 223-FZ compliance.

Uses AI (Groq, OpenRouter, DeepSeek) to generate technical characteristics based on a product model and ~81 predefined categories. Handles legal requirements (National Regime, PP878, PP1236, PP616) and exports to DOCX and PDF.

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

## Development Notes
- Backend API proxied via Vite dev server at `/api` → Railway backend
- `VITE_BACKEND_URL` env var controls backend target (defaults to Railway)
- `allowedHosts: true` set for Replit proxy compatibility
