/** Who to reach about CannaTrace: the public site's demo, pricing, and contact links. */
export const CONTACT_EMAILS = ["calebwestfall1989@gmail.com", "ccwestfall85@gmail.com"];
export const mailto = (subject: string) => `mailto:${CONTACT_EMAILS.join(",")}?subject=${encodeURIComponent(subject)}`;
