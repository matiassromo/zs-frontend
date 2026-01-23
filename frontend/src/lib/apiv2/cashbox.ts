// src/lib/apiv2/cashbox.ts
import { http } from "./http";
import type {
  CashMove,
  CashMoveType,
  Cashbox,
  CashboxTotals,
  PaymentSummary,
  CashboxReport,
} from "@/types/cashbox";
import { emitDashboardInvalidate } from "@/lib/events/bus";

const LS_PREFIX = "zs.cashbox.v1";
const LS_BOXES_KEY = `${LS_PREFIX}.boxes`; // record por dateKey
const LS_MANUAL_MOVES_KEY = `${LS_PREFIX}.manualMoves`; // record por dateKey -> CashMove[]
const LS_POS_PAY_MOVES_KEY = `${LS_PREFIX}.posPayMoves`; // record por dateKey -> CashMove[]
const LS_REPORTS_KEY = `${LS_PREFIX}.reports`; // ✅ record por dateKey -> CashboxReport

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
  emitDashboardInvalidate();
}

type BoxesStore = Record<string, Cashbox>;
type ManualMovesStore = Record<string, CashMove[]>;
type PosPayMovesStore = Record<string, CashMove[]>;
type ReportsStore = Record<string, CashboxReport>;

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

function readPosPayMovesStore(): PosPayMovesStore {
  return readJson<PosPayMovesStore>(LS_POS_PAY_MOVES_KEY) ?? {};
}
function writePosPayMovesStore(store: PosPayMovesStore) {
  writeJson(LS_POS_PAY_MOVES_KEY, store);
}

function readReportsStore(): ReportsStore {
  return readJson<ReportsStore>(LS_REPORTS_KEY) ?? {};
}
function writeReportsStore(store: ReportsStore) {
  writeJson(LS_REPORTS_KEY, store);
}

export function getCashboxByDate(dateKey: string): Cashbox | null {
  const boxes = readBoxes();
  return boxes[dateKey] ?? null;
}

