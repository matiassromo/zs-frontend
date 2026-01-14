// src/lib/ui/swal.ts
"use client";

import Swal, { SweetAlertIcon, SweetAlertOptions } from "sweetalert2";

function getScrollY() {
  if (typeof window === "undefined") return 0;
  return window.scrollY || 0;
}

function restoreScroll(y: number) {
  if (typeof window === "undefined") return;
  requestAnimationFrame(() => {
    window.scrollTo({ top: y, left: 0, behavior: "auto" });
  });
}

function withNoJumpDefaults(opts: SweetAlertOptions): SweetAlertOptions {
  return {
    // ✅ evita “brincos” por ajustes de altura y por devolver el focus
    heightAuto: false,
    returnFocus: false,
    focusConfirm: false,

    // defaults tuyos (puedes sobreescribirlos vía opts)
    reverseButtons: true,

    ...opts,
  };
}

export function confirm(options?: Partial<SweetAlertOptions>) {
  const y = getScrollY();

  return Swal.fire(
    withNoJumpDefaults({
      icon: "question",
      title: "¿Confirmar acción?",
      showCancelButton: true,
      confirmButtonText: "Sí, continuar",
      cancelButtonText: "Cancelar",

      // ✅ si quieres que quede por defecto, mantenlo; igual no debería saltar por returnFocus:false
      focusCancel: false,

      ...(options as any),
    } as any)
  ).finally(() => {
    restoreScroll(y);
  });
}

// ✅ helper genérico: cualquier Swal preserva scroll (para success/error/info también)
export function fire(options: SweetAlertOptions) {
  const y = getScrollY();
  return Swal.fire(withNoJumpDefaults(options)).finally(() => {
    restoreScroll(y);
  });
}

// Toast arriba a la derecha (no debería afectar scroll, pero igual le ponemos defaults)
export function toast(icon: SweetAlertIcon, title: string, timer = 2000) {
  return Swal.fire(
    withNoJumpDefaults({
      toast: true,
      position: "top-end",
      showConfirmButton: false,
      timer,
      timerProgressBar: true,
      icon,
      title,
    } as any)
  );
}

export default Swal;
export type { SweetAlertOptions } from "sweetalert2";
