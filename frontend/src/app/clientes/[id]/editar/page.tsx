// src/app/clientes/[id]/editar/page.tsx
"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import ClientForm, { ClientFormValues } from "@/components/clientes/ClientForm";
import { getClient } from "@/lib/apiv2/clients";

export default function EditarClientePage() {
  const { id } = useParams<{ id: string }>();
  const [defaults, setDefaults] = useState<ClientFormValues | null>(null);

  useEffect(() => {
    (async () => {
      const c = await getClient(id);
      if (!c) return;
    setDefaults({
      idType: "cedula", // no tienes cómo inferirlo si guardas solo 10 en backend
      nationalId: c.nationalId,
      name: c.name,
      email: c.email,
      address: c.address,
      number: c.number,
    });
    })();
  }, [id]);

  if (!defaults) {
    return (
      <div className="p-6">
        <div className="rounded-2xl border border-neutral-200 bg-white shadow-sm p-6 text-sm text-neutral-500">
          Cargando…
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-4">
      <div className="rounded-2xl border border-neutral-200 bg-white shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-neutral-200">
          <div className="text-sm font-semibold text-neutral-900">
            Editar cliente
          </div>
        </div>

        <div className="p-4">
          <ClientForm mode="edit" id={id} defaultValues={defaults} />
        </div>
      </div>
    </div>
  );
}
