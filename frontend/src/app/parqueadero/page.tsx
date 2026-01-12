// frontend/src/app/parqueadero/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import type { Parking, ParkingRequestDto } from "@/types/parking";
import {
  listParkings,
  createParking,
  updateParking,
  deleteParking,
} from "@/lib/apiv2/parkings";
import TransactionMappingModal from "@/components/shared/TransactionMappingModal";
import { toast } from "@/lib/ui/swal";

const HOURLY_RATE = 0.5;

// YYYY-MM-DD
function todayDateOnly(): string {
  return new Date().toISOString().slice(0, 10);
}

// HH:mm:ss  (compatible con TimeOnly del backend)
function nowTimeOnly(): string {
  return new Date().toTimeString().slice(0, 8);
}

// Mostrar solo HH:mm en la UI
function formatTime(value: string | null | undefined): string {
  if (!value) return "-";
  return value.slice(0, 5);
}

// Calcula monto usando fecha + hora de entrada/salida
function computeAmount(
  parkingDate: string,
  entryTime: string,
  exitTime?: string | null
): number {
  if (!parkingDate || !entryTime) return 0;

  const start = new Date(`${parkingDate}T${entryTime}`);
  const end = exitTime
    ? new Date(`${parkingDate}T${exitTime}`)
    : new Date();

  if (isNaN(start.getTime()) || isNaN(end.getTime())) return 0;

  const diffMs = end.getTime() - start.getTime();
  if (diffMs <= 0) return HOURLY_RATE;

  const diffHours = diffMs / (1000 * 60 * 60);
  const billedBlocks = Math.ceil(diffHours);
  return billedBlocks * HOURLY_RATE;
}

