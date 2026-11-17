"use server";

import { revalidatePath } from "next/cache";
import { checkConnection, connectKey, disconnect, setLimits, setModel } from "@/lib/ai/connection";
import { field, toFormError, type FormState } from "@/lib/form";
import { requirePermission } from "@/lib/session";

const manager = () => requirePermission("ai.manage");
const refresh = () => revalidatePath("/", "layout");

export async function connectKeyAction(_: FormState, formData: FormData): Promise<FormState> {
  try {
    const view = await connectKey(await manager(), { apiKey: String(formData.get("apiKey") ?? ""), model: field(formData, "model") || undefined });
    refresh();
    return { ok: `Connected. Tally now runs on your Claude account (key ${view.keyHint}) using ${view.model}.` };
  } catch (error) {
    return toFormError(error);
  }
}

export async function checkKeyAction(): Promise<FormState> {
  try {
    const view = await checkConnection(await manager());
    refresh();
    return view.status === "CONNECTED" ? { ok: "The connection works." } : { error: view.statusMessage ?? "There is a problem with the connection." };
  } catch (error) {
    return toFormError(error);
  }
}

export async function modelAction(_: FormState, formData: FormData): Promise<FormState> {
  try {
    await setModel(await manager(), field(formData, "model"));
    refresh();
    return { ok: "Model saved. Tally uses it from the next question." };
  } catch (error) {
    return toFormError(error);
  }
}

export async function limitsAction(_: FormState, formData: FormData): Promise<FormState> {
  try {
    await setLimits(await manager(), {
      dailyLimit: field(formData, "dailyLimit"),
      monthlyLimit: field(formData, "monthlyLimit"),
      perPersonDailyLimit: field(formData, "perPersonDailyLimit"),
      maxAnswerTokens: field(formData, "maxAnswerTokens"),
      enabled: formData.get("enabled") === "on",
    });
    refresh();
    return { ok: "Limits saved." };
  } catch (error) {
    return toFormError(error);
  }
}

export async function disconnectAction(_: FormState, formData: FormData): Promise<FormState> {
  try {
    if (field(formData, "confirm").toLowerCase() !== "disconnect") return { error: 'Type "disconnect" to confirm.' };
    await disconnect(await manager());
    refresh();
    return { ok: "Disconnected. The key was removed from CannaTrace. Delete it in the Claude Console too if you no longer need it." };
  } catch (error) {
    return toFormError(error);
  }
}
