"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import { confirm, fire } from "@/lib/ui/swal";

import type { PosAccount } from "@/lib/api/accounts";
import { addCharge, updateAccount, deleteCharge, listCharges } from "@/lib/api/accounts";

import { createParking, deleteParking, listParkings } from "@/lib/apiv2/parkings";
import type { ParkingRequestDto } from "@/types/parking";


import {
  findAccessCardByHolder,
  createAccessCardForHolder,
  updateAccessCard,
} from "@/lib/apiv2/accessCards";

import { listKeys, updateKey } from "@/lib/apiv2/keys";
import type { Key } from "@/types/key";
import type { SelectedKey, KeyGender } from "@/types/pos";

// ------------------ helpers localStorage map (accountId -> parkingId) ------------------
const ACCOUNT_PARKING_MAP_KEY = "zs:parking:accountParkingMap";

function readAccountParkingMap(): Record<string, string> {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(window.localStorage.getItem(ACCOUNT_PARKING_MAP_KEY) || "{}");
  } catch {
    return {};
  }
}

function writeAccountParkingMap(next: Record<string, string>) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(ACCOUNT_PARKING_MAP_KEY, JSON.stringify(next));
}

// ✅ GUID válido y NO vacío
function isNonEmptyGuid(v: any): v is string {
  if (typeof v !== "string") return false;
  const s = v.trim().toLowerCase();
  if (s === "00000000-0000-0000-0000-000000000000") return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(s);
}


type Counts = { A: number; N: number; TE: number; D: number; AC: number };

const PRICES = { A: 7, N: 4, TE: 5, D: 5, AC: 1 } as const;
const PASS_PRICE = 55;

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
  "Adulto",
  "Niño",
  "Tercera edad",
  "Discapacidad",
  "Acompañante",
  "Adulto (A)",
  "Niño (N)",
  "Tercera edad (TE)",
  "Discapacidad (D)",
  "Acompañante (AC)",
  "Entrada adulto",
  "Entrada niño",
  "Entrada 3ra edad",
  "Entrada discapacidad",
]);

function keyId(g: KeyGender, n: number) {
  return `${g}-${n}`;
}

function sortedKeysByGuid(keys: Key[]) {
  return [...(keys ?? [])].sort((a, b) => a.id.localeCompare(b.id));
}

function keyFromOrdered(ordered: Key[], gender: KeyGender, number: number): Key | null {
  const idx = gender === "H" ? number - 1 : 16 + (number - 1);
  return ordered[idx] ?? null;
}

// ✅ extrae el “tag” de cuenta desde notes (sirve para numérico o GUID)
function extractAccountTagFromNote(note: string | null | undefined): string | null {
  const s = String(note ?? "");
  const m = s.match(/Cuenta\s*([0-9a-f-]+)/i) || s.match(/Cuenta\s*(\d+)/i);
  if (!m?.[1]) return null;
  return String(m[1]).slice(0, 8);
}

function remainingFromFound(found: { card: any; remaining?: any } | null | undefined): number {
  const uses = Number(found?.card?.uses);
  if (Number.isFinite(uses)) return uses;
  const fallback = Number(found?.remaining);
  return Number.isFinite(fallback) ? fallback : 0;
}

