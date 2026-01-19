"use client";

import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  createClient,
  updateClient,
} from "@/lib/apiv2/clients";
import type { ClientRequestDto } from "@/types/client";
import Swal from "sweetalert2";
import { confirm, toast } from "@/lib/ui/swal";

/* ----------------- VALIDACIONES ECUADOR: CÉDULA / RUC ----------------- */

function isAllDigits(s: string) {
  return /^\d+$/.test(s);
}

function validateCedulaEC(cedula: string): boolean {
  if (!isAllDigits(cedula) || cedula.length !== 10) return false;

  const provincia = parseInt(cedula.slice(0, 2), 10);
  const tercer = parseInt(cedula[2], 10);

  // Provincia 01-24
  if (provincia < 1 || provincia > 24) return false;

  // Persona natural: 0-5
  if (tercer < 0 || tercer > 5) return false;

  const digits = cedula.split("").map((c) => parseInt(c, 10));
  const verificador = digits[9];

  let suma = 0;
  for (let i = 0; i < 9; i++) {
    let v = digits[i];
    if (i % 2 === 0) {
      v = v * 2;
      if (v > 9) v -= 9;
    }
    suma += v;
  }

  const decena = Math.ceil(suma / 10) * 10;
  const dig = (decena - suma) % 10;

  return dig === verificador;
}

function validateRucEC(ruc: string): boolean {
  if (!isAllDigits(ruc) || ruc.length !== 13) return false;

  const provincia = parseInt(ruc.slice(0, 2), 10);
  if (provincia < 1 || provincia > 24) return false;

  const tercer = parseInt(ruc[2], 10);
  const establecimiento = ruc.slice(10, 13);

  // Establecimiento no puede ser 000
  if (establecimiento === "000") return false;

  // RUC persona natural (0-5): primeros 10 deben ser cédula válida
  if (tercer >= 0 && tercer <= 5) {
    return validateCedulaEC(ruc.slice(0, 10));
  }

  // Privadas (9) / Públicas (6): aquí solo validación estructural mínima
  if (tercer === 6 || tercer === 9) {
    return true;
  }

  return false;
}

function validateNationalIdEC(value: string): { ok: boolean; msg?: string } {
  const v = value.trim();

  if (!isAllDigits(v)) return { ok: false, msg: "Solo números" };
  if (!(v.length === 10 || v.length === 13))
    return { ok: false, msg: "Debe tener 10 (cédula) o 13 (RUC) dígitos" };

  if (v.length === 10) {
    return validateCedulaEC(v)
      ? { ok: true }
      : { ok: false, msg: "Cédula inválida" };
  }

  return validateRucEC(v) ? { ok: true } : { ok: false, msg: "RUC inválido" };
}

/* ----------------- SCHEMA ----------------- */

const schema = z.object({
  nationalId: z
    .string()
    .min(10, "Debe tener 10 (cédula) o 13 (RUC) dígitos")
    .max(13, "Máx 13 dígitos")
    .superRefine((val, ctx) => {
      const r = validateNationalIdEC(val);
      if (!r.ok) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: r.msg ?? "ID inválido",
        });
      }
    }),
  name: z.string().min(1, "Nombre obligatorio").max(50, "Máx 50 caracteres"),
  email: z.string().email("Correo inválido"),
  address: z
    .string()
    .min(1, "Dirección obligatoria")
    .max(300, "Máx 300 caracteres"),
  number: z
    .string()
    .min(10, "Teléfono 10 dígitos")
    .max(10, "Máx 10 dígitos")
    .regex(/^\d+$/, "Solo números"),
});

export type ClientFormValues = z.infer<typeof schema>;

