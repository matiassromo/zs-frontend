// src/app/parqueadero/page.tsx
"use client";

import React, { useEffect, useMemo, useState } from "react";
import type { Parking, ParkingRequestDto } from "@/types/parking";

import { listParkings, updateParking, deleteParking } from "@/lib/apiv2/parkings";
import { getAccount } from "@/lib/api/accounts";

// ------------------ helpers fecha/hora ------------------

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

// HH:mm:ss (local)
function nowTimeOnly(): string {
  const d = new Date();
  return [pad2(d.getHours()), pad2(d.getMinutes()), pad2(d.getSeconds())].join(":");
}

// GUID válido y NO vacío
function isNonEmptyGuid(v: any): v is string {
  if (typeof v !== "string") return false;
  const s = v.trim().toLowerCase();
  if (s === "00000000-0000-0000-0000-000000000000") return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(s);
}

// Mostrar solo HH:mm en la UI
function formatTime(value: string | null | undefined): string {
  if (!value) return "-";
  return value.slice(0, 5);
}

// ------------------ helpers sorting ------------------

function toLocalTs(dateOnly?: string | null, timeOnly?: string | null): number {
  if (!dateOnly || !timeOnly) return 0;
  const [y, m, d] = dateOnly.split("-").map((x) => parseInt(x, 10));
  const [hh, mm, ss] = timeOnly.split(":").map((x) => parseInt(x, 10));
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return 0;
  return new Date(y, (m || 1) - 1, d || 1, hh || 0, mm || 0, ss || 0).getTime();
}

function sortParkings(items: Parking[]): Parking[] {
  // 1) Abiertos arriba
  // 2) Abiertos: más recientes arriba (entry desc)
  // 3) Cerrados: más recientes arriba (exit desc)
  return [...items].sort((a, b) => {
    const aOpen = a.parkingExitTime ? 1 : 0; // 0=open
    const bOpen = b.parkingExitTime ? 1 : 0;
    if (aOpen !== bOpen) return aOpen - bOpen;

    if (aOpen === 0 && bOpen === 0) {
      const ta = toLocalTs(a.parkingDate, a.parkingEntryTime);
      const tb = toLocalTs(b.parkingDate, b.parkingEntryTime);
      return tb - ta;
    }

    const ta = toLocalTs(a.parkingDate, a.parkingExitTime || "");
    const tb = toLocalTs(b.parkingDate, b.parkingExitTime || "");
    return tb - ta;
  });
}

// ------------------ helpers localStorage map ------------------
const PARKING_NAME_MAP_KEY = "zs:parking:accountNameMap";

function readParkingNameMap(): Record<string, string> {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(window.localStorage.getItem(PARKING_NAME_MAP_KEY) || "{}");
  } catch {
    return {};
  }
}

// ------------------ PARQUEADERO: cálculo UI ------------------
// Requisito: en vivo 0 -> (>=1h) 0.50 -> (>=2h) 1.00 ...
const PARKING_RATE_PER_HOUR = 0.5;

function parseLocalDateTime(dateOnly?: string | null, timeOnly?: string | null): Date | null {
  if (!dateOnly || !timeOnly) return null;
  const [y, m, d] = dateOnly.split("-").map((x) => parseInt(x, 10));
  const [hh, mm, ss] = timeOnly.split(":").map((x) => parseInt(x, 10));
  if (![y, m, d, hh, mm, ss].every((n) => Number.isFinite(n))) return null;
  return new Date(y, (m || 1) - 1, d || 1, hh || 0, mm || 0, ss || 0);
}

// En vivo: 0.. <1h => 0.00, 1.. <2h => 0.50, ...
function computeLiveAmount(p: Parking): number {
  const start = parseLocalDateTime(p.parkingDate, p.parkingEntryTime);
  if (!start) return 0;
  const end = new Date();
  const ms = Math.max(0, end.getTime() - start.getTime());
  const hours = Math.floor(ms / 3600000);
  return +(hours * PARKING_RATE_PER_HOUR).toFixed(2);
}

// Historial (cerrados): si backend ya trae total, úsalo. Si no, calcula igual que vivo pero con exitTime.
function computeClosedAmountFallback(p: Parking): number {
  const start = parseLocalDateTime(p.parkingDate, p.parkingEntryTime);
  const end = parseLocalDateTime(p.parkingDate, p.parkingExitTime || "");
  if (!start || !end) return 0;
  const ms = Math.max(0, end.getTime() - start.getTime());

  const hours = Math.max(1, Math.ceil(ms / 3600000)); // ✅ hora o fracción
  return +(hours * PARKING_RATE_PER_HOUR).toFixed(2);
}


