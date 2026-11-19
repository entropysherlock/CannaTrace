"use client";

import { Plus } from "lucide-react";
import { useState } from "react";
import { recipeAction } from "@/app/(app)/manufacturing/actions";
import { quickItemAction } from "@/app/(app)/quick-create-actions";
import { ActionForm } from "@/components/action-form";
import { CreatableSelect, type CreateConfig } from "@/components/contextual-create";
import { ItemFields } from "@/components/item-fields";
import { Field, inputBase, inputClass } from "@/components/ui";

export type ItemOption = { id: string; label: string };

/** "+ Add item" for every picker on the recipe form: the same dialog as everywhere else in CannaTrace. */
const addItem = (categories: string[], what: string): CreateConfig => ({
  buttonLabel: "Add item",
  title: "Add an item",
  intro: `It goes into your catalog too, and is picked as ${what}.`,
  submitLabel: "Save item",
  action: quickItemAction,
  fields: <ItemFields categories={categories} context="recipe" />,
});

export function RecipeForm({ items, categories }: { items: ItemOption[]; categories: string[] }) {
  const [options, setOptions] = useState(items);
  const [rows, setRows] = useState(3);
  const added = (item: ItemOption) => setOptions((all) => (all.some((o) => o.id === item.id) ? all : [...all, item].sort((a, b) => a.label.localeCompare(b.label))));
  return (
    <ActionForm action={recipeAction} submitLabel="Save recipe">
      {options.length < 2 ? (
        <p className="rounded-lg bg-brand-50 px-3 py-2 text-sm text-brand-900">
          A recipe needs at least two items: what it makes and what it uses. Use <strong>+ Add item</strong> beside any list to add one without leaving this form.
        </p>
      ) : null}
      <Field label="Recipe name">
        <input name="name" required className={inputClass} />
      </Field>
      <CreatableSelect
        name="outputItemId"
        label="What it makes"
        required
        placeholder="Choose an item"
        options={options}
        onCreated={added}
        create={addItem(categories, "what this recipe makes")}
      />
      <Field label="How much one batch makes" hint="In that item's unit of measure.">
        <input name="outputQuantity" inputMode="decimal" required className={inputClass} />
      </Field>
      <fieldset className="space-y-2">
        <legend className="mb-1 text-sm font-medium text-slate-700">What one batch uses</legend>
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="flex items-start gap-2">
            <CreatableSelect
              className="min-w-0 flex-1"
              name="inputItemId"
              label={`Input item ${i + 1}`}
              hideLabel
              compact
              placeholder={i === 0 ? "Choose an item" : "None"}
              options={options}
              onCreated={added}
              create={addItem(categories, `input ${i + 1}`)}
            />
            <input name="inputQuantity" aria-label={`Input quantity ${i + 1}`} placeholder="Qty" inputMode="decimal" className={`${inputBase} w-24 shrink-0`} />
          </div>
        ))}
        {rows < 10 ? (
          <button type="button" onClick={() => setRows((r) => r + 1)} className="inline-flex items-center gap-1 text-sm font-semibold text-brand-700 hover:underline">
            <Plus className="h-4 w-4" aria-hidden="true" /> Add another input
          </button>
        ) : null}
        <p className="text-xs text-slate-500">Quantities are in each item&apos;s own unit. Leave unused rows empty.</p>
      </fieldset>
    </ActionForm>
  );
}
