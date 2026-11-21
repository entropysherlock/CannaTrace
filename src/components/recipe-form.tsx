"use client";

import { Plus } from "lucide-react";
import { useState } from "react";
import { recipeAction } from "@/app/(app)/manufacturing/actions";
import { quickItemAction, quickRecipeAction } from "@/app/(app)/quick-create-actions";
import { ActionForm } from "@/components/action-form";
import { CreatableSelect, type CreateConfig } from "@/components/contextual-create";
import { ItemFields } from "@/components/item-fields";
import { Field, inputBase, inputClass } from "@/components/ui";
import type { CreateOption } from "@/lib/contextual-create";

export type ItemOption = { id: string; label: string };

/** "+ Add item" for every picker on a recipe: the same dialog as everywhere else in CannaTrace. */
const addItem = (categories: string[], what: string, canAddItems: boolean): CreateConfig | undefined =>
  canAddItems
    ? {
        buttonLabel: "Add item",
        title: "Add an item",
        intro: `It goes into your catalog too, and is picked as ${what}.`,
        submitLabel: "Save item",
        action: quickItemAction,
        fields: <ItemFields categories={categories} context="recipe" />,
      }
    : undefined;

/** The item list every picker on one recipe shares, so an item added in one row shows in all of them. */
function useItemOptions(items: ItemOption[]) {
  const [options, setOptions] = useState(items);
  const added = (item: ItemOption) =>
    setOptions((all) => (all.some((o) => o.id === item.id) ? all : [...all, item].sort((a, b) => a.label.localeCompare(b.label))));
  return { options, added };
}

type Shared = { options: ItemOption[]; added: (item: ItemOption) => void; categories: string[]; canAddItems: boolean };

/** Name, what the recipe makes, and how much one batch makes. */
function RecipeOutputFields({ options, added, categories, canAddItems }: Shared) {
  return (
    <>
      {options.length < 2 && canAddItems ? (
        <p className="rounded-lg bg-brand-50 px-3 py-2 text-sm text-brand-900">
          A recipe needs at least two items: what it makes and what it uses. Use <strong>+ Add item</strong> beside any list to add one without leaving this form.
        </p>
      ) : null}
      <Field label="Recipe name">
        <input name="name" required maxLength={120} className={inputClass} />
      </Field>
      <CreatableSelect
        name="outputItemId"
        label="What it makes"
        required
        placeholder="Choose an item"
        options={options}
        onCreated={added}
        create={addItem(categories, "what this recipe makes", canAddItems)}
      />
      <Field label="How much one batch makes" hint="In that item's unit of measure.">
        <input name="outputQuantity" inputMode="decimal" required className={inputClass} />
      </Field>
    </>
  );
}

/** "Blue Mesa Flower (g)" → "g". Every item label in CannaTrace ends with its unit in brackets. */
const unitOf = (label: string | undefined) => label?.match(/\(([^()]+)\)\s*$/)?.[1] ?? "";

/**
 * One input: the item, then a clearly labelled amount with the item's unit beside it.
 * The amount is required once an item is picked, so the browser points at the empty box before anything is sent.
 */
function RecipeInputRow({ index, options, added, categories, canAddItems }: Shared & { index: number }) {
  const [itemId, setItemId] = useState("");
  const unit = unitOf(options.find((o) => o.id === itemId)?.label);
  const qtyId = `recipe-input-qty-${index}`;
  return (
    <div className="grid gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3 sm:grid-cols-[minmax(0,1fr)_11rem] sm:items-end">
      <CreatableSelect
        className="min-w-0"
        name="inputItemId"
        label={`Input item ${index + 1}`}
        placeholder={index === 0 ? "Choose an item" : "None"}
        options={options}
        onCreated={(item) => {
          added(item);
          setItemId(item.id);
        }}
        onChange={setItemId}
        create={addItem(categories, `input ${index + 1}`, canAddItems)}
      />
      <div>
        <label htmlFor={qtyId} className="mb-1 block text-sm font-semibold text-slate-800">
          Amount per batch
        </label>
        <div className="flex items-center gap-2">
          <input
            id={qtyId}
            name="inputQuantity"
            aria-label={`Amount per batch, input quantity ${index + 1}`}
            placeholder={itemId ? "e.g. 35" : ""}
            inputMode="decimal"
            required={Boolean(itemId)}
            className={`${inputBase} w-full flex-1 border-slate-400 placeholder:text-slate-500`}
          />
          <span className="w-10 shrink-0 text-sm font-semibold text-slate-700" aria-hidden={!unit}>
            {unit}
          </span>
        </div>
      </div>
    </div>
  );
}

/** What one batch uses: one card per input, each with its item and amount. */
function RecipeInputFields({ rows, onMoreRows, ...shared }: Shared & { rows: number; onMoreRows: () => void }) {
  return (
    <fieldset className="min-w-0 space-y-2">
      <legend className="mb-1 text-sm font-medium text-slate-700">What one batch uses</legend>
      {Array.from({ length: rows }, (_, i) => (
        <RecipeInputRow key={i} index={i} {...shared} />
      ))}
      {rows < 10 ? (
        <button type="button" onClick={onMoreRows} className="inline-flex items-center gap-1 text-sm font-semibold text-brand-700 hover:underline">
          <Plus className="h-4 w-4" aria-hidden="true" /> Add another input
        </button>
      ) : null}
      <p className="text-xs text-slate-500">Type just the number; the unit comes from the item. Leave unused inputs empty.</p>
    </fieldset>
  );
}

/** The Recipes tab's form. */
export function RecipeForm({ items, categories }: { items: ItemOption[]; categories: string[] }) {
  const shared = { ...useItemOptions(items), categories, canAddItems: true };
  const [rows, setRows] = useState(3);
  return (
    <ActionForm action={recipeAction} submitLabel="Save recipe">
      <RecipeOutputFields {...shared} />
      <RecipeInputFields {...shared} rows={rows} onMoreRows={() => setRows((r) => r + 1)} />
    </ActionForm>
  );
}

/**
 * "Recipe" on Start a new run, with "+ Add recipe": the same recipe fields in a guided drawer
 * (what it makes, then what it uses), saved like the Recipes tab and picked for the run.
 */
export function RecipePicker({
  recipes,
  items,
  categories,
  canAddItems,
}: {
  recipes: CreateOption[];
  items: ItemOption[];
  categories: string[];
  canAddItems: boolean;
}) {
  const shared = { ...useItemOptions(items), categories, canAddItems };
  const [rows, setRows] = useState(3);
  return (
    <CreatableSelect
      name="recipeId"
      label="Recipe"
      required
      placeholder="Choose a recipe"
      options={recipes}
      create={{
        buttonLabel: "Add recipe",
        title: "Add a recipe",
        intro: "Saved to Recipes and picked for this run. The run's name and batch count stay as you left them.",
        submitLabel: "Save recipe",
        action: quickRecipeAction,
        steps: [
          { title: "What it makes", fields: <RecipeOutputFields {...shared} /> },
          { title: "What it uses", fields: <RecipeInputFields {...shared} rows={rows} onMoreRows={() => setRows((r) => r + 1)} /> },
        ],
      }}
    />
  );
}
