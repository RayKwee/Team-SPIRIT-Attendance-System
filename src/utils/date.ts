export interface CalendarDayCell {
  dateKey: string;
  dayNumber: number;
  inCurrentMonth: boolean;
  isToday: boolean;
}

export interface YearMonthGroup {
  year: number;
  monthIndex: number;
  label: string;
  shortLabel: string;
  cells: CalendarDayCell[];
}

export interface JumpDateResult {
  dateKey: string;
  precision: 'day' | 'month' | 'year';
}

const MONTH_NAME_MAP: Record<string, number> = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
};

function isValidCalendarDate(year: number, monthOneBased: number, day: number): boolean {
  if (year < 1900 || year > 2199) return false;
  if (monthOneBased < 1 || monthOneBased > 12) return false;
  if (day < 1 || day > 31) return false;
  const candidate = new Date(year, monthOneBased - 1, day);
  return (
    candidate.getFullYear() === year &&
    candidate.getMonth() === monthOneBased - 1 &&
    candidate.getDate() === day
  );
}

function formatDateParts(year: number, monthOneBased: number, day: number): string {
  return `${String(year).padStart(4, '0')}-${String(monthOneBased).padStart(2, '0')}-${String(
    day,
  ).padStart(2, '0')}`;
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

/** Parses a local YYYY-MM-DD key into a Date, returning null if invalid. */
export function parseIsoDateKey(dateKey: string): Date | null {
  const parts = dateKey.split('-').map(Number);
  if (parts.length !== 3 || parts.some(Number.isNaN)) return null;
  const [year, month, day] = parts;
  if (!isValidCalendarDate(year, month, day)) return null;
  return new Date(year, month - 1, day);
}

/**
 * Parses a typed jump-to-date string.
 * By default only complete exact dates trigger immediate navigation; set `allowPartial`
 * on explicit form submission to also support month (`YYYY-MM`) and year (`YYYY`) targets.
 */
export function parseJumpDateInput(
  raw: string,
  options: { allowPartial?: boolean } = {},
): JumpDateResult | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const { allowPartial = false } = options;

  const isoPattern = allowPartial
    ? /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/
    : /^(\d{4})[-/](\d{2})[-/](\d{2})$/;
  const isoMatch = trimmed.match(isoPattern);
  if (isoMatch) {
    const year = Number(isoMatch[1]);
    const month = Number(isoMatch[2]);
    const day = Number(isoMatch[3]);
    if (!isValidCalendarDate(year, month, day)) return null;
    return { dateKey: formatDateParts(year, month, day), precision: 'day' };
  }

  const usMatch = trimmed.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
  if (usMatch) {
    const month = Number(usMatch[1]);
    const day = Number(usMatch[2]);
    const year = Number(usMatch[3]);
    if (!isValidCalendarDate(year, month, day)) return null;
    return { dateKey: formatDateParts(year, month, day), precision: 'day' };
  }

  const monthFirstText = trimmed.match(/^([A-Za-z]{3,9})\s+(\d{1,2}),?\s+(\d{4})$/);
  if (monthFirstText) {
    const month = MONTH_NAME_MAP[monthFirstText[1].toLowerCase()];
    const day = Number(monthFirstText[2]);
    const year = Number(monthFirstText[3]);
    if (!month || !isValidCalendarDate(year, month, day)) return null;
    return { dateKey: formatDateParts(year, month, day), precision: 'day' };
  }

  const dayFirstText = trimmed.match(/^(\d{1,2})\s+([A-Za-z]{3,9}),?\s+(\d{4})$/);
  if (dayFirstText) {
    const day = Number(dayFirstText[1]);
    const month = MONTH_NAME_MAP[dayFirstText[2].toLowerCase()];
    const year = Number(dayFirstText[3]);
    if (!month || !isValidCalendarDate(year, month, day)) return null;
    return { dateKey: formatDateParts(year, month, day), precision: 'day' };
  }

  if (!allowPartial) {
    return null;
  }

  const yearMonthMatch = trimmed.match(/^(\d{4})[-/](\d{1,2})$/);
  if (yearMonthMatch) {
    const year = Number(yearMonthMatch[1]);
    const month = Number(yearMonthMatch[2]);
    if (!isValidCalendarDate(year, month, 1)) return null;
    return { dateKey: formatDateParts(year, month, 1), precision: 'month' };
  }

  const monthYearText = trimmed.match(/^([A-Za-z]{3,9})\s+(\d{4})$/);
  if (monthYearText) {
    const month = MONTH_NAME_MAP[monthYearText[1].toLowerCase()];
    const year = Number(monthYearText[2]);
    if (!month || !isValidCalendarDate(year, month, 1)) return null;
    return { dateKey: formatDateParts(year, month, 1), precision: 'month' };
  }

  const yearOnlyMatch = trimmed.match(/^(\d{4})$/);
  if (yearOnlyMatch) {
    const year = Number(yearOnlyMatch[1]);
    if (!isValidCalendarDate(year, 1, 1)) return null;
    return { dateKey: formatDateParts(year, 1, 1), precision: 'year' };
  }

  return null;
}

