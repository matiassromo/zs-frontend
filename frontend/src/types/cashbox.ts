// ================================
// Backend CashBox API Types
// ================================

/**
 * CashBox status enum matching backend
 */
export enum CashBoxStatus {
  Open = 0,
  Closed = 1
}

/**
 * CashBox DTO from backend API
 */
export interface CashBoxDto {
  id: string;
  status: CashBoxStatus;
  openedAt: string;
  closedAt?: string | null;
  openingBalance: number;
  closingBalance?: number | null;
}

/**
 * Request DTO for opening a new cashbox
 */
export interface OpenCashBoxRequestDto {
  openingBalance: number;
}

/**
 * Request DTO for closing a cashbox
 */
export interface CloseCashBoxRequestDto {
  closingBalance?: number | null;
  notes?: string | null;
}

/**
 * CashBox summary DTO from backend API
 */
export interface CashBoxSummaryDto {
  cashBox: CashBoxDto;
  totalCharges: number;
  totalPayments: number;
  cash: number;
  transfer: number;
  openTransactions: number;
  closedTransactions: number;
}

// ================================
// Legacy Local Storage Types
// (kept for backward compatibility during migration)
// ================================

export type CashboxStatus = "Abierta" | "Cerrada";

export type CashMoveType = "Ingreso" | "Egreso";

export type CashMoveSource =
  | "Manual"
  | "Payment"; // ingreso automático desde backend/POS

export type CashMove = {
  id: string;

  /** Fecha de la caja en formato YYYY-MM-DD (local). */
  dateKey: string;

  type: CashMoveType;
  source: CashMoveSource;

  concept: string;

  /** Siempre positivo. */
  amount: number;

  /** ISO timestamp. */
  createdAt: string;

  createdBy: string;

  /** Referencia a entidad del backend (solo para source Payment). */
  ref?: {
    kind: "Payment";
    id: number | string;
  };

  /** Datos de pago (si aplica) */
  payment?: {
    paymentType?: string; // Efectivo / Transferencia / Tarjeta / etc
    bankName?: string; // Pichincha / Produbanco / etc
    reference?: string; // nro transferencia / voucher
  };
};

export type Cashbox = {
  /** ID local */
  id: string;

  /** Fecha de la caja: YYYY-MM-DD (local) */
  dateKey: string;

  status: CashboxStatus;

  openedAt: string;
  openedBy: string;

  openingAmount: number;

  closedAt?: string;
  closedBy?: string;

  /** efectivo contado al cierre */
  countedCash?: number;

  note?: string;
};

export type CashboxTotals = {
  opening: number;
  ingresos: number;
  egresos: number;

  theoretical: number; // opening + ingresos - egresos

  counted?: number;
  diff?: number; // counted - theoretical
};

export type PaymentSummary = {
  key: string; // p.ej. "Efectivo", "Transferencia:Produbanco"
  label: string;
  amount: number;
  count: number;
};

/** ✅ Reporte “snapshot” (para imprimir/exportar igual al ejemplo) */
export type CashboxReport = {
  id: string;
  dateKey: string;

  title: string; // "Cierre de Caja Diaria"
  generatedAt: string; // ISO

  status: CashboxStatus;

  openedAt?: string;
  openedBy?: string;

  closedAt?: string;
  closedBy?: string;

  openingAmount: number;
  ingresos: number;
  egresos: number;

  theoretical: number;

  countedCash?: number;
  diff?: number;  

  note?: string;

  paymentsSummary: PaymentSummary[];

  moves: CashMove[];
};
