import { BarProduct } from "./barProduct";
import { TransactionItemDto } from "./transactionItem";

/**
 * Estado de la orden de bar
 */
export type BarOrderStatus = "Pendiente" | "Entregado";

/**
 * Represents a bar order in the system
 * Extends TransactionItemDto with bar order-specific fields
 */
export interface BarOrder extends TransactionItemDto {
  /** Fecha/hora de creación (OrderDate en el backend) */
  orderDate?: string;
  /** Id de la cuenta POS asociada (si aplica) */
  accountId?: string | null;
  /** Estado de preparación/entrega */
  status?: BarOrderStatus;
  /** Detalles de la orden */
  details?: BarOrderDetail[];
}

/**
 * Represents a detail item within a bar order
 */
export interface BarOrderDetail {
  unitPrice: number;
  qty: number;
  barProduct: BarProduct;
}

/**
 * Request DTO for creating a bar order detail
 * All fields are required as per the OpenAPI schema
 */
export interface BarOrderDetailCreateRequestDto {
  barProductId: string;
  unitPrice: number;
  qty: number;
}

/**
 * Request DTO for updating a bar order detail
 * Both fields are optional as per the OpenAPI schema
 */
export interface BarOrderDetailUpdateRequestDto {
  unitPrice?: number;
  qty?: number;
}

/**
 * Request DTO for creating or updating a bar order
 */
export interface BarOrderRequestDto {
  transactionId?: string | null;
}
