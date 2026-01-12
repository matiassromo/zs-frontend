// src/components/pos/CreateAccountModal.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { PRICES, openAccount, addCharge } from "@/lib/api/accounts";

import { listClients, createClient, UpsertClientInput } from "@/lib/api/clients";
import { Client } from "@/types/client";
import { SelectedKey, KeyGender } from "@/types/pos";

// 🔽 backend real de llaves (CORRECTO)
import { listKeys, updateKey } from "@/lib/apiv2/keys";
import type { Key } from "@/types/key";

import { createParking } from "@/lib/apiv2/parkings";
import type { ParkingRequestDto } from "@/types/parking";

// 🔽 Bar
import type { BarProduct } from "@/types/barProduct";
import { listBarProducts } from "@/lib/apiv2/barProducts";
import { createBarOrder, createBarOrderDetail } from "@/lib/apiv2/barOrders";

// ✅ Tarjetas 10 pases (módulo real)
import {
  findAccessCardByHolder,
  createAccessCardForHolder,
  consumeAccessCardByHolder,
} from "@/lib/apiv2/accessCards";

const PARKING_HOURLY_RATE = 0.5;

function norm(s: string) {
  return (s ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

function matchesPrefixAnyWord(fullName: string, q: string) {
  const nq = norm(q);
  if (!nq) return true;

  const words = norm(fullName).split(/\s+/).filter(Boolean);
  return words.some((w) => w.startsWith(nq));
}

function formatDateOnly(d: Date): string {
  return d.toISOString().slice(0, 10);
}
function formatTimeOnly(d: Date): string {
  return d.toTimeString().slice(0, 8);
}

type Duration = "1H" | "8H" | "2M";

/* --------- HELPERS PARA LLAVES (api/Keys) --------- */
async function fetchAvailableKeysByGender(gender: KeyGender): Promise<number[]> {
  const raw: Key[] = await listKeys();
  const ordered = [...raw].sort((a, b) => a.id.localeCompare(b.id));

  const free: number[] = [];
  ordered.forEach((k, index) => {
    const g: KeyGender = index < 16 ? "H" : "M";
    if (g !== gender) return;

    const num = g === "H" ? index + 1 : index - 16 + 1;
    if (k.available) free.push(num);
  });

  return free.sort((a, b) => a - b);
}

async function reserveLockerKeys(
  selectedKeys: SelectedKey[],
  accountId: string,
  clientId: string,
  clientName: string
) {
  if (!selectedKeys.length) return;

  const raw: Key[] = await listKeys();
  const ordered = [...raw].sort((a, b) => a.id.localeCompare(b.id));

  type KeyIndex = { gender: KeyGender; number: number; key: Key };
  const indexed: KeyIndex[] = [];

  ordered.forEach((k, index) => {
    const gender: KeyGender = index < 16 ? "H" : "M";
    const number = gender === "H" ? index + 1 : index - 16 + 1;
    indexed.push({ gender, number, key: k });
  });

  const note = `Cuenta ${accountId.slice(0, 8)} - ${clientName}`;

  const toUpdate = indexed.filter((ix) =>
    selectedKeys.some((s) => s.gender === ix.gender && s.number === ix.number)
  );

  if (!toUpdate.length) return;

  await Promise.all(
    toUpdate.map(({ key }) =>
      updateKey(key.id, {
        available: false,
        lastAssignedTo: clientId,
        notes: note,
      })
    )
  );
}

/* --------- Tipo auxiliar para bar en el modal ---------- */
type BarItem = {
  productId: string;
  name: string;
  unitPrice: number;
  qty: number;
};

/* --------- Tipo auxiliar tarjeta 10 pases ---------- */
type AccessCardState = {
  loading: boolean;
  exists: boolean;
  cardId: string | null;
  remaining: number;
  willCreateIfMissing: boolean;
  createdNow: boolean;
  error: string | null;
};

const emptyCardState: AccessCardState = {
  loading: false,
  exists: false,
  cardId: null,
  remaining: 0,
  willCreateIfMissing: false,
  createdNow: false,
  error: null,
};

function remainingFromFound(
  found: { card: any; remaining?: any } | null | undefined
): number {
  const uses = Number(found?.card?.uses);
  if (Number.isFinite(uses)) return uses;

  const fallback = Number(found?.remaining);
  return Number.isFinite(fallback) ? fallback : 0;
}

export default function CreateAccountModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Client[]>([]);
  const [allClients, setAllClients] = useState<Client[]>([]);
  const [client, setClient] = useState<Client | null>(null);

  // ✅ Entradas normales (siempre disponibles)
  const [counts, setCounts] = useState({ A: 0, N: 0, TE: 0, D: 0, AC: 0 });

  // ✅ Tarjeta 10 pases (se puede combinar con normal)
  const [usePassCard, setUsePassCard] = useState(false);
  const [passPeople, setPassPeople] = useState(0);
  const [cardState, setCardState] = useState<AccessCardState>(emptyCardState);

  const normalPeople = counts.A + counts.N + counts.TE + counts.D + counts.AC;
  const totalPeople = normalPeople + (usePassCard ? passPeople : 0);

  const [keyGender, setKeyGender] = useState<KeyGender>("H");
  const [availableKeys, setAvailableKeys] = useState<number[]>([]);
  const [selectedKeys, setSelectedKeys] = useState<SelectedKey[]>([]);
  const duration: Duration = "1H";

  const [requiresParking, setRequiresParking] = useState(false);
  const [creating, setCreating] = useState(false);

  const [useBarOrder, setUseBarOrder] = useState(false);
  const [barProducts, setBarProducts] = useState<BarProduct[]>([]);
  const [loadingBarProducts, setLoadingBarProducts] = useState(false);
  const [selectedBarProductId, setSelectedBarProductId] = useState("");
  const [barQty, setBarQty] = useState(1);
  const [barItems, setBarItems] = useState<BarItem[]>([]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const data = await listClients("");
        if (alive) setAllClients(data);
      } catch {}
    })();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    const t = setTimeout(async () => {
      const q = query.trim();

      if (!q) {
        setResults([]);
        return;
      }

      if (allClients.length > 0) {
        const filtered = allClients
          .filter((c) => matchesPrefixAnyWord(c.name, q))
          .slice(0, 50);

        setResults(filtered);
        return;
      }

      const r = await listClients(q);
      setResults(r);
    }, 150);

    return () => clearTimeout(t);
  }, [query, allClients]);

  const selectedHash = useMemo(() => {
    return selectedKeys
      .filter((k) => k.gender === keyGender)
      .map((k) => k.number)
      .sort((a, b) => a - b)
      .join(",");
  }, [selectedKeys, keyGender]);

  useEffect(() => {
    let alive = true;

    (async () => {
      const free = await fetchAvailableKeysByGender(keyGender);

      const selectedNums = new Set(
        selectedHash ? selectedHash.split(",").map((x) => parseInt(x, 10)) : []
      );

      if (!alive) return;
      setAvailableKeys(free.filter((n) => !selectedNums.has(n)));
    })();

    return () => {
      alive = false;
    };
  }, [keyGender, selectedHash]);

  useEffect(() => {
    if (!useBarOrder) return;
    (async () => {
      setLoadingBarProducts(true);
      try {
        const data = await listBarProducts();
        setBarProducts(data);
        if (data.length && !selectedBarProductId)
          setSelectedBarProductId(data[0].id);
      } finally {
        setLoadingBarProducts(false);
      }
    })();
  }, [useBarOrder, selectedBarProductId]);

  const entriesSubtotal = useMemo(() => {
    return +(
      counts.A * PRICES.A +
      counts.N * PRICES.N +
      counts.TE * PRICES.TE +
      counts.D * PRICES.D +
      counts.AC * PRICES.AC
    ).toFixed(2);
  }, [counts]);

  const passSale = useMemo(() => {
    if (!usePassCard) return 0;
    if (passPeople <= 0) return 0;
    if (cardState.createdNow) return PRICES.PASS;
    if (!cardState.exists && cardState.willCreateIfMissing) return PRICES.PASS;
    return 0;
  }, [
    usePassCard,
    passPeople,
    cardState.createdNow,
    cardState.exists,
    cardState.willCreateIfMissing,
  ]);

  const keysSubtotal = 0;
  const parkingSubtotal = 0;

  const barSubtotal = useMemo(
    () => barItems.reduce((sum, item) => sum + item.unitPrice * item.qty, 0),
    [barItems]
  );

  const total = useMemo(
    () =>
      +(
        entriesSubtotal +
        passSale +
        keysSubtotal +
        parkingSubtotal +
        barSubtotal
      ).toFixed(2),
    [entriesSubtotal, passSale, keysSubtotal, parkingSubtotal, barSubtotal]
  );

  function setCount(field: keyof typeof counts, v: number) {
    const n = Math.max(0, Math.floor(Number.isFinite(v) ? v : 0));
    setCounts((c) => ({ ...c, [field]: n }));
  }

  async function ensureClient(existing: Client | null, fallbackName: string) {
    if (existing) return existing;
    const name = fallbackName.trim();
    if (!name) throw new Error("Ingresa un nombre de cliente.");

    const input: UpsertClientInput = {
      nationalId: "",
      name,
      email: "",
      address: "",
      number: "",
    };
    return createClient(input);
  }

  function holderNameFromUI(): string {
    return (client?.name ?? query).trim();
  }

  async function lookupCard(holderName: string) {
    setCardState((s) => ({ ...s, loading: true, error: null }));
    try {
      const found = await findAccessCardByHolder(holderName);
      const remaining = remainingFromFound(found);

      setCardState((s) => ({
        ...s,
        loading: false,
        exists: !!found,
        cardId: found?.card?.id ?? null,
        remaining,
        error: null,
        willCreateIfMissing: found ? false : s.willCreateIfMissing,
        createdNow: false,
      }));
    } catch (e) {
      setCardState((s) => ({
        ...s,
        loading: false,
        error: (e as Error).message ?? "Error buscando tarjeta.",
      }));
    }
  }

  async function createCardNow(holderName: string) {
    setCardState((s) => ({ ...s, loading: true, error: null }));
    try {
      const created = await createAccessCardForHolder(holderName, 10);

      const uses = Number((created as any)?.card?.uses);
      const remaining = Number.isFinite(uses)
        ? uses
        : Number.isFinite(Number((created as any)?.remaining))
        ? Number((created as any)?.remaining)
        : 10;

      setCardState({
        loading: false,
        exists: true,
        cardId: (created as any).card.id,
        remaining,
        willCreateIfMissing: true,
        createdNow: true,
        error: null,
      });
    } catch (e) {
      setCardState((s) => ({
        ...s,
        loading: false,
        error: (e as Error).message ?? "Error creando tarjeta.",
      }));
    }
  }

  async function handleCreate() {
    try {
      setCreating(true);

      const holder = await ensureClient(client, query);
      const holderName = holder.name;

      const hasSomething =
        normalPeople > 0 ||
        (usePassCard && passPeople > 0) ||
        selectedKeys.length > 0;

      if (!hasSomething) {
        throw new Error(
          "Agrega al menos 1 persona (normal o tarjeta) o selecciona llaves para continuar."
        );
      }

      let willChargePassSale = false;
      let remainingToValidate = 0;

      if (usePassCard && passPeople > 0) {
        if (cardState.exists && cardState.cardId) {
          remainingToValidate = cardState.remaining;
          if (cardState.createdNow) willChargePassSale = true;
        } else {
          const found = await findAccessCardByHolder(holderName);

          if (found) {
            const remaining = remainingFromFound(found);
            remainingToValidate = remaining;

            setCardState((s) => ({
              ...s,
              exists: true,
              cardId: found.card.id,
              remaining,
              createdNow: false,
              error: null,
            }));
          } else {
            if (!cardState.willCreateIfMissing) {
              throw new Error(
                "No existe tarjeta. Marca 'Crear y cobrar si no existe' para continuar."
              );
            }

            const created = await createAccessCardForHolder(holderName, 10);
            willChargePassSale = true;

            const uses = Number((created as any)?.card?.uses);
            remainingToValidate = Number.isFinite(uses)
              ? uses
              : Number.isFinite(Number((created as any)?.remaining))
              ? Number((created as any)?.remaining)
              : 10;

            setCardState((s) => ({
              ...s,
              exists: true,
              cardId: (created as any).card.id,
              remaining: remainingToValidate,
              willCreateIfMissing: true,
              createdNow: true,
              error: null,
            }));
          }
        }

        if (remainingToValidate < passPeople) {
          throw new Error(
            `Tarjeta sin usos suficientes. Restantes: ${remainingToValidate}`
          );
        }
      }

      const keysToAttach: SelectedKey[] = selectedKeys.map((k) => ({
        ...k,
        duration,
      }));

      const account = await openAccount({
        clientId: holder.id,
        clientName: holder.name,
        gender: "M",
        entryType: "normal",
        counts: normalPeople > 0 ? counts : undefined,
        peopleCount: totalPeople,
        keys: keysToAttach.length > 0 ? { items: keysToAttach, duration } : undefined,
        createPassIfMissing: false,
      });

      // const addEntryCharge = async (
      //   concept: string,
      //   qty: number,
      //   unit: number
      // ) => {
      //   if (qty <= 0) return;
      //   await addCharge(account.id, {
      //     kind: "Normal",
      //     concept,
      //     qty,
      //     amount: unit,
      //   });
      // };

      // await Promise.all([
      //   addEntryCharge("Entrada adulto", counts.A, PRICES.A),
      //   addEntryCharge("Entrada niño", counts.N, PRICES.N),
      //   addEntryCharge("Entrada 3ra edad", counts.TE, PRICES.TE),
      //   addEntryCharge("Entrada discapacidad", counts.D, PRICES.D),
      //   addEntryCharge("Entrada acompañante", counts.AC, PRICES.AC),
      // ]);

      if (usePassCard && passPeople > 0 && willChargePassSale) {
        await addCharge(account.id, {
          kind: "Normal",
          concept: "Tarjeta 10 pases (venta)",
          qty: 1,
          amount: PRICES.PASS,
        });
      }

      if (usePassCard && passPeople > 0) {
        await consumeAccessCardByHolder(holderName, passPeople);
        setCardState((s) => ({
          ...s,
          remaining: Math.max(0, (s.remaining ?? 0) - passPeople),
        }));

        await addCharge(account.id, {
          kind: "Normal",
          concept: "Tarjeta 10 pases (uso)",
          qty: passPeople,
          amount: 0,
        });
      }

      if (selectedKeys.length) {
        await reserveLockerKeys(selectedKeys, account.id, holder.id, holder.name);
      }

      if (requiresParking) {
        const now = new Date();
        const parkingInput: ParkingRequestDto = {
          parkingDate: formatDateOnly(now),
          parkingEntryTime: formatTimeOnly(now),
          parkingExitTime: null,
        };
        await createParking(parkingInput);
      }

      if (useBarOrder && barItems.length > 0) {
        const order = await createBarOrder({});

        await Promise.all(
          barItems.map((item) =>
            createBarOrderDetail(order.id, {
              barProductId: item.productId,
              unitPrice: item.unitPrice,
              qty: item.qty,
            })
          )
        );

        await Promise.all(
          barItems.map((item) =>
            addCharge(account.id, {
              kind: "Normal",
              concept: `${item.name}`,
              qty: item.qty,
              amount: item.unitPrice,
            })
          )
        );
      }

      onCreated();
      onClose();
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setCreating(false);
    }
  }

  const canSubmit =
    (client || query.trim().length > 0) &&
    (normalPeople > 0 ||
      (usePassCard && passPeople > 0) ||
      selectedKeys.length > 0);

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
      <div className="w-full max-w-4xl max-h-[90vh] rounded-2xl border border-neutral-200 bg-white shadow-2xl overflow-hidden">
        <div className="px-6 py-4 border-b border-neutral-200 flex items-center justify-between">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
              POS
            </div>
            <h2 className="text-lg font-semibold text-neutral-900">
              Abrir nueva cuenta
            </h2>
          </div>
          <button
            onClick={onClose}
            className="inline-flex items-center justify-center rounded-lg border border-neutral-200 px-3 py-1.5 text-sm hover:bg-neutral-50"
          >
            Cerrar
          </button>
        </div>

        <div className="px-6 py-5 overflow-y-auto max-h-[calc(90vh-140px)]">
          <div className="grid gap-2">
            <label className="text-sm font-medium text-neutral-900">
              Cliente
            </label>
            <input
              className="border border-neutral-200 rounded-xl px-3 py-2"
              placeholder="Buscar o ingresar nombre…"
              value={client ? client.name : query}
              onChange={(e) => {
                setClient(null);
                setQuery(e.target.value);
              }}
            />

            {!client && results.length > 0 && (
              <div className="border border-neutral-200 rounded-xl max-h-48 overflow-auto">
                {results.map((r) => (
                  <button
                    key={r.id}
                    className="w-full text-left px-3 py-2 hover:bg-neutral-50 border-b border-neutral-100 last:border-b-0"
                    onClick={() => {
                      setClient(r);
                      setQuery("");
                    }}
                    type="button"
                  >
                    {r.name}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="mt-5 rounded-2xl border border-neutral-200 overflow-hidden">
            <div className="px-4 py-3 border-b border-neutral-200 font-semibold">
              Entradas (normal)
            </div>
            <div className="p-4 grid sm:grid-cols-2 lg:grid-cols-5 gap-3">
              {(["A", "N", "TE", "D", "AC"] as const).map((k) => (
                <Counter
                  key={k}
                  label={labelOf(k)}
                  price={priceOf(k)}
                  value={(counts as any)[k]}
                  onChange={(v) => setCount(k, v)}
                />
              ))}
            </div>
          </div>

          <div className="mt-5 rounded-2xl border border-neutral-200 overflow-hidden">
            <div className="px-4 py-3 border-b border-neutral-200 flex items-center justify-between gap-3">
              <div className="font-semibold">Tarjeta 10 pases</div>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={usePassCard}
                  onChange={(e) => {
                    const on = e.target.checked;
                    setUsePassCard(on);
                    if (!on) {
                      setPassPeople(0);
                      setCardState(emptyCardState);
                    }
                  }}
                />
                <span>Usar tarjeta en este grupo</span>
              </label>
            </div>

            {usePassCard ? (
              <div className="p-4 grid lg:grid-cols-3 gap-4">
                <div className="rounded-xl border border-neutral-200 p-3">
                  <div className="text-sm font-medium">
                    Personas que entran con tarjeta
                  </div>
                  <input
                    type="number"
                    min={0}
                    className="mt-2 border border-neutral-200 rounded-xl px-3 py-2 w-40"
                    value={passPeople}
                    onChange={(e) => {
                      const v = Math.max(
                        0,
                        parseInt(e.target.value || "0", 10)
                      );
                      setPassPeople(v);
                    }}
                  />
                  <p className="mt-2 text-xs text-neutral-500">
                    Se descontarán {passPeople} usos de la tarjeta.
                  </p>
                </div>

                <div className="lg:col-span-2 rounded-xl border border-neutral-200 p-3">
                  <div className="text-sm font-medium">
                    Validar tarjeta 10 pases
                  </div>

                  <div className="mt-2 flex flex-wrap gap-2 items-center">
                    <button
                      className="px-3 py-2 rounded-xl bg-neutral-100 hover:bg-neutral-200 text-sm font-medium disabled:opacity-60"
                      disabled={!holderNameFromUI() || cardState.loading}
                      onClick={() => lookupCard(holderNameFromUI())}
                      type="button"
                    >
                      {cardState.loading ? "Buscando…" : "Buscar por nombre"}
                    </button>

                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={cardState.willCreateIfMissing}
                        onChange={(e) =>
                          setCardState((s) => ({
                            ...s,
                            willCreateIfMissing: e.target.checked,
                          }))
                        }
                      />
                      <span>Crear y cobrar si no existe</span>
                    </label>

                    {!cardState.exists && cardState.willCreateIfMissing && (
                      <button
                        className="px-3 py-2 rounded-xl bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 disabled:opacity-60"
                        disabled={!holderNameFromUI() || cardState.loading}
                        onClick={() => createCardNow(holderNameFromUI())}
                        type="button"
                      >
                        Crear ahora
                      </button>
                    )}
                  </div>

                  <div className="mt-3 text-sm">
                    {cardState.error && (
                      <p className="text-rose-600">{cardState.error}</p>
                    )}

                    {cardState.exists ? (
                      <p>
                        ✔ Tarjeta encontrada. Restantes:{" "}
                        <b>{cardState.remaining}</b>
                      </p>
                    ) : (
                      <p>
                        ✖ No existe tarjeta.
                        {cardState.willCreateIfMissing ? (
                          <>
                            {" "}
                            Se creará y se cobrará <b>${PRICES.PASS}</b>.
                          </>
                        ) : (
                          <> Marca “Crear y cobrar” para continuar.</>
                        )}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            ) : (
              <div className="p-4 text-sm text-neutral-500">
                Activa esta sección si parte del grupo entra usando tarjeta (se
                puede combinar con entradas normales).
              </div>
            )}
          </div>

          <div className="mt-5 rounded-2xl border border-neutral-200 p-4">
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
                <div className="text-sm font-medium">
                  Llaves disponibles ({keyGender})
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {availableKeys.map((n) => {
                    const active = selectedKeys.some(
                      (k) => k.number === n && k.gender === keyGender
                    );

                    return (
                      <button
                        key={`${keyGender}-${n}`}
                        type="button"
                        onClick={() =>
                          setSelectedKeys((prev) =>
                            active
                              ? prev.filter(
                                  (k) =>
                                    !(
                                      k.number === n && k.gender === keyGender
                                    )
                                )
                              : [
                                  ...prev,
                                  {
                                    keyId: `${keyGender}-${n}`,
                                    number: n,
                                    gender: keyGender,
                                    duration,
                                  },
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

                  {availableKeys.length === 0 && (
                    <span className="text-sm text-neutral-500">
                      No hay llaves libres
                    </span>
                  )}
                </div>
              </div>
            </div>

            {selectedKeys.length > 0 && (
              <div className="mt-4">
                <div className="text-sm font-medium">Llaves seleccionadas</div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {selectedKeys
                    .slice()
                    .sort(
                      (a, b) =>
                        a.gender.localeCompare(b.gender) || a.number - b.number
                    )
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
                          onClick={() =>
                            setSelectedKeys((prev) =>
                              prev.filter((x) => x.keyId !== k.keyId)
                            )
                          }
                        >
                          ✕
                        </button>
                      </span>
                    ))}
                </div>
              </div>
            )}

            <div className="mt-4 flex items-center gap-2">
              <input
                id="requiresParking"
                type="checkbox"
                className="h-4 w-4"
                checked={requiresParking}
                onChange={(e) => setRequiresParking(e.target.checked)}
              />
              <label htmlFor="requiresParking" className="text-sm">
                Requiere parqueadero (0.50 la hora o fracción)
              </label>
            </div>
          </div>

          <div className="mt-5 rounded-2xl border border-neutral-200 p-4">
            <div className="flex items-center justify-between gap-3">
              <div className="text-sm font-medium">Consumo de bar inicial</div>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={useBarOrder}
                  onChange={(e) => setUseBarOrder(e.target.checked)}
                />
                <span>Agregar productos de bar</span>
              </label>
            </div>

            {useBarOrder && (
              <div className="mt-4 space-y-3">
                {loadingBarProducts ? (
                  <p className="text-sm text-neutral-500">
                    Cargando productos de bar...
                  </p>
                ) : barProducts.length === 0 ? (
                  <p className="text-sm text-neutral-500">
                    No hay productos de bar configurados.
                  </p>
                ) : (
                  <form
                    className="grid sm:grid-cols-3 gap-3 items-end"
                    onSubmit={(e) => {
                      e.preventDefault();
                      const p = barProducts.find(
                        (x) => x.id === selectedBarProductId
                      );
                      if (!p || barQty <= 0) return;
                      setBarItems((prev) => [
                        ...prev,
                        {
                          productId: p.id,
                          name: p.name,
                          unitPrice: p.unitPrice,
                          qty: barQty,
                        },
                      ]);
                      setBarQty(1);
                    }}
                  >
                    <div className="sm:col-span-2">
                      <div className="text-sm font-medium">Producto</div>
                      <select
                        className="border border-neutral-200 rounded-xl px-3 py-2 w-full mt-2 text-sm"
                        value={selectedBarProductId}
                        onChange={(e) => setSelectedBarProductId(e.target.value)}
                      >
                        <option value="">Selecciona un producto</option>
                        {barProducts.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name} (${p.unitPrice.toFixed(2)})
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <div className="text-sm font-medium">Cantidad</div>
                      <input
                        type="number"
                        min={1}
                        className="border border-neutral-200 rounded-xl px-3 py-2 w-full mt-2 text-sm"
                        value={barQty}
                        onChange={(e) =>
                          setBarQty(
                            Math.max(1, parseInt(e.target.value || "1", 10))
                          )
                        }
                      />
                    </div>
                    <div className="sm:col-span-3 flex justify-end">
                      <button
                        type="submit"
                        className="px-4 py-2 rounded-full bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 disabled:opacity-60"
                        disabled={!selectedBarProductId}
                      >
                        Agregar a pedido
                      </button>
                    </div>
                  </form>
                )}

                {barItems.length > 0 && (
                  <div className="border border-neutral-200 rounded-xl overflow-hidden">
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm min-w-[560px]">
                        <thead className="bg-neutral-50">
                          <tr>
                            <th className="text-left px-3 py-2">Producto</th>
                            <th className="text-right px-3 py-2">Cant.</th>
                            <th className="text-right px-3 py-2">P. Unit.</th>
                            <th className="text-right px-3 py-2">Subtotal</th>
                            <th className="px-3 py-2"></th>
                          </tr>
                        </thead>
                        <tbody>
                          {barItems.map((i, idx) => (
                            <tr key={idx} className="border-t border-neutral-200">
                              <td className="px-3 py-2">{i.name}</td>
                              <td className="px-3 py-2 text-right">{i.qty}</td>
                              <td className="px-3 py-2 text-right">
                                ${i.unitPrice.toFixed(2)}
                              </td>
                              <td className="px-3 py-2 text-right">
                                {(i.unitPrice * i.qty).toFixed(2)}
                              </td>
                              <td className="px-3 py-2 text-right">
                                <button
                                  type="button"
                                  className="text-xs font-semibold text-rose-600"
                                  onClick={() =>
                                    setBarItems((prev) =>
                                      prev.filter((_, iIdx) => iIdx !== idx)
                                    )
                                  }
                                >
                                  Quitar
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                        <tfoot className="bg-neutral-50">
                          <tr>
                            <td
                              className="px-3 py-2 font-semibold text-right"
                              colSpan={3}
                            >
                              Total bar
                            </td>
                            <td className="px-3 py-2 font-semibold text-right">
                              ${barSubtotal.toFixed(2)}
                            </td>
                            <td />
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="grid md:grid-cols-4 gap-3 mt-5">
            <TotalCard label="Subtotal (normal)" value={entriesSubtotal} />
            <TotalCard label="Venta tarjeta (si aplica)" value={passSale} />
            <TotalCard label="Personas (total)" valueNumber={totalPeople} />
            <TotalCard label="Total" value={total} highlight />
          </div>
        </div>

        <div className="px-6 py-4 border-t border-neutral-200 flex justify-end gap-2 bg-white">
          <button
            className="px-4 py-2 rounded-xl border border-neutral-200 hover:bg-neutral-50"
            onClick={onClose}
            disabled={creating}
          >
            Cancelar
          </button>
          <button
            className="px-5 py-2 rounded-full bg-blue-600 text-white font-semibold hover:bg-blue-700 disabled:opacity-60"
            onClick={handleCreate}
            disabled={!canSubmit || creating}
          >
            {creating ? "Creando…" : "Crear cuenta"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---------- Subcomponentes ---------- */

function Counter({
  label,
  price,
  value,
  onChange,
}: {
  label: string;
  price: number;
  value: number;
  onChange: (v: number) => void;
}) {
  const safe = Math.max(0, Math.floor(Number.isFinite(value) ? value : 0));
  const subtotal = +(safe * price).toFixed(2);

  return (
    <div className="rounded-xl border border-neutral-200 p-3 bg-white">
      <div className="text-sm font-semibold text-neutral-900">{label}</div>
      <div className="text-xs text-neutral-500">Precio: ${price.toFixed(2)}</div>

      <div className="mt-3 flex items-center gap-2">
        <button
          type="button"
          className="h-9 w-9 rounded-lg border border-neutral-200 bg-neutral-50 hover:bg-neutral-100 font-semibold"
          onClick={() => onChange(Math.max(0, safe - 1))}
        >
          −
        </button>

        <input
          type="number"
          className="h-9 w-16 text-center border border-neutral-200 rounded-lg px-2"
          value={safe}
          onChange={(e) =>
            onChange(Math.max(0, parseInt(e.target.value || "0", 10)))
          }
          min={0}
        />

        <button
          type="button"
          className="h-9 w-9 rounded-lg border border-neutral-200 bg-neutral-50 hover:bg-neutral-100 font-semibold"
          onClick={() => onChange(safe + 1)}
        >
          +
        </button>
      </div>

      <div className="mt-3 text-sm">
        Subtotal: <b>${subtotal.toFixed(2)}</b>
      </div>
    </div>
  );
}

function TotalCard({
  label,
  value,
  valueNumber,
  highlight,
}: {
  label: string;
  value?: number;
  valueNumber?: number;
  highlight?: boolean;
}) {
  const isNumberCard = typeof valueNumber === "number";
  return (
    <div
      className={`rounded-xl border border-neutral-200 p-4 ${
        highlight ? "bg-emerald-50" : "bg-white"
      }`}
    >
      <div className="text-xs font-medium text-neutral-500">{label}</div>
      {isNumberCard ? (
        <div
          className={`mt-1 text-2xl font-semibold ${
            highlight ? "text-emerald-700" : "text-neutral-900"
          }`}
        >
          {valueNumber}
        </div>
      ) : (
        <div
          className={`mt-1 text-2xl font-semibold ${
            highlight ? "text-emerald-700" : "text-neutral-900"
          }`}
        >
          ${(value ?? 0).toFixed(2)}
        </div>
      )}
    </div>
  );
}

function labelOf(k: "A" | "N" | "TE" | "D" | "AC") {
  return k === "A"
    ? "Adulto"
    : k === "N"
    ? "Niño"
    : k === "TE"
    ? "3ra edad"
    : k === "D"
    ? "Discapacidad"
    : "Acompañante";
}
function priceOf(k: "A" | "N" | "TE" | "D" | "AC") {
  return k === "A"
    ? PRICES.A
    : k === "N"
    ? PRICES.N
    : k === "TE"
    ? PRICES.TE
    : k === "D"
    ? PRICES.D
    : PRICES.AC;
}
