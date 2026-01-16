import { Parking, ParkingRequestDto } from "@/types/parking";
import { http } from "./http";

/**
 * Retrieves all parking records from the backend
 * @returns Promise<Parking[]> - Array of all parking records
 */
export async function listParkings(): Promise<Parking[]> {
  const dtos = await http<any[]>(`/api/Parkings`);
  return dtos.map(normalize);
}

/**
 * Retrieves a single parking record by ID
 * @param id - The UUID of the parking record to retrieve
 * @returns Promise<Parking | null> - The parking record or null if not found
 */
export async function getParking(id: string): Promise<Parking | null> {
  try {
    const dto = await http<any>(`/api/Parkings/${id}`);
    return dto ? normalize(dto) : null;
  } catch (err: any) {
    if (err?.status === 404) return null;
    throw err;
  }
}

/**
 * Creates a new parking record
 * @param input - The parking data to create
 * @returns Promise<Parking> - The newly created parking record
 */
export async function createParking(input: ParkingRequestDto): Promise<Parking> {
  const dto = await http<any>(`/api/Parkings`, {
    method: "POST",
    body: JSON.stringify(input),
  });
  return normalize(dto);
}

/**
 * Updates an existing parking record
 * @param id - The UUID of the parking record to update
 * @param input - The updated parking data
 * @returns Promise<Parking> - The updated parking record
 */
export async function updateParking(id: string, input: ParkingRequestDto): Promise<Parking> {
  const dto = await http<any>(`/api/Parkings/${id}`, {
    method: "PUT",
    body: JSON.stringify(input),
  });
  return normalize(dto);
}

/**
 * Deletes a parking record
 * @param id - The UUID of the parking record to delete
 * @returns Promise<void>
 */
export async function deleteParking(id: string): Promise<void> {
  await http<void>(`/api/Parkings/${id}`, { method: "DELETE" });
}

/**
 * Normalizes the backend DTO to the frontend Parking interface
 * Handles both PascalCase (C#) and camelCase property names
 * @param dto - The raw DTO from the backend
 * @returns Parking - The normalized parking object
 */
function normalize(dto: any): Parking {
  return {
    // TransactionItemDto base fields
    id: dto.id ?? dto.Id,
    createdAt: dto.createdAt ?? dto.CreatedAt,
    total: dto.total ?? dto.Total ?? 0,
    transactionType: dto.transactionType ?? dto.TransactionType,
    transactionId: dto.transactionId ?? dto.TransactionId ?? null,
    // Parking-specific fields
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
