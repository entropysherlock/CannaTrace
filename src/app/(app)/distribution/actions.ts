"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  addOrderLine,
  allocateToOrder,
  cancelOrder,
  confirmOrder,
  createCustomer,
  createDriver,
  createOrder,
  createPriceList,
  createVehicle,
  deliverOrder,
  packOrder,
  recordPayment,
  removeOrderLine,
  reopenOrder,
  setCustomerPriceList,
  setPrice,
  shipOrder,
  unallocateFromOrder,
  verifyCustomerLicense,
} from "@/lib/distribution";
import { field, toFormError, type FormState } from "@/lib/form";
import { InventoryError, type Actor } from "@/lib/inventory";
import { can, type Permission } from "@/lib/rbac";
import { PermissionError, requireSession } from "@/lib/session";

async function actorWith(...anyOf: Permission[]): Promise<Actor> {
  const session = await requireSession();
  if (!anyOf.some((permission) => can(session.role, permission))) {
    throw new PermissionError("Your role does not allow this action. Ask an owner or manager for access.");
  }
  return { userId: session.userId, userName: session.name, orgId: session.orgId, facilityId: session.facilityId };
}
const seller = () => actorWith("sales.write");
const fulfiller = () => actorWith("sales.write", "inventory.write");
const refresh = () => revalidatePath("/distribution", "layout");

export async function customerAction(_state: FormState, formData: FormData): Promise<FormState> {
  let id: string;
  try {
    const customer = await createCustomer(await seller(), {
      name: field(formData, "name"),
      licenseNumber: field(formData, "licenseNumber"),
      licenseType: field(formData, "licenseType"),
      licenseExpires: field(formData, "licenseExpires"),
      contactName: field(formData, "contactName"),
      email: field(formData, "email"),
      phone: field(formData, "phone"),
      address: field(formData, "address"),
      paymentTermsDays: field(formData, "paymentTermsDays"),
    });
    id = customer.id;
  } catch (error) {
    return toFormError(error);
  }
  refresh();
  redirect(`/distribution/customers/${id}`);
}

export async function verifyLicenseAction(_state: FormState, formData: FormData): Promise<FormState> {
  try {
    await verifyCustomerLicense(await seller(), {
      customerId: field(formData, "customerId"),
      licenseExpires: field(formData, "licenseExpires"),
    });
    refresh();
    return { ok: "License marked as verified." };
  } catch (error) {
    return toFormError(error);
  }
}

export async function customerPriceListAction(_state: FormState, formData: FormData): Promise<FormState> {
  try {
    await setCustomerPriceList(await seller(), { customerId: field(formData, "customerId"), priceListId: field(formData, "priceListId") });
    refresh();
    return { ok: "Price list saved." };
  } catch (error) {
    return toFormError(error);
  }
}

export async function priceListAction(_state: FormState, formData: FormData): Promise<FormState> {
  try {
    const name = field(formData, "name");
    await createPriceList(await seller(), { name });
    refresh();
    return { ok: `Added ${name}.` };
  } catch (error) {
    return toFormError(error);
  }
}

export async function priceAction(_state: FormState, formData: FormData): Promise<FormState> {
  try {
    await setPrice(await seller(), { priceListId: field(formData, "priceListId"), itemId: field(formData, "itemId"), price: field(formData, "price") });
    refresh();
    return { ok: "Price saved." };
  } catch (error) {
    return toFormError(error);
  }
}

export async function driverAction(_state: FormState, formData: FormData): Promise<FormState> {
  try {
    const name = field(formData, "name");
    await createDriver(await seller(), { name, licenseNumber: field(formData, "licenseNumber"), phone: field(formData, "phone") });
    refresh();
    return { ok: `Added ${name}.` };
  } catch (error) {
    return toFormError(error);
  }
}

export async function vehicleAction(_state: FormState, formData: FormData): Promise<FormState> {
  try {
    await createVehicle(await seller(), { make: field(formData, "make"), model: field(formData, "model"), plate: field(formData, "plate") });
    refresh();
    return { ok: "Vehicle added." };
  } catch (error) {
    return toFormError(error);
  }
}