export default function EditAccountModal({
  open,
  onOpenChange,
  account,
  posEnabled,
  posReason,
  onDone,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  account: PosAccount;
  posEnabled: boolean;
  posReason?: string | null;
  onDone: () => Promise<void> | void;
}) {
  if (!open) return null;

  const accountTag = useMemo(() => String(account.id).slice(0, 8), [account.id]);

  const initialCounts: Counts = useMemo(() => {
    const c = account.counts;
    return {
      A: clampInt(c?.A ?? 0),
      N: clampInt(c?.N ?? 0),
      TE: clampInt(c?.TE ?? 0),
      D: clampInt(c?.D ?? 0),
      AC: clampInt(c?.AC ?? 0),
    };
  }, [account.counts?.A, account.counts?.N, account.counts?.TE, account.counts?.D, account.counts?.AC]);

  const [counts, setCounts] = useState<Counts>(initialCounts);

  const [useCard, setUseCard] = useState(false);
  const [passCount, setPassCount] = useState(0);

  // ✅ LLAVES
  const [keyGender, setKeyGender] = useState<KeyGender>("H");
  const [availableKeys, setAvailableKeys] = useState<number[]>([]);
  const [selectedKeys, setSelectedKeys] = useState<SelectedKey[]>([]);
  const [initialKeys, setInitialKeys] = useState<SelectedKey[]>([]);

  const [requiresParking, setRequiresParking] = useState(false);
  const [initialRequiresParking, setInitialRequiresParking] = useState(false);
  const [initialParkingId, setInitialParkingId] = useState<string | null>(null);

  useEffect(() => {
  setCounts(initialCounts);
  setUseCard(false);
  setPassCount(0);

  // reset parking (se hidrata en efecto aparte)
  setRequiresParking(false);
  setInitialRequiresParking(false);
  setInitialParkingId(null);
}, [initialCounts]);

useEffect(() => {
  if (!open) return;

  (async () => {
    // 1) preferir vínculo guardado por CreateAccountModal
    const ap = readAccountParkingMap();
    const pid = ap[String(account.id)] || null;

    if (pid) {
      setRequiresParking(true);
      setInitialRequiresParking(true);
      setInitialParkingId(pid);
      return;
    }

    // 2) fallback opcional: buscar en backend por transactionId == account.id
    // (si listParkings existe)
    try {
      const all = await listParkings();
      const found = (all ?? []).find((p: any) => String(p.transactionId ?? "") === String(account.id));
      if (found?.id) {
        setRequiresParking(true);
        setInitialRequiresParking(true);
        setInitialParkingId(String(found.id));

        const next = readAccountParkingMap();
        next[String(account.id)] = String(found.id);
        writeAccountParkingMap(next);
        return;
      }
    } catch {}

    setRequiresParking(false);
    setInitialRequiresParking(false);
    setInitialParkingId(null);
  })();
}, [open, account.id]);



  // ✅ REGLA: el modal SIEMPRE reconstruye llaves desde backend real (keys + notes),
  // así se sincroniza después de liberar en /llaves.
  const hydrateSelectedKeysFromBackend = useCallback(async () => {
    const raw = await listKeys();
    const ordered = sortedKeysByGuid(raw);

    const live: SelectedKey[] = [];

    ordered.forEach((k, idx) => {
      if (k.available) return;

      const tag = extractAccountTagFromNote(k.notes);
      if (!tag || tag !== accountTag) return;

      const g: KeyGender = idx < 16 ? "H" : "M";
      const num = g === "H" ? idx + 1 : idx - 16 + 1;

      live.push({
        keyId: keyId(g, num),
        gender: g,
        number: num,
        duration: "1H" as any,
      });
    });

    live.sort((a, b) => a.gender.localeCompare(b.gender) || a.number - b.number);

    setSelectedKeys(live);
    setInitialKeys(live);
    setKeyGender(live[0]?.gender ?? "H");
  }, [accountTag]);

  useEffect(() => {
    if (!open) return;
    hydrateSelectedKeysFromBackend();
  }, [open, hydrateSelectedKeysFromBackend]);

  useEffect(() => {
    if (!open) return;

    const onKeysChanged = (ev: any) => {
      const tag = String(ev?.detail?.accountId ?? "").slice(0, 8);
      if (!tag || tag !== accountTag) return;
      hydrateSelectedKeysFromBackend();
    };

    window.addEventListener("zs:keys-changed", onKeysChanged as any);

    let bc: BroadcastChannel | null = null;
    try {
      bc = new BroadcastChannel("zs:bus");
      bc.onmessage = (msg: any) => {
        const data = msg?.data;
        if (data?.type !== "keys-changed") return;
        const tag = String(data?.accountId ?? "").slice(0, 8);
        if (!tag || tag !== accountTag) return;
        hydrateSelectedKeysFromBackend();
      };
    } catch {}

    return () => {
      window.removeEventListener("zs:keys-changed", onKeysChanged as any);
      try {
        bc?.close();
      } catch {}
    };
  }, [open, accountTag, hydrateSelectedKeysFromBackend]);

  useEffect(() => {
    let alive = true;

    (async () => {
      const raw = await listKeys();
      const ordered = sortedKeysByGuid(raw);

      const free: number[] = [];

      ordered.forEach((k, idx) => {
        const g: KeyGender = idx < 16 ? "H" : "M";
        if (g !== keyGender) return;

        const num = g === "H" ? idx + 1 : idx - 16 + 1;

        const mine = !k.available && extractAccountTagFromNote(k.notes) === accountTag;

        if (k.available || mine) free.push(num);
      });

      const used = new Set(selectedKeys.filter((k) => k.gender === keyGender).map((k) => k.number));

      if (!alive) return;
      setAvailableKeys(free.filter((n) => !used.has(n)).sort((a, b) => a - b));
    })();

    return () => {
      alive = false;
    };
  }, [keyGender, selectedKeys, accountTag]);

  const totalPeople = useMemo(() => counts.A + counts.N + counts.TE + counts.D + counts.AC, [counts]);

  async function syncKeys(accountId: string) {
    const prev = initialKeys;
    const next = selectedKeys;

    const removed = prev.filter((p) => !next.some((n) => n.gender === p.gender && n.number === p.number));
    const added = next.filter((n) => !prev.some((p) => p.gender === n.gender && p.number === n.number));

    const raw = await listKeys();
    const ordered = sortedKeysByGuid(raw);

    for (const r of removed) {
      const k = keyFromOrdered(ordered, r.gender as KeyGender, Number(r.number));
      if (!k) continue;

      await updateKey(k.id, {
        available: true,
        lastAssignedTo: null,
        notes: null,
        lastAssignedAt: null,
      });
    }

    const nowIso = new Date().toISOString();
    const note = `Cuenta ${accountId.slice(0, 8)} - ${String(account.clientName ?? "").trim()}`;

    for (const a of added) {
      const k = keyFromOrdered(ordered, a.gender as KeyGender, Number(a.number));
      if (!k) continue;

      if (!k.available && extractAccountTagFromNote(k.notes) !== accountId.slice(0, 8)) {
        throw new Error(`La llave ${a.number}${a.gender} ya no está disponible.`);
      }

      await updateKey(k.id, {
        available: false,
        lastAssignedTo: account.clientId,
        notes: note,
        lastAssignedAt: nowIso,
      });
    }

    await updateAccount(accountId, {
      keys: next.length ? { items: next.map((k) => ({ gender: k.gender, number: k.number })), duration: "1H" } : undefined,
    } as any);

    const currentCharges = await listCharges(accountId);
    for (const c of currentCharges) {
      if (c.kind === "Key") await deleteCharge(accountId, c.id);
    }

    if (next.length) {
      const tag = next
        .slice()
        .sort((a, b) => String(a.gender).localeCompare(String(b.gender)) || a.number - b.number)
        .map((k) => `${k.number}${k.gender}`)
        .join(", ");

      await addCharge(accountId, {
        kind: "Key",
        concept: `Llaves ${tag} (1H)`,
        qty: 1,
        amount: 0,
      });
    }

    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("zs:keys-changed", { detail: { accountId: accountId.slice(0, 8) } }));
      try {
        new BroadcastChannel("zs:bus").postMessage({ type: "keys-changed", accountId: accountId.slice(0, 8) });
      } catch {}
    }

    setInitialKeys(next);
  }

  async function handleSave() {
    try {
      if (!posEnabled) throw new Error(posReason ?? "POS cerrado para este día.");
      if (account.status !== "Abierta") throw new Error("Solo puedes modificar cuentas abiertas.");

      const ok = await confirm({
        title: "Aplicar cambios",
        text: `Esto actualizará las entradas de ${account.clientName} en esta cuenta.`,
        icon: "question",
        confirmButtonText: "Sí, aplicar",
        cancelButtonText: "Cancelar",
      });

      if (!ok.isConfirmed) return;

      const accountId = account.id;

      // 0) llaves
      await syncKeys(accountId);

      // 1) entradas: borra solo pendientes de conceptos de entrada
      const charges = await listCharges(accountId);

      const toDelete = charges.filter(
        (c) => c.kind === "Normal" && c.status !== "Pagado" && ENTRY_CONCEPTS.has(String(c.concept ?? "").trim())
      );

      for (const c of toDelete) {
        await deleteCharge(accountId, c.id);
      }

      // 2) recrea entradas
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

      // 3) persist counts
      await updateAccount(accountId, {
        peopleCount: totalPeople,
        counts: { ...counts },
      });
      // 5) parqueadero: crear o eliminar (según check)
      // - si estaba marcado y lo desmarcan: elimina registro + quita cargo pendiente
      // - si no estaba y lo marcan: crea registro + añade cargo en curso

      const accountIdStr = String(account.id);
      const apMap = readAccountParkingMap();
      let parkingId: string | null = initialParkingId ?? apMap[accountIdStr] ?? null;


      // helper: borrar cargos de parqueadero pendientes
      async function removeParkingCharges() {
        const current = await listCharges(accountIdStr);
        const toDel = current.filter(
          (c) =>
            c.kind === "Normal" &&
            c.status !== "Pagado" &&
            String(c.concept ?? "").toLowerCase().includes("parqueadero")
        );
        for (const c of toDel) await deleteCharge(accountIdStr, c.id);
      }

      if (initialRequiresParking && !requiresParking) {
        // cancelar parqueo
        if (parkingId) {
          try {
            await deleteParking(parkingId);
          } catch {}
        }

        await removeParkingCharges();

        // limpiar maps
        const next = readAccountParkingMap();
        delete next[accountIdStr];
        writeAccountParkingMap(next);

        parkingId = null;
        setInitialParkingId(null);
        setInitialRequiresParking(false);

        try {
          window.dispatchEvent(new CustomEvent("zs:parking-changed", { detail: { accountId: accountIdStr } }));
        } catch {}
      }

      if (!initialRequiresParking && requiresParking) {
        // crear parqueo
        const now = new Date();
        const parkingDate = now.toISOString().slice(0, 10);
        const parkingEntryTime = now.toTimeString().slice(0, 8);

        const tx = isNonEmptyGuid(accountIdStr) ? accountIdStr : null;

        const parkingInput: ParkingRequestDto = {
          parkingDate,
          parkingEntryTime,
          parkingExitTime: null,
          transactionId: tx,
        };

        const created = await createParking(parkingInput);
        parkingId = String((created as any)?.id);

        // guardar vínculo
        const next = readAccountParkingMap();
        next[accountIdStr] = parkingId;
        writeAccountParkingMap(next);

        // asegurar cargo "en curso" (sin duplicar)
        const current = await listCharges(accountIdStr);
        const exists = current.some(
          (c) =>
            c.kind === "Normal" &&
            c.status !== "Pagado" &&
            String(c.concept ?? "").toLowerCase().includes("parqueadero (en curso)")
        );

        if (!exists) {
          await addCharge(accountIdStr, {
            kind: "Normal",
            concept: "Parqueadero (en curso)",
            qty: 1,
            amount: 0,
          });
        }

        setInitialParkingId(parkingId);
        setInitialRequiresParking(true);

        try {
          window.dispatchEvent(new CustomEvent("zs:parking-changed", { detail: { accountId: accountIdStr } }));
        } catch {}
      }

      

      // 4) tarjeta 10 pases (AHORA: crea o renueva + cobra si hace falta)
      if (useCard && passCount > 0) {
        const holder = String(account.clientName ?? "").trim();
        if (!holder) throw new Error("No se puede usar tarjeta de pases sin nombre del cliente.");

        let willChargeSale = false;

        const found = await findAccessCardByHolder(holder);

        let cardIdToUse: string | null = found?.card?.id ?? null;

        if (!cardIdToUse) {
          const created = await createAccessCardForHolder(holder, 10);
          cardIdToUse = (created as any)?.card?.id ?? null;
          willChargeSale = true;
        } else {
          const remaining = remainingFromFound(found);
          if (remaining < passCount) {
            await updateAccessCard(cardIdToUse, {
              holderName: holder,
              total: 10,
              uses: 10,
              transactionId: null,
            } as any);
            willChargeSale = true;
          }
        }


        if (willChargeSale) {
          await addCharge(accountId, {
            kind: "Normal",
            concept: "Tarjeta 10 pases (venta)",
            qty: 1,
            amount: PASS_PRICE,
          });
        }


        if (cardIdToUse) {
          const now = new Date();
          await fetch("/api/EntranceAccessCards", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              accessCardId: cardIdToUse,
              entranceDate: now.toISOString().slice(0, 10),
              entranceEntryTime: now.toTimeString().slice(0, 8),
              qty: passCount, // <- NUEVO
            }),
          });
        }



        await addCharge(accountId, {
          kind: "Normal",
          concept: "Tarjeta 10 pases (uso)",
          qty: passCount,
          amount: 0,
        });
      }

      await fire({
        title: "Listo",
        text: "Entradas (y llaves) actualizadas en la cuenta.",
        icon: "success",
        timer: 1100,
        showConfirmButton: false,
      });

      onOpenChange(false);
      await onDone();
    } catch (e: any) {
      await fire({
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
          <div className="text-lg font-semibold">Editar cuenta</div>
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

      {/* ✅ CONTENIDO */}
      <div className="space-y-6 px-5 py-5">
        {/* ENTRADAS */}
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

        {/* TARJETA 10 PASES */}
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
                Si la tarjeta no existe o no alcanza, se creará/renovará y se cobrará para{" "}
                <b>{account.clientName}</b>.
              </div>
            </div>
          )}
        </div>

        {/* LLAVES + PARQUEADERO */}
        <div className="rounded-2xl border border-neutral-200 p-4">
          <div className="grid lg:grid-cols-3 gap-4">
            <div>
              <div className="text-sm font-medium">Género (para llaves)</div>
              <select
                className="border border-neutral-200 rounded-xl px-3 py-2 w-full mt-2"
                value={keyGender}
                onChange={(e) => setKeyGender(e.target.value as KeyGender)}
              >
                <option value="H">Hombres</option>
                <option value="M">Mujeres</option>
              </select>
            </div>

            <div className="lg:col-span-2">
              <div className="text-sm font-medium">Llaves disponibles ({keyGender})</div>

              <div className="mt-2 flex flex-wrap gap-2">
                {availableKeys.map((n) => {
                  const active = selectedKeys.some((k) => k.number === n && k.gender === keyGender);

                  return (
                    <button
                      key={`${keyGender}-${n}`}
                      type="button"
                      onClick={() =>
                        setSelectedKeys((prev) =>
                          active
                            ? prev.filter((k) => !(k.number === n && k.gender === keyGender))
                            : [
                                ...prev,
                                { keyId: keyId(keyGender, n), number: n, gender: keyGender, duration: "1H" as any },
                              ]
                        )
                      }
                      className={
                        "px-3 py-2 rounded-full border text-sm font-semibold " +
                        (active
                          ? "bg-blue-600 text-white border-blue-600"
                          : "bg-white border-neutral-200 hover:bg-neutral-50")
                      }
                    >
                      {n}
                    </button>
                  );
                })}

                {availableKeys.length === 0 && <span className="text-sm text-neutral-500">No hay llaves libres</span>}
              </div>
            </div>
          </div>

          {/* ✅ PARQUEADERO (EDIT) - FUERA DEL GRID */}
          <div className="mt-4 rounded-xl border border-neutral-200 p-3">
            <label className="flex items-center gap-2 text-sm">
              <input
                id="requiresParkingEdit"
                type="checkbox"
                className="h-4 w-4"
                checked={requiresParking}
                onChange={(e) => setRequiresParking(e.target.checked)}
              />
              Requiere parqueadero (0.50 la hora o fracción)
            </label>

            {initialRequiresParking && !requiresParking && (
              <div className="mt-2 text-xs text-amber-700">
                Se eliminará el registro de parqueadero y el cargo pendiente al aplicar.
              </div>
            )}
          </div>

          {selectedKeys.length > 0 && (
            <div className="mt-4">
              <div className="text-sm font-medium">Llaves seleccionadas</div>
              <div className="mt-2 flex flex-wrap gap-2">
                {selectedKeys
                  .slice()
                  .sort((a, b) => a.gender.localeCompare(b.gender) || a.number - b.number)
                  .map((k) => (
                    <span
                      key={k.keyId}
                      className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-neutral-100 border border-neutral-200 text-sm"
                    >
                      {k.number}
                      {k.gender}
                      <button
                        type="button"
                        className="opacity-70 hover:opacity-100"
                        onClick={() => setSelectedKeys((prev) => prev.filter((x) => x.keyId !== k.keyId))}
                      >
                        ✕
                      </button>
                    </span>
                  ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ✅ FOOTER (FUERA DEL CONTENIDO) */}
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
