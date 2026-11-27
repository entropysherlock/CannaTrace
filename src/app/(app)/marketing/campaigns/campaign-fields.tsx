import { Field, inputClass } from "@/components/ui";
import { MERGE_FIELDS, SEGMENTS } from "@/lib/loyalty-math";

export type CampaignValues = { name?: string; channel?: string; subject?: string | null; body?: string; segment?: string };

/** The boxes shared by the new-campaign form and the draft editor. */
export function CampaignFields({ values = {}, categories }: { values?: CampaignValues; categories: { id: string; name: string }[] }) {
  return (
    <>
      <Field label="Campaign name" hint="Only you see this.">
        <input name="name" required maxLength={60} defaultValue={values.name} className={inputClass} placeholder="Weekend flower push" />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Send as">
          <select name="channel" defaultValue={values.channel ?? "EMAIL"} className={inputClass}>
            <option value="EMAIL">Email</option>
            <option value="SMS">Text message</option>
          </select>
        </Field>
        <Field label="Who gets it" hint="Only shoppers who agreed to this kind of message are sent it. Others are left out automatically.">
          <select name="segment" defaultValue={values.segment ?? "ALL"} className={inputClass}>
            <option value="ALL">Everyone</option>
            {SEGMENTS.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label}
              </option>
            ))}
            <option value="BIRTHDAY">Birthday this month</option>
            {categories.map((c) => (
              <option key={c.id} value={`FAVORITE:${c.id}`}>
                Bought {c.name} in the last year
              </option>
            ))}
          </select>
        </Field>
      </div>
      <Field label="Subject (email only)">
        <input name="subject" maxLength={120} defaultValue={values.subject ?? ""} className={inputClass} />
      </Field>
      <Field label="Message" hint={`You can use ${MERGE_FIELDS.join(", ")}. Your required statement, and "Reply STOP to opt out" on texts, are added for you if missing. Offer discounts or bonus points, never free cannabis.`}>
        <textarea name="body" required rows={6} maxLength={4000} defaultValue={values.body} className={inputClass} />
      </Field>
    </>
  );
}
