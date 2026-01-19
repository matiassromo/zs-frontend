import { Client, ClientRequestDto } from "@/types/client";
import { http } from "./http";


export async function listClients(search?: string): Promise<Client[]> {
  const query = search ? `?search=${encodeURIComponent(search)}` : "";
  const dtos = await http<any[]>(`/api/Clients${query}`);
  return (dtos ?? []).map(normalize);
}

export async function getClient(id: string): Promise<Client | null> {
  try {
    const dto = await http<any>(`/api/Clients/${id}`);
    return dto ? normalize(dto) : null;
  } catch (err: any) {
    if (err?.status === 404) return null;
    throw err;
  }
}

export async function createClient(input: ClientRequestDto): Promise<Client> {
  const dto = await http<any>(`/api/Clients`, {
    method: "POST",
    body: JSON.stringify(input),
  });
  return normalize(dto);
}

export async function updateClient(id: string, input: ClientRequestDto): Promise<Client> {
  const dto = await http<any>(`/api/Clients/${id}`, {
    method: "PUT",
    body: JSON.stringify(input),
  });
  return normalize(dto);
}

export async function deleteClient(id: string): Promise<void> {
  await http<void>(`/api/Clients/${id}`, { method: "DELETE" });
}

function normalize(dto: any): Client {
  return {
    id: dto.id ?? dto.Id,
    nationalId: dto.nationalId ?? dto.NationalId,
    name: dto.name ?? dto.Name,
    email: dto.email ?? dto.Email,
    address: dto.address ?? dto.Address,
    number: dto.number ?? dto.Number,
    createdAt: dto.createdAt ?? dto.CreatedAt ?? null,
    updatedAt: dto.updatedAt ?? dto.UpdatedAt ?? null,
  } as Client;
}

export default {
  listClients,
  getClient,
  createClient,
  updateClient,
  deleteClient,
};
