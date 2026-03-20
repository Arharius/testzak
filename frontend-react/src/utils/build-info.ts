const FALLBACK_BUILD_LABEL = '2026.03.20.1';

function normalizeBuildToken(value: string | undefined): string {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

export const APP_BUILD_LABEL = normalizeBuildToken(import.meta.env.VITE_APP_BUILD) || FALLBACK_BUILD_LABEL;
export const APP_BUILD_COMMIT = normalizeBuildToken(import.meta.env.VITE_APP_COMMIT);
export const APP_BUILD_META = APP_BUILD_COMMIT
  ? `${APP_BUILD_LABEL} · ${APP_BUILD_COMMIT.slice(0, 7)}`
  : APP_BUILD_LABEL;
