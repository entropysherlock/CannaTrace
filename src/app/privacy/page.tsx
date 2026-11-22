import type { Metadata } from "next";
import { LegalPage } from "@/components/legal-page";
import { LEGAL, type LegalSection } from "@/lib/legal";

export const metadata: Metadata = { title: "Privacy Policy · CannaTrace", description: "What CannaTrace collects, why, and who sees it." };

const SECTIONS: LegalSection[] = [
  {
    heading: "Who is who",
    paragraphs: [
      `${LEGAL.operator} ("we") runs CannaTrace. For the records a business keeps in CannaTrace (its sales, inventory, staff and customers), the business decides what goes in and why, and we handle that data on its behalf under the Data Agreement. For our website, accounts and billing, we decide what we collect.`,
    ],
  },
  {
    heading: "What we collect",
    items: [
      "Account details: your name, work email and a password, which we store only in scrambled (hashed) form, never in readable form.",
      "Business records you enter: plants, inventory, batches, labels, sales, returns, discounts, orders, vendors and business customers, employees' names and roles, and an audit trail of who did what and when.",
      "Rewards members (shoppers): a phone number, a first name, an optional birthday (month and day only), their points and the history of those points. The shopper agrees at the register when they sign up. We do not collect last names, addresses or emails for rewards, and we do not send text messages.",
      "ID checks at the register: the name and dates on an ID are used for the age and expiry check on the screen and are not saved. A business may record what the law requires of it separately.",
      "Basic technical information: sign-in cookies, and short-lived records needed to keep the service running and secure.",
      "Crash reports, which contain the error, where in the code it happened and the page path. They do not contain cookies, form entries, request contents, IP addresses or database data.",
      "Messages you send to Tally, only when your business has connected its own Claude account.",
    ],
  },
  {
    heading: "How we use it",
    items: [
      "To run CannaTrace for the business that entered it: show it, calculate with it, print labels from it, and create the reports you ask for.",
      "To keep it secure and fix bugs, and to contact account owners about the service.",
      "To bill businesses and keep our own records.",
    ],
    paragraphs: ["We do not sell personal information. We do not use shoppers' phone numbers or birthdays for advertising, and we do not share them with other businesses."],
  },
  {
    heading: "Who else sees it",
    paragraphs: ["We use a small number of outside services to run CannaTrace. Each handles data only to do the job described:"],
    items: LEGAL.providers.map((p) => `${p.name} ${p.does}.`),
  },
  {
    heading: "Other disclosures",
    paragraphs: [
      "We may share information when the law requires it, such as a valid legal request, or to protect people's safety or our rights. A business's own records may be shared by that business with regulators as its license requires. If we are ever sold or merged, the data goes with the service and this policy continues to apply.",
    ],
  },
  {
    heading: "Cookies",
    paragraphs: ["We use only the cookies needed to keep you signed in and to recognize a linked device. We do not use advertising or tracking cookies."],
  },
  {
    heading: "Keeping and deleting data",
    items: [
      "A business keeps its records for as long as its account is active and may export them as spreadsheets at any time.",
      "A rewards member can ask the shop to delete their rewards account. Deleting it removes their phone number, name, birthday and points history. The sales they made stay in the shop's books, as the law may require, but are no longer linked to them.",
      "After an account ends, the data stays available for download for 30 days and is then deleted. Encrypted backups roll off within about 30 days after that.",
      "Some records may be kept longer where the law or an open dispute requires it.",
    ],
  },
  {
    heading: "Security",
    paragraphs: [
      "Data travels over encrypted connections. Passwords are hashed, access to a business's data is limited to its own signed-in staff by the permissions its owner sets, and backups are encrypted. No system is perfectly secure. If something happens that affects your data, we will tell the account owner promptly.",
    ],
  },
  {
    heading: "Your choices",
    paragraphs: [
      "You can ask what we hold about you, ask us to fix or delete it, or ask us to stop using it, by emailing us. If your information is in a business's CannaTrace records (for example you are a rewards member), please ask that business first, since it controls those records, and we will help it respond.",
    ],
  },
  {
    heading: "Age",
    paragraphs: ["CannaTrace is for businesses and their adult staff. It is not directed at children, and we do not knowingly collect information from anyone under 18."],
  },
  {
    heading: "Changes",
    paragraphs: ["If we change this policy we will update the date at the top, and tell account owners about important changes before they apply."],
  },
];

export default function PrivacyPage() {
  return (
    <LegalPage
      current="/privacy"
      title="Privacy Policy"
      intro="This explains what CannaTrace collects, why, who can see it, and the choices you have. We have tried to keep it short and plain."
      sections={SECTIONS}
    />
  );
}
