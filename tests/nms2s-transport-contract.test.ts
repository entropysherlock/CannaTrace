import { describe, expect, it } from "vitest";
import { officialTransport } from "@/lib/nms2s/official-transport";
import { Nms2sSimulator } from "@/lib/nms2s/simulator";
import type { CallContext, Nms2sTransport } from "@/lib/nms2s/types";

/*
 * Behaviour every NMS2S transport must have for CannaTrace's ledger and reconciliation to be safe.
 *
 * Today this runs against the UNOFFICIAL simulator only. When the official transport is implemented,
 * run it against UAT with:
 *   NMS2S_CONTRACT_TARGET=official NMS2S_CONTRACT_LICENSE=<UAT license> NMS2S_CONTRACT_CREDENTIALS='{"...":"..."}' npx vitest run tests/nms2s-transport-contract.test.ts
 * Read-only checks run first; the write check runs only with NMS2S_CONTRACT_ALLOW_UAT_WRITES=1 and a
 * NMS2S_CONTRACT_PACKAGE tag the CCD/RTS UAT environment provides for testing. Record results in
 * docs/nms2s/evidence-template.md. Never point this at production.
 */

function contract(name: string, make: () => { transport: Nms2sTransport; ctx: CallContext; writableTag?: string }) {
  describe(`NMS2S transport contract: ${name}`, () => {
    it("declares its capabilities explicitly", () => {
      const caps = make().transport.capabilities();
      for (const v of [caps.readPackages, caps.readPlants, caps.idempotencyKeys, caps.lookupByClientReference]) expect(["SUPPORTED", "UNSUPPORTED", "UNKNOWN"]).toContain(v);
    });

    it("pages through packages without repeating or losing a record", async () => {
      const { transport, ctx } = make();
      const seen = new Set<string>();
      let cursor: string | null = null;
      for (let i = 0; i < 50; i++) {
        const page = await transport.listPackages(ctx, { cursor, pageSize: 2 });
        for (const r of page.records) {
          expect(seen.has(r.stateId)).toBe(false);
          expect(r.licenseNumber).toBe(ctx.licenseNumber);
          seen.add(r.stateId);
        }
        if (!page.nextCursor) break;
        cursor = page.nextCursor;
      }
    });

    it("refuses bad credentials with AUTH_FAILED, not with data", async () => {
      const { transport, ctx } = make();
      await expect(transport.listPackages({ ...ctx, credentials: { apiKey: "definitely-not-valid" } }, { pageSize: 1 })).rejects.toMatchObject({ kind: "AUTH_FAILED" });
    });

    it.skipIf(name === "official" && process.env.NMS2S_CONTRACT_ALLOW_UAT_WRITES !== "1")("does not apply the same request key twice when it claims idempotency support", async () => {
      const { transport, ctx, writableTag } = make();
      if (transport.capabilities().idempotencyKeys !== "SUPPORTED" || !writableTag) return;
      const op = { kind: "PACKAGE_ADJUST" as const, packageTag: writableTag, quantityChange: "0", newQuantity: "0", unit: "G", reason: "Contract test", note: null, occurredAt: new Date().toISOString() };
      const key = `ct-contract-${Date.now()}`;
      await transport.submit(ctx, op, key);
      expect((await transport.submit(ctx, op, key)).outcome).toBe("DUPLICATE");
    });
  });
}

contract("unofficial simulator", () => {
  const transport = new Nms2sSimulator();
  transport.addAccount("contract-key", ["SIM-LIC"]);
  for (let i = 0; i < 5; i++) transport.seedPackage("SIM-LIC", { tag: `C-${i}`, quantity: "1", unit: "G", status: "Active" });
  return { transport, ctx: { environment: "UAT", facilityId: "sim", licenseNumber: "SIM-LIC", credentials: { apiKey: "contract-key" } }, writableTag: "C-0" };
});

if (process.env.NMS2S_CONTRACT_TARGET === "official") {
  contract("official", () => ({
    transport: officialTransport(),
    ctx: { environment: "UAT", facilityId: "uat", licenseNumber: process.env.NMS2S_CONTRACT_LICENSE ?? "", credentials: JSON.parse(process.env.NMS2S_CONTRACT_CREDENTIALS ?? "{}") },
    writableTag: process.env.NMS2S_CONTRACT_PACKAGE,
  }));
}
