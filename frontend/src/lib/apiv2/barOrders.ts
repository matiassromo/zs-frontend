import {
  BarOrder,
  BarOrderDetail,
  BarOrderDetailCreateRequestDto,
  BarOrderDetailUpdateRequestDto,
  BarOrderRequestDto,
} from "@/types/barOrder";
import { http } from "./http";

/**
 * Retrieves all bar orders from the backend
 * @returns Promise<BarOrder[]> Array of all bar orders
 */
export async function listBarOrders(): Promise<BarOrder[]> {
  const dtos = await http<any[]>(`/api/BarOrders`);
  return dtos.map(normalizeBarOrder);
}

/**
 * Retrieves a single bar order by ID
 * @param id - The UUID of the bar order to retrieve
 * @returns Promise<BarOrder | null> The bar order if found, null if not found
 */
export async function getBarOrder(id: string): Promise<BarOrder | null> {
  try {
    const dto = await http<any>(`/api/BarOrders/${id}`);
    return dto ? normalizeBarOrder(dto) : null;
  } catch (err: any) {
    if (err?.status === 404) return null;
    throw err;
  }
}

/**
 * Creates a new bar order
 * @param input - The bar order data (transactionId)
 * @returns Promise<BarOrder> The created bar order
 */
export async function createBarOrder(input: BarOrderRequestDto): Promise<BarOrder> {
  const dto = await http<any>(`/api/BarOrders`, {
    method: "POST",
    body: JSON.stringify(input),
  });
  return normalizeBarOrder(dto);
}

/**
 * Updates an existing bar order
 * @param id - The UUID of the bar order to update
 * @param input - The updated bar order data
 * @returns Promise<BarOrder> The updated bar order
 */
export async function updateBarOrder(id: string, input: BarOrderRequestDto): Promise<BarOrder> {
  const dto = await http<any>(`/api/BarOrders/${id}`, {
    method: "PUT",
    body: JSON.stringify(input),
  });
  return normalizeBarOrder(dto);
}

/**
 * Deletes a bar order
 * @param id - The UUID of the bar order to delete
 * @returns Promise<void>
 */
export async function deleteBarOrder(id: string): Promise<void> {
  await http<void>(`/api/BarOrders/${id}`, { method: "DELETE" });
}

/**
 * Retrieves a specific bar order detail item
 * @param orderId - The UUID of the bar order
 * @param barProductId - The UUID of the bar product
 * @returns Promise<BarOrderDetail | null> The order detail if found, null if not found
 */
export async function getBarOrderDetail(
  orderId: string,
  barProductId: string
): Promise<BarOrderDetail | null> {
  try {
    const dto = await http<any>(`/api/BarOrders/${orderId}/details/${barProductId}`);
    return dto ? normalizeBarOrderDetail(dto) : null;
  } catch (err: any) {
    if (err?.status === 404) return null;
    throw err;
  }
}

/**
 * Creates a new detail item for a bar order
 * @param orderId - The UUID of the bar order
 * @param input - The order detail data (barProductId, unitPrice, qty)
 * @returns Promise<BarOrderDetail> The created order detail
 */
export async function createBarOrderDetail(
  orderId: string,
  input: BarOrderDetailCreateRequestDto
): Promise<BarOrderDetail> {
  const dto = await http<any>(`/api/BarOrders/${orderId}/details`, {
    method: "POST",
    body: JSON.stringify(input),
  });
  return normalizeBarOrderDetail(dto);
}

/**
 * Updates an existing bar order detail item
 * @param orderId - The UUID of the bar order
 * @param barProductId - The UUID of the bar product
 * @param input - The updated detail data (unitPrice, qty)
 * @returns Promise<BarOrderDetail> The updated order detail
 */
export async function updateBarOrderDetail(
  orderId: string,
  barProductId: string,
  input: BarOrderDetailUpdateRequestDto
): Promise<BarOrderDetail> {
  const dto = await http<any>(`/api/BarOrders/${orderId}/details/${barProductId}`, {
    method: "PUT",
    body: JSON.stringify(input),
  });
  return normalizeBarOrderDetail(dto);
}

/**
 * Deletes a bar order detail item
 * @param orderId - The UUID of the bar order
 * @param barProductId - The UUID of the bar product
 * @returns Promise<void>
 */
export async function deleteBarOrderDetail(orderId: string, barProductId: string): Promise<void> {
  await http<void>(`/api/BarOrders/${orderId}/details/${barProductId}`, { method: "DELETE" });
}

/**
 * Normalizes backend DTO to frontend BarOrder type
 * Handles both PascalCase (C# style) and camelCase property names
 * @param dto - Raw DTO from backend
 * @returns BarOrder Normalized bar order object
 */
function normalizeBarOrder(dto: any): BarOrder {
  return {
    // TransactionItemDto base fields
    id: dto.id ?? dto.Id,
    createdAt: dto.createdAt ?? dto.CreatedAt,
    total: dto.total ?? dto.Total ?? 0,
    transactionType: dto.transactionType ?? dto.TransactionType,
    transactionId: dto.transactionId ?? dto.TransactionId ?? null,
    // BarOrder-specific fields
    orderDate: dto.orderDate ?? dto.OrderDate,
    details: dto.details?.map(normalizeBarOrderDetail) ?? dto.Details?.map(normalizeBarOrderDetail) ?? [],
  } as BarOrder;
}

/**
 * Normalizes backend DTO to frontend BarOrderDetail type
 * Handles both PascalCase (C# style) and camelCase property names
 * @param dto - Raw DTO from backend
 * @returns BarOrderDetail Normalized bar order detail object
 */
function normalizeBarOrderDetail(dto: any): BarOrderDetail {
  return {
    unitPrice: dto.unitPrice ?? dto.UnitPrice,
    qty: dto.qty ?? dto.Qty,
    barProduct: dto.barProduct ?? dto.BarProduct,
  } as BarOrderDetail;
}

export default {
  listBarOrders,
  getBarOrder,
  createBarOrder,
  updateBarOrder,
  deleteBarOrder,
  getBarOrderDetail,
  createBarOrderDetail,
  updateBarOrderDetail,
  deleteBarOrderDetail,
};
