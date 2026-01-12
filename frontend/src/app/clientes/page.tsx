"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Client } from "@/types/client";
import { listClients, deleteClient } from "@/lib/api/clients";
import Swal from "sweetalert2";
import "sweetalert2/dist/sweetalert2.min.css";

export default function ClientesPage() {
  const [items, setItems] = useState<Client[]>([]);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);

  // Toast simple (arriba-derecha)
  const toast = (title: string, icon: "success" | "info" | "error" = "success", timer = 1800) =>
    Swal.fire({ toast: true, position: "top-end", showConfirmButton: false, timer, timerProgressBar: true, icon, title });

  async function load() {
    try {
      setLoading(true);
      const data = await listClients(q);
      setItems(data);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <Link
          href="/clientes/nuevo"
          className="rounded-full px-5 py-2.5 bg-blue-600 text-white hover:bg-blue-700 shadow-sm"
        >
          Nuevo cliente
        </Link>
      </div>

      {/* Buscador */}
      <div className="flex gap-3">
        <input
          className="flex-1 rounded-full border border-neutral-300 bg-white px-5 py-3 outline-none focus:ring-2 focus:ring-blue-500"
          placeholder="Buscar por nombre, cédula, email o teléfono…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <button
          onClick={load}
          className="rounded-full border border-neutral-300 bg-white px-5 py-3 hover:bg-neutral-50"
        >
          Buscar
        </button>
      </div>

      {/* Tabla */}
      <div className="rounded-2xl border border-neutral-200 bg-white overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-neutral-50 text-neutral-600">
            <tr className="[&>th]:text-left [&>th]:font-medium [&>th]:p-3">
              <th>Nombre</th>
              <th>Cédula</th>
              <th>Teléfono</th>
              <th>Correo</th>
              <th className="text-right pr-4">Acciones</th>
            </tr>
          </thead>
          <tbody className="[&>tr]:border-t [&>tr]:border-neutral-200">
            {loading && (
              <tr>
                <td colSpan={5} className="p-4 text-neutral-500">
                  Cargando…
                </td>
              </tr>
            )}

            {!loading && items.length === 0 && (
              <tr>
                <td colSpan={5} className="p-6 text-center text-neutral-500">
                  Sin resultados.
                </td>
              </tr>
            )}

            {!loading &&
              items.map((c) => (
                <tr key={c.id} className="hover:bg-neutral-50/60 transition-colors">
                  <td className="p-3">{c.name}</td>
                  <td className="p-3">{c.nationalId}</td>
                  <td className="p-3">{c.number}</td>
                  <td className="p-3">{c.email}</td>
                  <td className="p-3">
                    <div className="flex items-center justify-end gap-4">
                      <Link
                        href={`/clientes/${c.id}/editar`}
                        className="text-blue-600 hover:underline"
                      >
                        Editar
                      </Link>
                      <button
                        onClick={async () => {
                          const res = await Swal.fire({
                            icon: "warning",
                            title: "¿Eliminar cliente?",
                            text: `Se eliminará a ${c.name}. Esta acción no se puede deshacer.`,
                            showCancelButton: true,
                            confirmButtonText: "Sí, eliminar",
                            cancelButtonText: "Cancelar",
                            confirmButtonColor: "#dc2626", // red-600
                            reverseButtons: true,
                            showLoaderOnConfirm: true,
                            allowOutsideClick: () => !Swal.isLoading(),
                            preConfirm: async () => {
                              try {
                                await deleteClient(c.id);
                              } catch (err: any) {
                                Swal.showValidationMessage(err?.message ?? "Error eliminando cliente");
                                throw err;
                              }
                            },
                          });

                          if (res.isConfirmed) {
                            await load();
                            toast("Cliente eliminado", "success");
                          }
                        }}
                        className="text-red-600 hover:underline"
                      >
                        Eliminar
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
