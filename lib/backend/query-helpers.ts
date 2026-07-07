export function relationName(value: unknown) {
  if (Array.isArray(value)) return value[0]?.name ?? "";
  if (value && typeof value === "object" && "name" in value) return String(value.name);
  return "";
}

export function relationDisplayName(value: unknown) {
  if (Array.isArray(value)) return value[0]?.display_name ?? "";
  if (value && typeof value === "object" && "display_name" in value) {
    return String(value.display_name);
  }
  return "";
}

export function monthRange(month: string) {
  const [year, monthIndex] = month.split("-").map(Number);
  const start = new Date(Date.UTC(year, monthIndex - 1, 1));
  const end = new Date(Date.UTC(year, monthIndex, 1));

  return [start.toISOString().slice(0, 10), end.toISOString().slice(0, 10)] as const;
}

export function previousMonth(month: string) {
  const [year, monthIndex] = month.split("-").map(Number);
  const previous = new Date(Date.UTC(year, monthIndex - 2, 1));

  return previous.toISOString().slice(0, 7);
}

export function taipeiDate(timestamp: string) {
  return new Date(timestamp).toLocaleDateString("en-CA", { timeZone: "Asia/Taipei" });
}

export function taipeiDayStart(date: string) {
  return `${date}T00:00:00+08:00`;
}

export function nextDay(date: string) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + 1);

  return value.toISOString().slice(0, 10);
}

export function timeToMinutes(time: string) {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

export function shiftDurationHours(startsAt: string, endsAt: string) {
  const start = timeToMinutes(startsAt);
  const end = timeToMinutes(endsAt);
  const duration = end >= start ? end - start : end + 24 * 60 - start;

  return duration / 60;
}

export function roundCurrency(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
