"use client";

import { useState } from "react";
import { ActionForm } from "@/components/action-form";
import { Field, inputClass } from "@/components/ui";
import type { FormState } from "@/lib/form";
import { PERMISSION_GROUPS, type Permission } from "@/lib/rbac";

/** Pick a name and tick what the role can do. "Start from" copies a built-in role's ticks as a shortcut. */
export function RoleBuilder({
  action,
  role,
  templates,
  ownerOnly,
  canGrantOwnerOnly,
}: {
  action: (state: FormState, formData: FormData) => Promise<FormState>;
  role?: { id: string; name: string; description: string; permissions: Permission[] };
  templates: { label: string; permissions: Permission[] }[];
  ownerOnly: Permission[];
  canGrantOwnerOnly: boolean;
}) {
  const [picked, setPicked] = useState<Set<Permission>>(new Set(role?.permissions ?? []));
  const toggle = (p: Permission, on: boolean) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (on) next.add(p);
      else next.delete(p);
      return next;
    });

  return (
    <ActionForm action={action} submitLabel={role ? "Save role" : "Create role"}>
      {role ? <input type="hidden" name="id" value={role.id} /> : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Role name" hint="For example: Shift lead, Trimmer, Delivery driver.">
          <input name="name" required maxLength={60} defaultValue={role?.name} className={inputClass} />
        </Field>
        <Field label="Start from (optional)" hint="Copies the ticks from a built-in role. You can change them after.">
          <select
            defaultValue=""
            className={inputClass}
            onChange={(e) => {
              const t = templates.find((x) => x.label === e.target.value);
              if (t) setPicked(new Set(t.permissions.filter((p) => canGrantOwnerOnly || !ownerOnly.includes(p))));
            }}
          >
            <option value="">Keep my ticks</option>
            {templates.map((t) => (
              <option key={t.label} value={t.label}>
                {t.label}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <Field label="Description (optional)">
        <input name="description" maxLength={300} defaultValue={role?.description} className={inputClass} />
      </Field>

      <div className="grid gap-4 md:grid-cols-2">
        {PERMISSION_GROUPS.map((group) => (
          <fieldset key={group.title} className="rounded-lg border border-slate-200 p-4">
            <legend className="px-1 text-sm font-semibold text-slate-800">{group.title}</legend>
            <div className="space-y-3">
              {group.permissions.map((p) => {
                const locked = ownerOnly.includes(p.key) && !canGrantOwnerOnly;
                return (
                  <label key={p.key} className={`flex gap-3 ${locked ? "opacity-50" : "cursor-pointer"}`}>
                    <input
                      type="checkbox"
                      name="permissions"
                      value={p.key}
                      disabled={locked}
                      checked={picked.has(p.key)}
                      onChange={(e) => toggle(p.key, e.target.checked)}
                      className="mt-0.5 h-5 w-5 shrink-0 accent-brand-700"
                    />
                    <span>
                      <span className="block text-sm font-medium text-slate-900">{p.label}</span>
                      <span className="block text-xs text-slate-500">{p.hint}</span>
                    </span>
                  </label>
                );
              })}
            </div>
          </fieldset>
        ))}
      </div>
      <p className="text-sm text-slate-600">{picked.size} permissions ticked.</p>
    </ActionForm>
  );
}
