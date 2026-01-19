// src/app/facturacion/caja-diaria/page.tsx
"use client";

import React from "react";
import type { CashBoxDto, CashBoxSummaryDto, CashboxTotals } from "@/types/cashbox";
import { CashBoxStatus } from "@/types/cashbox";
import {
  getTodayCashBox,
  openCashBox,
  closeCashBox,
  reopenCashBox,
  getCashBoxSummary,
  getCashBoxTransactions,
  getCashBoxRange,
} from "@/lib/apiv2/cashboxes";
import { toDateKey, todayDateKey } from "@/lib/apiv2/dateUtils";

import { OpenCashDialog } from "@/components/cashbox/OpenCashDialog";
import { CloseCashDialog } from "@/components/cashbox/CloseCashDialog";

function money(n: number) {
  return `$${n.toFixed(2)}`;
}

function emitCashboxChanged(dateKey: string) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("zs:cashbox-changed", { detail: { dateKey } }));
}

export default function CajaDiariaPage() {
  const [dateKey, setDateKey] = React.useState<string>(() => todayDateKey());

  const [cashbox, setCashbox] = React.useState<CashBoxDto | null>(null);
  const [summary, setSummary] = React.useState<CashBoxSummaryDto | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const [openOpen, setOpenOpen] = React.useState(false);
  const [openClose, setOpenClose] = React.useState(false);

  const [historyDates, setHistoryDates] = React.useState<string[]>([]);

  const refresh = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const cb = await getTodayCashBox(dateKey);
      setCashbox(cb);

      if (cb) {
        const sum = await getCashBoxSummary(cb.id);
        setSummary(sum);
      } else {
        setSummary(null);
      }

      // Load history (last 30 days)
      const today = new Date();
      const thirtyDaysAgo = new Date(today);
      thirtyDaysAgo.setDate(today.getDate() - 30);
      const range = await getCashBoxRange(
        toDateKey(thirtyDaysAgo),
        toDateKey(today)
      );
      const dates = range.map(r => r.openedAt?.slice(0, 10) ?? "").filter(Boolean);
      setHistoryDates([...new Set(dates)].sort().reverse());
    } catch (e: any) {
      setError(e?.message ?? "Error cargando caja.");
    } finally {
      setLoading(false);
    }
  }, [dateKey]);

  React.useEffect(() => {
    refresh();
  }, [refresh]);

  // Listen to cashbox changes from POS
  React.useEffect(() => {
    function onCashboxChanged(e: any) {
      const dk = e?.detail?.dateKey;
      if (!dk || dk === dateKey) refresh();
    }
    window.addEventListener("zs:cashbox-changed", onCashboxChanged as any);
    return () => window.removeEventListener("zs:cashbox-changed", onCashboxChanged as any);
  }, [dateKey, refresh]);

  // Calculate totals from summary
  const totals: CashboxTotals = React.useMemo(() => {
    const opening = cashbox?.openingBalance ?? 0;
    const ingresos = summary?.totalPayments ?? 0;
    const egresos = 0; // Backend doesn't track egresos separately yet
    const theoretical = opening + ingresos - egresos;
    const counted = cashbox?.closingBalance ?? null;
    const difference = counted !== null ? counted - theoretical : null;

    return {
      opening,
      ingresos,
      egresos,
      theoretical,
      counted: counted ?? 0,
      difference: difference ?? 0,
    };
  }, [cashbox, summary]);

  const isOpen = cashbox?.status === CashBoxStatus.Open;
  const today = dateKey === todayDateKey();
  const isClosed = cashbox?.status === CashBoxStatus.Closed;

  const canOpenToday = today && !cashbox;
  const canReopenToday = today && isClosed;
  const canClose = isOpen;

  async function handleOpen(data: { openingAmount: number; openedBy: string }) {
    try {
      await openCashBox({ openingBalance: data.openingAmount });
      emitCashboxChanged(dateKey);
      setOpenOpen(false);
      await refresh();
    } catch (e: any) {
      alert(e?.message ?? "Error abriendo caja");
    }
  }

  async function handleReopen() {
    if (!cashbox) return;
    try {
      await reopenCashBox(cashbox.id);
      emitCashboxChanged(dateKey);
      await refresh();
    } catch (e: any) {
      alert(e?.message ?? "Error reabriendo caja");
    }
  }

  async function handleClose(data: { countedCash: number; closedBy: string; note?: string }) {
    if (!cashbox) return;
    try {
      await closeCashBox(cashbox.id, {
        closingBalance: data.countedCash,
        notes: data.note,
      });
      emitCashboxChanged(dateKey);
      setOpenClose(false);
      await refresh();
    } catch (e: any) {
      alert(e?.message ?? "Error cerrando caja");
    }
  }

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
                {cashbox ? (isOpen ? "Abierta" : "Cerrada") : "Sin caja"}
              </span>
            </span>

            {!today && (
              <>
                <span className="text-slate-300">•</span>
                <span className="font-medium text-slate-600">Histórico (solo lectura)</span>
              </>
            )}

            {isOpen && cashbox?.openedAt && (
              <span className="text-slate-400">— desde {new Date(cashbox.openedAt).toLocaleTimeString()}</span>
            )}
          </div>

          {error && <div className="mt-2 text-sm text-rose-700">{error}</div>}
        </div>

        <div className="flex gap-2 items-center">
          <input
            type="date"
            className="px-3 py-2 rounded-xl border bg-white text-sm"
            value={dateKey}
            onChange={(e) => setDateKey(e.target.value)}
          />

          {isOpen ? (
            <button
              className="px-4 py-2 rounded-xl bg-slate-900 text-white disabled:opacity-50"
              disabled={!canClose}
              onClick={() => setOpenClose(true)}
            >
              Cerrar Caja
            </button>
          ) : canReopenToday ? (
            <button className="px-4 py-2 rounded-xl bg-slate-900 text-white" onClick={handleReopen}>
              Reabrir Caja
            </button>
          ) : (
            <button
              className="px-4 py-2 rounded-xl bg-slate-900 text-white disabled:opacity-50"
              disabled={!canOpenToday}
              onClick={() => setOpenOpen(true)}
              title={!today ? "Solo puedes abrir la caja en el día de hoy" : ""}
            >
              Abrir Caja
            </button>
          )}

          <button className="px-4 py-2 rounded-xl border" onClick={refresh} disabled={loading}>
            {loading ? "Actualizando..." : "Refrescar"}
          </button>
        </div>
      </div>

      {/* Metrics */}
      <div className="mt-6 grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card title="Saldo Inicial" value={money(totals.opening)} />
        <Card title="Ingresos (Pagos)" value={money(totals.ingresos)} accent="text-emerald-700" />
        <Card title="Efectivo" value={money(summary?.cash ?? 0)} accent="text-blue-700" />
        <Card title="Transferencias" value={money(summary?.transfer ?? 0)} accent="text-purple-700" />
      </div>

      {/* Summary stats */}
      {summary && (
        <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card title="Cuentas Abiertas" value={String(summary.openTransactions)} />
          <Card title="Cuentas Cerradas" value={String(summary.closedTransactions)} />
          <Card title="Total Cargos" value={money(summary.totalCharges)} />
        </div>
      )}

      {/* Local history */}
      <div className="mt-6 rounded-2xl border bg-white">
        <div className="p-4 border-b flex items-center justify-between">
          <div className="font-semibold">Histórico (últimos 30 días)</div>
          <div className="text-xs text-slate-500">{historyDates.length} fechas</div>
        </div>

        {historyDates.length === 0 ? (
          <div className="p-4 text-sm text-slate-500">Aún no hay cajas registradas.</div>
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
        onSubmit={handleOpen}
      />

      <CloseCashDialog
        open={openClose}
        totals={totals}
        onClose={() => setOpenClose(false)}
        onSubmit={handleClose}
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
