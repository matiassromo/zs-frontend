"use client";

import React from "react";
import type { CashMoveType } from "@/types/cashbox";

export function MoveDialog({
  open,
  type,
  onClose,
  onSubmit,
}: {
  open: boolean;
  type: CashMoveType;
  onClose: () => void;
  onSubmit: (data: { amount: number; concept: string; createdBy: string }) => void;
}) {
  const [amount, setAmount] = React.useState<string>("");
  const [concept, setConcept] = React.useState<string>("");
  const [createdBy, setCreatedBy] = React.useState<string>("operador");

  React.useEffect(() => {
    if (open) {
      setAmount("");
      setConcept("");
      setCreatedBy("operador");
    }
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
      <div className="w-full max-w-md rounded-2xl bg-white shadow-xl border">
        <div className="p-5 border-b">
          <div className="text-lg font-semibold">
            {type === "Ingreso" ? "Nuevo ingreso" : "Nuevo egreso"}
          </div>
          <div className="text-sm text-slate-500">Movimiento manual.</div>
        </div>

        <div className="p-5 space-y-4">
          <label className="block">
            <div className="text-sm font-medium mb-1">Monto</div>
            <input
              className="w-full rounded-xl border px-3 py-2 outline-none focus:ring-2 focus:ring-slate-200"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
            />
          </label>

          <label className="block">
            <div className="text-sm font-medium mb-1">Concepto</div>
            <input
              className="w-full rounded-xl border px-3 py-2 outline-none focus:ring-2 focus:ring-slate-200"
              value={concept}
              onChange={(e) => setConcept(e.target.value)}
              placeholder="Ej: compra de insumos"
            />
          </label>

          <label className="block">
            <div className="text-sm font-medium mb-1">Usuario</div>
            <input
              className="w-full rounded-xl border px-3 py-2 outline-none focus:ring-2 focus:ring-slate-200"
              value={createdBy}
              onChange={(e) => setCreatedBy(e.target.value)}
              placeholder="operador"
            />
          </label>
        </div>

        <div className="p-5 border-t flex gap-2 justify-end">
          <button className="px-4 py-2 rounded-xl border" onClick={onClose}>
            Cancelar
          </button>
          <button
            className="px-4 py-2 rounded-xl bg-slate-900 text-white"
            onClick={() =>
              onSubmit({
                amount: Number(amount),
                concept,
                createdBy,
              })
            }
          >
            Guardar
          </button>
        </div>
      </div>
    </div>
  );
}
