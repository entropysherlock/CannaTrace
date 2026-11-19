import { toFormError } from "./form";

/**
 * "Create without leaving": the shared result shape for every small server action that adds a
 * missing prerequisite (a strain, a room, a vendor...) from inside another task's form.
 *
 * - `created`  the new record, which the picker selects right away.
 * - `existing` nothing was created because a record with the same name is already there;
 *              the dialog offers to use that one instead, so duplicates are never made silently.
 * - `error`    a message to show inside the dialog. Nothing was saved.
 */
export type CreateOption = { id: string; label: string };
export type CreateResult = { created?: CreateOption; existing?: CreateOption; error?: string };

/** Turn a thrown error into a dialog message, letting sign-in redirects through like toFormError. */
export function toCreateError(error: unknown): CreateResult {
  return { error: toFormError(error)?.error ?? "Something went wrong on our side. Nothing was changed. Please try again." };
}

/** Names match when they differ only in letter case or spacing, so "blue  dream" finds "Blue Dream". */
export function sameName(a: string, b: string): boolean {
  const norm = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();
  return norm(a) === norm(b);
}
