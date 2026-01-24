/**
 * Base interface for all transaction items (Parking, AccessCard, EntranceTransaction, BarOrder)
 * Mirrors the backend TransactionItemDto class
 */
export interface TransactionItemDto {
  id: string;
  createdAt: string;
  total: number;
  transactionType: string;
  transactionId: string | null;
}

/**
 * Possible transaction types returned by the backend
 */
export type TransactionType = "Parking" | "AccessCard" | "Entrance" | "BarOrder";
