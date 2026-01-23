// src/app/facturacion/reportes/ventas/page.tsx
"use client";

import React from "react";
import { CashboxReportModal } from "@/components/cashbox/CashBoxReportModal";
import {
  toDateKey,
  dayRange,
  monthRange,
  yearRange,
  listSales,
  summarizeSales,
  buildSalesReportHtml,
  type SalesRow,
} from "@/lib/apiv2/salesReport";

function money(n: number) {
  return `$${Number(n || 0).toFixed(2)}`;
}

export default function VentasReportPage() {
  const [mode, setMode] = React.useState<"dia" | "mes" | "anio" | "rango">("mes");

  // Evitar hydration mismatch: setear “hoy” solo en useEffect
  const [day, setDay] = React.useState<string>("");
  const [month, setMonth] = React.useState<string>("");
  const [year, setYear] = React.useState<string>("");

  const [from, setFrom] = React.useState<string>("");
  const [to, setTo] = React.useState<string>("");

  const [rows, setRows] = React.useState<SalesRow[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);

  const [openReport, setOpenReport] = React.useState(false);
  const [reportHtml, setReportHtml] = React.useState("");

  React.useEffect(() => {
    const dk = toDateKey(new Date());
    const mk = dk.slice(0, 7);
    const yk = dk.slice(0, 4);
    setDay(dk);
    setMonth(mk);
    setYear(yk);

    const { fromIso, toIso } = monthRange(mk);
    setFrom(fromIso);
    setTo(toIso);
  }, []);

  // Recalcular rango cuando cambia modo/inputs
  React.useEffect(() => {
    try {
      if (mode === "dia" && day) {
        const { fromIso, toIso } = dayRange(day);
        setFrom(fromIso);
        setTo(toIso);
      }
      if (mode === "mes" && month) {
        const { fromIso, toIso } = monthRange(month);
        setFrom(fromIso);
        setTo(toIso);
      }
      if (mode === "anio" && year) {
        const { fromIso, toIso } = yearRange(Number(year));
        setFrom(fromIso);
        setTo(toIso);
      }
      // rango: from/to los edita el user
    } catch {
      // ignore
    }
  }, [mode, day, month, year]);

  async function refresh() {
    if (!from || !to) return;
    setLoading(true);
    setErr(null);
    try {
      const data = await listSales(from, to);
      setRows(data);
    } catch (e: any) {
      setRows([]);
      setErr(e?.message ?? "No se pudo cargar ventas.");
    } finally {
      setLoading(false);
    }
  }

  React.useEffect(() => {
    if (!from || !to) return;
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to]);

    // ✅ auto-refresco cuando POS escribe en caja diaria
  React.useEffect(() => {
    async function onCashboxChanged() {
      // refresca solo si el rango ya está listo
      if (!from || !to) return;
      await refresh();
    }

    window.addEventListener("zs:cashbox-changed", onCashboxChanged as any);

    // soporte multi-tab
    let bc: BroadcastChannel | null = null;
    try {
      bc = new BroadcastChannel("zs:bus");
      bc.onmessage = async (evt) => {
        const data = (evt as any)?.data;
        if (data?.type !== "cashbox-changed") return;
        await onCashboxChanged();
      };
    } catch {}

    return () => {
      window.removeEventListener("zs:cashbox-changed", onCashboxChanged as any);
      try { bc?.close(); } catch {}
    };
  }, [from, to]); // eslint-disable-line react-hooks/exhaustive-deps


  const summary = React.useMemo(() => summarizeSales(rows), [rows]);

  function openReportModal() {
    const title =
      mode === "dia" ? `Reporte de Ventas (Día ${day})`
      : mode === "mes" ? `Reporte de Ventas (Mes ${month})`
      : mode === "anio" ? `Reporte de Ventas (Año ${year})`
      : `Reporte de Ventas (Rango)`;

    const html = buildSalesReportHtml({
      title,
      fromIso: from,
      toIso: to,
      rows,
      summary,
    });

    setReportHtml(html);
    setOpenReport(true);
  }

  return (
    <div className="p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-sm text-slate-500">FACTURACIÓN</div>
          <div className="text-2xl font-semibold">Reporte de Ventas</div>
          <div className="mt-1 text-sm text-slate-500">
            Rango: <span className="font-medium text-slate-800">{from ? new Date(from).toLocaleString() : "-"}</span>
            {" "}→{" "}
            <span className="font-medium text-slate-800">{to ? new Date(to).toLocaleString() : "-"}</span>
          </div>
          {err ? <div className="mt-2 text-sm text-rose-700">{err}</div> : null}
        </div>

        <div className="flex gap-2 items-center">
          <select
            className="px-3 py-2 rounded-xl border bg-white text-sm"
            value={mode}
            onChange={(e) => setMode(e.target.value as any)}
          >
            <option value="dia">Día</option>
            <option value="mes">Mes</option>
            <option value="anio">Año</option>
            <option value="rango">Rango</option>
          </select>

          {mode === "dia" ? (
            <input
              type="date"
              className="px-3 py-2 rounded-xl border bg-white text-sm"
              value={day}
              onChange={(e) => setDay(e.target.value)}
            />
          ) : null}

          {mode === "mes" ? (
            <input
              type="month"
              className="px-3 py-2 rounded-xl border bg-white text-sm"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
            />
          ) : null}

          {mode === "anio" ? (
            <input
              type="number"
              className="px-3 py-2 rounded-xl border bg-white text-sm w-[110px]"
              value={year}
              onChange={(e) => setYear(e.target.value)}
              min={2000}
              max={2100}
            />
          ) : null}

          {mode === "rango" ? (
            <>
              <input
                type="datetime-local"
                className="px-3 py-2 rounded-xl border bg-white text-sm"
                value={from ? new Date(from).toISOString().slice(0, 16) : ""}
                onChange={(e) => setFrom(new Date(e.target.value).toISOString())}
              />
              <input
                type="datetime-local"
                className="px-3 py-2 rounded-xl border bg-white text-sm"
                value={to ? new Date(to).toISOString().slice(0, 16) : ""}
                onChange={(e) => setTo(new Date(e.target.value).toISOString())}
              />
            </>
          ) : null}

          <button className="px-4 py-2 rounded-xl border" onClick={refresh} disabled={loading}>
            {loading ? "Actualizando..." : "Refrescar"}
          </button>

          <button
            className="px-4 py-2 rounded-xl bg-slate-900 text-white disabled:opacity-50"
            onClick={openReportModal}
            disabled={loading}
          >
            Ver Reporte
          </button>
        </div>
      </div>

      <div className="mt-6 grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="rounded-2xl border bg-white p-4">
          <div className="text-xs text-slate-500">Total ventas</div>
          <div className="mt-1 text-2xl font-semibold">{money(summary.total)}</div>
        </div>
        <div className="rounded-2xl border bg-white p-4">
          <div className="text-xs text-slate-500"># Transacciones</div>
          <div className="mt-1 text-2xl font-semibold">{summary.count}</div>
        </div>
        <div className="rounded-2xl border bg-white p-4">
          <div className="text-xs text-slate-500">Promedio</div>
          <div className="mt-1 text-2xl font-semibold">
            {money(summary.count ? summary.total / summary.count : 0)}
          </div>
        </div>
      </div>

      <div className="mt-6 rounded-2xl border bg-white">
        <div className="p-4 border-b flex items-center justify-between">
          <div className="font-semibold">Ventas</div>
          <div className="text-xs text-slate-500">{rows.length} registros</div>
        </div>

        {rows.length === 0 ? (
          <div className="p-4 text-sm text-slate-500">Sin ventas en el rango.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-slate-500">
                <tr className="border-b">
                  <th className="text-left py-2 px-3">Fecha</th>
                  <th className="text-left py-2 px-3">Método</th>
                  <th className="text-left py-2 px-3">Banco/Ref/Tx</th>
                  <th className="text-right py-2 px-3">Monto</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const extra = [
                    r.bankName ? `Banco: ${r.bankName}` : "",
                    r.reference ? `Ref: ${r.reference}` : "",
                    r.transactionId ? `Tx: ${String(r.transactionId).slice(0, 10)}` : "",
                  ].filter(Boolean).join(" | ");

                  return (
                    <tr key={r.id} className="border-b last:border-b-0">
                      <td className="py-2 px-3">{new Date(r.paidAtIso).toLocaleString()}</td>
                      <td className="py-2 px-3">
                        <span className="px-2 py-1 rounded text-xs bg-slate-100 text-slate-700">{r.method}</span>
                      </td>
                      <td className="py-2 px-3 text-slate-600">{extra || "—"}</td>
                      <td className="py-2 px-3 text-right font-medium">{money(r.total)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <CashboxReportModal
        open={openReport}
        title={"Reporte de Ventas"}
        html={reportHtml}
        onClose={() => setOpenReport(false)}
      />
    </div>
  );
}
