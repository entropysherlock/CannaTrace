import { ROOM_AREAS } from "@/lib/rooms";
import { Field, inputClass } from "./ui";

// The fields each "+ Add …" dialog asks for. They carry the same names as the record's own page,
// so the server reads them the same way. Rendered on the server and handed to the dialog.

/** A room: the same two things Settings → Facilities asks for. */
export function RoomFields({ defaultArea = "PROPAGATION" }: { defaultArea?: string }) {
  return (
    <>
      <Field label="Room name" hint='Any name you like, for example "Clone Room 2".'>
        <input name="name" required maxLength={80} className={inputClass} />
      </Field>
      <Field label="Room area type">
        <select name="area" required defaultValue={defaultArea} className={inputClass}>
          {ROOM_AREAS.map((a) => (
            <option key={a.value} value={a.value}>
              {a.label}
            </option>
          ))}
        </select>
      </Field>
    </>
  );
}

/** A storage location: the same two things the Locations page asks for. */
export function LocationFields() {
  return (
    <>
      <Field label="Location name" hint='For example "Vault B / Rack 3".'>
        <input name="name" required maxLength={80} className={inputClass} />
      </Field>
      <Field label="Type">
        <select name="type" required defaultValue="RACK" className={inputClass}>
          <option value="ROOM">Room</option>
          <option value="RACK">Rack</option>
          <option value="BIN">Bin</option>
        </select>
      </Field>
    </>
  );
}

/** A driver: the same things the Drivers and vehicles tab asks for. The license number prints on manifests. */
export function DriverFields() {
  return (
    <>
      <Field label="Driver name">
        <input name="name" required maxLength={100} className={inputClass} />
      </Field>
      <Field label="Driver's license number" hint="Printed on the manifest.">
        <input name="licenseNumber" required maxLength={40} className={inputClass} />
      </Field>
      <Field label="Phone (optional)">
        <input name="phone" type="tel" maxLength={40} className={inputClass} />
      </Field>
    </>
  );
}

/** A vehicle: make, model, and plate, as on the Drivers and vehicles tab. */
export function VehicleFields() {
  return (
    <>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Make">
          <input name="make" required maxLength={60} className={inputClass} />
        </Field>
        <Field label="Model">
          <input name="model" required maxLength={60} className={inputClass} />
        </Field>
      </div>
      <Field label="License plate">
        <input name="plate" required maxLength={20} autoCapitalize="characters" className={inputClass} />
      </Field>
    </>
  );
}
