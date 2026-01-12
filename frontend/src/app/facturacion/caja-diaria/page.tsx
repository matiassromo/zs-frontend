// src/app/facturacion/caja-diaria/page.tsx
"use client";

import React from "react";
import type { CashMove, Cashbox } from "@/types/cashbox";
import {
  toDateKey,
  getCashboxByDate,
  openCashbox,
  closeCashbox,
  listManualMoves,
  addManualMove,
  deleteManualMove,
  listPaymentMoves,
  mergeMoves,
  calcTotals,
  listCashboxDates,
} from "@/lib/apiv2/cashbox";

import { OpenCashDialog } from "@/components/cashbox/OpenCashDialog";
import { MoveDialog } from "@/components/cashbox/MoveDialog";
import { CloseCashDialog } from "@/components/cashbox/CloseCashDialog";

function money(n: number) {
  return `$${n.toFixed(2)}`;
}

/* ----------------- POS LOCK (por fecha) -----------------
   - Cerrar caja => locked=1 (POS bloqueado)
   - Reabrir (solo si es HOY) => locked=0 (POS desbloqueado)
---------------------------------------------------------- */
const lockKey = (dateKey: string) => `zs:cashbox:locked:${dateKey}`;
function isLocked(dateKey: string) {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(lockKey(dateKey)) === "1";
}
function setLocked(dateKey: string, locked: boolean) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(lockKey(dateKey), locked ? "1" : "0");
}
function emitCashboxChanged(dateKey: string) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("zs:cashbox-changed", { detail: { dateKey } }));
}
function isTodayKey(dateKey: string) {
  return dateKey === toDateKey(new Date());
}

