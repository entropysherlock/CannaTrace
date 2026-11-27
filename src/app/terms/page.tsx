import type { Metadata } from "next";
import { LegalPage } from "@/components/legal-page";
import { LEGAL, type LegalSection } from "@/lib/legal";

export const metadata: Metadata = { title: "Terms of Service · Leaf2Sale", description: "The rules for using Leaf2Sale, in plain language." };

const SECTIONS: LegalSection[] = [
  {
    heading: "What Leaf2Sale is",
    paragraphs: [
      "Leaf2Sale is software for licensed cannabis businesses: plants, inventory, labels, sales, reports and Tally, an AI helper. It is a tool for keeping your own records. It is not legal advice and it is not a government system.",
      "New Mexico requires licensees to use NMS2S. Leaf2Sale does not replace it. NMS2S stays your official record, and you are responsible for entering and reporting to it as the law requires.",
    ],
  },
  {
    heading: "Who may use it",
    items: [
      "Businesses that hold, or are applying for, a license to operate in the cannabis industry, and their staff.",
      "You must be at least 21 years old to have an account, and you must have authority to bind the business you sign up.",
      "Accounts are by invitation while we are in early access. We may decline or suspend access at our discretion.",
    ],
  },
  {
    heading: "Your account",
    items: [
      "Keep your password private and use a long, unique one. You are responsible for what happens under your account and your staff's accounts.",
      "The owner decides who on the team can do what. Remove staff who leave.",
      "Tell us right away if you think an account was used without permission.",
    ],
  },
  {
    heading: "Following the law",
    paragraphs: [
      "You are responsible for complying with every law and license condition that applies to your business, including purchase limits, age and ID checks, taxes and state reporting. Features such as limit meters, age checks and compliance checks are aids. They can be wrong or out of date, and they do not make your business compliant by themselves.",
    ],
  },
  {
    heading: "Your data",
    paragraphs: [
      "Your business records are yours. We store and process them only to run Leaf2Sale for you, as described in the Privacy Policy and the Data Agreement. You can download your data as spreadsheets at any time, including after you stop.",
      "You give us permission to host, copy, back up and display your data as needed to provide the service, and to use anonymous, combined statistics that do not identify you or your customers to keep the service working and improve it.",
    ],
  },
  {
    heading: "Your customers' information",
    paragraphs: [
      "If you collect information from your own customers, such as rewards sign-ups, you must have the right to collect it, tell them what you collect and why, and honor their requests. The register's rewards sign-up includes a short agreement for this. You are responsible for using it honestly.",
    ],
  },
  {
    heading: "Tally and other AI features",
    items: [
      "Tally runs on your business's own Claude account. You pay Anthropic directly for what you use, and your questions and the business information needed to answer them are sent to Anthropic for that purpose.",
      "Tally can be wrong. It drafts changes and you review and confirm them. Check anything that matters, especially weights, dates, tax and compliance items, before relying on it.",
    ],
  },
  {
    heading: "Prices and payment",
    paragraphs: [
      "Prices are listed on the Pricing page. Unless we agree otherwise in writing, billing is month to month with no long-term contract, and you can stop at any time. If we change a price, we will give you at least 30 days' notice before it applies to you. We may invoice you rather than charge a card.",
    ],
  },
  {
    heading: "What you must not do",
    items: [
      "Use Leaf2Sale for anything unlawful, or to hide, falsify or misreport records.",
      "Try to get into other businesses' data, probe or attack the service, or overload it.",
      "Copy, resell or reverse engineer the software, or share your access with people outside your business.",
      "Put in data you have no right to use.",
    ],
  },
  {
    heading: "Availability and backups",
    paragraphs: [
      "We work to keep Leaf2Sale running and your data safe, and we take regular backups. But software goes down, and we do not promise it will always be available or error-free. Keep your own records you are required to keep, and keep NMS2S up to date.",
    ],
  },
  {
    heading: "Ending your use",
    paragraphs: [
      "You can stop at any time. We can suspend or end access if you break these terms, do not pay, or put the service or other customers at risk, and we will give notice where we reasonably can. After the account ends, we make your data available for download for 30 days, then delete it as described in the Privacy Policy, except where the law requires us to keep something.",
    ],
  },
  {
    heading: "Our responsibility",
    paragraphs: [
      "Leaf2Sale is provided as is, without warranties of any kind, to the extent the law allows. To the extent the law allows, we are not liable for indirect or consequential losses, lost profits, fines, license actions or lost data, and our total liability for any claim is limited to the amount you paid us in the 12 months before it. Some places do not allow these limits, so they apply only as far as the law permits.",
      "You agree to cover claims brought against us because of your data, your breach of these terms, or your violation of law.",
    ],
  },
  {
    heading: "Changes and disputes",
    paragraphs: [
      "We may update these terms. We will post the new version here and tell account owners about material changes before they apply. Using Leaf2Sale after that means you accept them.",
      `These terms are governed by the laws of the State of New Mexico. Disputes go to the state or federal courts located in Bernalillo County, New Mexico. If we form a company to run Leaf2Sale, these terms pass to that company, and we will tell you. ${LEGAL.operator} is based in ${LEGAL.place}.`,
    ],
  },
];

export default function TermsPage() {
  return (
    <LegalPage
      current="/terms"
      title="Terms of Service"
      intro="These terms are the agreement between you and Leaf2Sale when you use the website, the app, or Tally. Please read them. If you do not agree, do not use Leaf2Sale."
      sections={SECTIONS}
    />
  );
}
