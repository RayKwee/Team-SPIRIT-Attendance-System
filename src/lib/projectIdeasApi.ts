import type {
  ProjectIdea,
  ProjectIdeaFeedback,
  ProjectIdeaInput,
  ProjectIdeaReviewStatus,
} from '../types/projectIdeas';
import { toSupabaseSyncError } from './attendanceSync';
import { supabase } from './supabase';

export interface DbProjectIdeaRow {
  id: string;
  submitted_by_user_id: string | null;
  linked_member_id: string | null;
  author_name: string;
  title: string;
  description: string;
  category: string | null;
  review_status: string | null;
  is_highlighted: boolean;
  admin_note: string | null;
  created_at: string;
  updated_at: string;
}

export interface DbProjectIdeaFeedbackRow {
  idea_id: string;
  feedback_text: string;
  responder_user_id: string | null;
  responder_name: string | null;
  updated_at: string;
}

const VALID_REVIEW_STATUSES = new Set<ProjectIdeaReviewStatus>([
  'pending',
  'under_review',
  'approved',
  'archived',
]);

const MISSING_IDEAS_TABLE_MESSAGE =
  'The Supabase "project_ideas" or "project_idea_feedback" schema is outdated. Run the updated supabase/schema.sql in your Supabase SQL Editor, then click Retry.';

const IDEAS_PERMISSION_MESSAGE =
  'Supabase denied access to "project_ideas". Make sure you are signed in and run the updated GRANT & RLS script in supabase/schema.sql.';

function cleanOptionalText(value: string | null | undefined): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function normalizeReviewStatus(value: string | null | undefined): ProjectIdeaReviewStatus {
  if (value && VALID_REVIEW_STATUSES.has(value as ProjectIdeaReviewStatus)) {
    return value as ProjectIdeaReviewStatus;
  }
  return 'pending';
}

export function feedbackFromDbRow(row: DbProjectIdeaFeedbackRow): ProjectIdeaFeedback {
  return {
    ideaId: row.idea_id,
    feedbackText: row.feedback_text,
    responderUserId: row.responder_user_id ?? undefined,
    responderName: cleanOptionalText(row.responder_name),
    updatedAt: row.updated_at,
  };
}

export function projectIdeaFromDbRow(
  row: DbProjectIdeaRow,
  feedback?: ProjectIdeaFeedback,
): ProjectIdea {
  return {
    id: row.id,
    submittedByUserId: row.submitted_by_user_id ?? undefined,
    linkedMemberId: cleanOptionalText(row.linked_member_id),
    authorName: row.author_name,
    title: row.title,
    description: row.description,
    category: cleanOptionalText(row.category),
    reviewStatus: normalizeReviewStatus(row.review_status),
    isHighlighted: Boolean(row.is_highlighted),
    adminFeedback: feedback,
    createdAt: row.created_at,
    updatedAt: row.updated_at || row.created_at,
  };
}

function normalizeIdeasError(error: unknown, fallbackMessage: string, httpStatus?: number): Error {
  const syncErr = toSupabaseSyncError(error, fallbackMessage, httpStatus);
  if (syncErr.isMissingTable || syncErr.isMissingColumn) {
    return new Error(MISSING_IDEAS_TABLE_MESSAGE);
  }
  if (syncErr.isPermissionDenied) {
    return new Error(IDEAS_PERMISSION_MESSAGE);
  }
  return new Error(syncErr.message || fallbackMessage);
}

/**
 * Fetches RLS-scoped Project Ideas for the authenticated user alongside private
 * admin feedback rows (readable only by Admins and each idea's submitter).
 */
export async function fetchScopedProjectIdeas(): Promise<ProjectIdea[]> {
  const [ideasRes, feedbackRes] = await Promise.all([
    supabase
      .from('project_ideas')
      .select('*')
      .order('is_highlighted', { ascending: false })
      .order('created_at', { ascending: false }),
    supabase.from('project_idea_feedback').select('*'),
  ]);

  if (ideasRes.error) {
    throw normalizeIdeasError(
      ideasRes.error,
      'Failed to load Project Ideas from Supabase.',
      ideasRes.status,
    );
  }

  const feedbackMap = new Map<string, ProjectIdeaFeedback>();
  if (!feedbackRes.error && Array.isArray(feedbackRes.data)) {
    for (const row of feedbackRes.data as DbProjectIdeaFeedbackRow[]) {
      feedbackMap.set(row.idea_id, feedbackFromDbRow(row));
    }
  }

  return ((ideasRes.data ?? []) as DbProjectIdeaRow[]).map((row) =>
    projectIdeaFromDbRow(row, feedbackMap.get(row.id)),
  );
}

