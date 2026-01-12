// src/lib/api/dashboard.ts
import { http, USE_MOCKS } from "./_core";

// ✅ para modo mocks: leer POS (local) + caja diaria (local)
import { listAccountsToday } from "@/lib/api/accounts";
import {
  getCashboxByDate,
  listManualMoves,
  listPosPaymentMoves,
  mergeMoves,
  calcTotals,
  toDateKey,
} from "@/lib/apiv2/cashbox";

// (opcional) si tienes backend corriendo aunque estés en mocks, puedes intentar llaves reales
// import { listKeys as listKeysV2 } from "@/lib/apiv2/keys";

export type DashboardSnapshot = {
  cajaAbierta: boolean;
  ingresosHoy: number;
  clientesActivos: number;
  pedidosPendientes: number;
  llavesDisponibles: number;
  llavesTotales: number;
  actividadReciente: { id: string; texto: string; hora: string }[];
};

const LOCKERS_TOTAL = 32;

function todayKeyEC(): string {
  // usa el mismo dateKey que Caja Diaria
  return toDateKey(new Date());
}

function hhmm(isoOrDate: unknown): string {
  const d = new Date(String(isoOrDate ?? ""));
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("es-EC", { hour: "2-digit", minute: "2-digit" });
}

// ---------- helpers para leer “personas” desde cuentas (mocks) ----------
function n(v: any): number {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
}

function sumPeopleFromAccount(a: any): number {
  const direct =
    n(a?.peopleCount) ||
    n(a?.PeopleCount) ||
    n(a?.totalPeople) ||
    n(a?.TotalPeople) ||
    n(a?.people) ||
    n(a?.People) ||
    n(a?.summary?.peopleCount) ||
    n(a?.summary?.PeopleCount) ||
    n(a?.entry?.peopleCount) ||
    n(a?.entry?.PeopleCount);

  if (direct > 0) return direct;

  const counts =
    a?.counts ??
    a?.peopleCounts ??
    a?.entries?.counts ??
    a?.summary?.counts ??
    null;

  const normal =
    n(counts?.A) + n(counts?.N) + n(counts?.TE) + n(counts?.D) + n(counts?.AC);

  const passPeople = n(a?.passPeople ?? a?.pass?.people ?? a?.summary?.passPeople ?? 0);

  return normal + passPeople;
}




function extractKeysFromAccount(a: any): Array<{ gender: string; number: number }> {
  // formato nuevo: { keys: { items:[{gender,number}], duration } }
  const items = a?.keys?.items;
  if (Array.isArray(items)) {
    return items
      .map((k: any) => ({ gender: String(k.gender), number: Number(k.number) }))
      .filter((k: any) => (k.gender === "H" || k.gender === "M") && Number.isFinite(k.number));
  }

  // formato viejo: keys:[{gender,number}]
  if (Array.isArray(a?.keys)) {
    return a.keys
      .map((k: any) => ({ gender: String(k.gender), number: Number(k.number) }))
      .filter((k: any) => (k.gender === "H" || k.gender === "M") && Number.isFinite(k.number));
  }

  return [];
}

function keySig(g: any, n2: any) {
  return `${String(g)}-${String(n2)}`;
}