export default function ClientForm({
  defaultValues,
  mode,
  id,
}: {
  defaultValues?: Partial<ClientFormValues>;
  mode: "create" | "edit";
  id?: string;
}) {
  const router = useRouter();

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<ClientFormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      nationalId: "",
      name: "",
      email: "",
      address: "",
      number: "",
      ...defaultValues,
    },
  });

  const onSubmit = async (data: ClientFormValues) => {
    try {
      // Backend actual limita a 10, así que si ingresan RUC (13) guardamos base 10.
      const nid = data.nationalId.trim();
      const nationalIdForBackend = nid.length === 13 ? nid.slice(0, 10) : nid;

      const payload: ClientRequestDto = {
        ...data,
        nationalId: nationalIdForBackend,
      };

      if (mode === "edit" && id) {
        const res = await confirm({
          title: "Guardar cambios",
          text: "Se actualizarán los datos del cliente.",
          confirmButtonText: "Sí, guardar",
        });
        if (!res.isConfirmed) return;

        Swal.showLoading();
        await updateClient(id, payload);

        await Swal.fire({
          icon: "success",
          title: "Cambios guardados",
          timer: 1400,
          showConfirmButton: false,
        });

        router.push("/clientes");
        return;
      }

      if (mode === "create") {
        Swal.showLoading();
        await createClient(payload);

        const r = await Swal.fire({
          icon: "success",
          title: "Cliente creado",
          text: "¿Qué deseas hacer ahora?",
          showDenyButton: true,
          confirmButtonText: "Ir al listado",
          denyButtonText: "Crear otro",
          reverseButtons: true,
        });

        if (r.isConfirmed) {
          router.push("/clientes");
        } else {
          reset();
          toast("info", "Formulario listo para un nuevo cliente");
        }
        return;
      }
    } catch (e: any) {
      await Swal.fire({
        icon: "error",
        title: "No se pudo guardar",
        text: e?.message ?? "Error guardando cliente",
      });
    }
  };

  // ✅ estilo POS
  const inputCls =
    "w-full rounded-xl border border-neutral-200 bg-white px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-neutral-200";
  const labelCls =
    "block text-xs font-semibold uppercase tracking-wide text-neutral-500 mb-1";
  const errCls = "text-xs text-rose-700 mt-1";

  return (
  <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
    <div className="grid gap-4 sm:grid-cols-2">
      {/* Cédula / RUC */}
      <div>
        <label className={labelCls}>Cédula / RUC</label>
        <input
          type="text"
          inputMode="numeric"
          maxLength={13}
          className={inputCls}
          placeholder="1724567890 o 1724567890001"
          {...register("nationalId")}
        />
        {errors.nationalId && (
          <p className={errCls}>{errors.nationalId.message}</p>
        )}
      </div>

      {/* Teléfono */}
      <div>
        <label className={labelCls}>Número / Teléfono</label>
        <input
          type="text"
          inputMode="numeric"
          maxLength={10}
          className={inputCls}
          placeholder="0991234567"
          {...register("number")}
        />
        {errors.number && <p className={errCls}>{errors.number.message}</p>}
      </div>

      {/* Nombre */}
      <div>
        <label className={labelCls}>Nombre</label>
        <input
          type="text"
          maxLength={50}
          className={inputCls}
          placeholder="Rodrigo Castillo"
          {...register("name")}
        />
        {errors.name && <p className={errCls}>{errors.name.message}</p>}
      </div>

      {/* Email */}
      <div>
        <label className={labelCls}>Correo electrónico</label>
        <input
          type="email"
          className={inputCls}
          placeholder="rodrigo.castillo@gmail.com"
          {...register("email")}
        />
        {errors.email && <p className={errCls}>{errors.email.message}</p>}
      </div>

      {/* Dirección */}
      <div className="sm:col-span-2">
        <label className={labelCls}>Dirección</label>
        <textarea
          rows={3}
          maxLength={300}
          className={`${inputCls} resize-y`}
          placeholder="Av. La Prensa y Eloy Alfaro, Quito"
          {...register("address")}
        />
        {errors.address && (
          <p className={errCls}>{errors.address.message}</p>
        )}
      </div>
    </div>

    {/* Botones */}
    <div className="flex flex-wrap gap-2 pt-4">
      <button
        type="submit"
        disabled={isSubmitting}
        className="inline-flex items-center justify-center rounded-full bg-neutral-900 px-4 py-2 text-sm font-semibold text-white hover:bg-neutral-800 disabled:opacity-50"
      >
        {isSubmitting ? "Guardando…" : "Guardar"}
      </button>

      <button
        type="button"
        onClick={() => reset()}
        className="inline-flex items-center justify-center rounded-full border border-neutral-200 bg-white px-4 py-2 text-sm font-medium text-neutral-900 hover:bg-neutral-50"
      >
        Limpiar
      </button>

      <button
        type="button"
        onClick={() => router.push("/clientes")}
        className="inline-flex items-center justify-center rounded-full border border-neutral-200 bg-white px-4 py-2 text-sm font-medium text-neutral-900 hover:bg-neutral-50"
      >
        Volver
      </button>
    </div>
  </form>
);

}
