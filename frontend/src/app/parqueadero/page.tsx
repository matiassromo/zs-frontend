// src/app/parqueadero/page.tsx
"use client";

import React, { useEffect, useMemo, useState } from "react";
import type { Parking, ParkingRequestDto } from "@/types/parking";

import {
  listParkings,
  updateParking,
  deleteParking,
} from "@/lib/apiv2/parkings";
import { getAccount } from "@/lib/api/accounts";

// ------------------ helpers fecha/hora ------------------

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

// YYYY-MM-DD (local)
function todayDateOnly(): string {
  const d = new Date();
  return [d.getFullYear(), pad2(d.getMonth() + 1), pad2(d.getDate())].join("-");
}

// HH:mm:ss (local)
function nowTimeOnly(): string {
  const d = new Date();
  return [pad2(d.getHours()), pad2(d.getMinutes()), pad2(d.getSeconds())].join(
    ":"
  );
}

// GUID válido y NO vacío
function isNonEmptyGuid(v: any): v is string {
  if (typeof v !== "string") return false;
  const s = v.trim().toLowerCase();
  if (s === "00000000-0000-0000-0000-000000000000") return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
    s
  );
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
  return new Date(
    y,
    (m || 1) - 1,
    d || 1,
    hh || 0,
    mm || 0,
    ss || 0
  ).getTime();
}

function sortParkings(items: Parking[]): Parking[] {
  // Reglas:
  // 1) Abiertos (sin salida) arriba.
  // 2) Abiertos: más recientes arriba (entry desc).
  // 3) Cerrados: más recientes arriba (exit desc).
  return [...items].sort((a, b) => {
    const aOpen = a.parkingExitTime ? 1 : 0; // 0=open, 1=closed
    const bOpen = b.parkingExitTime ? 1 : 0;
    if (aOpen !== bOpen) return aOpen - bOpen; // open first

    if (aOpen === 0 && bOpen === 0) {
      const ta = toLocalTs(a.parkingDate, a.parkingEntryTime);
      const tb = toLocalTs(b.parkingDate, b.parkingEntryTime);
      return tb - ta; // newest entry first
    }

    const ta = toLocalTs(a.parkingDate, a.parkingExitTime || "");
    const tb = toLocalTs(b.parkingDate, b.parkingExitTime || "");
    return tb - ta; // newest exit first
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

export default function ParkingPage() {
  const [parkings, setParkings] = useState<Parking[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);

  const [deletingIds, setDeletingIds] = useState<Record<string, boolean>>({});

  // transactionId -> nombre (cuando se puede resolver con getAccount)
  const [accountNames, setAccountNames] = useState<Record<string, string>>({});

  // parkingId (o transactionId) -> nombre (hint guardado desde POS)
  const [parkingNameMap, setParkingNameMap] = useState<Record<string, string>>(
    {}
  );

  useEffect(() => {
    setParkingNameMap(readParkingNameMap());
    void loadParkings();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function hydrateAccountNames(items: Parking[]) {
    const ids = Array.from(
      new Set(
        items
          .map((p) => p.transactionId)
          .filter((x): x is string => isNonEmptyGuid(x))
      )
    );
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

    // reordenar para que el que acaba de registrar salida quede arriba del historial
    setParkings((prev) =>
      sortParkings(prev.map((x) => (x.id === p.id ? updated : x)))
    );
  }

  async function handleDelete(p: Parking) {
    if (deletingIds[p.id]) return;

    setDeletingIds((m) => ({ ...m, [p.id]: true }));
    try {
      await deleteParking(p.id);
      setParkings((prev) => prev.filter((x) => x.id !== p.id));
    } catch (e: any) {
      // si backend devuelve 404, igual saca del UI
      if (String(e?.message || "").includes("404")) {
        setParkings((prev) => prev.filter((x) => x.id !== p.id));
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

    if (
      !confirm(
        `Se eliminarán ${toDelete.length} registros del historial. ¿Continuar?`
      )
    ) {
      return;
    }

    for (const p of toDelete) {
      try {
        await deleteParking(p.id);
      } catch {
        // seguimos aunque uno falle
      }
    }

    // Limpia estado local (solo abiertos) y deja orden consistente
    setParkings((prev) => sortParkings(prev.filter((p) => !p.parkingExitTime)));
  }

  const openParkings = useMemo(
    () => parkings.filter((p) => !p.parkingExitTime),
    [parkings]
  );
  const closedParkings = useMemo(
    () => parkings.filter((p) => p.parkingExitTime),
    [parkings]
  );

  function renderAccountName(p: Parking) {
    const txId = isNonEmptyGuid(p.transactionId) ? p.transactionId : null;

    if (txId && accountNames[txId]) {
      return <span className="font-medium">{accountNames[txId]}</span>;
    }

    const hintByParkingId = parkingNameMap[p.id];
    if (hintByParkingId) {
      return <span className="font-medium">{hintByParkingId}</span>;
    }

    if (txId && parkingNameMap[txId]) {
      return <span className="font-medium">{parkingNameMap[txId]}</span>;
    }

    if (!txId) return <span className="text-gray-400 italic text-xs">Sin cuenta</span>;
    return <span className="text-gray-500 text-xs">Cargando…</span>;
  }

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

              {openParkings.map((p) => (
                <tr key={p.id} className="border-t">
                  <td className="px-3 py-2">{p.parkingDate}</td>
                  <td className="px-3 py-2">{formatTime(p.parkingEntryTime)}</td>
                  <td className="px-3 py-2">{renderAccountName(p)}</td>
                  <td className="px-3 py-2 text-right">${p.total.toFixed(2)}</td>
                  <td className="px-3 py-2 text-right space-x-2">
                    <button
                      onClick={() => handleExit(p)}
                      className="px-3 py-1 rounded-full text-xs font-medium bg-black text-white"
                    >
                      Registrar salida
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Historial */}
      <section className="bg-white rounded-xl shadow p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Historial</h2>

          <div className="flex items-center gap-3">
            <span className="text-sm text-gray-500">
              {closedParkings.length} registros
            </span>

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
              </tr>
            </thead>
            <tbody>
              {closedParkings.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-3 py-4 text-center text-gray-500">
                    Aún no hay historial.
                  </td>
                </tr>
              )}

              {closedParkings.map((p) => (
                <tr key={p.id} className="border-t">
                  <td className="px-3 py-2">{p.parkingDate}</td>
                  <td className="px-3 py-2">{formatTime(p.parkingEntryTime)}</td>
                  <td className="px-3 py-2">
                    {formatTime(p.parkingExitTime ?? null)}
                  </td>
                  <td className="px-3 py-2">{renderAccountName(p)}</td>
                  <td className="px-3 py-2 text-right">${p.total.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
