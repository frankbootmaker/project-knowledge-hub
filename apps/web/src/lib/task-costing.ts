export type RatePerson = {
  userId: string;
  displayName: string;
  hourlyRate: number | null;
};

export function resolveRatePerson(
  currentOwnerUserId: string | null | undefined,
  raci: Array<{ userId: string; role: string }>,
  rates: Map<string, RatePerson>,
): RatePerson | null {
  const candidates = [
    currentOwnerUserId ?? null,
    raci.find((entry) => entry.role === 'R')?.userId ?? null,
    raci.find((entry) => entry.role === 'A')?.userId ?? null,
  ];
  for (const userId of candidates) {
    if (!userId) continue;
    const person = rates.get(userId);
    if (person) return person;
    return {
      userId,
      displayName: userId,
      hourlyRate: null,
    };
  }
  return null;
}

export function hoursCost(
  hours: number | null | undefined,
  hourlyRate: number | null | undefined,
): number | null {
  if (hours == null || hourlyRate == null) return null;
  if (!Number.isFinite(hours) || !Number.isFinite(hourlyRate)) return null;
  return Math.round(hours * hourlyRate * 100) / 100;
}

export function parseHoursInput(value: string | null | undefined): number | null {
  if (value == null) return null;
  const trimmed = value.trim();
  if (trimmed === '') return null;
  const n = Number(trimmed);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export function sumEffortRollup(
  tasks: Array<{
    forecastHours?: string | number | null;
    actualHours?: string | number | null;
    forecastCost?: number | null;
    actualCost?: number | null;
    status?: string;
  }>,
): {
  forecastHours: number;
  actualHours: number;
  forecastCost: number | null;
  actualCost: number | null;
} {
  let forecastHours = 0;
  let actualHours = 0;
  let forecastCost: number | null = null;
  let actualCost: number | null = null;
  for (const task of tasks) {
    if (task.status === 'cancelled') continue;
    const fh =
      typeof task.forecastHours === 'string'
        ? Number(task.forecastHours)
        : task.forecastHours;
    const ah =
      typeof task.actualHours === 'string'
        ? Number(task.actualHours)
        : task.actualHours;
    if (fh != null && Number.isFinite(fh)) forecastHours += fh;
    if (ah != null && Number.isFinite(ah)) actualHours += ah;
    if (task.forecastCost != null) {
      forecastCost = (forecastCost ?? 0) + task.forecastCost;
    }
    if (task.actualCost != null) {
      actualCost = (actualCost ?? 0) + task.actualCost;
    }
  }
  return {
    forecastHours: Math.round(forecastHours * 100) / 100,
    actualHours: Math.round(actualHours * 100) / 100,
    forecastCost:
      forecastCost == null ? null : Math.round(forecastCost * 100) / 100,
    actualCost: actualCost == null ? null : Math.round(actualCost * 100) / 100,
  };
}
