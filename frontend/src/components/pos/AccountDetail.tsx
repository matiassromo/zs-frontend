// src/components/pos/AccountDetail.tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  getAccount,
  listCharges,
  listPayments,
  addPayment,
  markChargePaid,
  closeAccount,
  printAccountReceipt,
  addCharge,
  deleteCharge,
  type AccountSummary,
  type Charge,
  type Payment,
  type PosAccount,
} from "@/lib/api/accounts";

import { listKeys } from "@/lib/apiv2/keys";
import { confirm, fire } from "@/lib/ui/swal";
import EditAccountModal from "@/components/pos/EditAccountModal";

// ✅ POS lock / caja diaria
import { toDateKey, getCashboxByDate, addPosPaymentMove } from "@/lib/apiv2/cashbox";

// ✅ bar
import { listBarProducts, updateBarProduct } from "@/lib/apiv2/barProducts";
import type { BarProduct } from "@/types/barProduct";


// ✅ parqueadero (vinculado a cuenta POS)
import { listParkings, updateParking } from "@/lib/apiv2/parkings";
import type { Parking, ParkingRequestDto } from "@/types/parking";

type PayMethod = "Efectivo" | "Transferencia";

function norm(s: string) {
  return (s ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

/* ----------------- POS LOCK (mismo criterio que Caja Diaria) ----------------- */
const lockKey = (dateKey: string) => `zs:cashbox:locked:${dateKey}`;

function isLocked(dateKey: string) {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(lockKey(dateKey)) === "1";
}

function emitCashboxChanged(dateKey: string) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("zs:cashbox-changed", { detail: { dateKey } }));
}

/* ----------------- PARQUEADERO helpers ----------------- */
const PARKING_RATE_PER_HOUR = 0.5; // $0.50 por hora


function isNonEmptyGuid(v: any): v is string {
  if (typeof v !== "string") return false;
  const s = v.trim().toLowerCase();
  if (s === "00000000-0000-0000-0000-000000000000") return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(s);
}

function toLocalTs(dateOnly?: string | null, timeOnly?: string | null): number {
  if (!dateOnly || !timeOnly) return 0;
  const [y, m, d] = dateOnly.split("-").map((x) => parseInt(x, 10));
  const [hh, mm, ss] = timeOnly.split(":").map((x) => parseInt(x, 10));
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return 0;
  return new Date(y, (m || 1) - 1, d || 1, hh || 0, mm || 0, ss || 0).getTime();
}

function nowTimeOnly(): string {
  const d = new Date();
  const pad2 = (n: number) => String(n).padStart(2, "0");
  return [pad2(d.getHours()), pad2(d.getMinutes()), pad2(d.getSeconds())].join(":");
}

function parkingAmountFromEntryTs(entryTs: number): number {
  if (!entryTs) return 0;
  const diffMs = Date.now() - entryTs;
  if (diffMs <= 0) return 0;

  // Requisito: 0 al inicio, luego cada hora suma 0.50
  // 0.. <1h => 0.00
  // 1.. <2h => 0.50
  // 2.. <3h => 1.00
  const hours = Math.floor(diffMs / (60 * 60 * 1000));
  return +(hours * PARKING_RATE_PER_HOUR).toFixed(2);
}

function parkingFinalAmountFromEntryExit(entryTs: number, exitTs: number): number {
  if (!entryTs || !exitTs) return 0;
  const diffMs = Math.max(0, exitTs - entryTs);

  // Requisito: 0.50 la hora o fracción (al salir)
  // 1..60min => 0.50, 61..120 => 1.00, etc
  const hours = Math.max(1, Math.ceil(diffMs / (60 * 60 * 1000)));
  return +(hours * PARKING_RATE_PER_HOUR).toFixed(2);
}

function emitBarProductsChanged() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("zs:bar-products-changed"));
  try {
    const bc = new BroadcastChannel("zs:bus");
    bc.postMessage({ type: "bar-products-changed" });
    bc.close();
  } catch {}
}


// emitir para que /parqueadero refresque y mueva a historial
function emitParkingChanged(accountId?: string | null) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("zs:parking-changed", { detail: { accountId: accountId ?? null } }));
  try {
    const bc = new BroadcastChannel("zs:bus");
    bc.postMessage({ type: "parking-changed", accountId: accountId ?? null });
    bc.close();
  } catch {}
}


function parkingConcept(summary: AccountSummary | null) {
  const name = summary?.clientName ?? "";
  return `Parqueadero · ${name}`.trim();
}

/* ----------------- LLAVES: señales del módulo /llaves ----------------- */
const SINCE_MAP_KEY = "zs:keys:sinceMap";

/* ----------------- LLAVES: helpers para display desde summary.keys ----------------- */
function normalizeStoredKeys(raw: any): { gender: "H" | "M"; number: number; duration?: any }[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  if (raw && Array.isArray(raw.items)) {
    const dur = raw.duration ?? "1H";
    return raw.items.map((k: any) => ({ gender: k.gender, number: Number(k.number), duration: k.duration ?? dur }));
  }
  return [];
}

function formatKeysFromBundle(raw: any): string {
  const items = normalizeStoredKeys(raw);
  if (!items.length) return "";
  return items
    .slice()
    .sort((a, b) => String(a.gender).localeCompare(String(b.gender)) || a.number - b.number)
    .map((k) => `${k.number}${k.gender}`)
    .join(", ");
}

function keyConceptFromSummary(summary: AccountSummary | null): string | null {
  if (!summary) return null;
  const bundle = (summary as any).keys;
  const tag = formatKeysFromBundle(bundle);
  if (!tag) return null;
  return `Llaves ${tag}`;
}

/* ----------------- LLAVES: derivar code estable desde listKeys() ----------------- */
function buildKeyCodeMap(allKeys: any[]): Record<string, string> {
  // mismo criterio que /llaves: sort por id y map a 1H..16H / 1M..16M
  const ordered = [...allKeys].sort((a, b) => String(a.id).localeCompare(String(b.id)));
  const map: Record<string, string> = {};
  for (let index = 0; index < ordered.length; index++) {
    const zone = index < 16 ? "H" : "M";
    const idxInZone = zone === "H" ? index + 1 : index - 16 + 1;
    map[String(ordered[index].id)] = `${idxInZone}${zone}`;
  }
  return map;
}

