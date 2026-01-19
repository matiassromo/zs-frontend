import { Transaction, TransactionRequestDto, TransactionStatus } from "@/types/transaction";
import { http } from "./http";

/**
 * Retrieves all transactions from the backend
 * @returns Promise<Transaction[]> Array of all transactions
 */
export async function listTransactions(): Promise<Transaction[]> {
  const dtos = await http<any[]>(`/api/Transactions`);
  return (dtos ?? []).map(normalize);
}

/**
 * Retrieves a single transaction by ID
 * @param id - The UUID of the transaction to retrieve
 * @returns Promise<Transaction | null> The transaction if found, null if not found
 */
export async function getTransaction(id: string): Promise<Transaction | null> {
  try {
    const dto = await http<any>(`/api/Transactions/${id}`);
    return dto ? normalize(dto) : null;
  } catch (err: any) {
    if (err?.status === 404) return null;
    throw err;
  }
}

/**
 * Creates a new transaction
 * @param input - The transaction data (clientId)
 * @returns Promise<Transaction> The created transaction
 */
export async function createTransaction(input: TransactionRequestDto): Promise<Transaction> {
  const dto = await http<any>(`/api/Transactions`, {
    method: "POST",
    body: JSON.stringify(input),
  });
  return normalize(dto);
}

/**
 * Updates an existing transaction
 * @param id - The UUID of the transaction to update
 * @param input - The updated transaction data
 * @returns Promise<Transaction> The updated transaction
 */
export async function updateTransaction(id: string, input: TransactionRequestDto): Promise<Transaction> {
  const dto = await http<any>(`/api/Transactions/${id}`, {
    method: "PUT",
    body: JSON.stringify(input),
  });
  return normalize(dto);
}

/**
 * Deletes a transaction
 * @param id - The UUID of the transaction to delete
 * @returns Promise<void>
 */
export async function deleteTransaction(id: string): Promise<void> {
  await http<void>(`/api/Transactions/${id}`, { method: "DELETE" });
}

/**
 * Closes an open transaction
 * @param id - The UUID of the transaction to close
 * @returns Promise<Transaction> The closed transaction
 */
export async function closeTransaction(id: string): Promise<Transaction> {
  const dto = await http<any>(`/api/Transactions/${id}/close`, {
    method: "POST",
  });
  return normalize(dto);
}

/**
 * Lists all transactions for a specific cashbox
 * @param cashBoxId - The UUID of the cashbox
 * @returns Promise<Transaction[]> Array of transactions in the cashbox
 */
export async function listTransactionsByCashBox(cashBoxId: string): Promise<Transaction[]> {
  const dtos = await http<any[]>(`/api/CashBoxes/${cashBoxId}/transactions`);
  return (dtos ?? []).map(normalize);
}

/**
 * Normalizes backend DTO to frontend Transaction type
 * Handles both PascalCase (C# style) and camelCase property names
 * @param dto - Raw DTO from backend
 * @returns Transaction Normalized transaction object
 */
function normalize(dto: any): Transaction {
  return {
    id: dto.id ?? dto.Id,
    openedAt: dto.openedAt ?? dto.OpenedAt ?? dto.createdAt ?? dto.CreatedAt,
    closedAt: dto.closedAt ?? dto.ClosedAt ?? null,
    status: normalizeStatus(dto.status ?? dto.Status),
    clientId: dto.clientId ?? dto.ClientId,
    cashBoxId: dto.cashBoxId ?? dto.CashBoxId,
    client: dto.client ?? dto.Client,
    transactionItems: dto.transactionItems ?? dto.TransactionItems ?? [],
    payments: dto.payments ?? dto.Payments ?? [],
  };
}

/**
 * Normalize status from backend (could be number or string)
 */
function normalizeStatus(status: any): TransactionStatus {
  if (typeof status === "number") {
    return status as TransactionStatus;
  }
  if (typeof status === "string") {
    const lower = status.toLowerCase();
    if (lower === "open" || lower === "abierta") return TransactionStatus.Open;
    if (lower === "closed" || lower === "cerrada") return TransactionStatus.Closed;
  }
  return TransactionStatus.Open; // Default to Open
}

export default {
  listTransactions,
  getTransaction,
  createTransaction,
  updateTransaction,
  deleteTransaction,
  closeTransaction,
  listTransactionsByCashBox,
};
