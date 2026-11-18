import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auditLogs, locations } from "@/db/schema";
import { db, pool } from "@/lib/db";
import { addRoom, updateRoom, type FacilityActor } from "@/lib/facilities";
import { ROOM_AREAS, isRoomArea, roomAreaLabel } from "@/lib/rooms";
import { createBusiness } from "@/lib/setup";

const hasDb = Boolean(process.env.DATABASE_URL);
const run = Date.now().toString(36);

describe("room area types", () => {
  it("offers the eight area types in growing order", () => {
    expect(ROOM_AREAS.map((a) => a.label)).toEqual([
      "Propagation",
      "Vegetative",
      "Flowering",
      "Harvest",
      "Drying & Trimming",
      "Inventory",
      "Quarantine",
      "Waste",
    ]);
    expect(isRoomArea("FLOWERING")).toBe(true);
    expect(isRoomArea("GARAGE")).toBe(false);
    expect(roomAreaLabel("DRYING_TRIMMING")).toBe("Drying & Trimming");
    expect(roomAreaLabel(null)).toBeNull();
  });
});

let a: FacilityActor;
let b: FacilityActor;

describe.skipIf(!hasDb)("rooms under Settings → Facilities", () => {
  beforeAll(async () => {
    const business = (who: string) => ({
      businessName: `Room Test ${who} ${run}`,
      facilityName: "Main",
      licenseNumber: `R-${who}-${run}`,
      licenseType: "CULTIVATION",
      state: "NM",
      ownerName: `${who} Owner`,
      email: `${who}-owner-${run}@rooms.test`,
      password: "a-long-test-password",
    });
    const toActor = (s: { orgId: string; userId: string; name: string; facilityId: string }) => ({ orgId: s.orgId, userId: s.userId, userName: s.name, facilityId: s.facilityId });
    a = toActor(await createBusiness(business("a"), { onlyIfEmpty: false }));
    b = toActor(await createBusiness(business("b"), { onlyIfEmpty: false }));
  });
  afterAll(() => pool.end());

  it("creates a named room with an area type, and records it in the audit trail", async () => {
    const room = await addRoom(a, a.facilityId, { area: "FLOWERING", name: "  Flower   Room 1 " });
    expect(room).toMatchObject({ name: "Flower Room 1", type: "ROOM", area: "FLOWERING", facilityId: a.facilityId });
    const [log] = await db.select().from(auditLogs).where(and(eq(auditLogs.entityId, room.id), eq(auditLogs.action, "CREATE")));
    expect(log.after).toMatchObject({ name: "Flower Room 1", area: "Flowering" });
  });

  it("refuses a missing area, a made-up area, a blank name, and a duplicate name", async () => {
    await expect(addRoom(a, a.facilityId, { area: "", name: "Veg 1" })).rejects.toThrow(/area type/);
    await expect(addRoom(a, a.facilityId, { area: "GARAGE", name: "Veg 1" })).rejects.toThrow(/area type/);
    await expect(addRoom(a, a.facilityId, { area: "VEGETATIVE", name: "   " })).rejects.toThrow(/name/);
    await expect(addRoom(a, a.facilityId, { area: "QUARANTINE", name: "Flower Room 1" })).rejects.toThrow(/already has/);
  });

  it("allows the same room name at another business", async () => {
    const room = await addRoom(b, b.facilityId, { area: "FLOWERING", name: "Flower Room 1" });
    expect(room.orgId).toBe(b.orgId);
  });

  it("will not add a room to another business's facility", async () => {
    await expect(addRoom(a, b.facilityId, { area: "WASTE", name: "Sneaky" })).rejects.toThrow(/not found/);
  });

  it("renames a room and changes its area type", async () => {
    const room = await addRoom(a, a.facilityId, { area: "PROPAGATION", name: "Clone Room" });
    await updateRoom(a, room.id, { area: "VEGETATIVE", name: "Veg Room A" });
    const [after] = await db.select().from(locations).where(eq(locations.id, room.id));
    expect(after).toMatchObject({ name: "Veg Room A", area: "VEGETATIVE" });
    await expect(updateRoom(a, room.id, { area: "VEGETATIVE", name: "Flower Room 1" })).rejects.toThrow(/already has/);
    await expect(updateRoom(b, room.id, { area: "WASTE", name: "Mine now" })).rejects.toThrow(/not found/);
  });
});