export default function ParkingPage() {
  const [parkings, setParkings] = useState<Parking[]>([]);
  const [loading, setLoading] = useState(true);

  const [creating, setCreating] = useState(false);
  const [showTransactionModal, setShowTransactionModal] = useState(false);
  const [selectedParking, setSelectedParking] = useState<Parking | null>(null);

  useEffect(() => {
    loadParkings();
  }, []);

  async function loadParkings() {
    setLoading(true);
    try {
      const data = await listParkings();
      const sorted = [...data].sort((a, b) => {
        const aOpen = a.parkingExitTime == null ? 0 : 1;
        const bOpen = b.parkingExitTime == null ? 0 : 1;
        if (aOpen !== bOpen) return aOpen - bOpen;
        // abiertos primero, luego cerrados, dentro de cada grupo por hora de entrada
        return (a.parkingEntryTime || "").localeCompare(
          b.parkingEntryTime || ""
        );
      });
      setParkings(sorted);
    } finally {
      setLoading(false);
    }
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();

    setCreating(true);
    try {
      const dto: ParkingRequestDto = {
        parkingDate: todayDateOnly(),
        parkingEntryTime: nowTimeOnly(), // solo hora para TimeOnly
        parkingExitTime: null,
      };
      const created = await createParking(dto);
      setParkings((prev) => [created, ...prev]);
    } finally {
      setCreating(false);
    }
  }

  async function handleExit(p: Parking) {
    if (p.parkingExitTime) return;

    const dto: ParkingRequestDto = {
      parkingDate: p.parkingDate,
      parkingEntryTime: p.parkingEntryTime,
      parkingExitTime: nowTimeOnly(), // solo hora de salida
    };

    const updated = await updateParking(p.id, dto);
    setParkings((prev) => prev.map((x) => (x.id === p.id ? updated : x)));
  }

  async function handleDelete(p: Parking) {
    await deleteParking(p.id);
    setParkings((prev) => prev.filter((x) => x.id !== p.id));
  }

  function handleMapTransaction(p: Parking) {
    setSelectedParking(p);
    setShowTransactionModal(true);
  }

  async function handleTransactionSelected(transactionId: string) {
    if (!selectedParking) return;

    try {
      const dto: ParkingRequestDto = {
        parkingDate: selectedParking.parkingDate,
        parkingEntryTime: selectedParking.parkingEntryTime,
        parkingExitTime: selectedParking.parkingExitTime,
        transactionId,
      };
      const updated = await updateParking(selectedParking.id, dto);
      setParkings((prev) => prev.map((x) => (x.id === selectedParking.id ? updated : x)));
      toast("success", "Transacción vinculada");
    } catch (error: any) {
      toast("error", error?.message ?? "No se pudo vincular la transacción");
    }
  }

  const openParkings = useMemo(
    () => parkings.filter((p) => !p.parkingExitTime),
    [parkings]
  );
  const closedParkings = useMemo(
    () => parkings.filter((p) => p.parkingExitTime),
    [parkings]
  );

  return (
    <div className="p-8 space-y-8">

      {/* Registrar ingreso */}
      <section className="bg-white rounded-xl shadow p-6 space-y-4">
        <h2 className="text-lg font-semibold">Registrar ingreso</h2>
        <p className="text-sm text-gray-500">
          Para clientes que solicitaron parqueadero en el POS. Tarifa{" "}
          <span className="font-medium">$0.50</span> por hora o fracción.
        </p>

        <form
          onSubmit={handleCreate}
          className="flex flex-col md:flex-row gap-4 items-center"
        >
          <button
            type="submit"
            disabled={creating}
            className="px-4 py-2 rounded-full text-sm font-medium bg-black text-white disabled:opacity-50"
          >
            Registrar ingreso
          </button>
        </form>
      </section>

      {/* Vehículos dentro */}
      <section className="bg-white rounded-xl shadow p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Vehículos dentro</h2>
          <span className="text-sm text-gray-500">
            {openParkings.length} activos
          </span>
        </div>

        <div className="border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="text-left px-3 py-2">Fecha</th>
                <th className="text-left px-3 py-2">Ingreso</th>
                <th className="text-right px-3 py-2">Monto actual</th>
                <th className="text-left px-3 py-2">Transacción</th>
                <th className="text-right px-3 py-2">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td
                    colSpan={5}
                    className="px-3 py-4 text-center text-gray-500"
                  >
                    Cargando registros...
                  </td>
                </tr>
              )}

              {!loading && openParkings.length === 0 && (
                <tr>
                  <td
                    colSpan={5}
                    className="px-3 py-4 text-center text-gray-500"
                  >
                    No hay vehículos dentro actualmente.
                  </td>
                </tr>
              )}

              {openParkings.map((p) => {
                const amount = computeAmount(
                  p.parkingDate,
                  p.parkingEntryTime,
                  null
                );
                return (
                  <tr key={p.id} className="border-t">
                    <td className="px-3 py-2">{p.parkingDate}</td>
                    <td className="px-3 py-2">
                      {formatTime(p.parkingEntryTime)}
                    </td>
                    <td className="px-3 py-2 text-right">
                      ${amount.toFixed(2)}
                    </td>
                    <td className="px-3 py-2">
                      {p.transactionId ? (
                        <span className="font-mono text-xs text-emerald-600">
                          ✓ {p.transactionId.substring(0, 8)}...
                        </span>
                      ) : (
                        <span className="text-gray-400 italic text-xs">Sin TX</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right space-x-2">
                      <button
                        onClick={() => handleMapTransaction(p)}
                        className="px-3 py-1 rounded-full text-xs font-medium bg-blue-600 text-white hover:bg-blue-700"
                      >
                        {p.transactionId ? "Cambiar" : "Mapear"}
                      </button>
                      <button
                        onClick={() => handleExit(p)}
                        className="px-3 py-1 rounded-full text-xs font-medium bg-black text-white"
                      >
                        Registrar salida
                      </button>
                      <button
                        onClick={() => handleDelete(p)}
                        className="px-3 py-1 rounded-full text-xs font-medium border"
                      >
                        Eliminar
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
          <span className="text-sm text-gray-500">
            {closedParkings.length} registros
          </span>
        </div>

        <div className="border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="text-left px-3 py-2">Fecha</th>
                <th className="text-left px-3 py-2">Ingreso</th>
                <th className="text-left px-3 py-2">Salida</th>
                <th className="text-right px-3 py-2">Monto</th>
                <th className="text-left px-3 py-2">Transacción</th>
              </tr>
            </thead>
            <tbody>
              {closedParkings.length === 0 && (
                <tr>
                  <td
                    colSpan={5}
                    className="px-3 py-4 text-center text-gray-500"
                  >
                    Aún no hay historial.
                  </td>
                </tr>
              )}

              {closedParkings.map((p) => {
                const amount = computeAmount(
                  p.parkingDate,
                  p.parkingEntryTime,
                  p.parkingExitTime ?? null
                );
                return (
                  <tr key={p.id} className="border-t">
                    <td className="px-3 py-2">{p.parkingDate}</td>
                    <td className="px-3 py-2">
                      {formatTime(p.parkingEntryTime)}
                    </td>
                    <td className="px-3 py-2">
                      {formatTime(p.parkingExitTime ?? null)}
                    </td>
                    <td className="px-3 py-2 text-right">
                      ${amount.toFixed(2)}
                    </td>
                    <td className="px-3 py-2">
                      {p.transactionId ? (
                        <span className="font-mono text-xs text-neutral-600">
                          {p.transactionId.substring(0, 8)}...
                        </span>
                      ) : (
                        <span className="text-gray-400 italic text-xs">Sin TX</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* Transaction Mapping Modal */}
      <TransactionMappingModal
        open={showTransactionModal}
        onClose={() => {
          setShowTransactionModal(false);
          setSelectedParking(null);
        }}
        onTransactionSelected={handleTransactionSelected}
        currentTransactionId={selectedParking?.transactionId}
      />
    </div>
  );
}
