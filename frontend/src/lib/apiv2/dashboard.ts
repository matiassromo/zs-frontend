// frontend/src/lib/apiv2/dashboard.ts
import { getTodayCashBox, getCashBoxSummary, CashBoxStatus } from "./cashboxes";
import { listKeys } from "./keys";
import { listTransactions } from "./transactions";
import { TransactionStatus } from "@/types/transaction";
import { toDateKey } from "./dateUtils";

export type DashboardSnapshot = {
  cajaAbierta: boolean;
  ingresosHoy: number;
  clientesActivos: number;
  pedidosPendientes: number;
  llavesDisponibles: number;
  llavesTotales: number;
  actividadReciente: { id: string; texto: string; hora: string }[];
};

function hhmm(isoOrDate: unknown): string {
  const d = new Date(String(isoOrDate ?? ""));
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("es-EC", { hour: "2-digit", minute: "2-digit" });
}

export async function getDashboardSnapshot(): Promise<DashboardSnapshot> {
  const today = toDateKey(new Date());

  const [cashbox, keys, transactions] = await Promise.all([
    getTodayCashBox().catch(() => null),
    listKeys().catch(() => []),
    listTransactions().catch(() => []),
  ]);

  const cajaAbierta = cashbox?.status === CashBoxStatus.Open;

  // Get summary if cashbox exists
  let ingresosHoy = 0;
  if (cashbox) {
    try {
      const summary = await getCashBoxSummary(cashbox.id);
      ingresosHoy = summary.totalPayments;
    } catch {
      // Ignore errors
    }
  }

  // Keys
  const llavesTotales = keys.length;
  const llavesDisponibles = keys.filter(k => k.available).length;

  // Active clients = open transactions today
  const todayTransactions = transactions.filter(
    tx => (tx.openedAt ?? "").slice(0, 10) === today
  );
  const clientesActivos = todayTransactions.filter(
    tx => tx.status === TransactionStatus.Open
  ).length;

  // Pending orders - would need barOrders API
  const pedidosPendientes = 0;

  // Recent activity
  const actividadReciente = todayTransactions
    .slice(0, 6)
    .map(tx => ({
      id: tx.id,
      texto: tx.status === TransactionStatus.Open
        ? `Cuenta abierta - ${tx.client?.name ?? "Cliente"}`
        : `Cuenta cerrada - ${tx.client?.name ?? "Cliente"}`,
      hora: hhmm(tx.openedAt),
    }));

  return {
    cajaAbierta,
    ingresosHoy,
    clientesActivos,
    pedidosPendientes,
    llavesDisponibles,
    llavesTotales,
    actividadReciente,
  };
}
