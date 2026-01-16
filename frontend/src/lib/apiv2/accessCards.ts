// src/lib/apiv2/accessCards.ts
import type { AccessCard, AccessCardRequestDto } from "@/types/accessCard";
import { http, HttpError } from "./http";

const ENDPOINT = "/api/AccessCards";
const DEFAULT_TOTAL = 10;

/**
 * Convención:
 * - total = total de pases (normalmente 10)
 * - uses = pases usados (incrementa cuando se consume)
 * - remaining = total - uses (calculado en front si backend no lo trae)
 */

export async function listAccessCards(): Promise<AccessCard[]> {
  try {
    const dtos = await http<any[]>(ENDPOINT);
    return (dtos ?? []).map(normalize);
  } catch (err) {
    if (err instanceof HttpError && err.status >= 500) return [];
    throw err;
  }
}

export async function getAccessCard(id: string): Promise<AccessCard | null> {
  try {
    const dto = await http<any>(`${ENDPOINT}/${id}`);
    return dto ? normalize(dto) : null;
  } catch (err: any) {
    if (err instanceof HttpError && (err.status === 404 || err.status >= 500)) return null;
    throw err;
  }
}

/**
 * Intenta buscar por holderName en backend.
 * - 1) GET /api/AccessCards/by-holder?holderName=...
 * - 2) GET /api/AccessCards/by-holder/{holderName}
 * - 3) fallback: listAccessCards() y filtra por holderName
 *
 * Devuelve: { card, remaining }
 */
export async function findAccessCardByHolder(holderName: string): Promise<{
  card: AccessCard;
  remaining: number;
} | null> {
  const name = (holderName ?? "").trim();
  if (!name) return null;

  // helper para remaining (si backend no lo trae)
  const calcRemaining = (card: AccessCard) => Math.max(0, (card.total ?? 0) - (card.uses ?? 0));

  // 1) querystring
  try {
    const dto = await http<any>(
      `${ENDPOINT}/by-holder?holderName=${encodeURIComponent(name)}`
    );
    if (dto) {
      const card = normalize(dto);
      const remainingFromDto = dto?.remaining ?? dto?.Remaining;
      const remaining =
        remainingFromDto != null ? Number(remainingFromDto) : calcRemaining(card);
      return { card, remaining: Number.isFinite(remaining) ? remaining : calcRemaining(card) };
    }
  } catch (e: any) {
    if (!(e instanceof HttpError && (e.status === 404 || e.status === 405))) throw e;
  }

  // 2) path param
  try {
    const dto = await http<any>(`${ENDPOINT}/by-holder/${encodeURIComponent(name)}`);
    if (dto) {
      const card = normalize(dto);
      const remainingFromDto = dto?.remaining ?? dto?.Remaining;
      const remaining =
        remainingFromDto != null ? Number(remainingFromDto) : calcRemaining(card);
      return { card, remaining: Number.isFinite(remaining) ? remaining : calcRemaining(card) };
    }
  } catch (e: any) {
    if (!(e instanceof HttpError && (e.status === 404 || e.status === 405))) throw e;
  }

  // 3) fallback: list + filtro
  const all = await listAccessCards();
  const match = all.find(
    (c) => (c.holderName ?? "").trim().toLowerCase() === name.toLowerCase()
  );
  if (!match) return null;

  return { card: match, remaining: calcRemaining(match) };
}

export async function createAccessCard(input: AccessCardRequestDto): Promise<AccessCard> {
  const payload = toRequest(input);

  const dto = await http<any>(ENDPOINT, {
    method: "POST",
    body: JSON.stringify(payload),
  });

  return normalize(dto);
}

export async function updateAccessCard(id: string, input: AccessCardRequestDto): Promise<AccessCard> {
  const payload = toRequest(input);

  const dto = await http<any>(`${ENDPOINT}/${id}`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });

  return normalize(dto);
}

export async function deleteAccessCard(id: string): Promise<void> {
  await http<void>(`${ENDPOINT}/${id}`, { method: "DELETE" });
}

