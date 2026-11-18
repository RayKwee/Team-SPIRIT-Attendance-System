export interface CalendarDayCell {
  dateKey: string;
  dayNumber: number;
  inCurrentMonth: boolean;
  isToday: boolean;
}

/** Returns a formatted uppercase header label for today's date. */
export function getCurrentPeriodLabel(): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
    .format(new Date())
    .toUpperCase();
}

/** Formats a Date instance into a local YYYY-MM-DD key. */
export function toIsoDateString(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** Formats a YYYY-MM-DD session date for human-readable display. */
export function formatSessionDate(dateStr: string): string {
  const parts = dateStr.split('-').map(Number);
  if (parts.length !== 3 || parts.some(Number.isNaN)) return dateStr;
  const [year, month, day] = parts;
  const parsed = new Date(year, month - 1, day);
  if (Number.isNaN(parsed.getTime())) return dateStr;
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(parsed);
}

/** Formats a 24-hour HH:MM string into localized 12-hour/short time. */
export function formatSessionTime(timeStr: string): string {
  const [hoursStr, minutesStr] = timeStr.split(':');
  const hours = Number(hoursStr);
  const minutes = Number(minutesStr);
  if (Number.isNaN(hours) || Number.isNaN(minutes)) return timeStr;
  const date = new Date();
  date.setHours(hours, minutes, 0, 0);
  return new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

/** Formats an ISO timestamp string for roster update metadata. */
export function formatTimestamp(isoString: string | undefined): string {
  if (!isoString) return 'Not marked yet';
  const parsed = new Date(isoString);
  if (Number.isNaN(parsed.getTime())) return '—';
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(parsed);
}

/** Formats a month/year header such as "November 2026". */
export function formatMonthYearLabel(year: number, monthIndex: number): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'long',
    year: 'numeric',
  }).format(new Date(year, monthIndex, 1));
}

/** Builds a Sunday-first monthly calendar grid padded to full 7-day weeks. */
export function buildMonthGrid(year: number, monthIndex: number): CalendarDayCell[] {
  const todayKey = toIsoDateString(new Date());
  const firstDayOfMonth = new Date(year, monthIndex, 1);
  const startWeekday = firstDayOfMonth.getDay();
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
  const totalCells = Math.ceil((startWeekday + daysInMonth) / 7) * 7;

  const cells: CalendarDayCell[] = [];
  for (let index = 0; index < totalCells; index += 1) {
    const cellDate = new Date(year, monthIndex, 1 - startWeekday + index);
    const dateKey = toIsoDateString(cellDate);
    cells.push({
      dateKey,
      dayNumber: cellDate.getDate(),
      inCurrentMonth: cellDate.getMonth() === monthIndex && cellDate.getFullYear() === year,
      isToday: dateKey === todayKey,
    });
  }

  return cells;
}