// ------------------ bus eventos (para refrescar POS / detail) ------------------
function emitParkingChanged(accountId?: string | null) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("zs:parking-changed", { detail: { accountId: accountId ?? null } }));
  try {
    const bc = new BroadcastChannel("zs:bus");
    bc.postMessage({ type: "parking-changed", accountId: accountId ?? null });
    bc.close();
  } catch {}
}

export default function ParkingPage() {
  const [parkings, setParkings] = useState<Parking[]>([]);
  const [loading, setLoading] = useState(true);
  const [deletingIds, setDeletingIds] = useState<Record<string, boolean>>({});

  // transactionId -> nombre (cuando se puede resolver con getAccount)
  const [accountNames, setAccountNames] = useState<Record<string, string>>({});

  // parkingId (o transactionId) -> nombre (hint guardado desde POS)
  const [parkingNameMap, setParkingNameMap] = useState<Record<string, string>>({});

  // tick para recalcular montos en vivo
  const [tick, setTick] = useState(0);

  useEffect(() => {
    setParkingNameMap(readParkingNameMap());
    void loadParkings();

    const id = window.setInterval(() => setTick((t) => t + 1), 30_000); // cada 30s
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    function onParkingChanged() {
      void loadParkings();
    }
    window.addEventListener("zs:parking-changed", onParkingChanged as any);

    // multi-tab
    let bc: BroadcastChannel | null = null;
    try {
      bc = new BroadcastChannel("zs:bus");
      bc.onmessage = (evt) => {
        const data = (evt as any)?.data;
        if (data?.type === "parking-changed") void loadParkings();
      };
    } catch {}

    return () => {
      window.removeEventListener("zs:parking-changed", onParkingChanged as any);
      try {
        bc?.close();
      } catch {}
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function hydrateAccountNames(items: Parking[]) {
    const ids = Array.from(new Set(items.map((p) => p.transactionId).filter((x): x is string => isNonEmptyGuid(x))));
    if (!ids.length) return;

    setAccountNames((prev) => {
      const missing = ids.filter((id) => !prev[id]);
      if (!missing.length) return prev;

      void (async () => {
        const results = await Promise.allSettled(
          missing.map(async (id) => {
            const acc = await getAccount(id);
            const name = (acc as any)?.clientName ?? "";
            return { id, name };
          })
        );

        setAccountNames((p) => {
          const next = { ...p };
          for (const r of results) {
            if (r.status === "fulfilled") {
              const name = (r.value.name ?? "").trim();
              if (name) next[r.value.id] = name;
            }
          }
          return next;
        });
      })();

      return prev;
    });
  }

  async function loadParkings() {
    setLoading(true);
    try {
      const data = await listParkings();
      const sorted = sortParkings(data);
      setParkings(sorted);
      setParkingNameMap(readParkingNameMap());
      void hydrateAccountNames(sorted);
    } finally {
      setLoading(false);
    }
  }

  async function handleExit(p: Parking) {
    if (p.parkingExitTime) return;

    const dto: ParkingRequestDto = {
      parkingDate: p.parkingDate,
      parkingEntryTime: p.parkingEntryTime,
      parkingExitTime: nowTimeOnly(),
      transactionId: isNonEmptyGuid(p.transactionId) ? p.transactionId : null,
    };

    const updated = await updateParking(p.id, dto);
    setParkings((prev) => sortParkings(prev.map((x) => (x.id === p.id ? updated : x))));

    emitParkingChanged(isNonEmptyGuid(updated.transactionId) ? updated.transactionId : null);
  }

  async function handleDelete(p: Parking) {
    if (deletingIds[p.id]) return;

    setDeletingIds((m) => ({ ...m, [p.id]: true }));
    try {
      await deleteParking(p.id);
      setParkings((prev) => prev.filter((x) => x.id !== p.id));
      emitParkingChanged(isNonEmptyGuid(p.transactionId) ? p.transactionId : null);
    } catch (e: any) {
      if (String(e?.message || "").includes("404")) {
        setParkings((prev) => prev.filter((x) => x.id !== p.id));
        emitParkingChanged(isNonEmptyGuid(p.transactionId) ? p.transactionId : null);
        return;
      }
      throw e;
    } finally {
      setDeletingIds((m) => {
        const next = { ...m };
        delete next[p.id];
        return next;
      });
    }
  }

  async function handleClearHistory() {
    const toDelete = parkings.filter((p) => p.parkingExitTime);
    if (toDelete.length === 0) return;

    if (!confirm(`Se eliminarán ${toDelete.length} registros del historial. ¿Continuar?`)) return;

    for (const p of toDelete) {
      try {
        await deleteParking(p.id);
      } catch {}
    }

    setParkings((prev) => sortParkings(prev.filter((p) => !p.parkingExitTime)));
    emitParkingChanged(null);
  }

  const openParkings = useMemo(() => parkings.filter((p) => !p.parkingExitTime), [parkings]);
  const closedParkings = useMemo(() => parkings.filter((p) => p.parkingExitTime), [parkings]);

  function renderAccountName(p: Parking) {
    const txId = isNonEmptyGuid(p.transactionId) ? p.transactionId : null;

    if (txId && accountNames[txId]) return <span className="font-medium">{accountNames[txId]}</span>;

    const hintByParkingId = parkingNameMap[p.id];
    if (hintByParkingId) return <span className="font-medium">{hintByParkingId}</span>;

    if (txId && parkingNameMap[txId]) return <span className="font-medium">{parkingNameMap[txId]}</span>;

    if (!txId) return <span className="text-gray-400 italic text-xs">Sin cuenta</span>;
    return <span className="text-gray-500 text-xs">Cargando…</span>;
  }

  // forzar re-render por tick
  void tick;

  return (
    <div className="p-8 space-y-8">
      {/* Vehículos dentro */}
      <section className="bg-white rounded-xl shadow p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Vehículos dentro</h2>
          <span className="text-sm text-gray-500">{openParkings.length} activos</span>
        </div>

        <div className="border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="text-left px-3 py-2">Fecha</th>
                <th className="text-left px-3 py-2">Ingreso</th>
                <th className="text-left px-3 py-2">Cuenta</th>
                <th className="text-right px-3 py-2">Monto actual</th>
                <th className="text-right px-3 py-2">Acciones</th>
              </tr>
            </thead>

            <tbody>
              {loading && (
                <tr>
                  <td colSpan={5} className="px-3 py-4 text-center text-gray-500">
                    Cargando registros...
                  </td>
                </tr>
              )}

              {!loading && openParkings.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-3 py-4 text-center text-gray-500">
                    No hay vehículos dentro actualmente.
                  </td>
                </tr>
              )}

              {openParkings.map((p) => {
                const uiAmount = computeLiveAmount(p);
                return (
                  <tr key={p.id} className="border-t">
                    <td className="px-3 py-2">{p.parkingDate}</td>
                    <td className="px-3 py-2">{formatTime(p.parkingEntryTime)}</td>
                    <td className="px-3 py-2">{renderAccountName(p)}</td>
                    <td className="px-3 py-2 text-right">${uiAmount.toFixed(2)}</td>
                    <td className="px-3 py-2 text-right space-x-2">
                      <button
                        onClick={() => handleExit(p)}
                        className="px-3 py-1 rounded-full text-xs font-medium bg-black text-white"
                      >
                        Registrar salida
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* Historial */}
      <section className="bg-white rounded-xl shadow p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Historial</h2>

          <div className="flex items-center gap-3">
            <span className="text-sm text-gray-500">{closedParkings.length} registros</span>

            {closedParkings.length > 0 && (
              <button
                onClick={handleClearHistory}
                className="px-3 py-1 rounded-full text-xs font-medium border text-red-600 hover:bg-red-50"
              >
                Limpiar historial
              </button>
            )}
          </div>
        </div>

        <div className="border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="text-left px-3 py-2">Fecha</th>
                <th className="text-left px-3 py-2">Ingreso</th>
                <th className="text-left px-3 py-2">Salida</th>
                <th className="text-left px-3 py-2">Cuenta</th>
                <th className="text-right px-3 py-2">Monto</th>
                <th className="text-right px-3 py-2">Acciones</th>
              </tr>
            </thead>

            <tbody>
              {closedParkings.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-3 py-4 text-center text-gray-500">
                    Aún no hay historial.
                  </td>
                </tr>
              )}

              {closedParkings.map((p) => {
                // Si backend trae total, úsalo (más confiable). Si no, fallback.
                const backendTotal = Number((p as any).total);
                const uiAmount = Number.isFinite(backendTotal) ? backendTotal : computeClosedAmountFallback(p);

                return (
                  <tr key={p.id} className="border-t">
                    <td className="px-3 py-2">{p.parkingDate}</td>
                    <td className="px-3 py-2">{formatTime(p.parkingEntryTime)}</td>
                    <td className="px-3 py-2">{formatTime(p.parkingExitTime ?? null)}</td>
                    <td className="px-3 py-2">{renderAccountName(p)}</td>
                    <td className="px-3 py-2 text-right">${uiAmount.toFixed(2)}</td>
                    <td className="px-3 py-2 text-right">
                      <button
                        onClick={() => handleDelete(p)}
                        disabled={!!deletingIds[p.id]}
                        className="px-3 py-1 rounded-full text-xs font-medium border text-red-600 hover:bg-red-50 disabled:opacity-60"
                      >
                        {deletingIds[p.id] ? "Eliminando…" : "Eliminar"}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
