// src/components/pos/AccountFormModal.tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";

// ✅ clientes
import { listClients, createClient } from "@/lib/api/clients";
import type { Client } from "@/types/client";

// 🔽 llaves backend real
import { listKeys } from "@/lib/apiv2/keys";
import type { Key } from "@/types/key";

// ✅ POS types
import type { SelectedKey, KeyGender } from "@/types/pos";

// ✅ Tarjetas 10 pases (módulo real)
import {
  findAccessCardByHolder,
  createAccessCardForHolder,
  consumeAccessCardByHolder,
} from "@/lib/apiv2/accessCards";

type Mode = "create" | "edit";
type Duration = "1H" | "8H" | "2M";

const PRICES_LOCAL = {
  A: 7,
  N: 4,
  TE: 5,
  D: 5,
  AC: 1,
  PASS: 55,
};

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

function money(n: number) {
  const x = Number.isFinite(n) ? n : 0;
  return `$${x.toFixed(2)}`;
}

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

/* --------- Tarjeta 10 pases ---------- */
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

/* --------- Tipos de este modal ---------- */
export type AccountFormInitial = {
  clientId?: string | null;
  clientName?: string | null;

  // Totales actuales en la cuenta (lo ya “anotado / cobrado”)
  counts?: Partial<{ A: number; N: number; TE: number; D: number; AC: number }>;

  // Tarjeta 10 pases: total de usos ya registrados en esta cuenta
  usePassCard?: boolean;
  passPeople?: number;

  // llaves
  keys?: Array<{ keyId?: string; gender: KeyGender; number: number; duration?: Duration }>;

  // parking
  requiresParking?: boolean;
};

export type CountKey = "A" | "N" | "TE" | "D" | "AC";

type Counts = { A: number; N: number; TE: number; D: number; AC: number };

function clampInt(n: any) {
  const v = Math.floor(Number(n));
  return Number.isFinite(v) ? Math.max(0, v) : 0;
}

function diffCounts(base: Counts, next: Counts) {
  const add: Counts = { A: 0, N: 0, TE: 0, D: 0, AC: 0 };
  const refund: Counts = { A: 0, N: 0, TE: 0, D: 0, AC: 0 };

  (["A", "N", "TE", "D", "AC"] as const).forEach((k) => {
    const b = clampInt((base as any)[k]);
    const n = clampInt((next as any)[k]);
    if (n >= b) add[k] = n - b;
    else refund[k] = b - n;
  });

  return { add, refund };
}

function subtotalCounts(c: Counts) {
  return +(
    c.A * PRICES_LOCAL.A +
    c.N * PRICES_LOCAL.N +
    c.TE * PRICES_LOCAL.TE +
    c.D * PRICES_LOCAL.D +
    c.AC * PRICES_LOCAL.AC
  ).toFixed(2);
}

function subtotalCountsDelta(delta: Counts) {
  return +(
    delta.A * PRICES_LOCAL.A +
    delta.N * PRICES_LOCAL.N +
    delta.TE * PRICES_LOCAL.TE +
    delta.D * PRICES_LOCAL.D +
    delta.AC * PRICES_LOCAL.AC
  ).toFixed(2);
}

export type AccountFormSubmit = {
  clientId: string;
  clientName: string;

  // lo que quedó en el UI
  countsNext: Counts;

  // para edición:
  countsBase: Counts;
  countsAdd: Counts; // lo nuevo para cobrar
  countsRefund: Counts; // lo a devolver (se registra como ajuste negativo)

  // tarjeta
  usePassCard: boolean;
  passPeopleBase: number;
  passPeopleNext: number;
  passPeopleAdd: number; // solo aumenta (no se permite bajar usos desde aquí)

  // llaves
  keyGender: KeyGender;
  selectedKeys: Array<{ keyId: string; gender: KeyGender; number: number; duration: Duration }>;
  duration: Duration;

  // parking
  requiresParking: boolean;

  // estado tarjeta para que el padre decida acciones
  cardState: AccessCardState;

  passOps: {
    shouldConsumePasses: boolean;
    shouldChargePassSale: boolean; // si creó tarjeta ahora o si no existía y se creó
    remainingToValidate: number;
    willCreateIfMissing: boolean;
  };

  totals: {
    entriesSubtotalNext: number;
    entriesDeltaNet: number; // +cobros -devoluciones (en $)
    passSale: number; // $55 si aplica en esta edición
    totalPeopleNext: number;
  };
};

