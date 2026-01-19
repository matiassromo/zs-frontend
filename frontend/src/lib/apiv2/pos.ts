// frontend/src/lib/apiv2/pos.ts
// POS adapter: maps legacy account operations to Transaction-based backend

import {
  Transaction,
  TransactionStatus,
} from "@/types/transaction";
import {
  listTransactions,
  createTransaction,
  closeTransaction,
  getTransaction
} from "./transactions";
import {
  createEntranceTransaction,
  getEntranceTransactionByTransactionId,
  updateEntranceTransaction
} from "./entranceTransactions";
import { createPayment } from "./payments";
import { PaymentType } from "@/types/payment";
import { assignKey, releaseKey, listKeys } from "./keys";
import { getTodayCashBox } from "./cashboxes";
import { CashBoxStatus } from "@/types/cashbox";
import { toDateKey } from "./dateUtils";

// Types matching legacy accounts.ts interface
export type PosAccountStatus = "Abierta" | "Cerrada";

export interface PosAccount {
  id: string;
  status: PosAccountStatus;
  openedAt: string;
  closedAt?: string | null;
  clientId: string;
  clientName: string;
  gender: "M" | "F";
  entryType: "normal" | "pass";
  requiresParking?: boolean;
  peopleCount?: number;
  counts?: { A: number; N: number; TE: number; D: number };
}

export interface AccountSummary {
  id: string;
  clientId: string;
  clientName: string;
  status: PosAccountStatus;
  openedAt: string;
  closedAt?: string | null;
  totalCargos: number;
  totalPagos: number;
  saldo: number;
  gender?: "M" | "F";
  entryType?: "normal" | "pass";
  requiresParking?: boolean;
  peopleCount?: number;
  counts?: { A: number; N: number; TE: number; D: number };
}

// Map backend Transaction to PosAccount
function transactionToPosAccount(tx: Transaction): PosAccount {
  const entrance = tx.transactionItems?.find(
    item => item.transactionType === "Entrance"
  );

  const counts = entrance ? {
    A: (entrance as any).numberAdults ?? 0,
    N: (entrance as any).numberChildren ?? 0,
    TE: (entrance as any).numberSeniors ?? 0,
    D: (entrance as any).numberDisabled ?? 0,
  } : { A: 0, N: 0, TE: 0, D: 0 };

  const peopleCount = counts.A + counts.N + counts.TE + counts.D;

  return {
    id: tx.id,
    status: tx.status === TransactionStatus.Open ? "Abierta" : "Cerrada",
    openedAt: tx.openedAt,
    closedAt: tx.closedAt,
    clientId: tx.clientId,
    clientName: tx.client?.name ?? "",
    gender: "M", // Default, not stored in backend
    entryType: "normal", // Determined by presence of AccessCard item
    peopleCount,
    counts,
  };
}

function transactionToSummary(tx: Transaction): AccountSummary {
  const base = transactionToPosAccount(tx);

  const totalCargos = tx.transactionItems?.reduce(
    (sum, item) => sum + (item.total ?? 0), 0
  ) ?? 0;

  const totalPagos = tx.payments?.reduce(
    (sum, p) => sum + (p.total ?? 0), 0
  ) ?? 0;

  return {
    ...base,
    totalCargos,
    totalPagos,
    saldo: totalCargos - totalPagos,
  };
}

/**
 * List today's POS accounts (transactions)
 */
export async function listAccountsToday(): Promise<PosAccount[]> {
  const all = await listTransactions();
  const today = toDateKey(new Date());

  return all
    .filter(tx => (tx.openedAt ?? "").slice(0, 10) === today)
    .map(transactionToPosAccount)
    .sort((a, b) => b.openedAt.localeCompare(a.openedAt));
}

/**
 * Get account summary by ID
 */
export async function getAccount(id: string): Promise<AccountSummary> {
  const tx = await getTransaction(id);
  if (!tx) throw new Error("Cuenta no encontrada.");
  return transactionToSummary(tx);
}

/**
 * Open a new POS account (create transaction + entrance)
 */
