/** A facility that holds practice, sample, demo or test data rather than a real licensed business. */
export function isPracticeFacility(f: { licenseNumber: string; name: string }): boolean {
  return /^(demo|sample|practice|test)/i.test(f.licenseNumber) || /\b(demo|sample|practice|test)\b/i.test(f.name);
}