export default function AccountFormModal({
  mode,
  initial,
  onCancel,
  onSubmit,
}: {
  mode: Mode;
  initial?: AccountFormInitial;
  onCancel: () => void;
  onSubmit: (payload: AccountFormSubmit) => Promise<void> | void;
}) {
  // ============== CLIENTE (MISMO UX QUE CREATE) ==============
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Client[]>([]);
  const [allClients, setAllClients] = useState<Client[]>([]);
  const [client, setClient] = useState<Client | null>(null);

  // ============== BASE (para EDIT: calcular deltas) ==============
  const baseCountsRef = useRef<Counts>({ A: 0, N: 0, TE: 0, D: 0, AC: 0 });
  const basePassRef = useRef<number>(0);

  // ============== ENTRADAS (valores actuales en UI) ==============
  const [counts, setCounts] = useState<Counts>(() => ({
    A: clampInt(initial?.counts?.A ?? 0),
    N: clampInt(initial?.counts?.N ?? 0),
    TE: clampInt(initial?.counts?.TE ?? 0),
    D: clampInt(initial?.counts?.D ?? 0),
    AC: clampInt(initial?.counts?.AC ?? 0),
  }));

  // ============== TARJETA 10 PASES ==============
  const [usePassCard, setUsePassCard] = useState<boolean>(!!initial?.usePassCard);
  const [passPeople, setPassPeople] = useState<number>(clampInt(initial?.passPeople ?? 0));
  const [cardState, setCardState] = useState<AccessCardState>(emptyCardState);

  // ============== LLAVES ==============
  const [keyGender, setKeyGender] = useState<KeyGender>(() => {
    const k = initial?.keys?.[0];
    return (k?.gender as KeyGender) ?? "H";
  });
  const [availableKeys, setAvailableKeys] = useState<number[]>([]);
  const [selectedKeys, setSelectedKeys] = useState<
    Array<{ keyId: string; gender: KeyGender; number: number; duration: Duration }>
  >(() => {
    const duration: Duration = "1H";
    const inKeys = initial?.keys ?? [];
    return inKeys.map((k) => ({
      keyId: k.keyId ?? `${k.gender}-${k.number}`,
      gender: k.gender,
      number: k.number,
      duration: (k.duration as Duration) ?? duration,
    }));
  });

  const duration: Duration = "1H";

  // ============== PARKING ==============
  const [requiresParking, setRequiresParking] = useState<boolean>(!!initial?.requiresParking);

  // ============== UI STATE ==============
  const [saving, setSaving] = useState(false);

  // =================== PRECARGA EN EDIT CUANDO CAMBIA initial ===================
  useEffect(() => {
    if (!initial) return;

    // Cliente
    setClient(null);
    setQuery((initial.clientName ?? "").trim());

    const baseCounts: Counts = {
      A: clampInt(initial.counts?.A ?? 0),
      N: clampInt(initial.counts?.N ?? 0),
      TE: clampInt(initial.counts?.TE ?? 0),
      D: clampInt(initial.counts?.D ?? 0),
      AC: clampInt(initial.counts?.AC ?? 0),
    };
    baseCountsRef.current = baseCounts;
    setCounts(baseCounts);

    const basePass = clampInt(initial.passPeople ?? 0);
    basePassRef.current = basePass;

    setUsePassCard(!!initial.usePassCard);
    setPassPeople(basePass); // en edit, muestra lo ya usado
    setCardState(emptyCardState);

    const inKeys = initial.keys ?? [];
    setSelectedKeys(
      inKeys.map((k) => ({
        keyId: k.keyId ?? `${k.gender}-${k.number}`,
        gender: k.gender,
        number: k.number,
        duration,
      }))
    );

    const firstKey = inKeys[0];
    setKeyGender((firstKey?.gender as KeyGender) ?? "H");

    setRequiresParking(!!initial.requiresParking);
  }, [initial, mode]);

  // =================== LOAD CLIENTS ===================
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const data = await listClients();
        if (alive) setAllClients(data);
      } catch {}
    })();
    return () => {
      alive = false;
    };
  }, []);

  // =================== BUSQUEDA CLIENTE ===================
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

  // =================== LLAVES DISPONIBLES ===================
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

      // En EDIT: permitir que salgan seleccionadas aunque backend diga occupied
      const alreadySelected = new Set(
        selectedKeys.filter((k) => k.gender === keyGender).map((k) => k.number)
      );

      if (!alive) return;
      const union = Array.from(new Set([...free, ...Array.from(alreadySelected)])).sort(
        (a, b) => a - b
      );
      setAvailableKeys(union);
    })();
    return () => {
      alive = false;
    };
  }, [keyGender, selectedHash]);

  // =================== TOTALS + DELTAS (EDIT) ===================
  const normalPeople = counts.A + counts.N + counts.TE + counts.D + counts.AC;
  const totalPeopleNext = normalPeople + (usePassCard ? passPeople : 0);

  const entriesSubtotalNext = useMemo(() => subtotalCounts(counts), [counts]);

  const baseCounts = baseCountsRef.current;
  const { add: countsAdd, refund: countsRefund } = useMemo(
    () => diffCounts(baseCounts, counts),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [counts.A, counts.N, counts.TE, counts.D, counts.AC]
  );

  const entriesAddMoney = useMemo(() => subtotalCountsDelta(countsAdd), [countsAdd]);
  const entriesRefundMoney = useMemo(() => subtotalCountsDelta(countsRefund), [countsRefund]);
  const entriesDeltaNet = useMemo(() => +(entriesAddMoney - entriesRefundMoney).toFixed(2), [
    entriesAddMoney,
    entriesRefundMoney,
  ]);

  // Tarjeta (edit): solo permitir aumentar usos; si bajan, se clampa.
  const passPeopleBase = basePassRef.current;
  useEffect(() => {
    if (mode !== "edit") return;
    if (!usePassCard) return;
    if (passPeople < passPeopleBase) setPassPeople(passPeopleBase);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [passPeople, passPeopleBase, mode, usePassCard]);

  const passPeopleNext = usePassCard ? passPeople : 0;
  const passPeopleAdd = Math.max(0, passPeopleNext - passPeopleBase);

  // Venta tarjeta (solo si en este guardado se crea)
  const passSale = useMemo(() => {
    if (!usePassCard) return 0;
    if (passPeopleAdd <= 0 && mode === "edit") {
      // en edit, solo cobramos venta si hay creación de tarjeta (lo decide passOps)
      // el valor aquí solo se usa como "posible" total; el padre tomará passOps.shouldChargePassSale
      return cardState.createdNow ? PRICES_LOCAL.PASS : 0;
    }

    // create: mismo criterio del create modal
    if (mode === "create") {
      if (passPeopleNext <= 0) return 0;
      if (cardState.createdNow) return PRICES_LOCAL.PASS;
      if (!cardState.exists && cardState.willCreateIfMissing) return PRICES_LOCAL.PASS;
      return 0;
    }

    // edit: si creaste ahora, cobra
    return cardState.createdNow ? PRICES_LOCAL.PASS : 0;
  }, [usePassCard, passPeopleAdd, passPeopleNext, mode, cardState.createdNow, cardState.exists, cardState.willCreateIfMissing]);

  function setCount(field: CountKey, v: number) {
    const n = clampInt(v);
    setCounts((c) => ({ ...c, [field]: n }));
  }

  async function ensureClient(existing: Client | null, fallbackName: string) {
    if (existing) return existing;
    const name = fallbackName.trim();
    if (!name) throw new Error("Ingresa un nombre de cliente.");
    const created = await createClient({ name } as any);
    return created as any;
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

  function toggleKey(n: number) {
    const active = selectedKeys.some((k) => k.gender === keyGender && k.number === n);
    setSelectedKeys((prev) =>
      active
        ? prev.filter((k) => !(k.gender === keyGender && k.number === n))
        : [...prev, { keyId: `${keyGender}-${n}`, gender: keyGender, number: n, duration }]
    );
  }

  // =================== VALIDATION ===================
  const canSubmit =
    (client || query.trim().length > 0) &&
    (normalPeople > 0 || (usePassCard && passPeopleNext > 0) || selectedKeys.length > 0) &&
    !saving;

  // =================== SUBMIT ===================
  async function handleSave() {
    try {
      setSaving(true);

      const holder = await ensureClient(client, query);
      const holderName = holder.name;

      // --- tarjeta: validar y decidir operaciones SOLO por el incremento (edit) ---
      let shouldChargePassSale = false;
      let remainingToValidate = 0;
      let shouldConsumePasses = false;

      if (usePassCard && passPeopleAdd > 0) {
        // Si ya validaron en UI, usa cardState; si no, busca
        if (cardState.exists && cardState.cardId) {
          remainingToValidate = cardState.remaining;
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
              throw new Error("No existe tarjeta. Marca 'Crear y cobrar si no existe' para continuar.");
            }

            // Crear automáticamente (misma lógica que CreateAccountModal)
            const created = await createAccessCardForHolder(holderName, 10);
            shouldChargePassSale = true;

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

        if (remainingToValidate < passPeopleAdd) {
          throw new Error(`Tarjeta sin usos suficientes. Restantes: ${remainingToValidate}`);
        }

        shouldConsumePasses = true;
      }

      const payload: AccountFormSubmit = {
        clientId: holder.id,
        clientName: holder.name,

        countsBase: baseCountsRef.current,
        countsNext: counts,
        countsAdd,
        countsRefund,

        usePassCard,
        passPeopleBase,
        passPeopleNext,
        passPeopleAdd,

        keyGender,
        selectedKeys: selectedKeys
          .slice()
          .sort((a, b) => a.gender.localeCompare(b.gender) || a.number - b.number),
        duration,

        requiresParking,

        cardState,

        passOps: {
          shouldConsumePasses,
          shouldChargePassSale: shouldChargePassSale || cardState.createdNow,
          remainingToValidate,
          willCreateIfMissing: cardState.willCreateIfMissing,
        },

        totals: {
          entriesSubtotalNext,
          entriesDeltaNet,
          passSale: shouldChargePassSale || cardState.createdNow ? PRICES_LOCAL.PASS : 0,
          totalPeopleNext,
        },
      };

      await onSubmit(payload);
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  // =================== UI (IGUAL A CREATE, PERO CON “AJUSTES” EN EDIT) ===================
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
      <div className="w-full max-w-4xl max-h-[90vh] rounded-2xl border border-neutral-200 bg-white shadow-2xl overflow-hidden">
        <div className="px-6 py-4 border-b border-neutral-200 flex items-center justify-between">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
              POS
            </div>
            <h2 className="text-lg font-semibold text-neutral-900">
              {mode === "create" ? "Abrir nueva cuenta" : "Editar cuenta"}
            </h2>
          </div>
          <button
            onClick={onCancel}
            className="inline-flex items-center justify-center rounded-lg border border-neutral-200 px-3 py-1.5 text-sm hover:bg-neutral-50"
            disabled={saving}
          >
            Cerrar
          </button>
        </div>

        <div className="px-6 py-5 overflow-y-auto max-h-[calc(90vh-140px)]">
          {/* CLIENTE */}
          <div className="grid gap-2">
            <label className="text-sm font-medium text-neutral-900">Cliente</label>
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

          {/* ENTRADAS NORMAL */}
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

          {/* AJUSTES (solo edit): muestra lo que se va a cobrar y lo que se va a devolver */}
          {mode === "edit" && (
            <div className="mt-4 rounded-2xl border border-neutral-200 p-4">
              <div className="flex items-center justify-between gap-3">
                <div className="text-sm font-semibold text-neutral-900">Ajustes por edición</div>
                <div className="text-xs text-neutral-500">
                  Si bajas un contador, se registrará como <b>devolución</b> (ajuste negativo).
                </div>
              </div>

              <div className="mt-3 grid md:grid-cols-3 gap-3">
                <div className="rounded-xl border border-neutral-200 p-3">
                  <div className="text-xs text-neutral-500">Cobros adicionales</div>
                  <div className="mt-1 text-lg font-semibold text-neutral-900">{money(entriesAddMoney)}</div>
                  <div className="mt-2 text-xs text-neutral-500">
                    {renderDeltaLine("Adulto", countsAdd.A)}
                    {renderDeltaLine("Niño", countsAdd.N)}
                    {renderDeltaLine("3ra edad", countsAdd.TE)}
                    {renderDeltaLine("Discapacidad", countsAdd.D)}
                    {renderDeltaLine("Acompañante", countsAdd.AC)}
                  </div>
                </div>

                <div className="rounded-xl border border-neutral-200 p-3">
                  <div className="text-xs text-neutral-500">Devoluciones</div>
                  <div className="mt-1 text-lg font-semibold text-rose-700">
                    -{money(entriesRefundMoney).slice(1)}
                  </div>
                  <div className="mt-2 text-xs text-neutral-500">
                    {renderDeltaLine("Adulto", countsRefund.A)}
                    {renderDeltaLine("Niño", countsRefund.N)}
                    {renderDeltaLine("3ra edad", countsRefund.TE)}
                    {renderDeltaLine("Discapacidad", countsRefund.D)}
                    {renderDeltaLine("Acompañante", countsRefund.AC)}
                  </div>
                </div>

                <div className="rounded-xl border border-neutral-200 p-3 bg-emerald-50">
                  <div className="text-xs text-neutral-500">Neto por entradas</div>
                  <div className="mt-1 text-lg font-semibold text-emerald-700">
                    {entriesDeltaNet >= 0 ? money(entriesDeltaNet) : `-${money(Math.abs(entriesDeltaNet)).slice(1)}`}
                  </div>
                  <div className="mt-2 text-xs text-neutral-500">
                    Se aplicará como cargos (+) y ajustes (-) para dejar la cuenta correcta.
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TARJETA 10 PASES */}
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
                      basePassRef.current = 0; // en edit, si desactivas explícitamente, el padre decidirá qué hacer (normalmente no se “revierte” usos)
                      setCardState(emptyCardState);
                    } else {
                      // si la activan en edit, mantenemos base actual
                      if (mode === "edit") setPassPeople(Math.max(passPeople, basePassRef.current));
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
                    {mode === "edit" ? "Usos totales en esta cuenta" : "Personas que entran con tarjeta"}
                  </div>

                  <input
                    type="number"
                    min={0}
                    className="mt-2 border border-neutral-200 rounded-xl px-3 py-2 w-40"
                    value={passPeople}
                    onChange={(e) => {
                      const v = clampInt(e.target.value || "0");
                      if (mode === "edit") {
                        // no permitimos bajar usos desde aquí
                        setPassPeople(Math.max(v, basePassRef.current));
                      } else {
                        setPassPeople(v);
                      }
                    }}
                  />

                  {mode === "edit" ? (
                    <p className="mt-2 text-xs text-neutral-500">
                      Base actual: {basePassRef.current}. Se consumirán <b>{passPeopleAdd}</b> usos extra.
                    </p>
                  ) : (
                    <p className="mt-2 text-xs text-neutral-500">
                      Se descontarán {passPeople} usos de la tarjeta.
                    </p>
                  )}
                </div>

                <div className="lg:col-span-2 rounded-xl border border-neutral-200 p-3">
                  <div className="text-sm font-medium">Validar tarjeta 10 pases</div>

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
                    {cardState.error && <p className="text-rose-600">{cardState.error}</p>}

                    {cardState.exists ? (
                      <p>
                        ✔ Tarjeta encontrada. Restantes: <b>{cardState.remaining}</b>
                      </p>
                    ) : (
                      <p>
                        ✖ No existe tarjeta.
                        {cardState.willCreateIfMissing ? (
                          <>
                            {" "}
                            Se creará y se cobrará <b>${PRICES_LOCAL.PASS}</b>.
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
                Activa esta sección si parte del grupo entra usando tarjeta (se puede combinar con entradas normales).
              </div>
            )}
          </div>

          {/* LLAVES + PARQUEADERO */}
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
                <div className="text-sm font-medium">Llaves disponibles ({keyGender})</div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {availableKeys.map((n) => {
                    const active = selectedKeys.some((k) => k.number === n && k.gender === keyGender);
                    return (
                      <button
                        key={`${keyGender}-${n}`}
                        type="button"
                        onClick={() => toggleKey(n)}
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
                    <span className="text-sm text-neutral-500">No hay llaves libres</span>
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
                          onClick={() =>
                            setSelectedKeys((prev) => prev.filter((x) => x.keyId !== k.keyId))
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

          {/* TOTALES (informativos) */}
          <div className="grid md:grid-cols-4 gap-3 mt-5">
            <TotalCard label="Subtotal (normal)" value={entriesSubtotalNext} />
            <TotalCard label="Delta entradas (neto)" value={entriesDeltaNet} highlight={entriesDeltaNet !== 0} />
            <TotalCard label="Personas (total)" valueNumber={totalPeopleNext} />
            <TotalCard
              label="Venta tarjeta (si se crea)"
              value={passSale}
              highlight={passSale > 0}
            />
          </div>
        </div>

        <div className="px-6 py-4 border-t border-neutral-200 flex justify-end gap-2 bg-white">
          <button
            className="px-4 py-2 rounded-xl border border-neutral-200 hover:bg-neutral-50"
            onClick={onCancel}
            disabled={saving}
          >
            Cancelar
          </button>
          <button
            className="px-5 py-2 rounded-full bg-blue-600 text-white font-semibold hover:bg-blue-700 disabled:opacity-60"
            onClick={handleSave}
            disabled={!canSubmit}
          >
            {saving ? "Guardando…" : mode === "create" ? "Crear cuenta" : "Guardar cambios"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---------- UI helpers ---------- */

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
          onChange={(e) => onChange(Math.max(0, parseInt(e.target.value || "0", 10)))}
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
  const v = isNumberCard ? valueNumber : value ?? 0;

  return (
    <div
      className={`rounded-xl border border-neutral-200 p-4 ${
        highlight ? "bg-emerald-50" : "bg-white"
      }`}
    >
      <div className="text-xs font-medium text-neutral-500">{label}</div>
      <div
        className={`mt-1 text-2xl font-semibold ${
          highlight ? "text-emerald-700" : "text-neutral-900"
        }`}
      >
        {isNumberCard ? v : `$${v.toFixed(2)}`}
      </div>
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
    ? PRICES_LOCAL.A
    : k === "N"
    ? PRICES_LOCAL.N
    : k === "TE"
    ? PRICES_LOCAL.TE
    : k === "D"
    ? PRICES_LOCAL.D
    : PRICES_LOCAL.AC;
}

function renderDeltaLine(label: string, qty: number) {
  if (!qty) return null;
  return (
    <div key={label}>
      {label}: <b>{qty}</b>
    </div>
  );
}