export async function openAccount(input: {
  clientId: string;
  clientName: string;
  gender: "M" | "F";
  entryType: "normal" | "pass";
  counts?: { A: number; N: number; TE: number; D: number };
  peopleCount: number;
  keys?: { items: Array<{ keyId: string; number: number; gender: "H" | "M" }>; duration: string };
  requiresParking?: boolean;
}): Promise<PosAccount> {
  // 1. Verify cashbox is open
  const cashbox = await getTodayCashBox();
  if (!cashbox || cashbox.status !== CashBoxStatus.Open) {
    throw new Error("Debes abrir la caja del día antes de crear cuentas.");
  }

  // 2. Create transaction
  const tx = await createTransaction({ clientId: input.clientId });

  // 3. Create entrance transaction if normal entry
  if (input.entryType === "normal" && input.counts) {
    const now = new Date();
    await createEntranceTransaction({
      transactionId: tx.id,
      entranceDate: now.toISOString().slice(0, 10),
      entranceEntryTime: now.toTimeString().slice(0, 8),
      numberAdults: input.counts.A,
      numberChildren: input.counts.N,
      numberSeniors: input.counts.TE,
      numberDisabled: input.counts.D,
    });
  }

  // 4. Assign keys if selected
  if (input.keys?.items?.length) {
    const allKeys = await listKeys();
    const sorted = [...allKeys].sort((a, b) => a.id.localeCompare(b.id));

    for (const sel of input.keys.items) {
      // Find key by position (gender zone + number)
      const targetIndex = sel.gender === "H"
        ? sel.number - 1
        : 16 + sel.number - 1;

      const key = sorted[targetIndex];
      if (key && key.available) {
        await assignKey(key.id, {
          visitorName: input.clientName,
          transactionId: tx.id,
          notes: `Cuenta ${tx.id.slice(0, 8)} - ${input.clientName}`,
        });
      }
    }
  }

  // Refetch to get full data
  const final = await getTransaction(tx.id);
  return transactionToPosAccount(final!);
}

/**
 * Close an account (transaction)
 */
export async function closeAccount(id: string): Promise<PosAccount | undefined> {
  // 1. Release all keys assigned to this transaction
  const allKeys = await listKeys();
  const assigned = allKeys.filter(k =>
    !k.available &&
    (k.notes?.includes(`Cuenta ${id}`) || k.lastAssignedTo === id)
  );

  for (const key of assigned) {
    await releaseKey(key.id);
  }

  // 2. Update entrance exit time
  const entrance = await getEntranceTransactionByTransactionId(id);
  if (entrance && !entrance.entranceExitTime) {
    const now = new Date();
    await updateEntranceTransaction(entrance.id, {
      transactionId: id,
      entranceDate: entrance.entranceDate,
      entranceEntryTime: entrance.entranceEntryTime,
      entranceExitTime: now.toTimeString().slice(0, 8),
      numberAdults: entrance.numberAdults,
      numberChildren: entrance.numberChildren,
      numberSeniors: entrance.numberSeniors,
      numberDisabled: entrance.numberDisabled,
    });
  }

  // 3. Close transaction
  const closed = await closeTransaction(id);
  return transactionToPosAccount(closed);
}

/**
 * Add payment to transaction
 */
export async function addPayment(
  transactionId: string,
  input: { method: "Efectivo" | "Transferencia"; amount: number; note?: string }
): Promise<void> {
  await createPayment({
    transactionId,
    total: input.amount,
    type: input.method === "Efectivo" ? PaymentType.Efectivo : PaymentType.Transferencia,
  });
}

/**
 * Get charges (transaction items) for an account
 */
export async function listCharges(id: string): Promise<any[]> {
  const tx = await getTransaction(id);
  if (!tx) return [];

  return (tx.transactionItems ?? []).map(item => ({
    id: item.id,
    kind: item.transactionType === "Entrance" ? "Normal" : item.transactionType,
    concept: formatItemConcept(item),
    qty: 1,
    amount: item.total,
    total: item.total,
    status: "Pendiente", // Backend doesn't track individual charge status
    createdAt: item.createdAt,
  }));
}

function formatItemConcept(item: any): string {
  switch (item.transactionType) {
    case "Entrance":
      return "Entrada";
    case "Parking":
      return "Parqueadero";
    case "BarOrder":
      return `Bar: Orden`;
    case "AccessCard":
      return "Tarjeta 10 pases";
    default:
      return item.transactionType ?? "Cargo";
  }
}

/**
 * Get payments for an account
 */
export async function listPayments(id: string): Promise<any[]> {
  const tx = await getTransaction(id);
  if (!tx) return [];

  return (tx.payments ?? []).map(p => ({
    id: p.id,
    method: p.type === PaymentType.Efectivo ? "Efectivo" : "Transferencia",
    amount: p.total,
    createdAt: p.createdAt,
  }));
}

// Prices - TODO: fetch from backend
export const PRICES = {
  A: 7.0,
  N: 4.0,
  TE: 5.0,
  D: 5.0,
  AC: 0.0, // Acompañante - removed from scope, kept for backward compatibility
  PASS: 55.0,
  KEY_1H: 0.0,
  KEY_8H: 0.0,
  KEY_2M: 0.0,
};

export default {
  listAccountsToday,
  getAccount,
  openAccount,
  closeAccount,
  addPayment,
  listCharges,
  listPayments,
  PRICES,
};