/** Shifts a YYYY-MM-DD key by the given number of days. */
export function addDaysToDateKey(dateKey: string, deltaDays: number): string {
  const base = parseIsoDateKey(dateKey) ?? new Date();
  const next = new Date(base.getFullYear(), base.getMonth(), base.getDate() + deltaDays);
  return toIsoDateString(next);
}

/** Shifts a YYYY-MM-DD key by whole months while clamping to the target month's length. */
export function addMonthsToDateKey(dateKey: string, deltaMonths: number): string {
  const base = parseIsoDateKey(dateKey) ?? new Date();
  const targetMonthDate = new Date(base.getFullYear(), base.getMonth() + deltaMonths, 1);
  const maxDay = new Date(
    targetMonthDate.getFullYear(),
    targetMonthDate.getMonth() + 1,
    0,
  ).getDate();
  const clampedDay = Math.min(base.getDate(), maxDay);
  return toIsoDateString(
    new Date(targetMonthDate.getFullYear(), targetMonthDate.getMonth(), clampedDay),
  );
}

/** Shifts a YYYY-MM-DD key by whole years while clamping Feb 29 on non-leap years. */
export function addYearsToDateKey(dateKey: string, deltaYears: number): string {
  return addMonthsToDateKey(dateKey, deltaYears * 12);
}

/** Builds the 7-day Sunday-first week strip containing `anchorDateKey`. */
export function buildWeekDays(anchorDateKey: string): CalendarDayCell[] {
  const base = parseIsoDateKey(anchorDateKey) ?? new Date();
  const anchorMonth = base.getMonth();
  const todayKey = toIsoDateString(new Date());
  const startOfWeek = new Date(base.getFullYear(), base.getMonth(), base.getDate() - base.getDay());

  const days: CalendarDayCell[] = [];
  for (let offset = 0; offset < 7; offset += 1) {
    const current = new Date(
      startOfWeek.getFullYear(),
      startOfWeek.getMonth(),
      startOfWeek.getDate() + offset,
    );
    const dateKey = toIsoDateString(current);
    days.push({
      dateKey,
      dayNumber: current.getDate(),
      inCurrentMonth: current.getMonth() === anchorMonth,
      isToday: dateKey === todayKey,
    });
  }
  return days;
}

/** Formats a readable date range label for a 7-day week array. */
export function formatWeekRangeLabel(weekDays: CalendarDayCell[]): string {
  if (weekDays.length === 0) return '';
  const startDate = parseIsoDateKey(weekDays[0].dateKey);
  const endDate = parseIsoDateKey(weekDays[weekDays.length - 1].dateKey);
  if (!startDate || !endDate) return '';

  const sameYear = startDate.getFullYear() === endDate.getFullYear();
  const sameMonth = sameYear && startDate.getMonth() === endDate.getMonth();

  if (sameMonth) {
    const monthStr = new Intl.DateTimeFormat('en-US', { month: 'short' }).format(startDate);
    return `${monthStr} ${startDate.getDate()} – ${endDate.getDate()}, ${endDate.getFullYear()}`;
  }

  if (sameYear) {
    const fmt = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' });
    return `${fmt.format(startDate)} – ${fmt.format(endDate)}, ${endDate.getFullYear()}`;
  }

  const fullFmt = new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
  return `${fullFmt.format(startDate)} – ${fullFmt.format(endDate)}`;
}

/** Formats a compact month/day label such as "Nov 18". */
export function formatShortMonthDay(dateKey: string): string {
  const parsed = parseIsoDateKey(dateKey);
  if (!parsed) return dateKey;
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(parsed);
}

/** Builds all 12 monthly grids for the Year overview. */
export function buildYearMonths(year: number): YearMonthGroup[] {
  const fullMonthFmt = new Intl.DateTimeFormat('en-US', { month: 'long' });
  const shortMonthFmt = new Intl.DateTimeFormat('en-US', { month: 'short' });

  return Array.from({ length: 12 }, (_, monthIndex) => {
    const refDate = new Date(year, monthIndex, 1);
    return {
      year,
      monthIndex,
      label: fullMonthFmt.format(refDate),
      shortLabel: shortMonthFmt.format(refDate),
      cells: buildMonthGrid(year, monthIndex),
    };
  });
}
