// src/components/cashbox/CloseCashDialog.tsx
"use client";

import React from "react";
import type { CashboxTotals } from "@/types/cashbox";

export function CloseCashDialog({
  open,
  totals,
  onClose,
  onSubmit,
}: {
  open: boolean;
  totals: CashboxTotals;
  onClose: () => void;
  onSubmit: (data: { countedCash: number; closedBy: string; note?: string; printReport: boolean }) => void;
}) {
  const [counted, setCounted] = React.useState<string>("");
  const [closedBy, setClosedBy] = React.useState<string>("operador");
  const [note, setNote] = React.useState<string>("");
  const [printReport, setPrintReport] = React.useState<boolean>(true);

  React.useEffect(() => {
    if (open) {
      setCounted(String(totals.theoretical.toFixed(2)));
      setClosedBy("operador");
      setNote("");
      setPrintReport(true);
    }
  }, [open, totals.theoretical]);

  if (!open) return null;

  const countedNum = Number(counted);
  const diff = Number.isFinite(countedNum) ? countedNum - totals.theoretical : NaN;

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
      <div className="w-full max-w-lg rounded-2xl bg-white shadow-xl border">
        <div className="p-5 border-b">
          <div className="text-lg font-semibold">Cerrar caja</div>
          <div className="text-sm text-slate-500">Arqueo: contado vs teórico.</div>
        </div>

        <div className="p-5 space-y-4">
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="rounded-xl border p-3">
              <div className="text-slate-500">Saldo inicial</div>
              <div className="font-semibold">${totals.opening.toFixed(2)}</div>
            </div>
            <div className="rounded-xl border p-3">
              <div className="text-slate-500">Saldo teórico</div>
              <div className="font-semibold">${totals.theoretical.toFixed(2)}</div>
            </div>
          </div>

          <label className="block">
            <div className="text-sm font-medium mb-1">Efectivo contado</div>
            <input
              className="w-full rounded-xl border px-3 py-2 outline-none focus:ring-2 focus:ring-slate-200"
              inputMode="decimal"
              value={counted}
              onChange={(e) => setCounted(e.target.value)}
              placeholder="0.00"
            />
            <div className="text-xs text-slate-500 mt-1">
              Diferencia:{" "}
              {Number.isFinite(diff) ? (
                <span className={diff === 0 ? "text-emerald-700" : diff > 0 ? "text-blue-700" : "text-rose-700"}>
                  ${diff.toFixed(2)}
                </span>
              ) : (
                "-"
              )}
            </div>
          </label>

          <label className="block">
            <div className="text-sm font-medium mb-1">Usuario</div>
            <input
              className="w-full rounded-xl border px-3 py-2 outline-none focus:ring-2 focus:ring-slate-200"
              value={closedBy}
              onChange={(e) => setClosedBy(e.target.value)}
              placeholder="operador"
            />
          </label>

          <label className="block">
            <div className="text-sm font-medium mb-1">Nota (opcional)</div>
            <input
              className="w-full rounded-xl border px-3 py-2 outline-none focus:ring-2 focus:ring-slate-200"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Ej: faltante por cambio"
            />
          </label>

          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={printReport} onChange={(e) => setPrintReport(e.target.checked)} />
            Imprimir reporte al cerrar
          </label>
        </div>

        <div className="p-5 border-t flex gap-2 justify-end">
          <button className="px-4 py-2 rounded-xl border" onClick={onClose}>
            Cancelar
          </button>
          <button
            className="px-4 py-2 rounded-xl bg-slate-900 text-white"
            onClick={() => onSubmit({ countedCash: Number(counted), closedBy, note, printReport })}
          >
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
}