export function openCashbox(params: {
  dateKey: string;
  openingAmount: number;
  openedBy: string;
}): Cashbox {
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

export function closeCashbox(params: {
  dateKey: string;
  countedCash: number;
  closedBy: string;
  note?: string;
}): Cashbox {
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

function paymentTypeLabel(type: unknown): string {
  const n = typeof type === "number" ? type : Number(type);
  if (n === 0) return "Efectivo";
  if (n === 1) return "Transferencia";
  return `Tipo ${String(type)}`;
}

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

export async function listPaymentMoves(dateKey: string): Promise<CashMove[]> {
  const box = getCashboxByDate(dateKey);
  if (!box) return [];

  const local = listPosPaymentMoves(dateKey);
  const { fromIso, toIso } = dayRangeISO(dateKey);

  let pays: any[] = [];
  try {
    pays = await http<any[]>("/api/Payments");
  } catch {
    return [...local].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  }

  const backendMoves: CashMove[] = [];

  for (const p of Array.isArray(pays) ? pays : []) {
    const amountNum = Number(p.total);
    if (!Number.isFinite(amountNum) || amountNum === 0) continue;

    const iso = paymentDateISO(p);
    if (!iso) continue;
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

/* =======================
   ✅ REPORTES (snapshot + print)
   ======================= */

export function buildCashboxReport(params: {
  dateKey: string;
  cashbox: Cashbox;
  totals: CashboxTotals;
  moves: CashMove[];
}): CashboxReport {
  const { dateKey, cashbox, totals, moves } = params;

  const safeMoves = Array.isArray(moves) ? moves : [];
  const paymentsSummary = summarizePayments(safeMoves);

  return {
    id: uid(),
    dateKey,
    title: "Cierre de Caja Diaria",
    generatedAt: new Date().toISOString(),

    status: cashbox.status,

    openedAt: cashbox.openedAt,
    openedBy: cashbox.openedBy,

    closedAt: cashbox.closedAt,
    closedBy: cashbox.closedBy,

    openingAmount: totals.opening,
    ingresos: totals.ingresos,
    egresos: totals.egresos,
    theoretical: totals.theoretical,

    countedCash: cashbox.countedCash,
    diff: typeof cashbox.countedCash === "number" ? cashbox.countedCash - totals.theoretical : undefined,

    note: cashbox.note,

    paymentsSummary,
    moves: [...safeMoves],
  };
}

export function saveCashboxReport(dateKey: string, report: CashboxReport) {
  const store = readReportsStore();
  store[dateKey] = report;
  writeReportsStore(store);
}

export function getCashboxReport(dateKey: string): CashboxReport | null {
  const store = readReportsStore();
  const r: any = store[dateKey];
  if (!r) return null;

  // ✅ migración tolerante (reportes viejos)
  if (!Array.isArray(r.moves)) r.moves = [];
  if (!Array.isArray(r.paymentsSummary)) r.paymentsSummary = summarizePayments(r.moves);

  if (!r.title) r.title = "Cierre de Caja Diaria";
  if (!r.generatedAt) r.generatedAt = new Date().toISOString();

  return r as CashboxReport;
}

function esc(s: any): string {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function money(n: number): string {
  const v = Number(n);
  if (!Number.isFinite(v)) return "$0.00";
  return `$${v.toFixed(2)}`;
}

function fmtDateTime(iso?: string) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString();
}

/**
 * ✅ Si opts.returnHtmlOnly=true: NO abre ventana, solo devuelve el HTML listo para escribir en tu propia window.
 * ✅ Si no: se comporta como siempre (abre ventana e imprime).
 */
export function printCashboxReport(
  report: CashboxReport,
  opts?: { returnHtmlOnly?: boolean }
): string | void {
  // ✅ normalizar reportes viejos/incompletos
  const safeMoves = Array.isArray((report as any).moves) ? (report as any).moves : [];
  const safePaymentsSummary = Array.isArray((report as any).paymentsSummary)
    ? (report as any).paymentsSummary
    : summarizePayments(safeMoves);

  const safe: CashboxReport = {
    ...report,
    moves: safeMoves,
    paymentsSummary: safePaymentsSummary,
    title: report.title || "Cierre de Caja Diaria",
    generatedAt: report.generatedAt || new Date().toISOString(),
  };

  const manual = safe.moves.filter((m) => m.source === "Manual");
  const payments = safe.moves.filter((m) => m.source === "Payment");

  const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${esc(safe.title)} - ${esc(safe.dateKey)}</title>
  <style>
    *{box-sizing:border-box}
    body{font-family: ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Arial; margin:24px; color:#0f172a}
    .top{display:flex; justify-content:space-between; align-items:flex-start; gap:16px}
    .brand{font-weight:700; font-size:18px}
    .muted{color:#64748b}
    .card{border:1px solid #e2e8f0; border-radius:16px; padding:14px; background:#fff}
    .grid{display:grid; gap:12px}
    .grid4{grid-template-columns: repeat(4, minmax(0,1fr))}
    .grid2{grid-template-columns: repeat(2, minmax(0,1fr))}
    .title{font-weight:700; font-size:18px}
    .k{font-size:12px; color:#64748b}
    .v{font-size:20px; font-weight:700; margin-top:4px}
    table{width:100%; border-collapse:collapse}
    th,td{border-bottom:1px solid #e2e8f0; padding:10px 8px; font-size:12px; vertical-align:top}
    th{color:#64748b; text-align:left; font-weight:600}
    .right{text-align:right}
    .pill{display:inline-block; padding:4px 8px; border-radius:999px; border:1px solid #e2e8f0; background:#f8fafc; font-size:11px}
    .pill-in{background:#dcfce7; border-color:#bbf7d0; color:#166534}
    .pill-out{background:#ffedd5; border-color:#fed7aa; color:#9a3412}
    .hr{height:1px; background:#e2e8f0; margin:14px 0}
    .section{margin-top:14px}
    .section h3{margin:0 0 8px 0; font-size:14px}
    @media print{ body{margin:10mm} .no-print{display:none} }
  </style>
</head>
<body>
  <div class="top">
    <div>
      <div class="brand">Zero Stress</div>
      <div class="title">${esc(safe.title)}</div>
      <div class="muted">Fecha: <b>${esc(safe.dateKey)}</b> • Estado: <b>${esc(safe.status)}</b></div>
      <div class="muted">Desde: ${esc(fmtDateTime(safe.openedAt))} ${safe.closedAt ? `• Hasta: ${esc(fmtDateTime(safe.closedAt))}` : ""}</div>
      <div class="muted">Generado: ${esc(fmtDateTime(safe.generatedAt))}</div>
    </div>

    <div class="card" style="min-width:260px">
      <div class="k">Operador apertura</div>
      <div style="font-weight:700">${esc(safe.openedBy ?? "-")}</div>
      <div class="hr"></div>
      <div class="k">Operador cierre</div>
      <div style="font-weight:700">${esc(safe.closedBy ?? "-")}</div>
      ${safe.note ? `<div class="hr"></div><div class="k">Nota</div><div>${esc(safe.note)}</div>` : ""}
      <div class="hr"></div>
      <button class="no-print" onclick="window.print()" style="width:100%; padding:10px; border-radius:12px; border:1px solid #0f172a; background:#0f172a; color:#fff; font-weight:700">Imprimir</button>
    </div>
  </div>

  <div class="section grid grid4">
    <div class="card"><div class="k">Saldo Inicial</div><div class="v">${esc(money(safe.openingAmount))}</div></div>
    <div class="card"><div class="k">Ingresos</div><div class="v">${esc(money(safe.ingresos))}</div></div>
    <div class="card"><div class="k">Egresos</div><div class="v">${esc(money(safe.egresos))}</div></div>
    <div class="card"><div class="k">Saldo Teórico</div><div class="v">${esc(money(safe.theoretical))}</div></div>
  </div>

  <div class="section grid grid2">
    <div class="card">
      <h3>Ventas (por medio de pago)</h3>
      <table>
        <thead><tr><th>Método</th><th class="right">Monto</th><th class="right">#</th></tr></thead>
        <tbody>
          ${
            safe.paymentsSummary.length
              ? safe.paymentsSummary
                  .map(
                    (p) =>
                      `<tr><td>${esc(p.label)}</td><td class="right"><b>${esc(money(p.amount))}</b></td><td class="right">${esc(p.count)}</td></tr>`
                  )
                  .join("")
              : `<tr><td colspan="3" class="muted">Sin pagos registrados</td></tr>`
          }
          <tr>
            <td><b>Total ventas</b></td>
            <td class="right"><b>${esc(money(payments.reduce((a, m) => a + m.amount, 0)))}</b></td>
            <td class="right"><b>${esc(payments.length)}</b></td>
          </tr>
        </tbody>
      </table>
    </div>

    <div class="card">
      <h3>Efectivo (arqueo)</h3>
      <table>
        <tbody>
          <tr><td>Contado</td><td class="right"><b>${esc(money(safe.countedCash ?? safe.theoretical))}</b></td></tr>
          <tr><td>Diferencia</td><td class="right"><b>${esc(money(safe.diff ?? 0))}</b></td></tr>
        </tbody>
      </table>
      <div class="hr"></div>
      <div class="muted" style="font-size:12px">
        Manual: <b>${esc(manual.length)}</b> • Payment: <b>${esc(payments.length)}</b> • Total movimientos: <b>${esc(safe.moves.length)}</b>
      </div>
    </div>
  </div>

  <div class="section card">
    <h3>Movimientos</h3>
    ${
      safe.moves.length
        ? `<table>
            <thead>
              <tr>
                <th>Fecha</th><th>Tipo</th><th>Origen</th><th>Concepto</th><th class="right">Monto</th>
              </tr>
            </thead>
            <tbody>
              ${safe.moves
                .map((m) => {
                  const pill =
                    m.type === "Ingreso"
                      ? `<span class="pill pill-in">Ingreso</span>`
                      : `<span class="pill pill-out">Egreso</span>`;

                  const payExtra =
                    m.source === "Payment"
                      ? `<div class="muted" style="font-size:11px">
                          ${m.payment?.paymentType ? `Tipo: ${esc(m.payment.paymentType)}` : ""}
                          ${m.payment?.bankName ? ` • Banco: ${esc(m.payment.bankName)}` : ""}
                          ${m.payment?.reference ? ` • Ref: ${esc(m.payment.reference)}` : ""}
                         </div>`
                      : "";

                  return `<tr>
                    <td>${esc(fmtDateTime(m.createdAt))}</td>
                    <td>${pill}</td>
                    <td><span class="pill">${esc(m.source)}</span></td>
                    <td><b>${esc(m.concept)}</b>${payExtra}</td>
                    <td class="right"><b>${esc(money(m.amount))}</b></td>
                  </tr>`;
                })
                .join("")}
            </tbody>
          </table>`
        : `<div class="muted">Sin movimientos</div>`
    }
  </div>

  <div class="muted" style="margin-top:14px; font-size:11px">
    Reporte generado por Zero Stress • Caja Diaria
  </div>
</body>
</html>`;

  // ✅ si solo quieres HTML (para modal)
  if (opts?.returnHtmlOnly) return html;

  // ✅ si quieres comportamiento viejo (abrir y mostrar)
  if (typeof window === "undefined") return;
  const w = window.open("", "_blank", "noopener,noreferrer,width=980,height=900");
  if (!w) return;
  w.document.open();
  w.document.write(html);
  w.document.close();
  w.focus();
}
