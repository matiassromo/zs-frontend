import { EntranceAccessCard, EntranceAccessCardRequestDto } from "@/types/entranceAccessCard";
import { http } from "./http";

/**
 * Retrieves all entrance access card records from the backend
 * @returns Promise<EntranceAccessCard[]> - Array of all entrance access card records
 */
export async function listEntranceAccessCards(): Promise<EntranceAccessCard[]> {
  const dtos = await http<any[]>(`/api/EntranceAccessCards`);
  return dtos.map(normalize);
}

/**
 * Retrieves a single entrance access card record by ID
 * @param id - The UUID of the entrance access card record to retrieve
 * @returns Promise<EntranceAccessCard | null> - The entrance access card record or null if not found
 */
export async function getEntranceAccessCard(id: string): Promise<EntranceAccessCard | null> {
  try {
    const dto = await http<any>(`/api/EntranceAccessCards/${id}`);
    return dto ? normalize(dto) : null;
  } catch (err: any) {
    if (err?.status === 404) return null;
    throw err;
  }
}

/**
 * Creates a new entrance access card record
 * @param input - The entrance access card data to create
 * @returns Promise<EntranceAccessCard> - The newly created entrance access card record
 */
export async function createEntranceAccessCard(input: EntranceAccessCardRequestDto): Promise<EntranceAccessCard> {
  const dto = await http<any>(`/api/EntranceAccessCards`, {
    method: "POST",
    body: JSON.stringify(input),
  });
  return normalize(dto);
}

/**
 * Updates an existing entrance access card record
 * @param id - The UUID of the entrance access card record to update
 * @param input - The updated entrance access card data
 * @returns Promise<EntranceAccessCard> - The updated entrance access card record
 */
export async function updateEntranceAccessCard(id: string, input: EntranceAccessCardRequestDto): Promise<EntranceAccessCard> {
  const dto = await http<any>(`/api/EntranceAccessCards/${id}`, {
    method: "PUT",
    body: JSON.stringify(input),
  });
  return normalize(dto);
}

/**
 * Deletes an entrance access card record
 * @param id - The UUID of the entrance access card record to delete
 * @returns Promise<void>
 */
export async function deleteEntranceAccessCard(id: string): Promise<void> {
  await http<void>(`/api/EntranceAccessCards/${id}`, { method: "DELETE" });
}

/**
 * Normalizes the backend DTO to the frontend EntranceAccessCard interface
 * Handles both PascalCase (C#) and camelCase property names
 * @param dto - The raw DTO from the backend
 * @returns EntranceAccessCard - The normalized entrance access card object
 */
function normalize(dto: any): EntranceAccessCard {
  return {
    id: dto.id ?? dto.Id,
    accessCardId: dto.accessCardId ?? dto.AccessCardId,
    entranceDate: dto.entranceDate ?? dto.EntranceDate,
    entranceEntryTime: dto.entranceEntryTime ?? dto.EntranceEntryTime,
    entranceExitTime: dto.entranceExitTime ?? dto.EntranceExitTime ?? null,
    qty: Number(dto.qty ?? dto.Qty ?? 1), // ✅ NUEVO
  };
}


export default {
  listEntranceAccessCards,
  getEntranceAccessCard,
  createEntranceAccessCard,
  updateEntranceAccessCard,
  deleteEntranceAccessCard,
};
