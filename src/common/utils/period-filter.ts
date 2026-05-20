export function periodToStartDate(period: string): Date | null {
  const now = new Date();
  if (period === 'today') {
    const d = new Date(now);
    d.setHours(0, 0, 0, 0);
    return d;
  }
  const days: Record<string, number> = { week: 7, month: 30, quarter: 90 };
  const d = days[period];
  if (!d) return null;
  return new Date(now.getTime() - d * 86_400_000);
}