/** Submits a new project proposal strictly under the caller's authenticated profile. */
export async function submitProjectIdea(input: ProjectIdeaInput): Promise<ProjectIdea> {
  const authorName = input.authorName.trim();
  const title = input.title.trim();
  const description = input.description.trim();
  const category = cleanOptionalText(input.category);

  const { data, error, status } = await supabase
    .from('project_ideas')
    .insert({
      author_name: authorName,
      title,
      description,
      category: category ?? null,
      review_status: 'pending',
      is_highlighted: false,
      admin_note: null,
    })
    .select('*')
    .single();

  if (error || !data) {
    throw normalizeIdeasError(
      error ?? new Error('Unable to submit project idea.'),
      'Unable to submit project idea to Supabase.',
      status,
    );
  }

  return projectIdeaFromDbRow(data as DbProjectIdeaRow);
}

/** Admin-only: toggles the highlighted/featured state of an idea. */
export async function toggleProjectIdeaHighlight(
  ideaId: string,
  nextHighlighted: boolean,
): Promise<ProjectIdea> {
  const { data, error, status } = await supabase
    .from('project_ideas')
    .update({ is_highlighted: nextHighlighted })
    .eq('id', ideaId)
    .select('*')
    .single();

  if (error || !data) {
    throw normalizeIdeasError(
      error ?? new Error('Unable to update highlight state.'),
      'Failed to update idea highlight status.',
      status,
    );
  }

  return projectIdeaFromDbRow(data as DbProjectIdeaRow);
}

/** Admin-only: updates the workflow review status of a project idea. */
export async function updateProjectIdeaReviewStatus(
  ideaId: string,
  nextStatus: ProjectIdeaReviewStatus,
): Promise<ProjectIdea> {
  const { data, error, status } = await supabase
    .from('project_ideas')
    .update({ review_status: nextStatus })
    .eq('id', ideaId)
    .select('*')
    .single();

  if (error || !data) {
    throw normalizeIdeasError(
      error ?? new Error('Unable to update review status.'),
      'Failed to update idea review status.',
      status,
    );
  }

  return projectIdeaFromDbRow(data as DbProjectIdeaRow);
}

/** Admin-only: saves or clears personal feedback for the idea author inside `project_idea_feedback`. */
export async function upsertProjectIdeaFeedback(
  ideaId: string,
  feedbackText: string,
  responderUserId: string | null,
  responderName: string,
): Promise<ProjectIdeaFeedback | undefined> {
  const cleaned = cleanOptionalText(feedbackText);
  if (!cleaned) {
    const { error, status } = await supabase
      .from('project_idea_feedback')
      .delete()
      .eq('idea_id', ideaId);

    if (error) {
      throw normalizeIdeasError(error, 'Failed to clear personal feedback.', status);
    }
    return undefined;
  }

  const { data, error, status } = await supabase
    .from('project_idea_feedback')
    .upsert(
      {
        idea_id: ideaId,
        feedback_text: cleaned,
        responder_user_id: responderUserId,
        responder_name: cleanOptionalText(responderName) ?? 'Club Admin',
      },
      { onConflict: 'idea_id' },
    )
    .select('*')
    .single();

  if (error || !data) {
    throw normalizeIdeasError(
      error ?? new Error('Unable to save personal feedback.'),
      'Failed to save personal feedback.',
      status,
    );
  }

  return feedbackFromDbRow(data as DbProjectIdeaFeedbackRow);
}

/** Permanently deletes a project idea (cascading any feedback; RLS enforces the active deletion policy). */
export async function deleteProjectIdea(ideaId: string): Promise<void> {
  const { data, error, status } = await supabase
    .from('project_ideas')
    .delete()
    .eq('id', ideaId)
    .select('id');

  if (error) {
    throw normalizeIdeasError(error, 'Failed to delete project idea.', status);
  }
  if (!data || data.length === 0) {
    throw new Error(
      'Deletion is not permitted under the current content deletion policy (or the idea was already removed).',
    );
  }
}
