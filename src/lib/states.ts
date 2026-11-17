import { PACKS } from "./rules";

/** Every US state plus DC. CannaTrace doesn't decide which allow cannabis; the business picks its own. */
export const US_STATES: { code: string; name: string }[] = [
  ["AL", "Alabama"], ["AK", "Alaska"], ["AZ", "Arizona"], ["AR", "Arkansas"], ["CA", "California"], ["CO", "Colorado"],
  ["CT", "Connecticut"], ["DE", "Delaware"], ["DC", "District of Columbia"], ["FL", "Florida"], ["GA", "Georgia"],
  ["HI", "Hawaii"], ["ID", "Idaho"], ["IL", "Illinois"], ["IN", "Indiana"], ["IA", "Iowa"], ["KS", "Kansas"],
  ["KY", "Kentucky"], ["LA", "Louisiana"], ["ME", "Maine"], ["MD", "Maryland"], ["MA", "Massachusetts"],
  ["MI", "Michigan"], ["MN", "Minnesota"], ["MS", "Mississippi"], ["MO", "Missouri"], ["MT", "Montana"],
  ["NE", "Nebraska"], ["NV", "Nevada"], ["NH", "New Hampshire"], ["NJ", "New Jersey"], ["NM", "New Mexico"],
  ["NY", "New York"], ["NC", "North Carolina"], ["ND", "North Dakota"], ["OH", "Ohio"], ["OK", "Oklahoma"],
  ["OR", "Oregon"], ["PA", "Pennsylvania"], ["RI", "Rhode Island"], ["SC", "South Carolina"], ["SD", "South Dakota"],
  ["TN", "Tennessee"], ["TX", "Texas"], ["UT", "Utah"], ["VT", "Vermont"], ["VA", "Virginia"], ["WA", "Washington"],
  ["WV", "West Virginia"], ["WI", "Wisconsin"], ["WY", "Wyoming"],
].map(([code, name]) => ({ code, name }));

export const isStateCode = (code: string) => US_STATES.some((s) => s.code === code);
export const stateName = (code: string) => US_STATES.find((s) => s.code === code)?.name ?? code;
/** Whether CannaTrace has a verified rule pack for the state (purchase limits, ages, testing, waste). */
export const hasRulePack = (code: string) => Boolean(PACKS[code]);

/** The states CannaTrace sells in: adult-use is legal there and the state's rules are built in. */
export const SUPPORTED_STATES = US_STATES.filter((s) => hasRulePack(s.code));
export const isSupportedState = (code: string) => SUPPORTED_STATES.some((s) => s.code === code);
