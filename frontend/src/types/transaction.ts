import { Client } from "./client"
import { Payment } from "./payment";
import { TransactionItemDto } from "./transactionItem";

/**
 * Transaction status enum matching backend
 */
export enum TransactionStatus {
  Open = 0,
  Closed = 1
}

/**
 * Transaction entity represents a transaction record linking a client to transaction items and payments
 */
export interface Transaction {
  id: string;
  openedAt: string;
  closedAt?: string | null;
  status: TransactionStatus;
  clientId: string;
  cashBoxId: string;
  client: Client;
  transactionItems: TransactionItemDto[];
  payments: Payment[];
}

/**
 * Request DTO for creating or updating a transaction
 */
export interface TransactionRequestDto {
  clientId: string;
}
