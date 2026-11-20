import { can, type Permission } from "@/lib/rbac";

/** Anyone who can save at least one kind of document may have Tally read it; each kind checks its own permission when it is saved. */
const READERS: Permission[] = ["inventory.write", "cultivation.write", "sales.write", "catalog.manage"];
export const canReadDocuments = (session: Parameters<typeof can>[0]) => READERS.some((p) => can(session, p));
