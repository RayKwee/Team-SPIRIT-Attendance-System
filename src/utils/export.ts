import type { AttendanceSession, ClubMember } from '../types/attendance';
import {
  MEMBER_TYPE_LABELS,
  STATUS_LABELS,
  getSessionAssignedMembers,
  isLegacyMember,
  normalizeMemberType,
  sortSessionsNewestFirst,
  summarizeMemberAttendance,
  summarizeSessionAttendance,
  type MemberAttendanceStats,
} from './attendance';
import { formatSessionDate, formatSessionTime, formatTimestamp, toIsoDateString } from './date';

const FORMULA_PREFIX_RE = /^[=+\-@\t\r]/;

function sanitizeSpreadsheetCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  const text = String(value);
  if (!text) return '';
  // Prevent spreadsheet formula execution when opened in Excel or Google Sheets.
  return FORMULA_PREFIX_RE.test(text) ? `'${text}` : text;
}

function escapeCsvCell(value: string | number | null | undefined): string {
  const safe = sanitizeSpreadsheetCell(value);
  if (/[",\r\n]/.test(safe)) {
    return `"${safe.replace(/"/g, '""')}"`;
  }
  return safe;
}

function toCsvContent(rows: (string | number | null | undefined)[][]): string {
  return rows.map((row) => row.map(escapeCsvCell).join(',')).join('\r\n');
}

function slugifyFilename(value: string): string {
  const cleaned = value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return cleaned || 'report';
}

function downloadCsv(filename: string, rows: (string | number | null | undefined)[][]): void {
  const csv = `\uFEFF${toCsvContent(rows)}`;
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  window.setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 1000);
}

function escapeHtml(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

interface PrintSummaryStat {
  label: string;
  value: string;
}

function openPrintableDocument(options: {
  title: string;
  subtitle: string;
  metaLines: string[];
  stats: PrintSummaryStat[];
  headers: string[];
  rows: string[][];
  emptyMessage: string;
}): void {
  const generatedLabel = new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date());

  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>${escapeHtml(options.title)}</title>
    <style>
      * { box-sizing: border-box; }
      body {
        margin: 0;
        padding: 28px 32px;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        color: #0f172a;
        background: #ffffff;
        font-size: 12px;
        line-height: 1.45;
      }
      .report-header {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        gap: 16px;
        padding-bottom: 14px;
        border-bottom: 2px solid #0f172a;
        margin-bottom: 16px;
      }
      .report-brand {
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: #475569;
        margin-bottom: 4px;
      }
      h1 {
        margin: 0 0 4px;
        font-size: 20px;
        line-height: 1.2;
        color: #0f172a;
      }
      .report-subtitle {
        margin: 0;
        color: #475569;
        font-size: 12px;
      }
      .report-meta {
        text-align: right;
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        font-size: 11px;
        color: #475569;
      }
      .report-meta div + div {
        margin-top: 2px;
      }
      .stats-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(110px, 1fr));
        gap: 10px;
        margin-bottom: 18px;
      }
      .stat-box {
        padding: 10px 12px;
        border: 1px solid #cbd5e1;
        border-radius: 3px;
        background: #f8fafc;
      }
      .stat-label {
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        font-size: 10px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: #64748b;
      }
      .stat-value {
        margin-top: 4px;
        font-size: 16px;
        font-weight: 700;
        color: #0f172a;
      }
      table {
        width: 100%;
        border-collapse: collapse;
        margin-top: 4px;
      }
      th, td {
        padding: 7px 9px;
        border: 1px solid #cbd5e1;
        text-align: left;
        vertical-align: top;
      }
      th {
        background: #f1f5f9;
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        font-size: 10px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: #334155;
      }
      tr:nth-child(even) td {
        background: #f8fafc;
      }
      .empty-note {
        padding: 16px;
        border: 1px dashed #cbd5e1;
        color: #64748b;
        text-align: center;
      }
      @media print {
        body { padding: 0; }
        tr { break-inside: avoid; }
      }
    </style>
  </head>
  <body>
    <header class="report-header">
      <div>
        <div class="report-brand">Team SPIRIT Attendance System</div>
        <h1>${escapeHtml(options.title)}</h1>
        <p class="report-subtitle">${escapeHtml(options.subtitle)}</p>
      </div>
      <div class="report-meta">
        ${options.metaLines.map((line) => `<div>${escapeHtml(line)}</div>`).join('')}
        <div>Generated: ${escapeHtml(generatedLabel)}</div>
      </div>
    </header>

    <section class="stats-grid">
      ${options.stats
        .map(
          (stat) =>
            `<div class="stat-box"><div class="stat-label">${escapeHtml(stat.label)}</div><div class="stat-value">${escapeHtml(stat.value)}</div></div>`,
        )
        .join('')}
    </section>

    ${
      options.rows.length === 0
        ? `<div class="empty-note">${escapeHtml(options.emptyMessage)}</div>`
        : `<table>
      <thead>
        <tr>${options.headers.map((h) => `<th>${escapeHtml(h)}</th>`).join('')}</tr>
      </thead>
      <tbody>
        ${options.rows
          .map(
            (row) =>
              `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join('')}</tr>`,
          )
          .join('')}
      </tbody>
    </table>`
    }
  </body>
