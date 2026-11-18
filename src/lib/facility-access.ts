/**
 * Which facilities a person may work at. `facilityIds` null (or empty) means every facility in the business,
 * and a built-in owner always has every facility. Everything else in CannaTrace is scoped to the session's
 * facility, so keeping the session inside this list keeps every page and action inside it too.
 */
export type FacilityAccess = { role: string; customRoleId?: string | null; facilityIds?: string[] | null };

export function allowedFacilities(access: FacilityAccess): string[] | null {
  if (access.role === "OWNER" && !access.customRoleId) return null;
  return access.facilityIds && access.facilityIds.length > 0 ? access.facilityIds : null;
}

export function canUseFacility(access: FacilityAccess, facilityId: string): boolean {
  const allowed = allowedFacilities(access);
  return allowed === null || allowed.includes(facilityId);
}

/** Keep only the facilities this person may see, in the order given. */
export function visibleFacilities<T extends { id: string }>(list: T[], access: FacilityAccess): T[] {
  return list.filter((f) => canUseFacility(access, f.id));
}

/** Where someone should land: their last facility if they may still use it, else the first one they may use. */
export function homeFacility<T extends { id: string }>(ordered: T[], access: FacilityAccess, lastFacilityId: string | null): T | undefined {
  const usable = visibleFacilities(ordered, access);
  return usable.find((f) => f.id === lastFacilityId) ?? usable[0];
}
