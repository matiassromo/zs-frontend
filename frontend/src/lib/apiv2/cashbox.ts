// src/lib/apiv2/cashbox.ts
import { http } from "./http";
import type { CashMove, CashMoveType, Cashbox, CashboxTotals, PaymentSummary } from "@/types/cashbox";
import { emitDashboardInvalidate } from "@/lib/events/bus";

const LS_PREFIX = "zs.cashbox.v1";
const LS_BOXES_KEY = `${LS_PREFIX}.boxes`; // record por dateKey
const LS_MANUAL_MOVES_KEY = `${LS_PREFIX}.manualMoves`; // record por dateKey -> CashMove[]
const LS_POS_PAY_MOVES_KEY = `${LS_PREFIX}.posPayMoves`; // ✅ record por dateKey -> CashMove[] (pagos del POS)

function uid() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const c: any = globalThis.crypto;
  return c?.randomUUID?.() ?? `id_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

export function toDateKey(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function parseDateKey(dateKey: string): Date {
  const [y, m, d] = dateKey.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1, 0, 0, 0, 0);
}

function dayRangeISO(dateKey: string) {
  const start = parseDateKey(dateKey);
  const end = new Date(start);
  end.setHours(23, 59, 59, 999);
  return { fromIso: start.toISOString(), toIso: end.toISOString() };
}

function readJson<T>(key: string): T | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function writeJson<T>(key: string, value: T) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(key, JSON.stringify(value));

  // ✅ importante: storage NO dispara en el mismo tab
  emitDashboardInvalidate();
}


type BoxesStore = Record<string, Cashbox>;
type ManualMovesStore = Record<string, CashMove[]>;
type PosPayMovesStore = Record<string, CashMove[]>;

function readBoxes(): BoxesStore {
  return readJson<BoxesStore>(LS_BOXES_KEY) ?? {};
}
function writeBoxes(store: BoxesStore) {
  writeJson(LS_BOXES_KEY, store);
}

function readManualMovesStore(): ManualMovesStore {
  return readJson<ManualMovesStore>(LS_MANUAL_MOVES_KEY) ?? {};
}
function writeManualMovesStore(store: ManualMovesStore) {
  writeJson(LS_MANUAL_MOVES_KEY, store);
}

// ✅ Pagos capturados desde el POS (local)
function readPosPayMovesStore(): PosPayMovesStore {
  return readJson<PosPayMovesStore>(LS_POS_PAY_MOVES_KEY) ?? {};
}
function writePosPayMovesStore(store: PosPayMovesStore) {
  writeJson(LS_POS_PAY_MOVES_KEY, store);
}

export function getCashboxByDate(dateKey: string): Cashbox | null {
  const boxes = readBoxes();
  return boxes[dateKey] ?? null;
}

export function openCashbox(params: { dateKey: string; openingAmount: number; openedBy: string }): Cashbox {
  const boxes = readBoxes();
  const existing = boxes[params.dateKey];

  if (existing && existing.status === "Abierta") return existing;

  const now = new Date().toISOString();
  const box: Cashbox = {
    id: existing?.id ?? uid(),
    dateKey: params.dateKey,
    status: "Abierta",
    openedAt: now,
    openedBy: params.openedBy,
    openingAmount: Number(params.openingAmount) || 0,
  };

  boxes[params.dateKey] = box;
  writeBoxes(boxes);

  // asegurar stores
  const mm = readManualMovesStore();
  if (!mm[params.dateKey]) {
    mm[params.dateKey] = [];
    writeManualMovesStore(mm);
  }
  const pm = readPosPayMovesStore();
  if (!pm[params.dateKey]) {
    pm[params.dateKey] = [];
    writePosPayMovesStore(pm);
  }

  return box;
}

export function closeCashbox(params: { dateKey: string; countedCash: number; closedBy: string; note?: string }): Cashbox {
  const boxes = readBoxes();
  const box = boxes[params.dateKey];
  if (!box) throw new Error("No existe caja para esa fecha.");
  if (box.status !== "Abierta") return box;

  const now = new Date().toISOString();
  const closed: Cashbox = {
    ...box,
    status: "Cerrada",
    closedAt: now,
    closedBy: params.closedBy,
    countedCash: Number(params.countedCash) || 0,
    note: params.note?.trim() || undefined,
  };

  boxes[params.dateKey] = closed;
  writeBoxes(boxes);
  return closed;
}

export function listManualMoves(dateKey: string): CashMove[] {
  const store = readManualMovesStore();
  return store[dateKey] ?? [];
}

export function addManualMove(params: {
  dateKey: string;
  type: CashMoveType;
  amount: number;
  concept: string;
  createdBy: string;
}): CashMove {
  const box = getCashboxByDate(params.dateKey);
  if (!box || box.status !== "Abierta") throw new Error("Caja no está abierta para esa fecha.");

  const amount = Number(params.amount);
  if (!Number.isFinite(amount) || amount <= 0) throw new Error("Monto inválido.");

  const move: CashMove = {
    id: uid(),
    dateKey: params.dateKey,
    type: params.type,
    source: "Manual",
    concept: params.concept.trim() || "(Sin concepto)",
    amount,
    createdAt: new Date().toISOString(),
    createdBy: params.createdBy,
  };

  const store = readManualMovesStore();
  const arr = store[params.dateKey] ?? [];
  arr.unshift(move);
  store[params.dateKey] = arr;
  writeManualMovesStore(store);

  return move;
}

export function deleteManualMove(dateKey: string, id: string) {
  const store = readManualMovesStore();
  const arr = store[dateKey] ?? [];
  store[dateKey] = arr.filter((m) => m.id !== id);
  writeManualMovesStore(store);
}

/* =======================
   ✅ PAGOS DESDE EL POS
   ======================= */

export function addPosPaymentMove(params: {
  dateKey: string;
  amount: number;
  method: "Efectivo" | "Transferencia";
  concept: string;
  createdBy?: string;
  ref?: { kind: string; id: string };
  createdAt?: string;
}) {
  const box = getCashboxByDate(params.dateKey);
  if (!box || box.status !== "Abierta") throw new Error("Caja no está abierta para esa fecha.");

  const amount = Number(params.amount);
  if (!Number.isFinite(amount) || amount <= 0) throw new Error("Monto inválido.");

  const move: CashMove = {
    id: `pospay_${uid()}`,
    dateKey: params.dateKey,
    type: "Ingreso",
    source: "Payment",
    concept: params.concept?.trim() || `Pago (${params.method})`,
    amount,
    createdAt: params.createdAt ?? new Date().toISOString(),
    createdBy: params.createdBy ?? "pos",
    ref: params.ref,
    payment: {
      paymentType: params.method,
      bankName: params.method === "Transferencia" ? "Transferencia" : "Efectivo",
    },
  } as any;

  const store = readPosPayMovesStore();
  const arr = store[params.dateKey] ?? [];
  arr.unshift(move);
  store[params.dateKey] = arr;
  writePosPayMovesStore(store);

  return move;
}

export function listPosPaymentMoves(dateKey: string): CashMove[] {
  const store = readPosPayMovesStore();
  return store[dateKey] ?? [];
}

/** Tu enum PaymentType en Swagger es 0/1. Mapeo a texto. Ajusta si tu backend define otra cosa. */
function paymentTypeLabel(type: unknown): string {
  const n = typeof type === "number" ? type : Number(type);
  if (n === 0) return "Efectivo";
  if (n === 1) return "Transferencia";
  return `Tipo ${String(type)}`;
}

/** Extrae fecha del Payment (GET). Si tu backend no devuelve fecha, no se puede filtrar por día. */
function paymentDateISO(p: any): string | null {
  const raw =
    p.paidAt ??
    p.createdAt ??
    p.createdOn ??
    p.date ??
    p.paymentDate ??
    p.timestamp ??
    p.created_at;

  if (!raw) return null;

  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

/**
 * Lee pagos del backend y/o local (POS).
 * ✅ PRIORIDAD: local POS (siempre funciona)
 * ✅ BACKEND: se intenta si trae fecha; si no trae, se omite
 */
export async function listPaymentMoves(dateKey: string): Promise<CashMove[]> {
  const box = getCashboxByDate(dateKey);
  if (!box) return [];

  // 1) pagos del POS guardados localmente
  const local = listPosPaymentMoves(dateKey);

  // 2) intentar backend (opcional)
  const { fromIso, toIso } = dayRangeISO(dateKey);

  let pays: any[] = [];
  try {
    pays = await http<any[]>("/api/Payments");
  } catch {
    // si falla backend, igual devolvemos local
    return [...local].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  }

  const backendMoves: CashMove[] = [];

  for (const p of Array.isArray(pays) ? pays : []) {
    const amountNum = Number(p.total);
    if (!Number.isFinite(amountNum) || amountNum === 0) continue;

    const iso = paymentDateISO(p);
    if (!iso) continue; // backend sin fecha => no histórico

    if (iso < fromIso || iso > toIso) continue;

    const typeLabel = paymentTypeLabel(p.type);

    const move: CashMove = {
      id: `pay_${p.id ?? uid()}`,
      dateKey,
      type: amountNum < 0 ? "Egreso" : "Ingreso",
      source: "Payment",
      concept: `Pago (${typeLabel})`,
      amount: Math.abs(amountNum),
      createdAt: iso,
      createdBy: p.createdBy ?? p.user ?? "system",
      ref: { kind: "Payment", id: p.id ?? "unknown" },
      payment: { paymentType: typeLabel },
    } as any;

    if (p.transactionId) {
      move.concept = `Pago (${typeLabel}) — Tx ${String(p.transactionId).slice(0, 8)}`;
    }

    backendMoves.push(move);
  }

  // 3) merge local + backend (evitar duplicados por ref.id si coincide)
  const seen = new Set<string>();
  const merged: CashMove[] = [];

  for (const m of [...local, ...backendMoves]) {
    const key = (m.ref?.id ? `${m.ref.kind}:${m.ref.id}` : m.id) as string;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(m);
  }

  merged.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  return merged;
}

export function mergeMoves(manual: CashMove[], payments: CashMove[]): CashMove[] {
  const merged = [...manual, ...payments];
  merged.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  return merged;
}

export function calcTotals(openingAmount: number, moves: CashMove[], countedCash?: number): CashboxTotals {
  let ingresos = 0;
  let egresos = 0;

  for (const m of moves) {
    if (m.type === "Ingreso") ingresos += m.amount;
    else egresos += m.amount;
  }

  const theoretical = openingAmount + ingresos - egresos;

  const totals: CashboxTotals = {
    opening: openingAmount,
    ingresos,
    egresos,
    theoretical,
  };

  if (typeof countedCash === "number") {
    totals.counted = countedCash;
    totals.diff = countedCash - theoretical;
  }

  return totals;
}

/** Resumen por método (Efectivo/Transferencia). */
export function summarizePayments(moves: CashMove[]): PaymentSummary[] {
  const map = new Map<string, PaymentSummary>();

  for (const m of moves) {
    if (m.source !== "Payment") continue;
    const pt = (m.payment?.paymentType ?? "Desconocido").trim();
    const key = pt;
    const label = pt;

    const prev = map.get(key);
    if (!prev) {
      map.set(key, { key, label, amount: m.amount, count: 1 });
    } else {
      prev.amount += m.amount;
      prev.count += 1;
    }
  }

  const arr = Array.from(map.values());
  arr.sort((a, b) => b.amount - a.amount);
  return arr;
}

export function listCashboxDates(): string[] {
  const boxes = readBoxes();
  return Object.keys(boxes).sort((a, b) => (a < b ? 1 : -1));
}