export default function CajaDiariaPage() {
  const [dateKey, setDateKey] = React.useState<string>(() => toDateKey(new Date()));

  const [cashbox, setCashbox] = React.useState<Cashbox | null>(null);
  const [manualMoves, setManualMoves] = React.useState<CashMove[]>([]);
  const [paymentMoves, setPaymentMoves] = React.useState<CashMove[]>([]);
  const [loadingPayments, setLoadingPayments] = React.useState(false);
  const [errorPayments, setErrorPayments] = React.useState<string | null>(null);

  const [openOpen, setOpenOpen] = React.useState(false);
  const [openIn, setOpenIn] = React.useState(false);
  const [openOut, setOpenOut] = React.useState(false);
  const [openClose, setOpenClose] = React.useState(false);

  const [historyDates, setHistoryDates] = React.useState<string[]>([]);
  const [locked, setLockedState] = React.useState(false);

  const refresh = React.useCallback(async () => {
    const cb = getCashboxByDate(dateKey);
    setCashbox(cb);

    const mm = listManualMoves(dateKey);
    setManualMoves(mm);

    setHistoryDates(listCashboxDates());

    const lk = isLocked(dateKey);
    setLockedState(lk);

    if (!cb) {
      setPaymentMoves([]);
      setErrorPayments(null);
      return;
    }

    setLoadingPayments(true);
    setErrorPayments(null);
    try {
      const pm = await listPaymentMoves(dateKey);
      setPaymentMoves(pm);
    } catch (e: any) {
      setErrorPayments(e?.message ?? "No se pudo cargar movimientos de pagos del POS.");
      setPaymentMoves([]);
    } finally {
      setLoadingPayments(false);
    }
  }, [dateKey]);

  React.useEffect(() => {
    refresh();
  }, [refresh]);

  // ✅ cuando POS registra pagos o caja cambia, refrescar (para reflejar ingresos del POS)
  React.useEffect(() => {
    function onCashboxChanged(e: any) {
      const dk = e?.detail?.dateKey;
      if (!dk || dk === dateKey) refresh();
    }
    window.addEventListener("zs:cashbox-changed", onCashboxChanged as any);
    return () => window.removeEventListener("zs:cashbox-changed", onCashboxChanged as any);
  }, [dateKey, refresh]);

  const allMoves = React.useMemo(() => mergeMoves(manualMoves, paymentMoves), [manualMoves, paymentMoves]);

  const totals = React.useMemo(() => {
    const opening = cashbox?.openingAmount ?? 0;
    const counted = cashbox?.countedCash;
    return calcTotals(opening, allMoves, counted);
  }, [cashbox, allMoves]);

  const isOpen = cashbox?.status === "Abierta";
  const today = isTodayKey(dateKey);

  // ✅ Reglas según tu flujo:
  // - Solo puedes ABRIR / REABRIR si la fecha es HOY
  // - Cerrar bloquea POS (locked=1)
  // - Reabrir HOY desbloquea POS (locked=0)
  const canOpenToday = today && (!cashbox || cashbox.status !== "Abierta") && !locked;
  const canReopenToday = today && (!cashbox || cashbox.status !== "Abierta") && locked;
  const canClose = !!cashbox && cashbox.status === "Abierta";
  const canOperate = !!cashbox && cashbox.status === "Abierta" && !locked;

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-slate-500">
            <span>
              Fecha: <span className="font-medium text-slate-800">{dateKey}</span>
            </span>
            <span className="text-slate-300">•</span>
            <span>
              Estado:{" "}
              <span className={isOpen ? "text-emerald-700 font-medium" : "text-slate-700 font-medium"}>
                {cashbox?.status ?? "Sin caja"}
              </span>
            </span>

            {locked ? (
              <>
                <span className="text-slate-300">•</span>
                <span className="font-medium text-rose-700">Día cerrado (POS bloqueado)</span>
              </>
            ) : null}

            {!today ? (
              <>
                <span className="text-slate-300">•</span>
                <span className="font-medium text-slate-600">Histórico (solo lectura)</span>
              </>
            ) : null}

            {isOpen && cashbox?.openedAt ? (
              <span className="text-slate-400">— desde {new Date(cashbox.openedAt).toLocaleTimeString()}</span>
            ) : null}
          </div>

          {errorPayments ? (
            <div className="mt-2 text-sm text-rose-700">{errorPayments}</div>
          ) : null}
        </div>

        <div className="flex gap-2 items-center">
          <input
            type="date"
            className="px-3 py-2 rounded-xl border bg-white text-sm"
            value={dateKey}
            onChange={(e) => setDateKey(e.target.value)}
          />

          {/* ✅ Botón principal: Abrir / Reabrir / Cerrar */}
          {isOpen ? (
            <button
              className="px-4 py-2 rounded-xl bg-slate-900 text-white disabled:opacity-50"
              disabled={!canClose}
              onClick={() => setOpenClose(true)}
            >
              Cerrar Caja
            </button>
          ) : canReopenToday ? (
            <button className="px-4 py-2 rounded-xl bg-slate-900 text-white" onClick={() => setOpenOpen(true)}>
              Reabrir Caja
            </button>
          ) : (
            <button
              className="px-4 py-2 rounded-xl bg-slate-900 text-white disabled:opacity-50"
              disabled={!canOpenToday}
              onClick={() => setOpenOpen(true)}
              title={!today ? "Solo puedes abrir/reabrir la caja en el día de hoy" : locked ? "Día cerrado" : ""}
            >
              Abrir Caja
            </button>
          )}

          <button className="px-4 py-2 rounded-xl border" onClick={refresh} disabled={loadingPayments}>
            {loadingPayments ? "Actualizando..." : "Refrescar"}
          </button>
        </div>
      </div>

      {/* Metrics */}
      <div className="mt-6 grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card title="Saldo Inicial" value={money(totals.opening)} />
        <Card title="Ingresos" value={money(totals.ingresos)} accent="text-emerald-700" />
        <Card title="Egresos" value={money(totals.egresos)} accent="text-amber-700" />
        <Card title="Saldo Actual" value={money(totals.theoretical)} accent="text-blue-700" />
      </div>

      {/* Actions */}
      <div className="mt-4 flex flex-wrap gap-2">
        <button
          className="px-4 py-2 rounded-full bg-blue-600 text-white disabled:opacity-50"
          disabled={!canOperate}
          onClick={() => setOpenIn(true)}
        >
          + Ingreso
        </button>
        <button
          className="px-4 py-2 rounded-full bg-orange-600 text-white disabled:opacity-50"
          disabled={!canOperate}
          onClick={() => setOpenOut(true)}
        >
          + Egreso
        </button>
      </div>

      {/* Movimientos (incluye Payment del POS + Manual) */}
      <div className="mt-6 rounded-2xl border bg-white">
        <div className="p-4 border-b flex items-center justify-between">
          <div className="font-semibold">Movimientos</div>
          <div className="text-xs text-slate-500">
            Payment: {paymentMoves.length} | Manual: {manualMoves.length}
          </div>
        </div>

        {!cashbox ? (
          <div className="p-4 text-sm text-slate-500">Sin caja para esta fecha.</div>
        ) : allMoves.length === 0 ? (
          <div className="p-4 text-sm text-slate-500">Sin movimientos</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-slate-500">
                <tr className="border-b">
                  <th className="text-left py-2 px-3">Fecha</th>
                  <th className="text-left py-2 px-3">Tipo</th>
                  <th className="text-left py-2 px-3">Origen</th>
                  <th className="text-left py-2 px-3">Concepto</th>
                  <th className="text-right py-2 px-3">Monto</th>
                  <th className="text-right py-2 px-3">Acción</th>
                </tr>
              </thead>
              <tbody>
                {allMoves.map((m) => (
                  <tr key={m.id} className="border-b last:border-b-0">
                    <td className="py-2 px-3">{new Date(m.createdAt).toLocaleString()}</td>
                    <td className="py-2 px-3">
                      <span
                        className={
                          "px-2 py-1 rounded text-xs " +
                          (m.type === "Ingreso" ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700")
                        }
                      >
                        {m.type}
                      </span>
                    </td>
                    <td className="py-2 px-3">
                      <span className="px-2 py-1 rounded text-xs bg-slate-100 text-slate-700">{m.source}</span>
                    </td>
                    <td className="py-2 px-3">
                      <div className="font-medium">{m.concept}</div>
                      {m.source === "Payment" ? (
                        <div className="text-xs text-slate-500">
                          {m.payment?.paymentType ? `Tipo: ${m.payment.paymentType}` : ""}
                          {m.payment?.bankName ? ` | Banco: ${m.payment.bankName}` : ""}
                          {m.payment?.reference ? ` | Ref: ${m.payment.reference}` : ""}
                        </div>
                      ) : null}
                    </td>
                    <td className="py-2 px-3 text-right font-medium">{money(m.amount)}</td>
                    <td className="py-2 px-3 text-right">
                      {m.source === "Manual" && canOperate ? (
                        <button
                          className="px-3 py-1 rounded-lg border text-xs"
                          onClick={() => {
                            deleteManualMove(dateKey, m.id);
                            setManualMoves(listManualMoves(dateKey));
                          }}
                        >
                          Eliminar
                        </button>
                      ) : (
                        <span className="text-xs text-slate-400">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Local history */}
      <div className="mt-6 rounded-2xl border bg-white">
        <div className="p-4 border-b flex items-center justify-between">
          <div className="font-semibold">Histórico local (cajas guardadas en este PC)</div>
          <div className="text-xs text-slate-500">{historyDates.length} fechas</div>
        </div>

        {historyDates.length === 0 ? (
          <div className="p-4 text-sm text-slate-500">Aún no hay cajas registradas localmente.</div>
        ) : (
          <div className="p-4 flex flex-wrap gap-2">
            {historyDates.slice(0, 30).map((d) => (
              <button
                key={d}
                className={
                  "px-3 py-1.5 rounded-xl border text-sm " +
                  (d === dateKey ? "bg-slate-900 text-white border-slate-900" : "bg-white")
                }
                onClick={() => setDateKey(d)}
              >
                {d}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* dialogs */}
      <OpenCashDialog
        open={openOpen}
        onClose={() => setOpenOpen(false)}
        onSubmit={(data) => {
          // ✅ Solo hoy se puede abrir/reabrir
          if (!isTodayKey(dateKey)) {
            setOpenOpen(false);
            return;
          }

          openCashbox({ dateKey, openingAmount: data.openingAmount, openedBy: data.openedBy });

          // ✅ Al abrir/reabrir: desbloquea POS
          setLocked(dateKey, false);
          emitCashboxChanged(dateKey);

          setOpenOpen(false);
          refresh();
        }}
      />

      <MoveDialog
        open={openIn}
        type="Ingreso"
        onClose={() => setOpenIn(false)}
        onSubmit={(data) => {
          addManualMove({
            dateKey,
            type: "Ingreso",
            amount: data.amount,
            concept: data.concept,
            createdBy: data.createdBy,
          });
          setOpenIn(false);
          setManualMoves(listManualMoves(dateKey));
        }}
      />

      <MoveDialog
        open={openOut}
        type="Egreso"
        onClose={() => setOpenOut(false)}
        onSubmit={(data) => {
          addManualMove({
            dateKey,
            type: "Egreso",
            amount: data.amount,
            concept: data.concept,
            createdBy: data.createdBy,
          });
          setOpenOut(false);
          setManualMoves(listManualMoves(dateKey));
        }}
      />

      <CloseCashDialog
        open={openClose}
        totals={totals}
        onClose={() => setOpenClose(false)}
        onSubmit={(data) => {
          closeCashbox({ dateKey, countedCash: data.countedCash, closedBy: data.closedBy, note: data.note });

          // ✅ Cerrar => bloquea POS del día (pero podrás reabrir HOY)
          setLocked(dateKey, true);
          emitCashboxChanged(dateKey);

          setOpenClose(false);
          refresh();
        }}
      />
    </div>
  );
}

function Card({ title, value, accent }: { title: string; value: string; accent?: string }) {
  return (
    <div className="rounded-2xl border bg-white p-4">
      <div className="text-xs text-slate-500">{title}</div>
      <div className={"mt-1 text-2xl font-semibold " + (accent ?? "text-slate-900")}>{value}</div>
    </div>
  );
}
