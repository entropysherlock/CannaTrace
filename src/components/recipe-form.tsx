"use client";

import { Plus } from "lucide-react";
import { useState, useTransition } from "react";
import { newRecipeItemAction, recipeAction } from "@/app/(app)/manufacturing/actions";
import { ActionForm } from "@/components/action-form";
import { Field, inputBase, inputClass } from "@/components/ui";

export type ItemOption = { id: string; label: string };
const NEW = "__new__";
const UNITS = [
  ["G", "grams (g)"],
  ["EACH", "each (ea)"],
  ["MG", "milligrams (mg)"],
  ["KG", "kilograms (kg)"],
  ["OZ", "ounces (oz)"],
  ["LB", "pounds (lb)"],
  ["ML", "millilitres (mL)"],
  ["L", "litres (L)"],
] as const;

/** Inline "add a new item" box shown under a picker when "+ New item…" is chosen. */
function NewItem({ categories, onAdded, onCancel }: { categories: string[]; onAdded: (item: ItemOption) => void; onCancel: () => void }) {
  const [name, setName] = useState("");
  const [unit, setUnit] = useState("G");
  const [category, setCategory] = useState(categories[0] ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const add = () =>
    start(async () => {
      const r = await newRecipeItemAction({ name, unit, category });
      if (r.error || !r.item) return setError(r.error ?? "Could not add the item.");
      setError(null);
      onAdded(r.item);
    });
  return (
    <div className="mt-2 space-y-2 rounded-lg border border-brand-200 bg-brand-50 p-3" role="group" aria-label="New item">
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            add();
          }
        }}
        placeholder="New item name, e.g. Live Resin 1 g"
        aria-label="New item name"
        autoFocus
        className={inputClass}
      />
      <div className="flex gap-2">
        <select value={unit} onChange={(e) => setUnit(e.target.value)} aria-label="New item unit" className={`${inputBase} flex-1`}>
          {UNITS.map(([code, label]) => (
            <option key={code} value={code}>
              {label}
            </option>
          ))}
        </select>
        <input
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          list="recipe-categories"
          placeholder="Category"
          aria-label="New item category"
          className={`${inputBase} flex-1`}
        />
      </div>
      {error ? (
        <p role="alert" className="text-sm font-medium text-red-800">
          {error}
        </p>
      ) : null}
      <div className="flex gap-2">
        <button type="button" onClick={add} disabled={pending || !name.trim()} className="min-h-10 rounded-md bg-brand-700 px-3 text-sm font-semibold text-white disabled:bg-slate-300">
          {pending ? "Adding…" : "Add item"}
        </button>
        <button type="button" onClick={onCancel} className="min-h-10 rounded-md px-3 text-sm font-medium text-slate-700 hover:bg-white">
          Cancel
        </button>
      </div>
      <p className="text-xs text-slate-500">It goes into your catalog too, with a SKU made from its name.</p>
    </div>
  );
}

/** An item picker whose last choice adds a new item on the spot. */
function ItemPicker({
  name,
  label,
  placeholder,
  required,
  options,
  categories,
  onAdded,
}: {
  name: string;
  label: string;
  placeholder: string;
  required?: boolean;
  options: ItemOption[];
  categories: string[];
  onAdded: (item: ItemOption) => void;
}) {
  const [value, setValue] = useState("");
  const adding = value === NEW;
  return (
    <div className="min-w-0 flex-1">
      <select
        name={adding ? undefined : name}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        required={required}
        aria-label={label}
        className={inputClass}
      >
        <option value="" disabled={required}>
          {placeholder}
        </option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
        <option value={NEW}>+ New item…</option>
      </select>
      {adding ? <input type="hidden" name={name} value="" /> : null}
      {adding ? (
        <NewItem
          categories={categories}
          onCancel={() => setValue("")}
          onAdded={(item) => {
            onAdded(item);
            setValue(item.id);
          }}
        />
      ) : null}
    </div>
  );
}

export function RecipeForm({ items, categories }: { items: ItemOption[]; categories: string[] }) {
  const [options, setOptions] = useState(items);
  const [rows, setRows] = useState(3);
  const added = (item: ItemOption) => setOptions((all) => (all.some((o) => o.id === item.id) ? all : [...all, item].sort((a, b) => a.label.localeCompare(b.label))));
  return (
    <ActionForm action={recipeAction} submitLabel="Save recipe">
      <datalist id="recipe-categories">
        {categories.map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>
      {options.length < 2 ? (
        <p className="rounded-lg bg-brand-50 px-3 py-2 text-sm text-brand-900">
          A recipe needs at least two items: what it makes and what it uses. Choose <strong>+ New item…</strong> in any list to add one.
        </p>
      ) : null}
      <Field label="Recipe name">
        <input name="name" required className={inputClass} />
      </Field>
      <Field label="What it makes">
        <ItemPicker name="outputItemId" label="What it makes" placeholder="Choose an item" required options={options} categories={categories} onAdded={added} />
      </Field>
      <Field label="How much one batch makes" hint="In that item's unit of measure.">
        <input name="outputQuantity" inputMode="decimal" required className={inputClass} />
      </Field>
      <fieldset className="space-y-2">
        <legend className="mb-1 text-sm font-medium text-slate-700">What one batch uses</legend>
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="flex items-start gap-2">
            <ItemPicker
              name="inputItemId"
              label={`Input item ${i + 1}`}
              placeholder={i === 0 ? "Choose an item" : "None"}
              options={options}
              categories={categories}
              onAdded={added}
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
