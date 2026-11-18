import { roomAreaEnum } from "@/db/schema";

export type RoomArea = (typeof roomAreaEnum.enumValues)[number];

/** The room area types, in the order a plant moves through a facility. */
export const ROOM_AREAS: { value: RoomArea; label: string }[] = [
  { value: "PROPAGATION", label: "Propagation" },
  { value: "VEGETATIVE", label: "Vegetative" },
  { value: "FLOWERING", label: "Flowering" },
  { value: "HARVEST", label: "Harvest" },
  { value: "DRYING_TRIMMING", label: "Drying & Trimming" },
  { value: "INVENTORY", label: "Inventory" },
  { value: "QUARANTINE", label: "Quarantine" },
  { value: "WASTE", label: "Waste" },
];

export const isRoomArea = (v: string): v is RoomArea => ROOM_AREAS.some((a) => a.value === v);

export const roomAreaLabel = (v: string | null | undefined) => ROOM_AREAS.find((a) => a.value === v)?.label ?? null;
