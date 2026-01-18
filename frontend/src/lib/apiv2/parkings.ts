// src/lib/apiv2/parkings.ts
import { Parking, ParkingRequestDto } from "@/types/parking";
import { http } from "./http";

function isNonEmptyGuid(v: any): v is string {
  if (typeof v !== "string") return false;
  const s = v.trim().toLowerCase();
  if (s === "00000000-0000-0000-0000-000000000000") return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(s);
}

export async function listParkings(): Promise<Parking[]> {
  const dtos = await http<any[]>(`/api/Parkings`);
  return dtos.map(normalize);
}

export async function getParking(id: string): Promise<Parking | null> {
  try {
    const dto = await http<any>(`/api/Parkings/${id}`);
    return dto ? normalize(dto) : null;
  } catch (err: any) {
    if (err?.status === 404) return null;
    throw err;
  }
}

export async function createParking(input: ParkingRequestDto): Promise<Parking> {
  const safe: ParkingRequestDto = {
    ...input,
    transactionId: isNonEmptyGuid((input as any).transactionId) ? (input as any).transactionId : null,
  };

  const dto = await http<any>(`/api/Parkings`, {
    method: "POST",
    body: JSON.stringify(safe),
  });

  return normalize(dto);
}

export async function updateParking(id: string, input: ParkingRequestDto): Promise<Parking> {
  const safe: ParkingRequestDto = {
    ...input,
    transactionId: isNonEmptyGuid((input as any).transactionId) ? (input as any).transactionId : null,
  };

  const dto = await http<any>(`/api/Parkings/${id}`, {
    method: "PUT",
    body: JSON.stringify(safe),
  });

  return normalize(dto);
}

export async function deleteParking(id: string): Promise<void> {
  await http<void>(`/api/Parkings/${id}`, { method: "DELETE" });
}

function normalize(dto: any): Parking {
  const tx = dto.transactionId ?? dto.TransactionId ?? null;
  return {
    id: dto.id ?? dto.Id,
    createdAt: dto.createdAt ?? dto.CreatedAt,
    total: dto.total ?? dto.Total ?? 0,
    transactionType: dto.transactionType ?? dto.TransactionType,
    transactionId: isNonEmptyGuid(tx) ? tx : null,
    parkingDate: dto.parkingDate ?? dto.ParkingDate,
    parkingEntryTime: dto.parkingEntryTime ?? dto.ParkingEntryTime,
    parkingExitTime: dto.parkingExitTime ?? dto.ParkingExitTime ?? null,
  } as Parking;
}

export default {
  listParkings,
  getParking,
  createParking,
  updateParking,
  deleteParking,
};
