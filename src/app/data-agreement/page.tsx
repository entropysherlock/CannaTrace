import type { Metadata } from "next";
import { LegalPage } from "@/components/legal-page";
import { LEGAL, type LegalSection } from "@/lib/legal";

export const metadata: Metadata = { title: "Data Agreement · CannaTrace", description: "How CannaTrace handles a business's data on its behalf." };

const SECTIONS: LegalSection[] = [
  {
    heading: "Roles",
    paragraphs: [
      "The business using CannaTrace (\"you\") controls its data: you decide what to enter and why. CannaTrace (\"we\") handles that data on your behalf to provide the service. This agreement sits alongside the Terms of Service and Privacy Policy and applies whenever we handle personal information for you, such as staff details and rewards members.",
    ],
  },
  {
    heading: "What we will do",
    items: [
      "Use your data only to provide, secure and support CannaTrace for you, and as you instruct through the app or in writing.",
      "Keep it confidential, and limit access to people who need it to run the service and who are bound to keep it private.",
      "Keep your data separate from other businesses' data and show it only to people you have given access.",
      "Use reasonable safeguards: encrypted connections, hashed passwords, permission levels set by your owner, an audit trail, and encrypted backups.",
      "Not sell your data, and not use your customers' contact details to market to them.",
    ],
  },
  {
    heading: "Outside services",
    paragraphs: ["You agree we may use the following services to run CannaTrace, and we will make sure each is bound to protect the data. We will tell account owners before adding a new one that handles your stored data."],
    items: LEGAL.providers.map((p) => `${p.name}: ${p.does}.`),
  },
  {
    heading: "If something goes wrong",
    paragraphs: [
      "If we learn that your data was accessed or disclosed without permission, we will tell the account owner without undue delay, aiming for within 72 hours, with what we know about what happened and what we are doing. We will help you meet any notice duties you have to your customers or regulators.",
    ],
  },
  {
    heading: "Helping with requests",
    paragraphs: [
      "If a rewards member or another person asks you to see, fix or delete their information, the app lets you do most of it yourself, including deleting a rewards member. If you need our help, we will give it within a reasonable time. If a person contacts us about your data, we will point them to you.",
    ],
  },
  {
    heading: "Your responsibilities",
    items: [
      "Have the right to collect the data you enter, and tell the people you collect it from what you do with it. For rewards, use the sign-up agreement at the register honestly and only for the program.",
      "Keep your staff list and permissions up to date, and use strong passwords.",
      "Keep any records the law requires you to keep. CannaTrace is not a substitute for NMS2S or your license records.",
    ],
  },
  {
    heading: "Returning and deleting data",
    paragraphs: [
      "You can export your data as spreadsheets at any time. When the account ends, we keep it available for 30 days so you can download it, then delete it. Backups roll off within about 30 days after that. We may keep what the law requires.",
    ],
  },
  {
    heading: "Checking our work",
    paragraphs: ["On reasonable written request, we will answer questions about how we protect your data and share the information we reasonably can. This is not a right to access other businesses' data or our systems."],
  },
  {
    heading: "Legal requests",
    paragraphs: ["If we receive a legal demand for your data, we will tell you first where the law allows and share only what we are legally required to."],
  },
  {
    heading: "Who we are and which law applies",
    paragraphs: [`${LEGAL.operator}, ${LEGAL.place}. This agreement is governed by New Mexico law, the same as the Terms of Service. If it conflicts with the Terms on how we handle personal data, this agreement controls.`],
  },
];

export default function DataAgreementPage() {
  return (
    <LegalPage
      current="/data-agreement"
      title="Data Agreement"
      intro="This agreement explains how CannaTrace handles a business's data, including personal information about its staff and its rewards members, on the business's behalf."
      sections={SECTIONS}
    />
  );
}
