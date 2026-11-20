import { OfflineRegister } from "@/components/register/offline-register";
import { RegisterShell } from "@/components/register/shell";
import { buildOfflineSnapshot } from "@/lib/offline-snapshot";
import { requirePagePermission } from "@/lib/session";
import { shellInfo } from "../shell-info";

export const metadata = { title: "Offline register" };

/** Sells for cash with no internet. Online it saves a fresh copy of the menu and rules on this device; offline the saved copy is used. */
export default async function OfflineRegisterPage() {
  const session = await requirePagePermission("pos.use");
  const [info, snapshot] = await Promise.all([
    shellInfo(session),
    buildOfflineSnapshot({ userId: session.userId, userName: session.name, orgId: session.orgId, facilityId: session.facilityId }),
  ]);
  return (
    <RegisterShell info={info}>
      <OfflineRegister fresh={snapshot} />
    </RegisterShell>
  );
}
