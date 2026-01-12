// src/types/key.ts

// Lo que devuelve el backend (según tu API actual)
export interface Key {
  id: string;
  available: boolean;
  notes: string | null;

  // esto es lo que tú usas para mostrar (si el backend lo devuelve)
  lastAssignedClient: string | null;
}

// Lo que envías en PUT /api/Keys/{id}
export interface KeyRequestDto {
  available?: boolean;
  notes?: string | null;

  // ✅ esto debe existir para poder enviar LastAssignedTo al backend
  lastAssignedTo?: string | null;
}
