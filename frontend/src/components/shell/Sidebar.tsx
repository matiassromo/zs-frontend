// src/components/shell/Sidebar.tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

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

  // En facturación debe abrirse siempre (para que se vea la subruta activa).
  const isFacturacionRoute = useMemo(
    () => pathname.startsWith("/facturacion") || pathname === "/pos",
    [pathname]
  );

  // Estado manual (no se cierra al navegar a otros módulos).
  const [openFacturacion, setOpenFacturacion] = useState(false);

  // Solo fuerza "abrir" cuando estás dentro de facturación.
  // NO fuerza "cerrar" cuando sales (para que no se comprima Punto de Venta / Caja Diaria).
  useEffect(() => {
    if (isFacturacionRoute) setOpenFacturacion(true);
  }, [isFacturacionRoute]);

  return (
    <div className="h-full p-4 flex flex-col gap-4">
      {/* Logo + título */}
      <div className="flex items-center gap-3">
        <div className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-blue-600 text-white text-lg font-bold">
          Z
        </div>
        <div>
          <div className="text-lg font-semibold">Zero Stress</div>
          <div className="text-xs text-neutral-500 -mt-0.5">Panel Único</div>
        </div>
      </div>

      {/* Estado de caja */}
      <div className="rounded-xl border border-green-200 bg-green-50 p-3">
        <div className="text-sm font-medium text-green-800">Estado de Caja</div>
        <div className="mt-1 text-sm text-green-700">
          Abierta — {new Date().toLocaleDateString()}
        </div>
        <div className="mt-1 text-xs text-green-700">Ingresos: $7.00</div>
      </div>

      {/* Métricas rápidas */}
      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="rounded-xl border border-neutral-200 bg-white p-3">
          <div className="text-xs text-neutral-500">Personas</div>
          <div className="text-lg font-semibold">1</div>
        </div>
        <div className="rounded-xl border border-neutral-200 bg-white p-3">
          <div className="text-xs text-neutral-500">Llaves</div>
          <div className="text-lg font-semibold">31</div>
        </div>
        <div className="rounded-xl border border-neutral-200 bg-white p-3">
          <div className="text-xs text-neutral-500">Pend.</div>
          <div className="text-lg font-semibold">1</div>
        </div>
      </div>

      {/* Navegación */}
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
                  // Si estás dentro de facturación, no permitas cerrar (evita esconder el item activo).
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

                {/* Chevron con rotación suave */}
                <span
                  className={`i-lucide-chevron-down transition-transform duration-300 ease-out ${
                    open ? "rotate-180" : "rotate-0"
                  }`}
                />
              </button>

              {/* Animación elegante: grid-rows + fade/slide */}
              <div
                className={`grid transition-[grid-template-rows] duration-300 ease-out ${
                  open ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
                }`}
              >
                <div className="overflow-hidden">
                  <div
                    className={`mt-1 ml-2 flex flex-col gap-1 border-l border-neutral-200 pl-2 transition-all duration-300 ease-out ${
                      open
                        ? "opacity-100 translate-y-0"
                        : "opacity-0 -translate-y-1"
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
