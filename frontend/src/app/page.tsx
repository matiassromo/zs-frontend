"use client";

import { useState } from "react";
import MetricCard from "@/components/shell/MetricCard";
import ModuleCard from "@/components/shell/ModuleCard";
import ActivityItem from "@/components/shell/ActivityItem";
import ChatbotAnalysis from "@/components/ChatbotAnalysis";
import { useDashboard } from "@/hooks/useDashboard";

export default function PanelZeroStress() {
  const { data, loading } = useDashboard(10000);
  const [showChatbot, setShowChatbot] = useState(false);

  const cajaAbierta = data?.cajaAbierta ?? false;
  const ingresosHoy = data?.ingresosHoy ?? 0;
  const clientesActivos = data?.clientesActivos ?? 0;
  const pedidosPendientes = data?.pedidosPendientes ?? 0;
  const llavesDisponibles = data?.llavesDisponibles ?? 0;
  const llavesTotales = data?.llavesTotales ?? 0;
  const actividad = data?.actividadReciente ?? [];

  const ocupacionLlaves =
    llavesTotales > 0
      ? Math.round(((llavesTotales - llavesDisponibles) / llavesTotales) * 100)
      : 0;

  if (showChatbot) {
    return (
      <div className="relative">
        <button
          onClick={() => setShowChatbot(false)}
          className="absolute top-4 right-4 z-10 inline-flex items-center justify-center rounded-xl border border-neutral-200 bg-white px-4 py-2 text-sm font-medium text-neutral-800 shadow-sm transition hover:border-blue-500/70 hover:text-blue-700"
        >
          Volver al Dashboard
        </button>
        <ChatbotAnalysis />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* SECCIÓN SUPERIOR: TÍTULO + CONTEXTO DEL DÍA */}
      <section className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold text-neutral-900">
            Resumen operativo de hoy
          </h1>
          <p className="text-sm text-neutral-500 max-w-xl">
            Visión general del balneario, estado de la caja y módulos clave para la operación diaria.
          </p>
        </div>

        <div className="flex flex-wrap gap-2 justify-start md:justify-end">
          <button
            onClick={() => setShowChatbot(true)}
            className="inline-flex items-center justify-center rounded-xl bg-purple-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-purple-700"
          >
            Análisis con IA
          </button>
          <a
            href="/facturacion/pos"
            className="inline-flex items-center justify-center rounded-xl bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-blue-700"
          >
            Abrir Punto de Venta
          </a>
          <a
            href="/facturacion/caja-diaria"
            className="inline-flex items-center justify-center rounded-xl border border-neutral-200 bg-white px-4 py-2 text-sm font-medium text-neutral-800 shadow-sm transition hover:border-blue-500/70 hover:text-blue-700"
          >
            Ver Caja Diaria
          </a>
        </div>
      </section>

      {/* BLOQUE: ESTADO DE OPERACIÓN */}
      <section className="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        {/* Tarjeta de estado de caja y ocupación */}
        <div className="rounded-2xl border border-neutral-200 bg-white px-5 py-4 shadow-sm">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div className="space-y-1.5">
              <div className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
                Estado de la operación
              </div>
              <div className="flex items-center gap-2">
                <span
                  className={`inline-flex h-2.5 w-2.5 rounded-full ${
                    cajaAbierta ? "bg-emerald-500" : "bg-rose-500"
                  }`}
                />
                <p
                  className={`text-sm font-medium ${
                    cajaAbierta ? "text-emerald-800" : "text-rose-800"
                  }`}
                >
                  {cajaAbierta ? "Caja abierta" : "Caja cerrada"}
                </p>
              </div>
              <p className="text-xs text-neutral-500">
                {cajaAbierta
                  ? "Se pueden registrar ingresos, consumos y movimientos de llaves."
                  : "Solo se permiten consultas; los movimientos quedan bloqueados hasta abrir caja."}
              </p>
            </div>

            <div className="flex flex-col gap-2 text-sm text-right md:text-left lg:text-right">
              <div className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
                Ingresos acumulados hoy
              </div>
              <div className="text-2xl font-semibold text-neutral-900">
                {loading ? "…" : `$${ingresosHoy.toFixed(2)}`}
              </div>
              <div className="text-xs text-neutral-500">
                Incluye entradas, consumo en bar y otros servicios.
              </div>
            </div>
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-3">
            <div className="rounded-xl border border-neutral-100 bg-neutral-50/70 px-3 py-2.5 text-xs">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
                Clientes en el balneario
              </div>
              <div className="mt-1 text-xl font-semibold text-neutral-900">
                {loading ? "…" : clientesActivos}
              </div>
            </div>

            <div className="rounded-xl border border-neutral-100 bg-neutral-50/70 px-3 py-2.5 text-xs">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
                Pedidos pendientes en bar
              </div>
              <div className="mt-1 text-xl font-semibold text-neutral-900">
                {loading ? "…" : pedidosPendientes}
              </div>
              <div className="mt-1 text-[11px] text-neutral-500">
                {pedidosPendientes > 0
                  ? "Revisar cocina y barra para evitar tiempos muertos."
                  : "Sin pedidos en cola en este momento."}
              </div>
            </div>

            <div className="rounded-xl border border-neutral-100 bg-neutral-50/70 px-3 py-2.5 text-xs">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
                Ocupación de Lockers
              </div>
              <div className="mt-1 text-xl font-semibold text-neutral-900">
                {loading ? "…" : `${ocupacionLlaves}%`}
              </div>
              <div className="mt-1 text-[11px] text-neutral-500">
                {loading
                  ? ""
                  : `${llavesTotales - llavesDisponibles} en uso / ${llavesTotales} totales`}
              </div>
            </div>
          </div>
        </div>

        {/* Actividad reciente, separada visualmente */}
        <div className="rounded-2xl border border-neutral-200 bg-white px-4 py-4 shadow-sm flex flex-col">
          <div className="flex items-center justify-between gap-2 mb-2">
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
                Timeline de actividad
              </div>
              <h2 className="text-sm font-semibold text-neutral-900">
                Últimos movimientos registrados
              </h2>
            </div>
            <span className="rounded-full border border-neutral-200 bg-neutral-50 px-2.5 py-0.5 text-[11px] text-neutral-500">
              Hoy
            </span>
          </div>

          <div className="mt-2 space-y-2.5 overflow-auto max-h-[260px]">
            {loading && actividad.length === 0 ? (
              <>
                <ActivityItem title="Cargando actividad…" time="…" />
                <ActivityItem title="Cargando actividad…" time="…" />
              </>
            ) : actividad.length === 0 ? (
              <div className="text-xs text-neutral-500">
                No se han registrado movimientos recientes en esta jornada.
              </div>
            ) : (
              actividad.map((i) => (
                <ActivityItem key={i.id} title={i.texto} time={i.hora} />
              ))
            )}
          </div>
        </div>
      </section>

      {/* BLOQUE: MÉTRICAS RESUMIDAS */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-neutral-900">
              Indicadores clave del día
            </h2>
            <p className="text-xs text-neutral-500">
              Resumen numérico para control rápido de la operación.
            </p>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-4">
          <MetricCard
            title="Clientes activos"
            value={loading ? "…" : String(clientesActivos)}
            subtitle="Personas dentro del balneario"
          />
          <MetricCard
            title="Pedidos pendientes"
            value={loading ? "…" : String(pedidosPendientes)}
            subtitle="Órdenes en bar"
            tone={pedidosPendientes > 0 ? "warning" : "neutral"}
          />
          <MetricCard
            title="Ingresos hoy"
            value={loading ? "…" : `$${ingresosHoy.toFixed(2)}`}
            subtitle="Total consolidado"
            tone="success"
          />
          <MetricCard
            title="Lockers disponibles"
            value={loading ? "…" : String(llavesDisponibles)}
            subtitle={loading ? "" : `De ${llavesTotales} Lockers totales`}
          />
        </div>
      </section>

      {/* BLOQUE: MÓDULOS DEL SISTEMA */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-neutral-900">
              Módulos de operación
            </h2>
            <p className="text-xs text-neutral-500">
              Accesos rápidos a las funciones principales del sistema.
            </p>
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          <ModuleCard
            title="Facturación"
            subtitle="POS, Caja Diaria y cierres de turno"
            badge="MÓDULO PRINCIPAL"
            href="/facturacion"
          />
          <ModuleCard
            title="Clientes"
            subtitle="Ingreso, control de estadía y egreso"
            href="/clientes"
          />
          <ModuleCard
            title="Tarjetas 10 Pases"
            subtitle="Emisión, recarga y control de uso"
            href="/pases"
          />
          <ModuleCard
            title="Bar"
            subtitle="Pedidos, comandas y consumos en mesa"
            href="/bar"
          />
          <ModuleCard
            title="Parqueadero"
            subtitle="Control de vehículos y tickets"
            href="/parqueadero"
          />
          <ModuleCard
            title="Lockers"
            subtitle="Asignación de lockers y vestidores"
            href="/llaves"
          />
        </div>
      </section>
    </div>
  );
}
