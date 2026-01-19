// src/lib/apiv2/cashboxes.ts
// Backend API calls for /api/CashBoxes

import { http } from "./http";
import type {
  CashBoxDto,
  CashBoxStatus,
  CashBoxSummaryDto,
  OpenCashBoxRequestDto,
  CloseCashBoxRequestDto,
} from "@/types/cashbox";
import type { Transaction } from "@/types/transaction";

/**
 * Get today's cashbox (or for a specific date)
 * @param date - Optional ISO date string (defaults to today)
 * @returns The cashbox for the date, or null if none exists
 */
export async function getTodayCashBox(date?: string): Promise<CashBoxDto | null> {
  try {
    const query = date ? `?date=${encodeURIComponent(date)}` : "";
    const dto = await http<any>(`/api/CashBoxes/today${query}`);
    return dto ? normalizeCashBox(dto) : null;
  } catch (err: any) {
    if (err?.status === 404) return null;
    throw err;
  }
}

/**
 * Open a new cashbox
 * @param req - Opening balance and optional notes
 * @returns The newly created cashbox
 */
export async function openCashBox(req: OpenCashBoxRequestDto): Promise<CashBoxDto> {
  const dto = await http<any>(`/api/CashBoxes/open`, {
    method: "POST",
    body: JSON.stringify({
      OpeningBalance: req.openingBalance,
    }),
  });
  return normalizeCashBox(dto);
}

/**
 * Reopen a closed cashbox
 * @param id - The cashbox ID
 * @returns The reopened cashbox
 */
export async function reopenCashBox(id: string): Promise<CashBoxDto> {
  const dto = await http<any>(`/api/CashBoxes/${id}/reopen`, {
    method: "POST",
  });
  return normalizeCashBox(dto);
}

/**
 * Close an open cashbox
 * @param id - The cashbox ID
 * @param req - Closing balance and optional notes
 * @returns The closed cashbox
 */
export async function closeCashBox(id: string, req: CloseCashBoxRequestDto): Promise<CashBoxDto> {
  const dto = await http<any>(`/api/CashBoxes/${id}/close`, {
    method: "POST",
    body: JSON.stringify({
      ClosingBalance: req.closingBalance ?? null,
      Notes: req.notes ?? null,
    }),
  });
  return normalizeCashBox(dto);
}

/**
 * Get cashboxes in a date range
 * @param from - Start date (ISO string)
 * @param to - End date (ISO string)
 * @returns Array of cashboxes in the range
 */
export async function getCashBoxRange(from: string, to: string): Promise<CashBoxDto[]> {
  const query = `?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
  const dtos = await http<any[]>(`/api/CashBoxes/range${query}`);
  return (dtos ?? []).map(normalizeCashBox);
}

/**
 * Get all transactions for a cashbox
 * @param id - The cashbox ID
 * @returns Array of transactions in the cashbox
 */
export async function getCashBoxTransactions(id: string): Promise<Transaction[]> {
  const dtos = await http<any[]>(`/api/CashBoxes/${id}/transactions`);
  return (dtos ?? []).map(normalizeTransaction);
}

/**
 * Get summary for a cashbox
 * @param id - The cashbox ID
 * @returns Summary with totals, payments breakdown, and transaction counts
 */
export async function getCashBoxSummary(id: string): Promise<CashBoxSummaryDto> {
  const dto = await http<any>(`/api/CashBoxes/${id}/summary`);
  return normalizeSummary(dto);
}

/**
 * Normalize backend DTO to frontend CashBoxDto
 */
function normalizeCashBox(dto: any): CashBoxDto {
  return {
    id: dto.id ?? dto.Id,
    status: normalizeStatus(dto.status ?? dto.Status),
    openedAt: dto.openedAt ?? dto.OpenedAt,
    closedAt: dto.closedAt ?? dto.ClosedAt ?? null,
    openingBalance: dto.openingBalance ?? dto.OpeningBalance ?? 0,
    closingBalance: dto.closingBalance ?? dto.ClosingBalance ?? null,
  };
}

/**
 * Normalize status from backend (could be number or string)
 */
function normalizeStatus(status: any): CashBoxStatus {
  if (typeof status === "number") {
    return status as CashBoxStatus;
  }
  if (typeof status === "string") {
    const lower = status.toLowerCase();
    if (lower === "open" || lower === "abierta") return 0; // CashBoxStatus.Open
    if (lower === "closed" || lower === "cerrada") return 1; // CashBoxStatus.Closed
  }
  return 0; // Default to Open
}

/**
 * Normalize transaction from cashbox endpoint
 */
function normalizeTransaction(dto: any): Transaction {
  return {
    id: dto.id ?? dto.Id,
    openedAt: dto.openedAt ?? dto.OpenedAt ?? dto.createdAt ?? dto.CreatedAt,
    closedAt: dto.closedAt ?? dto.ClosedAt ?? null,
    status: dto.status ?? dto.Status ?? 0,
    clientId: dto.clientId ?? dto.ClientId,
    cashBoxId: dto.cashBoxId ?? dto.CashBoxId,
    client: dto.client ?? dto.Client,
    transactionItems: dto.transactionItems ?? dto.TransactionItems ?? [],
    payments: dto.payments ?? dto.Payments ?? [],
  };
}

/**
 * Normalize summary DTO
 */
function normalizeSummary(dto: any): CashBoxSummaryDto {
  return {
    cashBox: normalizeCashBox(dto.cashBox ?? dto.CashBox),
    totalCharges: dto.totalCharges ?? dto.TotalCharges ?? 0,
    totalPayments: dto.totalPayments ?? dto.TotalPayments ?? 0,
    cash: dto.cash ?? dto.Cash ?? 0,
    transfer: dto.transfer ?? dto.Transfer ?? 0,
    openTransactions: dto.openTransactions ?? dto.OpenTransactions ?? 0,
    closedTransactions: dto.closedTransactions ?? dto.ClosedTransactions ?? 0,
  };
}

export default {
  getTodayCashBox,
  openCashBox,
  reopenCashBox,
  closeCashBox,
  getCashBoxRange,
  getCashBoxTransactions,
  getCashBoxSummary,
};
