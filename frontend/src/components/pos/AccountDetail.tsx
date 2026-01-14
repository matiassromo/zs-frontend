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
import { consumeAccessCardByHolder } from "@/lib/apiv2/accessCards";

// ✅ POS lock / caja diaria
import { toDateKey, getCashboxByDate, addPosPaymentMove } from "@/lib/apiv2/cashbox";

// ✅ bar
import { listBarProducts } from "@/lib/apiv2/barProducts";
import type { BarProduct } from "@/types/barProduct";

const PRICES_LOCAL = { A: 7, N: 4, TE: 5, D: 5, AC: 1, PASS: 55 };

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

  async function cleanupKeyChargesIfNoKeys(chNow: Charge[]) {
    // ✅ NO modificar cargos si la cuenta no está abierta (deleteCharge lo bloquea)
    if (summary?.status !== "Abierta") return;

    // si no hay llaves ocupadas -> borra cargos Key pendientes (reales, no synth)
    if (liveKeyConcept) return;

    const toDelete = chNow.filter((c) => c.kind === "Key" && c.id !== "__key_synth__" && c.status !== "Pagado");
    for (const c of toDelete) {
      await deleteCharge(accountId, c.id);
    }
  }


  async function loadAll(live?: string | null) {
    setLoading(true);

    const [s, ch, pm] = await Promise.all([
      getAccount(accountId),
      listCharges(accountId),
      listPayments(accountId),
    ]);

    setSummary(s);
    setCharges(ch);
    setPayments(pm);
    setLoading(false);

    // ✅ si no me pasan live, lo calculo aquí
    const liveNow = typeof live === "string" || live === null ? live : await refreshLiveKeys();

    // ✅ si ya no hay llaves, borra cargo Key del backend (solo si cuenta abierta)
    if (s.status === "Abierta" && !liveNow) {
      await cleanupKeyChargesIfNoKeys(ch);
      const ch2 = await listCharges(accountId);
      setCharges(ch2);
    }
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

  // ✅ escuchar cambios de llaves emitidos por /llaves
  useEffect(() => {
    async function onKeysChanged(e: any) {
      const acc = e?.detail?.accountId;
      if (!acc || String(acc) === String(accountId)) {
        await refreshLiveKeys();
        await loadAll();
      }
    }
    window.addEventListener("zs:keys-changed", onKeysChanged as any);
    return () => window.removeEventListener("zs:keys-changed", onKeysChanged as any);
  }, [accountId]);

  // ✅ opcional multi-tab
  useEffect(() => {
    let bc: BroadcastChannel | null = null;
    try {
      bc = new BroadcastChannel("zs:bus");
      bc.onmessage = async (evt) => {
        const data = (evt as any)?.data;
        if (data?.type !== "keys-changed") return;
        const acc = data?.accountId;
        if (!acc || String(acc) === String(accountId)) {
          await refreshLiveKeys();
          await loadAll();
        }
      };
    } catch {}
    return () => {
      try {
        bc?.close();
      } catch {}
    };
  }, [accountId]);

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
    const p = [...payments]
      .filter((x) => (x.note ?? "").includes(tag))
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0];

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

    if (c.total <= 0) {
      throw new Error("No se puede registrar pago cuando el total es $0.00");
    }

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

  async function handleAddExtraCharge(input: { concept: string; qty: number; amount: number }) {
    if (!posEnabled) throw new Error(posReason ?? "POS cerrado para este día.");
    if (!summary) return;
    if (summary.status !== "Abierta") throw new Error("Solo puedes modificar cuentas abiertas.");

    const concept = input.concept.trim();
    if (!concept) throw new Error("Concepto requerido.");
    if (input.qty <= 0) throw new Error("Cantidad inválida.");
    if (!Number.isFinite(input.amount)) throw new Error("Monto inválido.");

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

  // ✅ displayCharges: muestra última fila Key real; si no hay, inyecta una synth SOLO si hay llaves vivas
  const displayCharges = useMemo(() => {
    const nonKey = charges.filter((c) => c.kind !== "Key");

    const keyCharges = charges
      .filter((c) => c.kind === "Key")
      .slice()
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));

    const lastKey = keyCharges[0] ? [keyCharges[0]] : [];
    const computedKeyConcept = liveKeyConcept; // ✅ aquí manda el estado real

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

  // ✅ ADAPTADOR para AddEntriesModal (PosAccount)
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
                  <span className="font-medium">Entrada:</span> {new Date(summary.openedAt).toLocaleString("es-EC")}
                </div>
                {summary.closedAt && (
                  <div className="text-sm">
                    <span className="font-medium">Salida:</span> {new Date(summary.closedAt).toLocaleString("es-EC")}
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

          <div className="rounded-xl border border-neutral-200 bg-white overflow-hidden min-w-0">
            <div className="px-4 py-3 border-b border-neutral-200 font-semibold">Cargos</div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[680px]">
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

                    return (
                      <tr key={c.id} className="border-t border-neutral-200">
                        <td className="py-3 px-3 whitespace-nowrap">{new Date(c.createdAt).toLocaleString("es-EC")}</td>
                        <td className="py-3 px-3">{c.kind}</td>

                        <td className="py-3 px-3">
                          {c.kind === "Key"
                            ? (liveKeyConcept ?? keyConceptFromSummary(summary) ?? c.concept.replace(/\s*\(\s*1H\s*\)\s*$/i, ""))
                            : c.concept}
                        </td>

                        <td className="py-3 px-3">{c.qty}</td>

                        <td className="py-3 px-3">
                          {isKey || c.total <= 0 ? <span className="text-neutral-400">—</span> : `$${c.amount.toFixed(2)}`}
                        </td>

                        <td className="py-3 px-3 font-semibold">
                          {isKey || c.total <= 0 ? <span className="text-neutral-400">—</span> : `$${c.total.toFixed(2)}`}
                        </td>

                        <td className="py-3 px-3">
                          {c.status === "Pagado" ? (
                            <span className="inline-flex items-center rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-medium text-emerald-800">
                              {paidMethod ? `Pagado (${paidMethod})` : "Pagado"}
                            </span>
                          ) : c.total <= 0 ? (
                            <span className="text-xs text-neutral-400">—</span>
                          ) : (
                            <span className="inline-flex items-center rounded-full bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-800">
                              Pendiente
                            </span>
                          )}
                        </td>

                        <td className="py-3 px-3 text-right">
                          {summary.status === "Abierta" && c.status === "Pendiente" && !isKey && c.total > 0 ? (
                            <div className="flex justify-end gap-2">
                              <button
                                onClick={() => {
                                  if (c.total <= 0) return;
                                  setPayChargeId(c.id);
                                }}
                                disabled={!posEnabled || c.total <= 0}
                                className={
                                  "inline-flex items-center justify-center rounded-lg px-3 py-2 text-xs font-semibold text-white disabled:opacity-50 " +
                                  (c.total <= 0 ? "bg-neutral-300 cursor-not-allowed" : "bg-emerald-600 hover:bg-emerald-700")
                                }
                                title={c.total <= 0 ? "No se puede pagar un cargo con total $0.00" : undefined}
                              >
                                Registrar pago
                              </button>

                              <button
                                onClick={() => handleDeleteCharge(c)}
                                disabled={!posEnabled}
                                className="inline-flex items-center justify-center rounded-lg px-3 py-2 text-xs font-semibold border border-neutral-200 bg-white hover:bg-neutral-50 disabled:opacity-50"
                              >
                                Eliminar
                              </button>
                            </div>
                          ) : (
                            <span className="text-xs text-neutral-400">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}

                  {charges.length === 0 && (
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
  onAdd: (payload: { concept: string; qty: number; amount: number }) => Promise<void> | void;
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
                        <div className="text-xs text-neutral-500">${p.unitPrice.toFixed(2)}</div>
                      </button>
                    ))}
                  </div>

                  <div className="text-sm text-neutral-700">
                    Seleccionado: <span className="font-semibold">{selected?.name ?? "—"}</span> · Unit:{" "}
                    <span className="font-semibold">${(selected?.unitPrice ?? 0).toFixed(2)}</span>
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
                onAdd({ concept: `Bar: ${selected.name}`, qty, amount: selected.unitPrice });
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
