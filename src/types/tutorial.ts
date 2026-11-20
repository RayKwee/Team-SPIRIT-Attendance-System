import type { CalendarViewMode } from './attendance';
import type { AppPage } from '../utils/router';

export type TutorialStatus = 'unseen' | 'completed' | 'dismissed';

export interface TutorialStorageState {
  version: 1;
  status: TutorialStatus;
  updatedAt?: string;
}

export type TutorialStepId =
  | 'header-nav'
  | 'stats-strip'
  | 'session-hub'
  | 'attendance-assign'
  | 'attendance-checklist'
  | 'calendar-views'
  | 'member-sidebar'
  | 'project-ideas'
  | 'settings-panel';

export type TutorialPlacement = 'top' | 'bottom' | 'left' | 'right';

export interface TutorialStepConfig {
  id: TutorialStepId;
  target: string;
  badge: string;
  title: string;
  description: string;
  preferredPlacement: TutorialPlacement;
  page: AppPage;
  requiresSession: boolean;
  memberSidebarOpen: boolean;
  calendarViewMode?: CalendarViewMode;
  spotlightPadding?: number;
}
