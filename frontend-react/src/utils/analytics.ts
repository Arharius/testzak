declare global {
  interface Window {
    ym?: (counterId: number, action: string, goal?: string, params?: Record<string, unknown>) => void;
    YM_COUNTER_ID?: number;
  }
}

export function trackGoal(goalName: string, params: Record<string, unknown> = {}): void {
  try {
    const id = window.YM_COUNTER_ID;
    if (id && typeof window.ym === 'function') {
      window.ym(id, 'reachGoal', goalName, params);
    }
  } catch {
  }
}
