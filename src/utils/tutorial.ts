import type { AttendanceSession, ClubMember } from '../types/attendance';
import type { TutorialStatus, TutorialStepConfig, TutorialStorageState } from '../types/tutorial';
import { toIsoDateString } from './date';

export const TUTORIAL_STORAGE_KEY = 'team-spirit:tutorial:v1';

const VALID_TUTORIAL_STATUSES: ReadonlySet<TutorialStatus> = new Set([
  'unseen',
  'completed',
  'dismissed',
]);

export const DEFAULT_TUTORIAL_STATE: TutorialStorageState = {
  version: 1,
  status: 'unseen',
};

/** Declarative step registry for the interactive Team SPIRIT walkthrough. */
export const TUTORIAL_STEPS: TutorialStepConfig[] = [
  {
    id: 'header-nav',
    target: 'header-nav',
    badge: 'Navigation',
    title: 'Three Focused Spaces',
    description:
      'Hang out in the Lounge for announcements and chill chat, browse or pitch builds on the Ideas board, or step into Attendance whenever you need club management tools.',
    preferredPlacement: 'bottom',
    page: 'lounge',
    requiresSession: false,
    memberSidebarOpen: false,
    spotlightPadding: 8,
  },
  {
    id: 'lounge-hub',
    target: 'lounge-hub',
    badge: 'Student Lounge',
    title: 'Announcements & Chill Chat',
    description:
      'Catch pinned club updates on the left and hang out with fellow members across live chat rooms on the right—no attendance clutter in your way.',
    preferredPlacement: 'top',
    page: 'lounge',
    requiresSession: false,
    memberSidebarOpen: false,
    spotlightPadding: 8,
  },
  {
    id: 'project-ideas',
    target: 'project-ideas-board',
    badge: 'Project Ideas',
    title: 'Dedicated Project Ideas Board',
    description:
      'Sign in to pitch club project proposals, browse shared builds, and read personal admin feedback in one calm, dedicated board.',
    preferredPlacement: 'top',
    page: 'ideas',
    requiresSession: false,
    memberSidebarOpen: false,
    spotlightPadding: 8,
  },
  {
    id: 'stats-strip',
    target: 'stats-strip',
    badge: 'Attendance Tools',
    title: 'Isolated Attendance Console',
    description:
      'All technical attendance telemetry, roster drawers, accounts management, and Record Session live cleanly inside the dedicated Attendance section.',
    preferredPlacement: 'bottom',
    page: 'tracker',
    requiresSession: false,
    memberSidebarOpen: false,
    spotlightPadding: 8,
  },
  {
    id: 'session-hub',
    target: 'session-hub',
    badge: 'Session Hub',
    title: 'Manage & Launch Sessions',
    description:
      'Search recorded meetings by name, date, type, or location, toggle between Cards and List views, duplicate past sessions, or click any card to take attendance.',
    preferredPlacement: 'top',
    page: 'tracker',
    requiresSession: false,
    memberSidebarOpen: false,
    spotlightPadding: 8,
  },
  {
    id: 'attendance-assign',
    target: 'attendance-assign-bar',
    badge: 'Recording Attendance',
    title: 'Assign Members to a Session',
    description:
      'Type any name, class, or role to add active members from your directory—or use Add All Active Members and Add by Class to populate a checklist in one click.',
    preferredPlacement: 'bottom',
    page: 'tracker',
    requiresSession: true,
    memberSidebarOpen: false,
    spotlightPadding: 8,
  },
  {
    id: 'attendance-checklist',
    target: 'attendance-checklist',
    badge: 'Recording Attendance',
    title: 'Mark Status, Filter & Export',
    description:
      'Mark each member as Present, Absent with reason (with an optional note), or Absent without reason. Filter by status, reset marks, or export CSV and PDF reports.',
    preferredPlacement: 'top',
    page: 'tracker',
    requiresSession: true,
    memberSidebarOpen: false,
    spotlightPadding: 8,
  },
  {
    id: 'calendar-views',
    target: 'calendar-workspace',
    badge: 'Calendar Views',
    title: 'Day, Week, Month & Year Views',
    description:
      'Browse scheduled sessions across four time scales, jump straight to any date, and inspect that day’s attendance summary and session cards in the side panel.',
    preferredPlacement: 'top',
    page: 'calendar',
    requiresSession: false,
    memberSidebarOpen: false,
    calendarViewMode: 'month',
    spotlightPadding: 8,
  },
  {
    id: 'member-sidebar',
    target: 'member-sidebar',
    badge: 'Member Manager',
    title: 'Club Roster & Profiles',
    description:
      'Slide open the Member Manager from the Attendance Tools bar to manage members, view attendance donut charts, track streaks or absence alerts, and archive alumni.',
    preferredPlacement: 'left',
    page: 'tracker',
    requiresSession: false,
    memberSidebarOpen: true,
    spotlightPadding: 6,
  },
  {
    id: 'settings-panel',
    target: 'header-settings',
    badge: 'Preferences & Help',
    title: 'Settings, Themes & Tour Replay',
    description:
      'Customize theme accents, roster spacing, default assignment status, and JSON backups in Settings—or replay this walkthrough anytime.',
    preferredPlacement: 'bottom',
    page: 'lounge',
    requiresSession: false,
    memberSidebarOpen: false,
    spotlightPadding: 8,
  },
];

