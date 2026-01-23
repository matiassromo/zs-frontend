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
