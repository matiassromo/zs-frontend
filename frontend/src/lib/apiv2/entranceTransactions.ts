import { EntranceTransaction, EntranceTransactionRequestDto } from "@/types/entranceTransaction";
import { http } from "./http";

/**
 * Retrieves all entrance transaction records from the backend
 * @returns Promise<EntranceTransaction[]> - Array of all entrance transaction records
 */
export async function listEntranceTransactions(): Promise<EntranceTransaction[]> {
  const dtos = await http<any[]>(`/api/EntranceTransactions`);
  return dtos.map(normalize);
}

/**
 * Retrieves a single entrance transaction record by ID
 * @param id - The UUID of the entrance transaction record to retrieve
 * @returns Promise<EntranceTransaction | null> - The entrance transaction record or null if not found
 */
export async function getEntranceTransaction(id: string): Promise<EntranceTransaction | null> {
  try {
    const dto = await http<any>(`/api/EntranceTransactions/${id}`);
    return dto ? normalize(dto) : null;
  } catch (err: any) {
    if (err?.status === 404) return null;
    throw err;
  }
}

/**
 * Creates a new entrance transaction record
 * @param input - The entrance transaction data to create
 * @returns Promise<EntranceTransaction> - The newly created entrance transaction record
 */
export async function createEntranceTransaction(input: EntranceTransactionRequestDto): Promise<EntranceTransaction> {
  const dto = await http<any>(`/api/EntranceTransactions`, {
    method: "POST",
    body: JSON.stringify(input),
  });
  return normalize(dto);
}

/**
 * Updates an existing entrance transaction record
 * @param id - The UUID of the entrance transaction record to update
 * @param input - The updated entrance transaction data
 * @returns Promise<EntranceTransaction> - The updated entrance transaction record
 */
export async function updateEntranceTransaction(id: string, input: EntranceTransactionRequestDto): Promise<EntranceTransaction> {
  const dto = await http<any>(`/api/EntranceTransactions/${id}`, {
    method: "PUT",
    body: JSON.stringify(input),
  });
  return normalize(dto);
}

/**
 * Deletes an entrance transaction record
 * @param id - The UUID of the entrance transaction record to delete
 * @returns Promise<void>
 */
export async function deleteEntranceTransaction(id: string): Promise<void> {
  await http<void>(`/api/EntranceTransactions/${id}`, { method: "DELETE" });
}

/**
 * Normalizes the backend DTO to the frontend EntranceTransaction interface
 * Handles both PascalCase (C#) and camelCase property names
 * @param dto - The raw DTO from the backend
 * @returns EntranceTransaction - The normalized entrance transaction object
 */
function normalize(dto: any): EntranceTransaction {
  return {
    // TransactionItemDto base fields
    id: dto.id ?? dto.Id,
    createdAt: dto.createdAt ?? dto.CreatedAt,
    total: dto.total ?? dto.Total ?? 0,
    transactionType: dto.transactionType ?? dto.TransactionType,
    transactionId: dto.transactionId ?? dto.TransactionId ?? null,
    // EntranceTransaction-specific fields
    entranceDate: dto.entranceDate ?? dto.EntranceDate,
    entranceEntryTime: dto.entranceEntryTime ?? dto.EntranceEntryTime,
    entranceExitTime: dto.entranceExitTime ?? dto.EntranceExitTime ?? null,
    numberAdults: dto.numberAdults ?? dto.NumberAdults,
    numberChildren: dto.numberChildren ?? dto.NumberChildren,
    numberSeniors: dto.numberSeniors ?? dto.NumberSeniors,
    numberDisabled: dto.numberDisabled ?? dto.NumberDisabled,
  } as EntranceTransaction;
}

export default {
  listEntranceTransactions,
  getEntranceTransaction,
  createEntranceTransaction,
  updateEntranceTransaction,
  deleteEntranceTransaction,
};