/** Reads persisted tutorial status from localStorage safely. */
export function loadTutorialState(): TutorialStorageState {
  try {
    const raw = window.localStorage.getItem(TUTORIAL_STORAGE_KEY);
    if (!raw) return DEFAULT_TUTORIAL_STATE;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) {
      return DEFAULT_TUTORIAL_STATE;
    }
    const candidate = parsed as Partial<TutorialStorageState>;
    if (typeof candidate.status !== 'string' || !VALID_TUTORIAL_STATUSES.has(candidate.status)) {
      return DEFAULT_TUTORIAL_STATE;
    }
    return {
      version: 1,
      status: candidate.status,
      updatedAt: typeof candidate.updatedAt === 'string' ? candidate.updatedAt : undefined,
    };
  } catch {
    return DEFAULT_TUTORIAL_STATE;
  }
}

/** Saves tutorial completion/dismissal status locally without affecting cloud sync or backups. */
export function saveTutorialState(status: TutorialStatus): TutorialStorageState {
  const next: TutorialStorageState = {
    version: 1,
    status,
    updatedAt: new Date().toISOString(),
  };
  try {
    window.localStorage.setItem(TUTORIAL_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Ignore storage write errors in restricted browsing contexts.
  }
  return next;
}

const DEMO_MEMBERS: ClubMember[] = [
  {
    id: '__tutorial-demo-member-1',
    name: 'Alex Rivera',
    memberType: 'student',
    classYear: 10,
    classLetter: 'T',
    className: '10T',
    role: 'Captain',
    createdAt: '2026-09-01T09:00:00.000Z',
  },
  {
    id: '__tutorial-demo-member-2',
    name: 'Maya Chen',
    memberType: 'student',
    classYear: 9,
    classLetter: 'E',
    className: '9E',
    role: 'Member',
    createdAt: '2026-09-01T09:00:00.000Z',
  },
];

/** Builds a non-persisted preview session when the user has 0 real sessions during the tour. */
export function buildTutorialDemoWorkspace(existingActiveMembers: ClubMember[]): {
  demoSession: AttendanceSession;
  demoMembers: ClubMember[];
} {
  const demoMembers = existingActiveMembers.length > 0 ? existingActiveMembers : DEMO_MEMBERS;
  const previewAssignees = demoMembers.slice(0, 2);
  const todayIso = toIsoDateString(new Date());
  const nowIso = new Date().toISOString();

  const attendance: AttendanceSession['attendance'] = {};
  if (previewAssignees[0]) {
    attendance[previewAssignees[0].id] = {
      status: 'present',
      updatedAt: nowIso,
    };
  }
  if (previewAssignees[1]) {
    attendance[previewAssignees[1].id] = {
      status: 'absent_with_reason',
      reason: 'Sample preview — robotics lab overlap',
      updatedAt: nowIso,
    };
  }

  return {
    demoSession: {
      id: '__tutorial-demo-session',
      name: 'Sample Weekly Workshop (Tour Preview)',
      date: todayIso,
      time: '15:30',
      location: 'Innovation Lab 2B',
      eventType: 'Workshop',
      description: 'Temporary preview session shown only during Tutorial Mode — not saved to your records.',
      createdAt: nowIso,
      memberIds: previewAssignees.map((member) => member.id),
      attendance,
    },
    demoMembers,
  };
}
