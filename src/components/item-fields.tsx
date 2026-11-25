import { UNIT_CODES, unitLabel, type UnitCode } from "@/lib/units";
import { Field, inputClass } from "./ui";

const UNIT_NAMES: Record<UnitCode, string> = {
  MG: "milligrams",
  G: "grams",
  KG: "kilograms",
  OZ: "ounces",
  LB: "pounds",
  ML: "millilitres",
  L: "litres",
  EACH: "each",
};

/**
 * A new catalog item's fields, for the "+ Add item" dialog. Safe to render on the server or in a
 * client component (it imports nothing from the database).
 *
 * `units` limits the choice when a task only works with some units (a harvest is packaged by weight);
 * the server checks the same limit. `context="recipe"` lets recipe makers add items, as before.
 */
export function ItemFields({ categories, units, context }: { categories: string[]; units?: UnitCode[]; context?: "recipe" }) {
  const choices = units?.length ? units : UNIT_CODES;
  return (
    <>
      {units?.length ? <input type="hidden" name="allowedUnits" value={units.join(",")} /> : null}
      {context ? <input type="hidden" name="context" value={context} /> : null}
      <datalist id="quick-item-categories">
        {categories.map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>
      <Field label="Item name">
        <input name="name" required maxLength={120} placeholder="e.g. Blue Mesa Flower (bulk)" className={inputClass} />
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Unit of measure" hint="Can't be changed later, because packages depend on it.">
          <select name="unit" required defaultValue={choices.length === 1 ? choices[0] : ""} className={inputClass}>
            <option value="" disabled>
              Choose a unit
            </option>
            {choices.map((u) => (
              <option key={u} value={u}>
                {UNIT_NAMES[u]} ({unitLabel(u)})
              </option>
            ))}
          </select>
        </Field>
        <Field label="Category" hint="Pick one or type a new one. A new category is made for you.">
          <input name="category" list="quick-item-categories" defaultValue={categories[0] ?? ""} maxLength={60} className={inputClass} />
        </Field>
      </div>
      <Field label="SKU (blank to generate)" hint="Leave blank and Leaf2Sale makes one from the category, like FLO-0007.">
        <input name="sku" autoCapitalize="characters" placeholder="Blank = generated" className={inputClass} />
      </Field>
      <Field label="Strain (optional)">
        <input name="strain" maxLength={80} className={inputClass} />
      </Field>
    </>
  );
}