/**
 * Crear tarjeta para holder.
 * - total por defecto: 10
 * - uses por defecto: 0
 */
// ✅ Crea tarjeta con uses = total (porque uses = RESTANTES en tu backend)
export async function createAccessCardForHolder(
  holderName: string,
  total: number = 10
): Promise<{ card: AccessCard; remaining: number }> {
  const name = (holderName ?? "").trim();
  if (!name) throw new Error("HolderName es obligatorio.");

  const card = await createAccessCard({
    holderName: name,
    total,
    uses: total, // 🔥 RESTANTES completos al crear
  });

  return { card, remaining: card.uses }; // remaining = uses (restantes)
}

/**
 * Consume usos por holder.
 * Preferido:
 * - POST /api/AccessCards/{id}/consume { uses }
 * Fallback:
 * - PUT updateAccessCard -> uses = uses + u
 */
// ✅ Consume decrementando uses (restantes)
export async function consumeAccessCardByHolder(
  holderName: string,
  usesToConsume: number
): Promise<{ cardId: string; remaining: number }> {
  const u = Math.max(0, Math.floor(usesToConsume));
  if (u <= 0) throw new Error("Usos inválidos.");

  const found = await findAccessCardByHolder(holderName);
  if (!found) throw new Error("No existe tarjeta para este HolderName.");

  const card = found.card;
  const cardId = card.id;

  const currentRemaining = Number(card.uses ?? 0); // 🔥 uses = RESTANTES
  if (currentRemaining < u) {
    throw new Error(`Tarjeta sin usos suficientes. Restantes: ${currentRemaining}`);
  }

  // 1) endpoint dedicado si existe
  try {
    await http<void>(`${ENDPOINT}/${encodeURIComponent(cardId)}/consume`, {
      method: "POST",
      body: JSON.stringify({ uses: u }),
    });

    const again = await getAccessCard(cardId);
    if (!again) return { cardId, remaining: currentRemaining - u };

    return { cardId, remaining: Number(again.uses ?? 0) };
  } catch (e: any) {
    if (!(e instanceof HttpError && (e.status === 404 || e.status === 405))) throw e;
  }

  // 2) fallback: decrementa restantes
  const updated = await updateAccessCard(cardId, {
    holderName: card.holderName,
    total: card.total,
    uses: currentRemaining - u, // 🔥 RESTANTES
    transactionId: card.transactionId ?? null,
  });

  return { cardId, remaining: Number(updated.uses ?? 0) };
}

/* -------------------- helpers -------------------- */

function toRequest(input: AccessCardRequestDto): any {
  return {
    transactionId: (input as any).transactionId ?? (input as any).TransactionId ?? null,
    total: (input as any).total ?? (input as any).Total ?? DEFAULT_TOTAL,
    uses: (input as any).uses ?? (input as any).Uses ?? 0,
    holderName: (input as any).holderName ?? (input as any).HolderName,
  };
}

function normalize(dto: any): AccessCard {
  const id = dto?.id ?? dto?.Id ?? dto?.accessCardId ?? dto?.AccessCardId;

  return {
    // TransactionItemDto base fields
    id: String(id ?? ""),
    createdAt: dto?.createdAt ?? dto?.CreatedAt,
    total: Number(dto?.total ?? dto?.Total ?? DEFAULT_TOTAL),
    transactionType: dto?.transactionType ?? dto?.TransactionType,
    transactionId: dto?.transactionId ?? dto?.TransactionId ?? null,
    // AccessCard-specific fields
    uses: Number(dto?.uses ?? dto?.Uses ?? 0),
    holderName: dto?.holderName ?? dto?.HolderName,
  };
}

export default {
  listAccessCards,
  getAccessCard,
  createAccessCard,
  updateAccessCard,
  deleteAccessCard,
  findAccessCardByHolder,
  createAccessCardForHolder,
  consumeAccessCardByHolder,
};
