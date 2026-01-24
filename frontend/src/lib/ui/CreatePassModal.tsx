"use client";
import { useState } from "react";
import { createAccessCardForHolder } from "@/lib/apiv2/accessCards";

export default function CreatePassModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void; }) {
  const [holderName, setHolder] = useState("");
  const [cardNumber, setCard] = useState("");
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    // Note: cardNumber is not used in apiv2 - AccessCard only uses holderName
    await createAccessCardForHolder(holderName.trim() || cardNumber, 10);
    onCreated();
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl p-6 w-full max-w-md">
        <h2 className="text-xl font-semibold mb-4">Nueva tarjeta</h2>
        <input className="input mb-3" placeholder="Titular" value={holderName} onChange={e=>setHolder(e.target.value)} />
        <input className="input mb-3" placeholder="Número de tarjeta" value={cardNumber} onChange={e=>setCard(e.target.value.toUpperCase())} />
        <div className="flex justify-end gap-3">
          <button className="btn" onClick={onClose}>Cancelar</button>
          <button className="btn-primary" onClick={save} disabled={!holderName || !cardNumber || saving}>Guardar</button>
        </div>
      </div>
    </div>
  );
}
