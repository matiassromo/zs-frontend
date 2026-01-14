// src/components/pos/AddEntriesModal.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import Swal from "sweetalert2";

import type { PosAccount } from "@/lib/api/accounts";
import { addCharge, updateAccount, deleteCharge, listCharges } from "@/lib/api/accounts";

import {
  findAccessCardByHolder,
  createAccessCardForHolder,
  consumeAccessCardByHolder,
} from "@/lib/apiv2/accessCards";

type Counts = { A: number; N: number; TE: number; D: number; AC: number };

const PRICES = { A: 7, N: 4, TE: 5, D: 5, AC: 1 } as const;

function clampInt(n: any) {
  const v = Number.isFinite(Number(n)) ? Number(n) : 0;
  return Math.max(0, Math.trunc(v));
}

function keyLabel(k: keyof Counts) {
  switch (k) {
    case "A":
      return "Adulto";
    case "N":
      return "Niño";
    case "TE":
      return "3ra edad";
    case "D":
      return "Discapacidad";
    case "AC":
      return "Acompañante";
  }
}

function conceptFor(k: keyof Counts) {
  // ✅ conceptos sin (A)/(N)/(...) para que no vuelvan a grabarse
  switch (k) {
    case "A":
      return "Adulto";
    case "N":
      return "Niño";
    case "TE":
      return "Tercera edad";
    case "D":
      return "Discapacidad";
    case "AC":
      return "Acompañante";
  }
}

const ENTRY_CONCEPTS = new Set<string>([
  // ✅ nuevos (sin siglas)
  "Adulto",
  "Niño",
  "Tercera edad",
  "Discapacidad",
  "Acompañante",

  // ✅ viejos con siglas por si quedaron en BD
  "Adulto (A)",
  "Niño (N)",
  "Tercera edad (TE)",
  "Discapacidad (D)",
  "Acompañante (AC)",

  // ✅ variantes antiguas
  "Entrada adulto",
  "Entrada niño",
  "Entrada 3ra edad",
  "Entrada discapacidad",
]);

