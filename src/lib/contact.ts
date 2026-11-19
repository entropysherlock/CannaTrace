/** Who to reach about CannaTrace: the public site's demo, pricing, and contact buttons. Addresses are not printed on the site. */
export const CONTACT_EMAIL = "calebwestfall1989@gmail.com";
export const mailto = (subject: string) => `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(subject)}`;
