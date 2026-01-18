"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";

import {
  getAccessCard,
  updateAccessCard,
  deleteAccessCard,
} from "@/lib/apiv2/accessCards";

import { listEntranceAccessCards } from "@/lib/apiv2/entranceAccessCards";

import type { AccessCard } from "@/types/accessCard";
import type { EntranceAccessCard } from "@/types/entranceAccessCard";

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-1">
      <span className="text-sm opacity-70">{k}</span>
      <div className="font-medium">{v}</div>
    </div>
  );
}

function toDateTime(t: EntranceAccessCard) {
  const d = t.entranceDate ?? "";
  const h = t.entranceEntryTime ?? "00:00:00";
  return new Date(`${d}T${h}`);
}

export default function PassDetailPage() {
  const { id } = useParams() as { id: string };
  const router = useRouter();

  const [card, setCard] = useState<AccessCard | null>(null);
  const [history, setHistory] = useState<EntranceAccessCard[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);

    const cardData = await getAccessCard(id);
    if (!cardData) {
      alert("Tarjeta no encontrada.");
      router.push("/pases");
      return;
    }

    const hist = await listEntranceAccessCards();
    const mine = hist.filter((h) => h.accessCardId === id);

    // ordenar por fecha+hora (asc)
    mine.sort((a, b) => toDateTime(a).getTime() - toDateTime(b).getTime());

    setHistory(mine);
    setCard(cardData);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, [id]);

  const remaining = useMemo(() => {
    if (!card) return 0;
    return card.uses; // disponibles
  }, [card]);

  const lastUse = useMemo(() => {
    if (history.length === 0) return "—";
    const last = history[history.length - 1];
    return toDateTime(last).toLocaleString();
  }, [history]);

  async function renewCard() {
    if (!card) return;

    // Renovar: volver a 10 disponibles (uses=total)
    await updateAccessCard(card.id, {
      holderName: card.holderName,
      total: card.total,
      uses: card.total,
      transactionId: card.transactionId ?? null,
    });

    await load();
  }

  async function onDelete() {
    if (!confirm("¿Eliminar esta tarjeta?")) return;

    await deleteAccessCard(id);
    router.push("/pases");
  }

  if (loading || !card) return <div className="p-6">Cargando…</div>;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Tarjeta {card.id.slice(0, 8)}</h1>
          <div className="text-sm opacity-70">
            Dueño: <span className="font-medium">{card.holderName?.trim() || "—"}</span>
          </div>
          <div className="text-xs opacity-60">{card.id}</div>
        </div>

        <div className="flex gap-2">
          <button className="btn" onClick={renewCard} type="button">
            🔄 Renovar
          </button>
          <button className="btn" onClick={onDelete} type="button">
            🗑️ Eliminar
          </button>
        </div>
      </div>

      {/* ✅ Card full ancho */}
      <div className="card space-y-3">
        <Row k="👤 Dueño" v={card.holderName?.trim() || "—"} />
        <Row k="🔢 Pases usados" v={`${card.total - card.uses} / ${card.total}`} />
        <Row k="📦 Disponibles" v={remaining} />
        <Row k="⏱️ Último uso" v={lastUse} />
      </div>

      <div className="card">
        <div className="font-medium mb-3">📊 Historial de usos</div>

        <div className="divide-y">
          {history.length === 0 && <div className="py-4 text-center opacity-60">Sin usos</div>}

          {history.map((t, i) => (
            <div key={t.id} className="py-2 grid grid-cols-1 sm:grid-cols-3 gap-2 items-center">
              <div className="opacity-70 text-sm">
                {i + 1}️⃣ {toDateTime(t).toLocaleString()}
              </div>

              <div className="text-sm">Entrada</div>

              <div className="text-sm sm:text-right"></div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