export async function orderAction(_state: FormState, formData: FormData): Promise<FormState> {
  let id: string;
  try {
    const order = await createOrder(await seller(), { customerId: field(formData, "customerId"), notes: field(formData, "notes") });
    id = order.id;
  } catch (error) {
    return toFormError(error);
  }
  refresh();
  redirect(`/distribution/orders/${id}`);
}

export async function lineAction(_state: FormState, formData: FormData): Promise<FormState> {
  try {
    await addOrderLine(await seller(), {
      orderId: field(formData, "orderId"),
      itemId: field(formData, "itemId"),
      quantity: field(formData, "quantity"),
      unitPrice: field(formData, "unitPrice"),
    });
    refresh();
    return { ok: "Line added." };
  } catch (error) {
    return toFormError(error);
  }
}

export async function removeLineAction(_state: FormState, formData: FormData): Promise<FormState> {
  try {
    await removeOrderLine(await seller(), { lineId: field(formData, "lineId") });
    refresh();
    return null;
  } catch (error) {
    return toFormError(error);
  }
}

/** Confirm, pack, reopen, or cancel an order. */
export async function orderStepAction(_state: FormState, formData: FormData): Promise<FormState> {
  try {
    const orderId = field(formData, "orderId");
    const step = field(formData, "step");
    if (step === "confirm") await confirmOrder(await seller(), { orderId });
    else if (step === "pack") await packOrder(await fulfiller(), { orderId });
    else if (step === "reopen") await reopenOrder(await fulfiller(), { orderId });
    else if (step === "cancel") await cancelOrder(await seller(), { orderId });
    else throw new InventoryError("Unknown step.");
    refresh();
    revalidatePath("/inventory");
    return null;
  } catch (error) {
    return toFormError(error);
  }
}

export async function allocateAction(_state: FormState, formData: FormData): Promise<FormState> {
  try {
    const pkg = await allocateToOrder(await fulfiller(), {
      orderId: field(formData, "orderId"),
      lineId: field(formData, "lineId"),
      tag: field(formData, "tag"),
      quantity: field(formData, "quantity"),
      newTag: field(formData, "newTag"),
    });
    refresh();
    revalidatePath("/inventory");
    return { ok: `Picked ${pkg.tag}.` };
  } catch (error) {
    return toFormError(error);
  }
}

export async function unallocateAction(_state: FormState, formData: FormData): Promise<FormState> {
  try {
    await unallocateFromOrder(await fulfiller(), { allocationId: field(formData, "allocationId") });
    refresh();
    revalidatePath("/inventory");
    return null;
  } catch (error) {
    return toFormError(error);
  }
}

export async function shipAction(_state: FormState, formData: FormData): Promise<FormState> {
  try {
    await shipOrder(await fulfiller(), {
      orderId: field(formData, "orderId"),
      driverId: field(formData, "driverId"),
      vehicleId: field(formData, "vehicleId"),
      departAt: field(formData, "departAt"),
      routeNotes: field(formData, "routeNotes"),
    });
    refresh();
    revalidatePath("/inventory");
    return null;
  } catch (error) {
    return toFormError(error);
  }
}

export async function deliverAction(_state: FormState, formData: FormData): Promise<FormState> {
  try {
    await deliverOrder(await fulfiller(), { orderId: field(formData, "orderId"), receivedBy: field(formData, "receivedBy") });
    refresh();
    return null;
  } catch (error) {
    return toFormError(error);
  }
}

export async function paymentAction(_state: FormState, formData: FormData): Promise<FormState> {
  try {
    const result = await recordPayment(await seller(), {
      invoiceId: field(formData, "invoiceId"),
      amount: field(formData, "amount"),
      method: field(formData, "method"),
      paidOn: field(formData, "paidOn"),
      reference: field(formData, "reference"),
    });
    refresh();
    return { ok: result.balance === "0.00" ? "Payment recorded. This invoice is paid in full." : `Payment recorded. $${result.balance} still owed.` };
  } catch (error) {
    return toFormError(error);
  }
}
