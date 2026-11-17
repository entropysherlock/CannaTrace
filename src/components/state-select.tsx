import { hasRulePack, US_STATES } from "@/lib/states";
import { inputClass } from "./ui";

/** A state picker that marks which states have built-in state rules. */
export function StateSelect({ name = "state", defaultValue }: { name?: string; defaultValue?: string }) {
  return (
    <select name={name} required defaultValue={defaultValue ?? ""} className={inputClass}>
      <option value="" disabled>
        Choose a state
      </option>
      {US_STATES.map((s) => (
        <option key={s.code} value={s.code}>
          {s.name} ({s.code}){hasRulePack(s.code) ? " · state rules built in" : ""}
        </option>
      ))}
    </select>
  );
}
