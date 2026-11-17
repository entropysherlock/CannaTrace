import { stateName, SUPPORTED_STATES } from "@/lib/states";
import { inputClass } from "./ui";

/**
 * Only states where adult-use cannabis is legal and CannaTrace has verified state rules.
 * A facility already set to another state keeps it listed so its form still works.
 */
export function StateSelect({ name = "state", defaultValue }: { name?: string; defaultValue?: string }) {
  const keep = defaultValue && !SUPPORTED_STATES.some((s) => s.code === defaultValue) ? [{ code: defaultValue, name: stateName(defaultValue) }] : [];
  return (
    <select name={name} required defaultValue={defaultValue ?? ""} className={inputClass}>
      <option value="" disabled>
        Choose a state
      </option>
      {[...SUPPORTED_STATES, ...keep].map((s) => (
        <option key={s.code} value={s.code}>
          {s.name}
        </option>
      ))}
    </select>
  );
}
