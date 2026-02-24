# TZ Generator React Frontend (Phase 1)

This folder contains the first migration layer from monolithic `index.html` to modular React + TypeScript.

## Added frameworks

- React + TypeScript + Vite
- TanStack Query (request retry/cache baseline)
- Zod + React Hook Form (strict client-side validation)
- Axios (API transport abstraction)

## Start

```bash
cd frontend-react
npm install
npm run dev
```

## Scope in this phase

- Automation settings module
- Platform integration module (EIS/ETP profile)
- Automation event log
- Learning map import/export

Legacy production app remains in `/Users/andres/Downloads/tz_generator/index.html`.
