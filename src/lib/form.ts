import { unstable_rethrow } from "next/navigation";
import { InventoryError } from "./inventory-math";

export type FormState = { error?: string; ok?: string } | null;

/** Turn a thrown error into a message safe to show the user. */
export function toFormError(error: unknown): FormState {
  // A signed-out or deactivated person is sent to sign in; let that redirect through instead of reporting it as a failure.
  unstable_rethrow(error);
  if (error instanceof InventoryError) return { error: error.message };
  if (error instanceof Error && error.name === "PermissionError") return { error: error.message };
  console.error(error);
  return { error: "Something went wrong on our side. Nothing was changed. Please try again." };
}

export function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
}