</html>`;

  const iframe = document.createElement('iframe');
  iframe.style.position = 'fixed';
  iframe.style.right = '0';
  iframe.style.bottom = '0';
  iframe.style.width = '0';
  iframe.style.height = '0';
  iframe.style.border = '0';
  iframe.setAttribute('aria-hidden', 'true');
  document.body.appendChild(iframe);

  let cleanedUp = false;
  let fallbackTimer: number | null = null;
  const removeIframe = () => {
    if (cleanedUp) return;
    cleanedUp = true;
    if (fallbackTimer !== null) {
      window.clearTimeout(fallbackTimer);
      fallbackTimer = null;
    }
    if (iframe.parentNode) {
      iframe.parentNode.removeChild(iframe);
    }
  };

  const doc = iframe.contentDocument ?? iframe.contentWindow?.document;
  const frameWindow = iframe.contentWindow;
  if (!doc || !frameWindow) {
    removeIframe();
    return;
  }

  doc.open();
  doc.write(html);
  doc.close();

  const triggerPrint = () => {
    try {
      frameWindow.addEventListener('afterprint', removeIframe, { once: true });
      fallbackTimer = window.setTimeout(removeIframe, 60_000);
      frameWindow.focus();
      frameWindow.print();
    } catch {
      removeIframe();
    }
  };

  window.setTimeout(triggerPrint, 60);
}

/** Downloads a CSV spreadsheet for a single session's attendance checklist. */
export function exportSessionAttendanceCsv(
  session: AttendanceSession,
  members: ClubMember[],
): void {
  const assignedMembers = getSessionAssignedMembers(session, members);
  const summary = summarizeSessionAttendance(session, members);

  const rows: (string | number | null | undefined)[][] = [
    ['Session', session.name],
    ['Date', formatSessionDate(session.date)],
    ['Time', formatSessionTime(session.time)],
    ['Location', session.location ?? ''],
    ['Event Type', session.eventType ?? ''],
    [
      'Summary',
      `${summary.presentCount}/${summary.totalMembers} Present (${summary.rate !== null ? `${summary.rate}%` : '--%'})`,
    ],
    [],
    [
      'Member Name',
      'Type',
      'Class',
      'Role',
      'Status',
      'Absence Reason',
      'Last Updated',
      'Email',
      'Phone',
      'Handle',
    ],
  ];

  for (const member of assignedMembers) {
    const memberType = normalizeMemberType(member.memberType);
    const entry = session.attendance[member.id];
    const status = entry?.status ?? 'unmarked';
    rows.push([
      member.name,
      MEMBER_TYPE_LABELS[memberType],
      member.className ?? '',
      member.role ?? '',
      STATUS_LABELS[status],
      status === 'absent_with_reason' ? (entry?.reason ?? '') : '',
      entry?.updatedAt ? formatTimestamp(entry.updatedAt) : 'Not marked yet',
      member.email ?? '',
      member.phone ?? '',
      member.handle ?? '',
    ]);
  }

  const filename = `team-spirit-${slugifyFilename(session.name)}-${session.date}.csv`;
  downloadCsv(filename, rows);
}

/** Opens a formatted print / Save-as-PDF report for a single session's attendance checklist. */
export function printSessionAttendanceReport(
  session: AttendanceSession,
  members: ClubMember[],
): void {
  const assignedMembers = getSessionAssignedMembers(session, members);
  const summary = summarizeSessionAttendance(session, members);

  const metaLines = [
    `Date: ${formatSessionDate(session.date)}`,
    `Time: ${formatSessionTime(session.time)}`,
  ];
  if (session.location) metaLines.push(`Location: ${session.location}`);
  if (session.eventType) metaLines.push(`Type: ${session.eventType}`);

  const rows = assignedMembers.map((member, index) => {
    const memberType = normalizeMemberType(member.memberType);
    const entry = session.attendance[member.id];
    const status = entry?.status ?? 'unmarked';
    return [
      String(index + 1),
      member.name,
      memberType === 'student'
        ? member.className || 'Student'
        : member.className
          ? `${MEMBER_TYPE_LABELS[memberType]} (${member.className})`
          : MEMBER_TYPE_LABELS[memberType],
      member.role || '—',
      STATUS_LABELS[status],
      status === 'absent_with_reason' ? entry?.reason || '—' : '—',
      entry?.updatedAt ? formatTimestamp(entry.updatedAt) : 'Not marked',
    ];
  });

  openPrintableDocument({
    title: session.name,
    subtitle: session.description || 'Session Attendance Report',
    metaLines,
    stats: [
      { label: 'Assigned', value: String(summary.totalMembers) },
      { label: 'Present', value: String(summary.presentCount) },
      { label: 'Excused', value: String(summary.absentWithReasonCount) },
      { label: 'Unexcused', value: String(summary.absentWithoutReasonCount) },
      { label: 'Unmarked', value: String(summary.unmarkedCount) },
      { label: 'Rate', value: summary.rate !== null ? `${summary.rate}%` : '--%' },
    ],
    headers: ['#', 'Member', 'Class / Type', 'Role', 'Status', 'Reason', 'Updated'],
    rows,
    emptyMessage: 'No members are currently assigned to this session.',
  });
}

/** Downloads a CSV spreadsheet of the Member Manager directory and per-member attendance stats. */
export function exportMemberDirectoryCsv(
  members: ClubMember[],
  statsMap: Map<string, MemberAttendanceStats>,
  sessions: AttendanceSession[],
  scopeSlug = 'members',
): void {
  const rows: (string | number | null | undefined)[][] = [
    [
      'Name',
      'Roster Status',
      'Graduation Year',
      'Type',
      'Class',
      'Role',
      'Sessions Assigned',
      'Present',
      'Absent w/ Reason',
      'Absent w/o Reason',
      'Unmarked',
      'Overall Rate (%)',
      'Marked Rate (%)',
      'Email',
      'Phone',
      'Handle',
      'Joined Date',
    ],
  ];

  for (const member of members) {
    const memberType = normalizeMemberType(member.memberType);
    const stats = statsMap.get(member.id) ?? summarizeMemberAttendance(member.id, sessions);
    const legacyStatus = isLegacyMember(member)
      ? member.graduationYear
        ? `Graduated ${member.graduationYear}`
        : 'Legacy / Retired'
      : 'Active';
    rows.push([
      member.name,
      legacyStatus,
      isLegacyMember(member) && member.graduationYear ? member.graduationYear : '',
      MEMBER_TYPE_LABELS[memberType],
      member.className ?? '',
      member.role ?? '',
      stats.totalSessions,
      stats.presentCount,
      stats.absentWithReasonCount,
      stats.absentWithoutReasonCount,
      stats.unmarkedCount,
      stats.overallRate !== null ? stats.overallRate : '',
      stats.markedRate !== null ? stats.markedRate : '',
      member.email ?? '',
      member.phone ?? '',
      member.handle ?? '',
      member.joinedDate ?? '',
    ]);
  }

  const filename = `team-spirit-${slugifyFilename(scopeSlug)}-${toIsoDateString(new Date())}.csv`;
  downloadCsv(filename, rows);
}

/** Opens a formatted print / Save-as-PDF report for the Member Manager directory and stats. */
export function printMemberDirectoryReport(
  members: ClubMember[],
  statsMap: Map<string, MemberAttendanceStats>,
  sessions: AttendanceSession[],
  filterDescription?: string,
): void {
  let totalPresent = 0;
  let totalAssignments = 0;

  const rows = members.map((member, index) => {
    const memberType = normalizeMemberType(member.memberType);
    const stats = statsMap.get(member.id) ?? summarizeMemberAttendance(member.id, sessions);
    totalPresent += stats.presentCount;
    totalAssignments += stats.totalSessions;
    const typeOrClass =
      memberType === 'student'
        ? member.className || 'Student'
        : member.className
          ? `${MEMBER_TYPE_LABELS[memberType]} (${member.className})`
          : MEMBER_TYPE_LABELS[memberType];

    return [
      String(index + 1),
      member.name,
      isLegacyMember(member)
        ? member.graduationYear
          ? `Graduated ${member.graduationYear}`
          : 'Legacy'
        : 'Active',
      typeOrClass,
      member.role || '—',
      String(stats.totalSessions),
      String(stats.presentCount),
      String(stats.absentWithReasonCount),
      String(stats.absentWithoutReasonCount),
      stats.overallRate !== null ? `${stats.overallRate}%` : '--%',
    ];
  });

  const aggregateRate =
    totalAssignments > 0 ? `${Math.round((totalPresent / totalAssignments) * 100)}%` : '--%';

  openPrintableDocument({
    title: 'Member Directory & Attendance Summary',
    subtitle: filterDescription || 'Club Roster & Cumulative Attendance Statistics',
    metaLines: [`Members Shown: ${members.length}`, `Recorded Sessions: ${sessions.length}`],
    stats: [
      { label: 'Members', value: String(members.length) },
      { label: 'Sessions', value: String(sessions.length) },
      { label: 'Total Assignments', value: String(totalAssignments) },
      { label: 'Total Present', value: String(totalPresent) },
      { label: 'Avg Overall Rate', value: aggregateRate },
    ],
    headers: [
      '#',
      'Name',
      'Status',
      'Class / Type',
      'Role',
      'Sessions',
      'Present',
      'Excused',
      'Unexcused',
      'Rate',
    ],
    rows,
    emptyMessage: 'No club members match the current directory filter.',
  });
}

/** Downloads a CSV report of an individual member's attendance stats and session history. */
export function exportMemberProfileCsv(
  member: ClubMember,
  stats: MemberAttendanceStats,
  sessions: AttendanceSession[],
): void {
  const memberType = normalizeMemberType(member.memberType);
  const assignedSessions = sortSessionsNewestFirst(sessions).filter(
    (session) => session.memberIds.includes(member.id) || Boolean(session.attendance[member.id]),
  );

  const rows: (string | number | null | undefined)[][] = [
    ['Member Name', member.name],
    [
      'Roster Status',
      isLegacyMember(member)
        ? member.graduationYear
          ? `Graduated ${member.graduationYear}`
          : 'Legacy / Retired'
        : 'Active',
    ],
    ...(isLegacyMember(member) && member.graduationYear
      ? [['Graduation Year', member.graduationYear]]
      : []),
    ['Type', MEMBER_TYPE_LABELS[memberType]],
    ['Class', member.className ?? ''],
    ['Role', member.role ?? ''],
    ['Email', member.email ?? ''],
    ['Phone', member.phone ?? ''],
    ['Handle', member.handle ?? ''],
    ['Overall Rate', stats.overallRate !== null ? `${stats.overallRate}%` : '--%'],
    ['Marked Rate', stats.markedRate !== null ? `${stats.markedRate}%` : '--%'],
    [],
    ['Date', 'Time', 'Session', 'Event Type', 'Location', 'Status', 'Absence Reason', 'Updated'],
  ];

  for (const session of assignedSessions) {
    const entry = session.attendance[member.id];
    const status = entry?.status ?? 'unmarked';
    rows.push([
      formatSessionDate(session.date),
      formatSessionTime(session.time),
      session.name,
      session.eventType ?? '',
      session.location ?? '',
      STATUS_LABELS[status],
      status === 'absent_with_reason' ? (entry?.reason ?? '') : '',
      entry?.updatedAt ? formatTimestamp(entry.updatedAt) : 'Not marked yet',
    ]);
  }

  const filename = `team-spirit-member-${slugifyFilename(member.name)}-${toIsoDateString(new Date())}.csv`;
  downloadCsv(filename, rows);
}

/** Opens a formatted print / Save-as-PDF report for an individual member's attendance history. */
export function printMemberProfileReport(
  member: ClubMember,
  stats: MemberAttendanceStats,
  sessions: AttendanceSession[],
): void {
  const memberType = normalizeMemberType(member.memberType);
  const assignedSessions = sortSessionsNewestFirst(sessions).filter(
    (session) => session.memberIds.includes(member.id) || Boolean(session.attendance[member.id]),
  );

  const metaLines: string[] = [
    `Status: ${
      isLegacyMember(member)
        ? member.graduationYear
          ? `Graduated ${member.graduationYear}`
          : 'Legacy / Retired'
        : 'Active'
    }`,
    `Type: ${MEMBER_TYPE_LABELS[memberType]}`,
  ];
  if (member.className) metaLines.push(`Class: ${member.className}`);
  if (member.role) metaLines.push(`Role: ${member.role}`);
  if (member.email) metaLines.push(`Email: ${member.email}`);

  const rows = assignedSessions.map((session) => {
    const entry = session.attendance[member.id];
    const status = entry?.status ?? 'unmarked';
    return [
      formatSessionDate(session.date),
      formatSessionTime(session.time),
      session.name,
      session.eventType || '—',
      STATUS_LABELS[status],
      status === 'absent_with_reason' ? entry?.reason || '—' : '—',
    ];
  });

  openPrintableDocument({
    title: member.name,
    subtitle: 'Individual Member Attendance Report',
    metaLines,
    stats: [
      { label: 'Sessions', value: String(stats.totalSessions) },
      { label: 'Present', value: String(stats.presentCount) },
      { label: 'Excused', value: String(stats.absentWithReasonCount) },
      { label: 'Unexcused', value: String(stats.absentWithoutReasonCount) },
      { label: 'Unmarked', value: String(stats.unmarkedCount) },
      { label: 'Overall Rate', value: stats.overallRate !== null ? `${stats.overallRate}%` : '--%' },
    ],
    headers: ['Date', 'Time', 'Session', 'Type', 'Status', 'Absence Reason'],
    rows,
    emptyMessage: 'This member has not been assigned to any sessions yet.',
  });
}
