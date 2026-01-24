// src/components/shell/Sidebar.tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { useDashboard } from "@/hooks/useDashboard";

type NavItem =
  | { type: "link"; href: string; label: string }
  | {
      type: "group";
      label: string;
      id: "facturacion" | string;
      children: { href: string; label: string }[];
    };

const items: NavItem[] = [
  { type: "link", href: "/", label: "Dashboard" },
  {
    type: "group",
    id: "facturacion",
    label: "Facturación",
    children: [
      { href: "/facturacion/pos", label: "Punto de Venta" },
      { href: "/facturacion/caja-diaria", label: "Caja Diaria" },
      { href: "/facturacion/reportes/ventas", label: "Reporte de Ventas" }, // ✅ NUEVO
    ],
  },
  { type: "link", href: "/clientes", label: "Clientes" },
  { type: "link", href: "/pases", label: "Tarjetas 10 Pases" },
  { type: "link", href: "/bar", label: "Bar" },
  { type: "link", href: "/parqueadero", label: "Parqueadero" },
  { type: "link", href: "/llaves", label: "Lockers" },
];


export default function Sidebar() {
  const pathname = usePathname();
  const { data } = useDashboard(8000);

  const isFacturacionRoute = useMemo(
    () => pathname.startsWith("/facturacion") || pathname === "/pos",
    [pathname]
  );


  const [openFacturacion, setOpenFacturacion] = useState(false);

  useEffect(() => {
    if (isFacturacionRoute) setOpenFacturacion(true);
  }, [isFacturacionRoute]);

  const cajaAbierta = data?.cajaAbierta ?? false;
  const ingresosHoy = data?.ingresosHoy ?? 0;
  const clientesActivos = data?.clientesActivos ?? 0;
  const pedidosPendientes = data?.pedidosPendientes ?? 0;
  const llavesDisponibles = data?.llavesDisponibles ?? 0;

  return (
    <div className="h-full p-4 flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <div className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-blue-600 text-white text-lg font-bold">
          Z
        </div>
        <div>
          <div className="text-lg font-semibold">Zero Stress</div>
          <div className="text-xs text-neutral-500 -mt-0.5">Panel Único</div>
        </div>
      </div>

      {/* Estado de caja (REAL) */}
      <div
        className={
          "rounded-xl border p-3 " +
          (cajaAbierta
            ? "border-emerald-200 bg-emerald-50"
            : "border-rose-200 bg-rose-50")
        }
      >
        <div
          className={
            "text-sm font-medium " +
            (cajaAbierta ? "text-emerald-800" : "text-rose-800")
          }
        >
          Estado de Caja
        </div>
        <div
          className={
            "mt-1 text-sm " +
            (cajaAbierta ? "text-emerald-700" : "text-rose-700")
          }
        >
          {cajaAbierta ? "Abierta" : "Cerrada"} — {new Date().toLocaleDateString("es-EC")}
        </div>
        <div
          className={
            "mt-1 text-xs " +
            (cajaAbierta ? "text-emerald-700" : "text-rose-700")
          }
        >
          Ingresos: ${ingresosHoy.toFixed(2)}
        </div>
      </div>

      {/* Métricas rápidas (REALES) */}
      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="rounded-xl border border-neutral-200 bg-white p-3">
          <div className="text-xs text-neutral-500">Personas</div>
          <div className="text-lg font-semibold">{clientesActivos}</div>
        </div>
        <div className="rounded-xl border border-neutral-200 bg-white p-3">
          <div className="text-xs text-neutral-500">Llaves</div>
          <div className="text-lg font-semibold">{llavesDisponibles}</div>
        </div>
        <div className="rounded-xl border border-neutral-200 bg-white p-3">
          <div className="text-xs text-neutral-500">Pend.</div>
          <div className="text-lg font-semibold">{pedidosPendientes}</div>
        </div>
      </div>

      <nav className="mt-2 flex flex-col gap-1">
        {items.map((it) => {
          if (it.type === "link") {
            const active = pathname === it.href;
            return (
              <Link
                key={it.href}
                href={it.href}
                className={`flex items-center justify-between rounded-xl px-3 py-2 text-sm transition-colors ${
                  active
                    ? "bg-blue-600 text-white"
                    : "hover:bg-neutral-100 text-neutral-700"
                }`}
              >
                <span>{it.label}</span>
              </Link>
            );
          }

          const groupActive = isFacturacionRoute;
          const open = openFacturacion || groupActive;

          return (
            <div key={it.id} className="select-none">
              <button
                type="button"
                onClick={() => {
                  if (groupActive) return;
                  setOpenFacturacion((v) => !v);
                }}
                className={`w-full flex items-center justify-between rounded-xl px-3 py-2 text-sm transition-colors ${
                  groupActive
                    ? "bg-blue-50 text-blue-700"
                    : "hover:bg-neutral-100 text-neutral-700"
                }`}
              >
                <span className="font-medium">{it.label}</span>
                <span
                  className={`i-lucide-chevron-down transition-transform duration-300 ease-out ${
                    open ? "rotate-180" : "rotate-0"
                  }`}
                />
              </button>

              <div
                className={`grid transition-[grid-template-rows] duration-300 ease-out ${
                  open ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
                }`}
              >
                <div className="overflow-hidden">
                  <div
                    className={`mt-1 ml-2 flex flex-col gap-1 border-l border-neutral-200 pl-2 transition-all duration-300 ease-out ${
                      open ? "opacity-100 translate-y-0" : "opacity-0 -translate-y-1"
                    }`}
                  >
                    {it.children.map((c) => {
                      const active = pathname === c.href;
                      return (
                        <Link
                          key={c.href}
                          href={c.href}
                          className={`rounded-lg px-3 py-2 text-sm transition-colors ${
                            active
                              ? "bg-blue-600 text-white"
                              : "hover:bg-neutral-100 text-neutral-700"
                          }`}
                        >
                          {c.label}
                        </Link>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </nav>
    </div>
  );
}
