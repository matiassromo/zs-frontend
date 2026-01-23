// src/lib/apiv2/salesReport.ts
"use client";

import {
  getCashboxByDate,
  listManualMoves,
  listPaymentMoves,
  mergeMoves,
} from "@/lib/apiv2/cashbox";

export type SalesRow = {
  id: string;
  paidAtIso: string;
  method: string;
  total: number;
  bankName?: string | null;
  reference?: string | null;
  transactionId?: string | null;
};

export function toDateKey(d: Date) {
  const pad2 = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

export function dayRange(dayKey: string) {
  const fromIso = new Date(`${dayKey}T00:00:00`).toISOString();
  const toIso = new Date(`${dayKey}T23:59:59.999`).toISOString();
  return { fromIso, toIso };
}

export function monthRange(monthKey: string) {
  const [y, m] = monthKey.split("-").map((x) => parseInt(x, 10));
  const from = new Date(y, (m || 1) - 1, 1, 0, 0, 0, 0);
  const to = new Date(y, (m || 1), 0, 23, 59, 59, 999);
  return { fromIso: from.toISOString(), toIso: to.toISOString() };
}

export function yearRange(year: number) {
  const from = new Date(year, 0, 1, 0, 0, 0, 0);
  const to = new Date(year, 11, 31, 23, 59, 59, 999);
  return { fromIso: from.toISOString(), toIso: to.toISOString() };
}

function iterDays(fromIso: string, toIso: string) {
  const out: string[] = [];
  const from = new Date(fromIso);
  const to = new Date(toIso);

  // normaliza a medianoche local para evitar saltos raros
  let cur = new Date(from.getFullYear(), from.getMonth(), from.getDate(), 0, 0, 0, 0);
  const end = new Date(to.getFullYear(), to.getMonth(), to.getDate(), 0, 0, 0, 0);

  while (cur.getTime() <= end.getTime()) {
    out.push(toDateKey(cur));
    cur = new Date(cur.getFullYear(), cur.getMonth(), cur.getDate() + 1, 0, 0, 0, 0);
  }
  return out;
}

/**
 * Ventas = movimientos POS registrados en Caja Diaria.
 *
 * Fuente:
 * - manual: listManualMoves(dateKey)
 * - payments: await listPaymentMoves(dateKey) (backend + local)
 * - merge: mergeMoves(manual, payments)
 *
 * Filtro:
 * - createdBy === "pos"
 * - ref.kind === "Charge" (si existe)
 */
export async function listSales(fromIso: string, toIso: string): Promise<SalesRow[]> {
  const days = iterDays(fromIso, toIso);
  const rows: SalesRow[] = [];

  const fromT = new Date(fromIso).getTime();
  const toT = new Date(toIso).getTime();

  for (const dateKey of days) {
    const cb = getCashboxByDate(dateKey);
    if (!cb) continue;

    const manual = listManualMoves(dateKey);
    const payments = await listPaymentMoves(dateKey);
    const moves = mergeMoves(manual, payments);

    for (const m of moves as any[]) {
      if (String(m?.createdBy ?? "") !== "pos") continue;

      const refKind = String(m?.ref?.kind ?? "");
      if (refKind && refKind !== "Charge") continue;

      const paidAtIso = String(m?.createdAt ?? m?.createdAtIso ?? "");
      const paidAt = paidAtIso ? new Date(paidAtIso) : null;
      if (!paidAt || !Number.isFinite(paidAt.getTime())) continue;

      const t = paidAt.getTime();
      if (t < fromT || t > toT) continue;

      rows.push({
        id: String(m?.id ?? `${dateKey}:${m?.ref?.id ?? Math.random()}`),
        paidAtIso: paidAt.toISOString(),
        method: String(m?.payment?.paymentType ?? m?.method ?? "—"),
        total: Number(m?.amount ?? 0),
        bankName: m?.payment?.bankName ?? null,
        reference: m?.payment?.reference ?? null,
        transactionId: m?.transactionId ?? null,
      });
    }
  }

  // newest first
  rows.sort((a, b) => (a.paidAtIso < b.paidAtIso ? 1 : -1));
  return rows;
}

export function summarizeSales(rows: SalesRow[]) {
  const total = rows.reduce((acc, r) => acc + (Number(r.total) || 0), 0);
  return { total: +total.toFixed(2), count: rows.length };
}

export function buildSalesReportHtml(input: {
  title: string;
  fromIso: string;
  toIso: string;
  rows: SalesRow[];
  summary: { total: number; count: number };
}) {
  const money = (n: number) => `$${Number(n || 0).toFixed(2)}`;
  const avg = input.summary.count ? input.summary.total / input.summary.count : 0;

  const bodyRows = input.rows
    .map((r) => {
      const extra = [
        r.bankName ? `Banco: ${r.bankName}` : "",
        r.reference ? `Ref: ${r.reference}` : "",
        r.transactionId ? `Tx: ${String(r.transactionId).slice(0, 10)}` : "",
      ]
        .filter(Boolean)
        .join(" | ");

      return `
        <tr>
          <td>${new Date(r.paidAtIso).toLocaleString()}</td>
          <td>${r.method}</td>
          <td>${extra || "—"}</td>
          <td style="text-align:right;font-weight:600">${money(r.total)}</td>
        </tr>`;
    })
    .join("");

  return `
  <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial">
    <h2 style="margin:0 0 6px 0">${input.title}</h2>
    <div style="color:#475569;margin-bottom:14px">
      Rango: ${new Date(input.fromIso).toLocaleString()} → ${new Date(input.toIso).toLocaleString()}
    </div>

    <div style="display:flex;gap:12px;margin-bottom:14px">
      <div style="border:1px solid #e2e8f0;border-radius:12px;padding:10px 12px;min-width:160px">
        <div style="font-size:12px;color:#64748b">Total ventas</div>
        <div style="font-size:22px;font-weight:700">${money(input.summary.total)}</div>
      </div>
      <div style="border:1px solid #e2e8f0;border-radius:12px;padding:10px 12px;min-width:160px">
        <div style="font-size:12px;color:#64748b"># Transacciones</div>
        <div style="font-size:22px;font-weight:700">${input.summary.count}</div>
      </div>
      <div style="border:1px solid #e2e8f0;border-radius:12px;padding:10px 12px;min-width:160px">
        <div style="font-size:12px;color:#64748b">Promedio</div>
        <div style="font-size:22px;font-weight:700">${money(avg)}</div>
      </div>
    </div>

    <table style="width:100%;border-collapse:collapse">
      <thead>
        <tr style="text-align:left;color:#64748b;border-bottom:1px solid #e2e8f0">
          <th style="padding:8px">Fecha</th>
          <th style="padding:8px">Método</th>
          <th style="padding:8px">Banco/Ref/Tx</th>
          <th style="padding:8px;text-align:right">Monto</th>
        </tr>
      </thead>
      <tbody>
        ${bodyRows || `<tr><td colspan="4" style="padding:10px;color:#64748b">Sin ventas.</td></tr>`}
      </tbody>
    </table>
  </div>`;
}