export default function AccountDetail({
  accountId,
  onChanged,
}: {
  accountId: string;
  onChanged?: () => void;
}) {
  const [summary, setSummary] = useState<AccountSummary | null>(null);
  const [charges, setCharges] = useState<Charge[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(true);

  const [payChargeId, setPayChargeId] = useState<string | null>(null);

  // ✅ modales/acciones
  const [addChargeOpen, setAddChargeOpen] = useState(false);
  const [addEntriesOpen, setAddEntriesOpen] = useState(false);

  // ✅ para evitar doble click / estado de acciones
  const [closing, setClosing] = useState(false);
  const [printing, setPrinting] = useState(false);

  // ✅ estado POS habilitado por caja diaria (según fecha de la cuenta)
  const [posEnabled, setPosEnabled] = useState(true);
  const [posReason, setPosReason] = useState<string | null>(null);

  // ✅ guarda scroll al pagar
  const lastScrollYRef = useRef(0);

  // ✅ concepto de llaves “vivo” (desde backend keys), no desde summary.keys
  const [liveKeyConcept, setLiveKeyConcept] = useState<string | null>(null);

  // ✅ parqueadero
  const [parking, setParking] = useState<Parking | null>(null);
  const [parkingEntryTs, setParkingEntryTs] = useState<number>(0);
  const [parkingLiveAmount, setParkingLiveAmount] = useState<number>(0);
  const [parkingChargeId, setParkingChargeId] = useState<string | null>(null); // cargo "Parqueadero" en accounts
  const [parkingFinalAmount, setParkingFinalAmount] = useState<number>(0);

  const ACCOUNT_PARKING_MAP_KEY = "zs:parking:accountParkingMap";


  function refreshPosGateFromSummary(s: AccountSummary | null) {
    if (!s) return;
    const dk = toDateKey(new Date(s.openedAt));
    const cb = getCashboxByDate(dk);
    const locked = isLocked(dk);
    const ok = !!cb && cb.status === "Abierta" && !locked;
    setPosEnabled(ok);
    if (ok) {
      setPosReason(null);
    } else {
      if (locked) setPosReason(`Caja del día ${dk} cerrada. POS bloqueado.`);
      else if (!cb) setPosReason(`No hay caja abierta para el día ${dk}. Abre caja para operar POS.`);
      else setPosReason(`Caja del día ${dk} está ${cb.status}. Abre caja para operar POS.`);
    }
  }

  async function refreshLiveKeys(): Promise<string | null> {
    const all = await listKeys();
    const codeMap = buildKeyCodeMap(all as any[]);
    const used = (all as any[])
      .filter((k) => !k.available)
      .filter((k) => String(k.notes ?? "").includes(`Cuenta ${accountId}`));

    const tags = used
      .map((k) => codeMap[String(k.id)] ?? null)
      .filter(Boolean) as string[];

    const uniq = Array.from(new Set(tags)).sort((a, b) => a.localeCompare(b));
    if (!uniq.length) {
      setLiveKeyConcept(null);
      return null;
    }
    const concept = `Llaves ${uniq.join(", ")}`;
    setLiveKeyConcept(concept);
    return concept;
  }

  async function cleanupKeyChargesIfNoKeys(chNow: Charge[], sNow?: AccountSummary | null) {
    const st = (sNow ?? summary)?.status;
    // ✅ NO modificar cargos si la cuenta no está abierta (deleteCharge lo bloquea)
    if (st !== "Abierta") return;

    // si no hay llaves ocupadas -> borra cargos Key pendientes (reales, no synth)
    if (liveKeyConcept) return;
    const toDelete = chNow.filter((c) => c.kind === "Key" && c.id !== "__key_synth__" && c.status !== "Pagado");
    for (const c of toDelete) {
      await deleteCharge(accountId, c.id);
    }
  }

  function readAccountParkingMap(): Record<string, string> {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(window.localStorage.getItem(ACCOUNT_PARKING_MAP_KEY) || "{}");
  } catch {
    return {};
  }
}

  async function resolveParkingForThisAccount(): Promise<Parking | null> {
    try {
      const all = (await listParkings()) as Parking[];

      // 1) ✅ vía vínculo fuerte accountId -> parkingId (para cuentas NO GUID)
      const map = readAccountParkingMap();
      const pid = map[String(accountId)];
      if (pid) {
        const byId = all.find((p) => String(p.id) === String(pid)) ?? null;
        if (byId && !byId.parkingExitTime) return byId;
      }

      // 2) si algún día transactionId sí existe (GUID), soporta también
      const openByTx =
        all
          .filter((p) => !p.parkingExitTime)
          .filter((p) => String(p.transactionId ?? "").trim() !== "")
          .filter((p) => String(p.transactionId) === String(accountId))
          .sort((a, b) => toLocalTs(b.parkingDate, b.parkingEntryTime) - toLocalTs(a.parkingDate, a.parkingEntryTime))[0] ??
        null;

      if (openByTx) return openByTx;

      // 3) fallback (por si no hay map aún): por nombre + mismo día + cercano a openedAt
      const name = norm(summary?.clientName ?? "");
      if (!name) return null;

      const opened = summary?.openedAt ? new Date(summary.openedAt) : null;
      const openedTs = opened ? opened.getTime() : 0;

      const candidates = all
        .filter((p) => !p.parkingExitTime)
        .filter((p) => norm((p as any)?.accountName ?? "").includes(name) || true) // no siempre existe
        .map((p) => ({ p, ts: toLocalTs(p.parkingDate, p.parkingEntryTime) }))
        .filter((x) => x.ts > 0)
        .sort((a, b) => b.ts - a.ts);

      if (!openedTs) return candidates[0]?.p ?? null;

      // el más cercano hacia adelante o dentro de 2h
      const near =
        candidates
          .filter((x) => Math.abs(x.ts - openedTs) <= 2 * 60 * 60 * 1000)
          .sort((a, b) => Math.abs(a.ts - openedTs) - Math.abs(b.ts - openedTs))[0]?.p ?? null;

      return near;
    } catch {
      return null;
    }
  }


  function computeAndSetParkingLive(entryTs: number) {
    const amt = parkingAmountFromEntryTs(entryTs);
    setParkingLiveAmount(amt);
    return amt;
  }

  async function ensureParkingChargeId(
    chList: Charge[],
    s: AccountSummary | null,
    p?: Parking | null
  ) {
    // Busca cargo existente por concepto "Parqueadero · <nombre>" (o cualquier "Parqueadero")
    const found =
      chList
        .filter((c) => c.kind !== "Key")
        .filter((c) => norm(c.concept).startsWith("parqueadero"))
        .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0] ?? null;

    if (found) {
      setParkingChargeId(found.id);
      return found.id;
    }

    // Si hay parqueadero activo (p) y cuenta abierta, crea cargo inicial $0.00
    if (p && s?.status === "Abierta") {
      const concept = parkingConcept(s);
      await addCharge(accountId, { kind: "Normal", concept, qty: 1, amount: 0 });

      const ch2 = await listCharges(accountId);
      setCharges(ch2);

      const created =
        ch2
          .filter((c) => c.kind !== "Key")
          .filter((c) => norm(c.concept).startsWith("parqueadero"))
          .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0] ?? null;

      if (created) {
        setParkingChargeId(created.id);
        return created.id;
      }
    }

    setParkingChargeId(null);
    return null;
  }


  async function syncParkingChargeAmount(amount: number, chList?: Charge[]): Promise<string | null> {
    const chNow = chList ?? charges;
    const cid = parkingChargeId ?? (await ensureParkingChargeId(chNow, summary, parking));
    if (!cid) return null;

    const c = (chNow ?? []).find((x) => x.id === cid) ?? null;
    if (!c) return null;
    if (c.status === "Pagado") return c.id;
    if (summary?.status !== "Abierta") return c.id;

    if (Number.isFinite(c.amount) && +c.amount.toFixed(2) === +amount.toFixed(2)) return c.id;

    try {
      await deleteCharge(accountId, c.id);
    } catch {
      return c.id;
    }

    await addCharge(accountId, {
      kind: "Normal",
      concept: parkingConcept(summary),
      qty: 1,
      amount,
    });

    const ch2 = await listCharges(accountId);
    setCharges(ch2);

    const created =
      ch2
        .filter((x) => x.kind !== "Key")
        .filter((x) => norm(x.concept).startsWith("parqueadero"))
        .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0] ?? null;

    const newId = created?.id ?? null;
    setParkingChargeId(newId);
    return newId;
  }


  async function loadAll(live?: string | null) {
    setLoading(true);
    const [s, ch, pm] = await Promise.all([getAccount(accountId), listCharges(accountId), listPayments(accountId)]);
    setSummary(s);
    setCharges(ch);
    setPayments(pm);
    setLoading(false);

    // ✅ llaves live
    const liveNow = typeof live === "string" || live === null ? live : await refreshLiveKeys();

    // ✅ si ya no hay llaves, borra cargo Key del backend (solo si cuenta abierta)
    if (s.status === "Abierta" && !liveNow) {
      await cleanupKeyChargesIfNoKeys(ch, s);
      const ch2 = await listCharges(accountId);
      setCharges(ch2);
    }

    // ✅ parqueadero: resolver, crear/ubicar cargo, iniciar timer
    const p = await resolveParkingForThisAccount();
setParking(p);

    if (p) {
      const entryTs = toLocalTs(p.parkingDate, p.parkingEntryTime);
      setParkingEntryTs(entryTs);

      // si ya tiene salida, fija monto final por fracción
      if (p.parkingExitTime) {
        const exitTs = toLocalTs(p.parkingDate, p.parkingExitTime);
        const finalAmt = parkingFinalAmountFromEntryExit(entryTs, exitTs);
        setParkingFinalAmount(finalAmt);
        setParkingLiveAmount(finalAmt); // para display consistente
      } else {
        setParkingFinalAmount(0);
        const liveAmt = computeAndSetParkingLive(entryTs);

        // asegurar cargo (si no existe)
        const cid = await ensureParkingChargeId(ch, s, p);

        // sincroniza cada minuto (sube al cruzar la hora)
        if (cid && liveAmt >= 0) {
          await syncParkingChargeAmount(liveAmt, ch);
        }
      }
    } else {
      setParkingEntryTs(0);
      setParkingLiveAmount(0);
      setParkingFinalAmount(0);
      setParkingChargeId(null);
    }

  }

  async function hardRefreshFromKeysSignal() {
    const live = await refreshLiveKeys();
    await loadAll(live);
  }

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId]);

  useEffect(() => {
    refreshPosGateFromSummary(summary);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [summary?.openedAt, summary?.status]);

  // ✅ escuchar cambios desde Caja Diaria
  useEffect(() => {
    function onCashboxChanged() {
      refreshPosGateFromSummary(summary);
      loadAll();
    }
    window.addEventListener("zs:cashbox-changed", onCashboxChanged as any);
    return () => window.removeEventListener("zs:cashbox-changed", onCashboxChanged as any);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [summary, accountId]);

  // ✅ escuchar cambios de PARQUEADERO (desde /parqueadero o desde otro tab)
useEffect(() => {
  async function onParkingChanged(e: any) {
    const acc = e?.detail?.accountId;
    if (!acc || String(acc) === String(accountId)) {
      await loadAll();
    }
  }

  window.addEventListener("zs:parking-changed", onParkingChanged as any);

  // soporte multi-tab
  let bc: BroadcastChannel | null = null;
  try {
    bc = new BroadcastChannel("zs:bus");
    bc.onmessage = async (evt) => {
      const data = (evt as any)?.data;
      if (data?.type !== "parking-changed") return;
      const acc = data?.accountId;
      if (!acc || String(acc) === String(accountId)) {
        await loadAll();
      }
    };
  } catch {}

  return () => {
    window.removeEventListener("zs:parking-changed", onParkingChanged as any);
    try {
      bc?.close();
    } catch {}
  };
}, [accountId]); // eslint-disable-line react-hooks/exhaustive-deps


  // ✅ escuchar cambios de llaves emitidos por /llaves
  useEffect(() => {
    async function onKeysChanged(e: any) {
      const acc = e?.detail?.accountId;
      if (!acc || String(acc) === String(accountId)) {
        await hardRefreshFromKeysSignal();
      }
    }
    window.addEventListener("zs:keys-changed", onKeysChanged as any);
    window.addEventListener("zs:lockerkeys-changed", onKeysChanged as any);
    window.addEventListener("zs:lockers-changed", onKeysChanged as any);
    return () => {
      window.removeEventListener("zs:keys-changed", onKeysChanged as any);
      window.removeEventListener("zs:lockerkeys-changed", onKeysChanged as any);
      window.removeEventListener("zs:lockers-changed", onKeysChanged as any);
    };
  }, [accountId]);

  // ✅ fallback: storage + visibilitychange para llaves
  useEffect(() => {
    let lastSince = "";
    function readSince() {
      try {
        return window.localStorage.getItem(SINCE_MAP_KEY) ?? "";
      } catch {
        return "";
      }
    }
    async function maybeRefresh() {
      const now = readSince();
      if (now !== lastSince) {
        lastSince = now;
        await hardRefreshFromKeysSignal();
      }
    }
    lastSince = readSince();
    function onStorage(ev: StorageEvent) {
      if (ev.key === SINCE_MAP_KEY) void maybeRefresh();
    }
    function onVisible() {
      if (document.visibilityState === "visible") void maybeRefresh();
    }
    window.addEventListener("storage", onStorage);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("storage", onStorage);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [accountId]);

  // ✅ opcional multi-tab (BroadcastChannel) para llaves
  useEffect(() => {
    let bc: BroadcastChannel | null = null;
    try {
      bc = new BroadcastChannel("zs:bus");
      bc.onmessage = async (evt) => {
        const data = (evt as any)?.data;
        if (!data) return;
        const isKeys =
          data?.type === "keys-changed" || data?.type === "lockerkeys-changed" || data?.type === "lockers-changed";
        if (!isKeys) return;
        const acc = data?.accountId;
        if (!acc || String(acc) === String(accountId)) {
          await hardRefreshFromKeysSignal();
        }
      };
    } catch {}
    return () => {
      try {
        bc?.close();
      } catch {}
    };
  }, [accountId]);

  // ✅ timer parqueadero: recalcula monto live y sincroniza cargo cada minuto (sube al cruzar la hora)
  useEffect(() => {
    if (!parking || !parkingEntryTs) return;

    let alive = true;

    const tick = async () => {
      if (!alive) return;
      const amt = computeAndSetParkingLive(parkingEntryTs);

      // Solo si la cuenta está abierta y parqueadero sigue activo (sin salida)
      if (summary?.status === "Abierta" && !parking.parkingExitTime) {
        await syncParkingChargeAmount(amt);
      }
    };

    // tick inmediato y luego cada 60s
    void tick();
    const id = window.setInterval(() => void tick(), 60_000);

    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, [parking?.id, parkingEntryTs, summary?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  const saldoColor = useMemo(() => {
    if (!summary) return "";
    return summary.saldo > 0 ? "text-rose-600" : "text-emerald-600";
  }, [summary]);

  const hasPendingCharges = useMemo(() => {
    return charges.some((c) => {
      const isKey = c.kind === "Key";
      const isZero = c.total <= 0;
      if (isKey || isZero) return false;
      return c.status !== "Pagado";
    });
  }, [charges]);

  const closeDisabledReason = useMemo(() => {
    if (!posEnabled) return posReason ?? "POS cerrado para este día.";
    if (hasPendingCharges) return "No puedes cerrar: aún hay cargos pendientes por pagar.";
    return null;
  }, [posEnabled, posReason, hasPendingCharges]);

  function findChargePaidMethod(chargeId: string): PayMethod | null {
    const tag = `charge:${chargeId}`;
    const p =
      [...payments]
        .filter((x) => (x.note ?? "").includes(tag))
        .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0] ?? null;
    if (!p) return null;
    const m = String((p as any).method ?? "");
    if (m === "Efectivo") return "Efectivo";
    if (m === "Transferencia") return "Transferencia";
    return null;
  }

  async function handlePayCharge(form: { chargeId: string; method: PayMethod }) {
    if (!posEnabled) throw new Error(posReason ?? "POS cerrado para este día.");
    lastScrollYRef.current = window.scrollY;

    const c = charges.find((x) => x.id === form.chargeId);
    if (!c) return;
    if (c.kind === "Key") return;
    if (c.total <= 0) throw new Error("No se puede registrar pago cuando el total es $0.00");

    await addPayment(accountId, {
      method: form.method,
      amount: c.total,
      note: `charge:${form.chargeId}`,
    });
    await markChargePaid(accountId, form.chargeId);

    const dk = toDateKey(new Date(summary?.openedAt ?? new Date()));
    addPosPaymentMove({
      dateKey: dk,
      amount: c.total,
      method: form.method,
      concept: `Cuenta #${accountId} · ${summary?.clientName ?? ""} · ${c.concept}`,
      createdBy: "pos",
      ref: { kind: "Charge", id: c.id },
    });

    await loadAll();
    setPayChargeId(null);

    requestAnimationFrame(() => {
      window.scrollTo({ top: lastScrollYRef.current, left: 0, behavior: "auto" });
    });

    emitCashboxChanged(dk);
    onChanged?.();
  }

  async function handleCloseAccount() {
    if (!posEnabled) return;
    if (closing) return;

    // ✅ Validación: no cerrar si existen llaves aún ocupadas por esta cuenta
    const allKeys = await listKeys();
    const stillBusy = (allKeys as any[]).filter((k) => {
      if (k.available) return false;
      const note = String(k.notes ?? "");
      return note.includes(`Cuenta ${accountId}`);
    });
    if (stillBusy.length > 0) {
      await fire({
        icon: "warning",
        title: "No puedes cerrar la cuenta",
        text: "Aún hay llaves asignadas a esta cuenta. Debes liberarlas/entregarlas primero.",
        confirmButtonText: "Entendido",
      });
      return;
    }

    const pending = charges.some((c) => c.kind !== "Key" && c.total > 0 && c.status !== "Pagado");
    if (pending) {
      alert("No puedes cerrar la cuenta: existen cargos pendientes por pagar.");
      return;
    }

    setClosing(true);
    try {
      await closeAccount(accountId);
      await loadAll();
      onChanged?.();
    } finally {
      setClosing(false);
    }
  }

  async function handlePrintReceipt() {
    if (printing) return;
    setPrinting(true);
    try {
      await Promise.resolve(printAccountReceipt(accountId));
    } finally {
      setPrinting(false);
    }
  }

async function handleAddExtraCharge(input: {
  concept: string;
  qty: number;
  amount: number;
  barProductId?: string | null;
}) {
  if (!posEnabled) throw new Error(posReason ?? "POS cerrado para este día.");
  if (!summary) return;
  if (summary.status !== "Abierta") throw new Error("Solo puedes modificar cuentas abiertas.");

  const concept = input.concept.trim();
  if (!concept) throw new Error("Concepto requerido.");
  if (input.qty <= 0) throw new Error("Cantidad inválida.");
  if (!Number.isFinite(input.amount)) throw new Error("Monto inválido.");

  // ✅ si es bar: validar stock y descontar
  if (input.barProductId) {
    const prods = await listBarProducts();
    const p = prods.find((x) => String(x.id) === String(input.barProductId)) ?? null;
    if (!p) throw new Error("Producto de bar no encontrado.");

    const newQty = (p.qty ?? 0) - input.qty;
    if (newQty < 0) {
      throw new Error(`Stock insuficiente. Disponible: ${p.qty ?? 0}`);
    }

    // descontar stock primero (para evitar vender sin stock si falla luego)
    await updateBarProduct(p.id, { name: p.name, qty: newQty, unitPrice: p.unitPrice });
    emitBarProductsChanged();
  }

  // ✅ crear cargo POS
  await addCharge(accountId, { kind: "Normal", concept, qty: input.qty, amount: input.amount });

  await loadAll();
  onChanged?.();
}


  async function handleDeleteCharge(c: Charge) {
    if (!posEnabled) return;

    if (summary?.status !== "Abierta") {
      await fire({ icon: "info", title: "Cuenta cerrada", text: "No se puede eliminar en una cuenta cerrada." });
      return;
    }
    if (c.kind === "Key") {
      await fire({ icon: "info", title: "No permitido", text: "El cargo de llaves no se elimina desde aquí." });
      return;
    }
    if (c.status === "Pagado") {
      await fire({ icon: "warning", title: "No permitido", text: "No se puede eliminar un cargo pagado." });
      return;
    }

    const ok = await confirm({
      icon: "warning",
      title: "Eliminar cargo",
      text: `Se eliminará: ${c.concept} (x${c.qty})`,
      confirmButtonText: "Sí, eliminar",
      cancelButtonText: "Cancelar",
    });
    if (!ok.isConfirmed) return;

    await deleteCharge(accountId, c.id);
    await loadAll();
    onChanged?.();
  }

    // ✅ registrar salida parqueadero desde el detail
   async function handleParkingExitFromDetail() {
    let p = parking;

    if (!p) {
      p = await resolveParkingForThisAccount();
      if (p) setParking(p);
    }

    if (!p) {
      await fire({
        icon: "info",
        title: "No hay parqueadero activo",
        text: "No se encontró un registro de parqueadero abierto vinculado a esta cuenta.",
        confirmButtonText: "OK",
      });
      return;
    }

    if (p.parkingExitTime) return;

    if (!posEnabled) {
      await fire({
        icon: "warning",
        title: "POS bloqueado",
        text: posReason ?? "POS cerrado para este día.",
        confirmButtonText: "Entendido",
      });
      return;
    }

    if (summary?.status !== "Abierta") {
      await fire({
        icon: "info",
        title: "Cuenta cerrada",
        text: "No puedes registrar salida de parqueadero en una cuenta cerrada.",
        confirmButtonText: "Entendido",
      });
      return;
    }

    const exitTime = nowTimeOnly();
    const exitTs = toLocalTs(p.parkingDate, exitTime);

    const finalAmt = parkingFinalAmountFromEntryExit(parkingEntryTs, exitTs);

    const dto: ParkingRequestDto = {
      parkingDate: p.parkingDate,
      parkingEntryTime: p.parkingEntryTime,
      parkingExitTime: exitTime,
      transactionId: String(p.transactionId ?? "") ? p.transactionId : null,
    };

    const updated = await updateParking(p.id, dto);
    setParking(updated);

    const newChargeId = await syncParkingChargeAmount(finalAmt);
    if (newChargeId) setPayChargeId(newChargeId);

    setParkingFinalAmount(finalAmt);
    setParkingLiveAmount(finalAmt);

    emitParkingChanged(String(accountId));

    await fire({
      icon: "success",
      title: "Salida registrada",
      text: `Monto final: $${finalAmt.toFixed(2)}`,
      confirmButtonText: "OK",
    });

    await loadAll();
    onChanged?.();
  }



  // ✅ displayCharges: muestra última fila Key real; si no hay, inyecta una synth SOLO si hay llaves vivas
  const displayCharges = useMemo(() => {
    const nonKey = charges.filter((c) => c.kind !== "Key");

    const keyCharges = charges
      .filter((c) => c.kind === "Key")
      .slice()
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));

    const lastKey = keyCharges[0] ? [keyCharges[0]] : [];
    const computedKeyConcept = liveKeyConcept;

    // ✅ estado real
    const shouldInject = lastKey.length === 0 && !!computedKeyConcept;
    const injected: Charge[] = shouldInject
      ? ([
          {
            id: "__key_synth__",
            kind: "Key",
            concept: computedKeyConcept!,
            qty: 1,
            amount: 0,
            total: 0,
            status: "Pendiente",
            createdAt: summary?.openedAt ?? new Date().toISOString(),
          } as any,
        ] as Charge[])
      : [];

    return [...nonKey, ...lastKey, ...injected].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  }, [charges, summary?.openedAt, liveKeyConcept]);

  // ✅ ADAPTADOR para EditAccountModal (PosAccount)
  const accountForEntries: PosAccount | null = useMemo(() => {
    if (!summary) return null;
    return {
      id: summary.id,
      status: summary.status,
      openedAt: summary.openedAt,
      closedAt: summary.closedAt ?? null,
      clientId: summary.clientId,
      clientName: summary.clientName ?? "",
      gender: (summary.gender ?? "M") as any,
      entryType: (summary.entryType ?? "normal") as any,
      requiresParking: (summary as any).requiresParking ?? false,
      keys: (summary as any).keys,
      peopleCount: (summary as any).peopleCount ?? 0,
      counts: (summary as any).counts ?? { A: 0, N: 0, TE: 0, D: 0, AC: 0 },
    };
  }, [summary]);

  if (loading) return <div className="mt-4 text-sm text-neutral-500">Cargando detalle…</div>;
  if (!summary) return null;

  const selectedCharge = payChargeId ? charges.find((c) => c.id === payChargeId) ?? null : null;

  return (
    <div className="min-w-0 overflow-hidden">
      <div className="rounded-2xl border border-neutral-200 bg-white shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-neutral-200">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">Detalle de cuenta</div>
          <div className="text-sm font-semibold text-neutral-900">Cuenta #{summary.id}</div>

          {!posEnabled && (
            <div className="mt-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
              {posReason ?? "POS cerrado para este día."}
            </div>
          )}
        </div>

        <div className="p-4 grid gap-4 min-w-0">
          <div className="rounded-xl border border-neutral-200 bg-white p-4">
            <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
              <div className="min-w-0">
                <div className="text-sm text-neutral-600">
                  Cuenta #{summary.id} · <span className="font-medium text-neutral-900">{summary.clientName}</span>
                </div>

                <div className="mt-1 text-sm">
                  <span className="font-medium">Estado:</span> {summary.status}
                </div>

                <div className="text-sm">
                  <span className="font-medium">Entrada:</span>{" "}
                  {new Date(summary.openedAt).toLocaleString("es-EC")}
                </div>

                {summary.closedAt && (
                  <div className="text-sm">
                    <span className="font-medium">Salida:</span>{" "}
                    {new Date(summary.closedAt).toLocaleString("es-EC")}
                  </div>
                )}

                {/* ✅ Parqueadero info live */}
                {parking && (
                  <div className="mt-2 rounded-xl border border-neutral-200 bg-neutral-50 px-3 py-2">
                    <div className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Parqueadero</div>
                    <div className="text-sm text-neutral-700">
                      <span className="font-medium">Ingreso:</span> {parking.parkingDate}{" "}
                      {String(parking.parkingEntryTime ?? "").slice(0, 5)}
                      {" · "}
                      <span className="font-medium">Monto actual:</span>{" "}
                      <span className="font-semibold">${parkingLiveAmount.toFixed(2)}</span>
                      {parking.parkingExitTime ? (
                        <>
                          {" · "}
                          <span className="font-medium">Salida:</span>{" "}
                          {String(parking.parkingExitTime ?? "").slice(0, 5)}
                        </>
                      ) : null}
                    </div>

                    {summary.status === "Abierta" && !parking.parkingExitTime && (
                      <div className="mt-2">
                        <button
                          onClick={handleParkingExitFromDetail}
                          disabled={!posEnabled}
                          className="inline-flex items-center justify-center rounded-full bg-black px-4 py-2 text-sm font-semibold text-white hover:bg-neutral-800 disabled:opacity-50"
                        >
                          Registrar salida parqueadero
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {summary.status === "Abierta" && (
                <div className="flex flex-wrap gap-2 justify-start md:justify-end">
                  <button
                    onClick={() => setAddEntriesOpen(true)}
                    disabled={!posEnabled}
                    className="inline-flex items-center justify-center rounded-full border border-neutral-200 bg-white px-4 py-2 text-sm font-medium text-neutral-900 hover:bg-neutral-50 disabled:opacity-50"
                  >
                    Editar Cuenta
                  </button>

                  <button
                    onClick={() => setAddChargeOpen(true)}
                    disabled={!posEnabled}
                    className="inline-flex items-center justify-center rounded-full bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-indigo-700 disabled:opacity-50"
                  >
                    Agregar cargo
                  </button>
                </div>
              )}
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-xl border border-neutral-200 bg-white p-4">
              <div className="text-xs font-medium text-neutral-500">Total cargos</div>
              <div className="mt-1 text-2xl font-semibold text-neutral-900">${summary.totalCargos.toFixed(2)}</div>
            </div>

            <div className="rounded-xl border border-neutral-200 bg-white p-4">
              <div className="text-xs font-medium text-neutral-500">Total pagos</div>
              <div className="mt-1 text-2xl font-semibold text-neutral-900">${summary.totalPagos.toFixed(2)}</div>
            </div>

            <div className="rounded-xl border border-neutral-200 bg-white p-4">
              <div className="text-xs font-medium text-neutral-500">Saldo</div>
              <div className={`mt-1 text-2xl font-semibold ${saldoColor}`}>${summary.saldo.toFixed(2)}</div>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            {summary.status === "Abierta" && (
              <button
                onClick={handleCloseAccount}
                disabled={closing || !posEnabled || hasPendingCharges}
                title={closeDisabledReason ?? undefined}
                className={
                  "inline-flex items-center justify-center rounded-full px-4 py-2 text-sm font-medium text-white " +
                  (closing ? "bg-rose-400 cursor-not-allowed" : "bg-rose-600 hover:bg-rose-700") +
                  " disabled:opacity-50"
                }
              >
                {closing ? "Cerrando…" : "Cerrar cuenta"}
              </button>
            )}

            <button
              onClick={handlePrintReceipt}
              disabled={printing}
              className={
                "inline-flex items-center justify-center rounded-full border border-neutral-200 bg-white px-4 py-2 text-sm font-medium " +
                (printing ? "opacity-60 cursor-not-allowed" : "hover:bg-neutral-50")
              }
            >
              {printing ? "Imprimiendo…" : "Imprimir comprobante"}
            </button>
          </div>

          {/* ---------------- CARGOS ---------------- */}
          <div className="rounded-xl border border-neutral-200 bg-white overflow-hidden min-w-0">
            <div className="px-4 py-3 border-b border-neutral-200 font-semibold">Cargos</div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[720px]">
                <thead className="bg-neutral-50">
                  <tr className="text-left text-xs font-semibold uppercase tracking-wide text-neutral-500">
                    <th className="py-3 px-3">Fecha</th>
                    <th className="py-3 px-3">Tipo</th>
                    <th className="py-3 px-3">Concepto</th>
                    <th className="py-3 px-3">Cant.</th>
                    <th className="py-3 px-3">Monto</th>
                    <th className="py-3 px-3">Total</th>
                    <th className="py-3 px-3">Estado</th>
                    <th className="py-3 px-3 text-right">Acción</th>
                  </tr>
                </thead>

                <tbody>
                  {displayCharges.map((c) => {
                    const paidMethod = c.status === "Pagado" ? findChargePaidMethod(c.id) : null;
                    const isKey = c.kind === "Key";

                    // Parqueadero: mostramos total con parkingLiveAmount para que “se vea subiendo”
                    const isParking = norm(c.concept).startsWith("parqueadero");

                    const parkingDisplayTotal = isParking
                      ? (parking?.parkingExitTime ? parkingFinalAmount : parkingLiveAmount)
                      : c.total;

                    const parkingDisplayAmount = isParking
                      ? (parking?.parkingExitTime ? parkingFinalAmount : parkingLiveAmount)
                      : c.amount;

                    const effectiveTotal = parkingDisplayTotal;
                    const effectiveAmount = parkingDisplayAmount;


                    return (
                      <tr key={c.id} className="border-t border-neutral-200">
                        <td className="py-3 px-3 whitespace-nowrap">{new Date(c.createdAt).toLocaleString("es-EC")}</td>
                        <td className="py-3 px-3">{c.kind}</td>
                        <td className="py-3 px-3">
                          {c.kind === "Key"
                            ? liveKeyConcept ??
                              keyConceptFromSummary(summary) ??
                              c.concept.replace(/\s*\(\s*1H\s*\)\s*$/i, "")
                            : c.concept}
                        </td>
                        {/* Cant. */}
                        <td className="py-3 px-3 font-semibold">
                          {isKey ? <span className="text-neutral-400">—</span> : c.qty}
                        </td>

                        {/* Monto */}
                        <td className="py-3 px-3">
                          {isKey ? (
                            <span className="text-neutral-400">—</span>
                          ) : isParking ? (
                            <>${(+effectiveAmount).toFixed(2)}</>
                          ) : effectiveTotal <= 0 ? (
                            <span className="text-neutral-400">—</span>
                          ) : (
                            <>${(+effectiveAmount).toFixed(2)}</>
                          )}
                        </td>

                        {/* Total */}
                        <td className="py-3 px-3 font-semibold">
                          {isKey ? (
                            <span className="text-neutral-400">—</span>
                          ) : isParking ? (
                            <>${(+effectiveTotal).toFixed(2)}</>
                          ) : effectiveTotal <= 0 ? (
                            <span className="text-neutral-400">—</span>
                          ) : (
                            <>${(+effectiveTotal).toFixed(2)}</>
                          )}
                        </td>


                        <td className="py-3 px-3">
                          {c.status === "Pagado" ? (
                            <span className="inline-flex items-center rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-medium text-emerald-800">
                              {paidMethod ? `Pagado (${paidMethod})` : "Pagado"}
                            </span>
                          ) : isParking && !parking?.parkingExitTime ? (
                            <span className="inline-flex items-center rounded-full bg-sky-100 px-2.5 py-1 text-xs font-medium text-sky-800">
                              En curso
                            </span>
                          ) : effectiveTotal <= 0 ? (
                            <span className="text-xs text-neutral-400">—</span>
                          ) : (
                            <span className="inline-flex items-center rounded-full bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-800">
                              Pendiente
                            </span>
                          )}
                        </td>
                        <td className="py-3 px-3 text-right">
                          {summary.status === "Abierta" && !isKey ? (
                            isParking ? (
                              <div className="flex justify-end gap-2">
                                {!parking?.parkingExitTime ? (
                                  <button
                                    type="button"
                                    onClick={handleParkingExitFromDetail}
                                    disabled={!posEnabled}
                                    className="inline-flex items-center justify-center rounded-lg px-3 py-2 text-xs font-semibold bg-black text-white hover:bg-neutral-800 disabled:opacity-50"
                                  >
                                    Registrar salida
                                  </button>
                                ) : effectiveTotal > 0 && c.status !== "Pagado" ? (
                                  <button
                                    type="button"
                                    onClick={() => setPayChargeId(c.id)}
                                    disabled={!posEnabled}
                                    className="inline-flex items-center justify-center rounded-lg px-3 py-2 text-xs font-semibold bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50"
                                  >
                                    Registrar pago
                                  </button>
                                ) : (
                                  <span className="text-xs text-neutral-400">—</span>
                                )}
                              </div>
                            ) : c.status === "Pendiente" && effectiveTotal > 0 ? (
                              <div className="flex justify-end gap-2">
                                <button
                                  type="button"
                                  onClick={() => setPayChargeId(c.id)}
                                  disabled={!posEnabled}
                                  className="inline-flex items-center justify-center rounded-lg px-3 py-2 text-xs font-semibold bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50"
                                >
                                  Registrar pago
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleDeleteCharge(c)}
                                  disabled={!posEnabled}
                                  className="inline-flex items-center justify-center rounded-lg px-3 py-2 text-xs font-semibold border border-neutral-200 bg-white hover:bg-neutral-50 disabled:opacity-opacity-50"
                                >
                                  Eliminar
                                </button>
                              </div>
                            ) : (
                              <span className="text-xs text-neutral-400">—</span>
                            )
                          ) : (
                            <span className="text-xs text-neutral-400">—</span>
                          )}
                        </td>


                      </tr>
                    );
                  })}

                  {displayCharges.length === 0 && (
                    <tr>
                      <td className="py-6 px-3 text-neutral-500" colSpan={8}>
                        Sin cargos registrados.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* ---------------- PAGOS ---------------- */}
          <div className="rounded-xl border border-neutral-200 bg-white overflow-hidden min-w-0">
            <div className="px-4 py-3 border-b border-neutral-200 font-semibold">Pagos</div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[520px]">
                <thead className="bg-neutral-50">
                  <tr className="text-left text-xs font-semibold uppercase tracking-wide text-neutral-500">
                    <th className="py-3 px-3">Fecha</th>
                    <th className="py-3 px-3">Método</th>
                    <th className="py-3 px-3">Monto</th>
                  </tr>
                </thead>

                <tbody>
                  {payments.map((p) => (
                    <tr key={p.id} className="border-t border-neutral-200">
                      <td className="py-3 px-3 whitespace-nowrap">{new Date(p.createdAt).toLocaleString("es-EC")}</td>
                      <td className="py-3 px-3">{(p as any).method}</td>
                      <td className="py-3 px-3 font-semibold">${p.amount.toFixed(2)}</td>
                    </tr>
                  ))}

                  {payments.length === 0 && (
                    <tr>
                      <td className="py-6 px-3 text-neutral-500" colSpan={3}>
                        Sin pagos registrados.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

      {selectedCharge && selectedCharge.kind !== "Key" && (
        <PayChargeModal
          charge={selectedCharge}
          onCancel={() => setPayChargeId(null)}
          onConfirm={(method) => handlePayCharge({ chargeId: selectedCharge.id, method })}
        />
      )}

      {addChargeOpen && (
        <AddChargeModal
          onCancel={() => setAddChargeOpen(false)}
          onAdd={async (payload) => {
            await handleAddExtraCharge(payload);
            setAddChargeOpen(false);
          }}
        />
      )}

      {addEntriesOpen && accountForEntries && (
        <EditAccountModal
          open={addEntriesOpen}
          onOpenChange={setAddEntriesOpen}
          account={accountForEntries}
          posEnabled={posEnabled}
          posReason={posReason}
          onDone={async () => {
            await loadAll();
            onChanged?.();
          }}
        />
      )}
    </div>
  );
}

/* ---------------- Modal pago ---------------- */
function PayChargeModal({
  charge,
  onCancel,
  onConfirm,
}: {
  charge: Charge;
  onCancel: () => void;
  onConfirm: (method: PayMethod) => void;
}) {
  const [method, setMethod] = useState<PayMethod>("Efectivo");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-2xl border border-neutral-200 bg-white shadow-xl overflow-hidden">
        <div className="p-4 border-b border-neutral-200 flex items-center justify-between">
          <div className="font-semibold">Registrar pago</div>
          <button onClick={onCancel} className="text-sm px-3 py-1 rounded-lg border">
            Cerrar
          </button>
        </div>

        <div className="p-4">
          <div className="text-sm text-neutral-700">
            <div className="mb-1">
              <span className="font-medium">Concepto:</span> {charge.concept}
            </div>
            <div>
              <span className="font-medium">Total:</span> ${charge.total.toFixed(2)}
            </div>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-2">
            <button
              onClick={() => setMethod("Efectivo")}
              className={
                "px-4 py-3 rounded-xl border text-sm font-semibold " +
                (method === "Efectivo"
                  ? "bg-neutral-900 text-white border-neutral-900"
                  : "bg-white border-neutral-200 hover:bg-neutral-50")
              }
            >
              Efectivo
            </button>
            <button
              onClick={() => setMethod("Transferencia")}
              className={
                "px-4 py-3 rounded-xl border text-sm font-semibold " +
                (method === "Transferencia"
                  ? "bg-neutral-900 text-white border-neutral-900"
                  : "bg-white border-neutral-200 hover:bg-neutral-50")
              }
            >
              Transferencia
            </button>
          </div>
        </div>

        <div className="p-4 border-t border-neutral-200 flex justify-end gap-2">
          <button onClick={onCancel} className="px-4 py-2 rounded-xl border border-neutral-200">
            Cancelar
          </button>
          <button
            onClick={() => onConfirm(method)}
            disabled={charge.total <= 0}
            className={
              "px-4 py-2 rounded-xl text-white font-semibold disabled:opacity-50 " +
              (charge.total <= 0 ? "bg-neutral-300 cursor-not-allowed" : "bg-emerald-600 hover:bg-emerald-700")
            }
          >
            Confirmar pago
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---------------- Modal agregar cargo (bar/extras) ---------------- */
function AddChargeModal({
  onCancel,
  onAdd,
}: {
  onCancel: () => void;
  onAdd: (payload: { concept: string; qty: number; amount: number; barProductId?: string | null }) => Promise<void> | void;
}) {
  const [tab, setTab] = useState<"bar" | "manual">("bar");
  const [loading, setLoading] = useState(false);
  const [products, setProducts] = useState<BarProduct[]>([]);
  const [q, setQ] = useState("");
  const [selectedId, setSelectedId] = useState<string>("");
  const [qty, setQty] = useState(1);
  const [concept, setConcept] = useState("");
  const [amount, setAmount] = useState<number>(0);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      try {
        const data = await listBarProducts();
        if (!alive) return;
        setProducts(data);
        if (data.length) setSelectedId(data[0].id);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const filtered = useMemo(() => {
    const nq = norm(q);
    if (!nq) return products;
    return products.filter((p) => norm(p.name).includes(nq));
  }, [products, q]);

  const selected = useMemo(() => products.find((p) => p.id === selectedId) ?? null, [products, selectedId]);

  

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-2xl rounded-2xl border border-neutral-200 bg-white shadow-xl overflow-hidden">
        <div className="p-4 border-b border-neutral-200 flex items-center justify-between">
          <div className="font-semibold">Agregar cargo</div>
          <button onClick={onCancel} className="text-sm px-3 py-1 rounded-lg border">
            Cerrar
          </button>
        </div>

        <div className="p-4">
          <div className="flex gap-2 mb-4">
            <button
              onClick={() => setTab("bar")}
              className={
                "px-3 py-2 rounded-full border text-sm font-semibold " +
                (tab === "bar" ? "bg-neutral-900 text-white border-neutral-900" : "border-neutral-200 hover:bg-neutral-50")
              }
            >
              Bar
            </button>
            <button
              onClick={() => setTab("manual")}
              className={
                "px-3 py-2 rounded-full border text-sm font-semibold " +
                (tab === "manual"
                  ? "bg-neutral-900 text-white border-neutral-900"
                  : "border-neutral-200 hover:bg-neutral-50")
              }
            >
              Manual
            </button>
          </div>

          {tab === "bar" ? (
            <div className="grid gap-3">
              {loading ? (
                <div className="text-sm text-neutral-500">Cargando productos…</div>
              ) : products.length === 0 ? (
                <div className="text-sm text-neutral-500">No hay productos de bar.</div>
              ) : (
                <>
                  <div className="grid sm:grid-cols-3 gap-3 items-end">
                    <div className="sm:col-span-2">
                      <div className="text-sm font-medium">Buscar</div>
                      <input
                        className="border border-neutral-200 rounded-xl px-3 py-2 w-full mt-1"
                        value={q}
                        onChange={(e) => setQ(e.target.value)}
                        placeholder="salchi, agua, cerveza…"
                      />
                    </div>
                    <div>
                      <div className="text-sm font-medium">Cantidad</div>
                      <input
                        type="number"
                        min={1}
                        className="border border-neutral-200 rounded-xl px-3 py-2 w-full mt-1"
                        value={qty}
                        onChange={(e) => setQty(Math.max(1, parseInt(e.target.value || "1", 10)))}
                      />
                    </div>
                  </div>

                  <div className="border border-neutral-200 rounded-xl max-h-56 overflow-auto">
                    {filtered.map((p) => (
                      <button
                        key={p.id}
                        onClick={() => setSelectedId(p.id)}
                        className={
                          "w-full text-left px-3 py-2 border-b border-neutral-200 last:border-b-0 hover:bg-neutral-50 " +
                          (p.id === selectedId ? "bg-emerald-50" : "")
                        }
                        type="button"
                      >
                        <div className="text-sm font-semibold">{p.name}</div>
                        <div className="text-xs text-neutral-500">
                          ${p.unitPrice.toFixed(2)} · Stock: {p.qty}
                        </div>
                      </button>
                    ))}
                  </div>
                  <div className="text-sm text-neutral-700">
                    Seleccionado: <span className="font-semibold">{selected?.name ?? "—"}</span> · Unit:{" "}
                    <span className="font-semibold">${(selected?.unitPrice ?? 0).toFixed(2)}</span> · Stock:{" "}
                    <span className="font-semibold">{selected?.qty ?? 0}</span>
                  </div>

                </>
              )}
            </div>
          ) : (
            <div className="grid sm:grid-cols-3 gap-3">
              <div className="sm:col-span-2">
                <div className="text-sm font-medium">Concepto</div>
                <input
                  className="border border-neutral-200 rounded-xl px-3 py-2 w-full mt-1"
                  value={concept}
                  onChange={(e) => setConcept(e.target.value)}
                  placeholder="Salchipapa, Nevado, etc."
                />
              </div>

              <div>
                <div className="text-sm font-medium">Monto unitario</div>
                <input
                  type="number"
                  step="0.01"
                  className="border border-neutral-200 rounded-xl px-3 py-2 w-full mt-1"
                  value={amount}
                  onChange={(e) => setAmount(parseFloat(e.target.value || "0"))}
                />
              </div>

              <div>
                <div className="text-sm font-medium">Cantidad</div>
                <input
                  type="number"
                  min={1}
                  className="border border-neutral-200 rounded-xl px-3 py-2 w-full mt-1"
                  value={qty}
                  onChange={(e) => setQty(Math.max(1, parseInt(e.target.value || "1", 10)))}
                />
              </div>
            </div>
          )}
        </div>

        <div className="p-4 border-t border-neutral-200 flex justify-end gap-2">
          <button onClick={onCancel} className="px-4 py-2 rounded-xl border border-neutral-200">
            Cancelar
          </button>
          <button
            onClick={() => {
              if (tab === "bar") {
                if (!selected) return;

                if ((selected.qty ?? 0) < qty) {
                  alert(`Stock insuficiente. Disponible: ${selected.qty ?? 0}`);
                  return;
                }

                onAdd({
                  concept: `Bar: ${selected.name}`,
                  qty,
                  amount: selected.unitPrice,
                  barProductId: selected.id,
                });
                return;
              }

              onAdd({ concept, qty, amount });
            }}

            className="px-4 py-2 rounded-xl bg-emerald-600 text-white font-semibold hover:bg-emerald-700 disabled:opacity-60"
            disabled={tab === "bar" ? !selected : !concept.trim() || !Number.isFinite(amount)}
          >
            Agregar
          </button>
        </div>
      </div>
    </div>
  );
}
