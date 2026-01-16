import { TransactionItemDto } from "./transactionItem";

/**
 * EntranceTransaction entity type definitions
 * Based on OpenAPI schema: EntranceTransactionRequestDto
 */

/**
 * Represents an EntranceTransaction entity in the system
 * Extends TransactionItemDto with entrance-specific fields
 * Tracks entrance transactions with visitor counts and timing information
 */
export interface EntranceTransaction extends TransactionItemDto {
  entranceDate?: string;
  entranceEntryTime?: string;
  entranceExitTime?: string | null;
  numberAdults?: number;
  numberChildren?: number;
  numberSeniors?: number;
  numberDisabled?: number;
}

/**
 * Request DTO for creating or updating an EntranceTransaction
 * Matches the EntranceTransactionRequestDto schema from the backend
 */
export interface EntranceTransactionRequestDto {
  transactionId?: string | null;
  entranceDate?: string;
  entranceEntryTime?: string;
  entranceExitTime?: string | null;
  numberAdults?: number;
  numberChildren?: number;
  numberSeniors?: number;
  numberDisabled?: number;
}
