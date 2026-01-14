    // src/types/lockerKey.ts

export type LockerZone = "Hombres" | "Mujeres";

export interface LockerKey {
  id: string;                        // Id real de la llave en la BD
  code: string;                      // "1H", "2H", "1M", etc.
  zone: LockerZone;                  // Hombres / Mujeres
  status: "disponible" | "ocupada";  // estado para la UI
  assignedTo: string | null;         // nombre del cliente
  since: string | null;      
  accountId?: string | null;
        // ISO de cuándo se asignó (si algún día lo tienes)
}