export default function AddEntriesModal({
  open,
  onOpenChange,
  account,
  posEnabled,
  posReason,
  onDone,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  account: PosAccount; // ✅ NUNCA null aquí
  posEnabled: boolean;
  posReason?: string | null;
  onDone: () => Promise<void> | void;
}) {
  if (!open) return null;

  const initial: Counts = useMemo(() => {
    const c = account.counts;
    return {
      A: clampInt(c?.A ?? 0),
      N: clampInt(c?.N ?? 0),
      TE: clampInt(c?.TE ?? 0),
      D: clampInt(c?.D ?? 0),
      AC: clampInt(c?.AC ?? 0),
    };
  }, [account.counts?.A, account.counts?.N, account.counts?.TE, account.counts?.D, account.counts?.AC]);

  const [counts, setCounts] = useState<Counts>(initial);

  // Tarjeta 10 pases (solo consume; no des-consume)
  const [useCard, setUseCard] = useState(false);
  const [passCount, setPassCount] = useState(0);

  useEffect(() => {
    setCounts(initial);
    setUseCard(false);
    setPassCount(0);
  }, [initial]);

  const totalPeople = useMemo(() => counts.A + counts.N + counts.TE + counts.D + counts.AC, [counts]);

  async function handleSave() {
    try {
      if (!posEnabled) throw new Error(posReason ?? "POS cerrado para este día.");
      if (account.status !== "Abierta") throw new Error("Solo puedes modificar cuentas abiertas.");

      const ok = await Swal.fire({
        title: "Aplicar cambios",
        text: `Esto actualizará las entradas de ${account.clientName} en esta cuenta.`,
        icon: "question",
        showCancelButton: true,
        confirmButtonText: "Sí, aplicar",
        cancelButtonText: "Cancelar",
      });
      if (!ok.isConfirmed) return;

      const accountId = account.id;

      // 1) Reemplazar cargos de entradas (Normal) por los nuevos totales
      const charges = await listCharges(accountId);

      // ✅ NO borres pagados (evita desbalancear pagos/total)
      const toDelete = charges.filter(
        (c) =>
          c.kind === "Normal" &&
          c.status !== "Pagado" &&
          ENTRY_CONCEPTS.has(String(c.concept ?? "").trim())
      );

      for (const c of toDelete) {
        await deleteCharge(accountId, c.id);
      }

      // 2) Crear cargos de entradas según nuevos conteos
      const keys: (keyof Counts)[] = ["A", "N", "TE", "D", "AC"];
      for (const k of keys) {
        const qty = clampInt(counts[k]);
        if (qty <= 0) continue;

        await addCharge(accountId, {
          kind: "Normal",
          concept: conceptFor(k),
          qty,
          amount: PRICES[k],
        });
      }

      // 3) Persistir counts/peopleCount en la cuenta (para Dashboard)
      await updateAccount(accountId, {
        peopleCount: totalPeople,
        counts: { ...counts },
      });

      // 4) Tarjeta 10 pases (solo consume)
      if (useCard && passCount > 0) {
        const holder = String(account.clientName ?? "").trim();
        if (!holder) throw new Error("No se puede usar tarjeta de pases sin nombre del cliente.");

        const card = await findAccessCardByHolder(holder);
        if (!card) {
          await createAccessCardForHolder(holder, 10);
        }
        await consumeAccessCardByHolder(holder, passCount);

        // cargo informativo $0
        await addCharge(accountId, {
          kind: "Normal",
          concept: "Tarjeta 10 pases (uso)",
          qty: passCount,
          amount: 0,
        });
      }

      await Swal.fire({
        title: "Listo",
        text: "Entradas actualizadas en la cuenta.",
        icon: "success",
        timer: 1100,
        showConfirmButton: false,
      });

      onOpenChange(false);
      await onDone();
    } catch (e: any) {
      await Swal.fire({
        title: "Error",
        text: e?.message || "No se pudo actualizar la cuenta.",
        icon: "error",
      });
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-3xl rounded-2xl bg-white shadow-xl overflow-hidden">
        <div className="flex items-center justify-between border-b px-5 py-4">
          <div>
            <div className="text-lg font-semibold">Agregar / editar entradas</div>
            <div className="text-sm text-neutral-500">
              Cuenta: <span className="font-medium text-neutral-900">{account.clientName}</span>
            </div>
          </div>

          <button
            className="rounded-lg px-3 py-1 text-sm hover:bg-neutral-100"
            onClick={() => onOpenChange(false)}
          >
            Cerrar
          </button>
        </div>

        {!posEnabled && (
          <div className="px-5 pt-4">
            <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
              {posReason ?? "POS cerrado para este día."}
            </div>
          </div>
        )}

        <div className="space-y-6 px-5 py-5">
          <div className="rounded-2xl border border-neutral-200 p-4">
            <div className="mb-3 text-sm font-semibold">Entradas (normal)</div>

            <div className="grid grid-cols-1 gap-3 md:grid-cols-5">
              {(["A", "N", "TE", "D", "AC"] as (keyof Counts)[]).map((k) => {
                const price = PRICES[k];
                const qty = counts[k];
                const subtotal = qty * price;

                return (
                  <div key={k} className="rounded-2xl border border-neutral-200 p-3">
                    <div className="text-sm font-medium">{keyLabel(k)}</div>
                    <div className="text-xs text-neutral-500">Precio: ${price.toFixed(2)}</div>

                    <div className="mt-3 flex items-center gap-2">
                      <button
                        className="h-9 w-9 rounded-full border border-neutral-200 bg-white hover:bg-neutral-50"
                        onClick={() => setCounts((s) => ({ ...s, [k]: Math.max(0, s[k] - 1) }))}
                        type="button"
                      >
                        −
                      </button>

                      <input
                        className="h-9 w-14 rounded-xl border border-neutral-200 text-center text-sm"
                        value={qty}
                        onChange={(e) => setCounts((s) => ({ ...s, [k]: clampInt(e.target.value) }))}
                      />

                      <button
                        className="h-9 w-9 rounded-full border border-neutral-200 bg-white hover:bg-neutral-50"
                        onClick={() => setCounts((s) => ({ ...s, [k]: s[k] + 1 }))}
                        type="button"
                      >
                        +
                      </button>
                    </div>

                    <div className="mt-3 text-xs">
                      Subtotal: <span className="font-semibold">${subtotal.toFixed(2)}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="rounded-2xl border border-neutral-200 p-4">
            <div className="flex items-center justify-between">
              <div className="text-sm font-semibold">Tarjeta 10 pases</div>

              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={useCard} onChange={(e) => setUseCard(e.target.checked)} />
                Usar tarjeta en este grupo
              </label>
            </div>

            <div className={"mt-3 text-sm text-neutral-500 " + (useCard ? "" : "opacity-70")}>
              Activa esta sección si parte del grupo entra usando tarjeta (se puede combinar con entradas normales).
            </div>

            {useCard && (
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <div className="text-sm">Pases a consumir:</div>
                <input
                  className="h-9 w-24 rounded-xl border border-neutral-200 px-3 text-sm"
                  value={passCount}
                  onChange={(e) => setPassCount(clampInt(e.target.value))}
                />
                <div className="text-xs text-neutral-500">
                  Si la tarjeta no existe, se creará para <b>{account.clientName}</b>.
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 border-t px-5 py-4">
          <button
            className="px-4 py-2 rounded-xl border border-neutral-200 hover:bg-neutral-50"
            onClick={() => onOpenChange(false)}
          >
            Cancelar
          </button>
          <button
            className="px-4 py-2 rounded-xl bg-emerald-600 text-white font-semibold hover:bg-emerald-700 disabled:opacity-60"
            onClick={handleSave}
            disabled={!posEnabled}
          >
            Aplicar
          </button>
        </div>
      </div>
    </div>
  );
}
