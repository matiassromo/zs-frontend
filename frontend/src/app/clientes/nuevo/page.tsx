// src/app/clientes/nuevo/page.tsx
import ClientForm from "@/components/clientes/ClientForm";

export default function NuevoClientePage() {
  return (
    <div className="p-6 space-y-4">
      <div className="rounded-2xl border border-neutral-200 bg-white shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-neutral-200">
          <div className="text-sm font-semibold text-neutral-900">
            Registrar cliente
          </div>
        </div>

        <div className="p-4">
          <ClientForm mode="create" />
        </div>
      </div>
    </div>
  );
}