// ---------- backend parsing helpers ----------
function pickDateISO(x: any): string | null {
  const raw =
    x?.createdAt ??
    x?.CreatedAt ??
    x?.paidAt ??
    x?.PaidAt ??
    x?.date ??
    x?.Date ??
    x?.orderDate ??
    x?.OrderDate ??
    x?.openingAt ??
    x?.OpenedAt ??
    null;

  if (!raw) return null;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

export async function getDashboardSnapshot(): Promise<DashboardSnapshot> {
  // =========================================================
  // ✅ BACKEND MODE
  // =========================================================
  if (!USE_MOCKS) {
    const dateKey = todayKeyEC();

    const [cashboxToday, keys, barOrders, entrances, payments] = await Promise.all([
      http<any>(`/api/CashBoxes/today?date=${encodeURIComponent(dateKey)}`).catch(() => null),
      http<any[]>(`/api/Keys`).catch(() => []),
      http<any[]>(`/api/BarOrders`).catch(() => []),
      http<any[]>(`/api/EntranceTransactions`).catch(() => []),
      http<any[]>(`/api/Payments`).catch(() => []),
    ]);

    const cajaAbierta =
      !!cashboxToday &&
      (cashboxToday.status === "Abierta" ||
        cashboxToday.Status === "Abierta" ||
        cashboxToday.open === true ||
        cashboxToday.Open === true);

    const llavesTotales = Array.isArray(keys) ? keys.length : 0;
    const llavesDisponibles = Array.isArray(keys)
      ? keys.filter((k) => (k.available ?? k.Available) === true).length
      : 0;

    const pedidosPendientes = Array.isArray(barOrders) ? barOrders.length : 0;

    const clientesActivos = Array.isArray(entrances)
      ? entrances.filter((e) => (e.entranceExitTime ?? e.EntranceExitTime) == null).length
      : 0;

    let ingresosHoy = 0;
    if (Array.isArray(payments)) {
      for (const p of payments) {
        const iso = pickDateISO(p);
        if (!iso) continue;
        if (iso.slice(0, 10) !== dateKey) continue;

        const total = Number(p.total ?? p.Total ?? 0);
        if (!Number.isFinite(total)) continue;

        ingresosHoy += total;
      }
    }
    ingresosHoy = +ingresosHoy.toFixed(2);

    const activity: { id: string; texto: string; hora: string; ts: string }[] = [];

    for (const o of Array.isArray(barOrders) ? barOrders : []) {
      const ts = pickDateISO(o) ?? new Date().toISOString();
      const total = Number(o.total ?? o.Total ?? 0);
      activity.push({
        id: String(o.id ?? o.Id ?? `bar_${ts}`),
        texto: `Pedido Bar — ${Number.isFinite(total) ? `$${total.toFixed(2)}` : "nuevo"}`,
        hora: hhmm(ts),
        ts,
      });
    }

    for (const e of Array.isArray(entrances) ? entrances : []) {
      const ts = pickDateISO(e) ?? new Date().toISOString();
      activity.push({
        id: String(e.id ?? e.Id ?? `ent_${ts}`),
        texto: `Ingreso registrado`,
        hora: hhmm(ts),
        ts,
      });
    }

    for (const p of Array.isArray(payments) ? payments : []) {
      const ts = pickDateISO(p);
      if (!ts) continue;
      if (ts.slice(0, 10) !== dateKey) continue;
      const total = Number(p.total ?? p.Total ?? 0);
      if (!Number.isFinite(total)) continue;
      activity.push({
        id: String(p.id ?? p.Id ?? `pay_${ts}`),
        texto: `Pago registrado — $${total.toFixed(2)}`,
        hora: hhmm(ts),
        ts,
      });
    }

    activity.sort((a, b) => (a.ts < b.ts ? 1 : -1));
    const actividadReciente = activity.slice(0, 6).map(({ id, texto, hora }) => ({ id, texto, hora }));

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

  // =========================================================
  // ✅ MOCKS MODE (SIN BACKEND): TODO SALE DE LOCALSTORAGE REAL
  // =========================================================
  const dateKey = todayKeyEC();

  // 1) Caja diaria real (local)
  const box = getCashboxByDate(dateKey);
  const cajaAbierta = !!box && box.status === "Abierta";

  // 2) Ingresos hoy real (local cashbox moves)
  const manual = listManualMoves(dateKey);
  const posPays = listPosPaymentMoves(dateKey);
  const allMoves = mergeMoves(manual, posPays);

  const totals = calcTotals(box?.openingAmount ?? 0, allMoves, box?.countedCash);
  const ingresosHoy = +Number(totals.ingresos ?? 0).toFixed(2);

  // 3) POS real (local): personas + llaves “en uso” según cuentas abiertas
  let accounts: any[] = [];
  try {
    accounts = await listAccountsToday();
  } catch {
    accounts = [];
  }

  const openAccounts = (Array.isArray(accounts) ? accounts : []).filter(
    (a) => String(a?.status ?? a?.Status ?? "").toLowerCase() === "abierta"
  );

  const clientesActivos = openAccounts.reduce((sum, a) => sum + sumPeopleFromAccount(a), 0);

  const inUse = new Set<string>();
  for (const a of openAccounts) {
    for (const k of extractKeysFromAccount(a)) {
      inUse.add(keySig(k.gender, k.number));
    }
  }

  const llavesTotales = LOCKERS_TOTAL;
  const llavesDisponibles = Math.max(0, llavesTotales - inUse.size);

  // 4) Pendientes bar: si no tienes un store local claro, déjalo en 0 (o luego lo conectamos)
  const pedidosPendientes = 0;

  // 5) Actividad: últimos pagos/caja (lo que sí existe local)
  const actividadReciente = allMoves
    .slice()
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    .slice(0, 6)
    .map((m) => ({
      id: m.id,
      texto:
        m.type === "Ingreso"
          ? `Ingreso — $${Number(m.amount ?? 0).toFixed(2)}`
          : `Egreso — $${Number(m.amount ?? 0).toFixed(2)}`,
      hora: hhmm(m.createdAt),
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
