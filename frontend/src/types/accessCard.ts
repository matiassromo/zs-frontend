// src/types/accessCard.ts

import { TransactionItemDto } from "./transactionItem";

/**
 * Represents an AccessCard entity in the system
 * Extends TransactionItemDto with access card-specific fields
 */
export interface AccessCard extends TransactionItemDto {
  uses: number;
  holderName?: string;
}

export interface AccessCardRequestDto {
  transactionId?: string | null;
  total?: number;
  uses?: number;
  holderName?: string;
}
