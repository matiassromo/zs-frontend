// app/bar/page.tsx  (o src/app/bar/page.tsx)
"use client";

import { useEffect, useState } from "react";
import type { BarProduct } from "@/types/barProduct";
import type { BarOrder, BarOrderDetail } from "@/types/barOrder";

import {
  listBarProducts,
  createBarProduct,
  updateBarProduct,
} from "@/lib/apiv2/barProducts";
import {
  createBarOrder,
  getBarOrder,
  updateBarOrder,
  createBarOrderDetail,
  listBarOrders,
} from "@/lib/apiv2/barOrders";
import TransactionMappingModal from "@/components/shared/TransactionMappingModal";
import { toast } from "@/lib/ui/swal";

export default function BarPage() {
  const [products, setProducts] = useState<BarProduct[]>([]);
  const [loadingProducts, setLoadingProducts] = useState(true);

  const [newName, setNewName] = useState("");
  const [newQty, setNewQty] = useState<number>(0);
  const [newPrice, setNewPrice] = useState<number>(0);

  const [currentOrder, setCurrentOrder] = useState<BarOrder | null>(null);
  const [selectedProductId, setSelectedProductId] = useState<string>("");
  const [detailQty, setDetailQty] = useState<number>(1);
  const [showTransactionModal, setShowTransactionModal] = useState(false);

  const [orders, setOrders] = useState<BarOrder[]>([]);
  const [loadingOrders, setLoadingOrders] = useState(true);

  // Cargar productos y órdenes al entrar
  useEffect(() => {
    loadProducts();
    loadOrders();
  }, []);

  async function loadProducts() {
    setLoadingProducts(true);
    try {
      const data = await listBarProducts();
      setProducts(data);
    } finally {
      setLoadingProducts(false);
    }
  }

  async function loadOrders() {
    setLoadingOrders(true);
    try {
      const data = await listBarOrders();
      setOrders(data);
    } finally {
      setLoadingOrders(false);
    }
  }

  // Crear producto nuevo
  async function handleCreateProduct(e: React.FormEvent) {
    e.preventDefault();
    if (!newName || newQty <= 0 || newPrice <= 0) return;

    const created = await createBarProduct({
      name: newName,
      qty: newQty,
      unitPrice: newPrice,
    });

    setProducts((prev) => [...prev, created]);
    setNewName("");
    setNewQty(0);
    setNewPrice(0);
  }

  // Ajustar stock de producto
  async function handleAdjustStock(product: BarProduct, delta: number) {
    const newQty = product.qty + delta;
    if (newQty < 0) {
      toast("error", "El stock no puede ser negativo");
      return;
    }

    try {
      const updated = await updateBarProduct(product.id, {
        name: product.name,
        qty: newQty,
        unitPrice: product.unitPrice,
      });
      setProducts((prev) =>
        prev.map((p) => (p.id === product.id ? updated : p))
      );
      toast("success", `Stock actualizado: ${product.name} → ${newQty}`);
    } catch (error: any) {
      toast("error", error?.message ?? "No se pudo actualizar el stock");
    }
  }

  // Crear nueva orden vacía
  async function handleNewOrder() {
    const order = await createBarOrder({});
    const full = await getBarOrder(order.id);
    setCurrentOrder(full ?? order);
    setSelectedProductId("");
    setDetailQty(1);
    await loadOrders();
  }

  // Agregar producto a la orden actual
  async function handleAddDetail(e: React.FormEvent) {
    e.preventDefault();
    if (!currentOrder) return;
    if (!selectedProductId || detailQty <= 0) return;

    const product = products.find((p) => p.id === selectedProductId);
    if (!product) return;

    await createBarOrderDetail(currentOrder.id, {
      barProductId: product.id,
      unitPrice: product.unitPrice,
      qty: detailQty,
    });

    const updated = await getBarOrder(currentOrder.id);
    if (updated) setCurrentOrder(updated);
    setDetailQty(1);
    await loadOrders();
  }

  // Mapear transacción a la orden actual
  async function handleTransactionSelected(transactionId: string) {
    if (!currentOrder) return;

    try {
      await updateBarOrder(currentOrder.id, { transactionId });
      const updated = await getBarOrder(currentOrder.id);
      if (updated) setCurrentOrder(updated);
      toast("success", "Transacción vinculada a la orden");
      await loadOrders();
    } catch (error: any) {
      toast("error", error?.message ?? "No se pudo vincular la transacción");
    }
  }

  const orderDetails: BarOrderDetail[] = currentOrder?.details ?? [];
  const orderTotal = orderDetails.reduce(
    (acc, d) => acc + d.unitPrice * d.qty,
    0
  );

  return (
    <div className="p-8 space-y-8">
      {/* ==================== PRODUCTOS ==================== */}
      <section className="bg-white rounded-xl shadow p-6 space-y-4">
        <h2 className="text-lg font-semibold">Productos (alimentos/bebidas)</h2>

        <form
          onSubmit={handleCreateProduct}
          className="grid grid-cols-4 gap-4 items-end"
        >
          <div className="col-span-2">
            <label className="block text-sm font-medium mb-1">Nombre</label>
            <input
              className="w-full border rounded-lg px-3 py-2 text-sm"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Hamburguesa, cerveza, pizza..."
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Stock</label>
            <input
              type="number"
              className="w-full border rounded-lg px-3 py-2 text-sm"
              value={newQty}
              onChange={(e) => setNewQty(Number(e.target.value))}
              min={0}
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">
              Precio unitario
            </label>
            <input
              type="number"
              className="w-full border rounded-lg px-3 py-2 text-sm"
              value={newPrice}
              onChange={(e) => setNewPrice(Number(e.target.value))}
              min={0}
              step="0.01"
            />
          </div>
          <div className="col-span-4 flex justify-end">
            <button
              type="submit"
              className="px-4 py-2 rounded-full text-sm font-medium bg-black text-white"
            >
              Guardar producto
            </button>
          </div>
        </form>

        <div className="border rounded-lg mt-4">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="text-left px-3 py-2">Nombre</th>
                <th className="text-right px-3 py-2">Stock</th>
                <th className="text-right px-3 py-2">Precio</th>
                <th className="text-center px-3 py-2">Ajustar Stock</th>
              </tr>
            </thead>
            <tbody>
              {loadingProducts && (
                <tr>
                  <td className="px-3 py-2 text-center" colSpan={4}>
                    Cargando productos...
                  </td>
                </tr>
              )}
              {!loadingProducts && products.length === 0 && (
                <tr>
                  <td className="px-3 py-2 text-center" colSpan={4}>
                    No hay productos. Crea el primero arriba.
                  </td>
                </tr>
              )}
              {products.map((p) => (
                <tr key={p.id} className="border-t">
                  <td className="px-3 py-2">{p.name}</td>
                  <td className="px-3 py-2 text-right">{p.qty}</td>
                  <td className="px-3 py-2 text-right">
                    ${p.unitPrice.toFixed(2)}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center justify-center gap-1">
                      <button
                        type="button"
                        onClick={() => handleAdjustStock(p, -1)}
                        className="px-2 py-1 text-xs font-medium rounded bg-red-100 text-red-700 hover:bg-red-200"
                        title="Disminuir 1"
                      >
                        -1
                      </button>
                      <button
                        type="button"
                        onClick={() => handleAdjustStock(p, 1)}
                        className="px-2 py-1 text-xs font-medium rounded bg-emerald-100 text-emerald-700 hover:bg-emerald-200"
                        title="Aumentar 1"
                      >
                        +1
                      </button>
                      <button
                        type="button"
                        onClick={() => handleAdjustStock(p, 5)}
                        className="px-2 py-1 text-xs font-medium rounded bg-emerald-100 text-emerald-700 hover:bg-emerald-200"
                        title="Aumentar 5"
                      >
                        +5
                      </button>
                      <button
                        type="button"
                        onClick={() => handleAdjustStock(p, 10)}
                        className="px-2 py-1 text-xs font-medium rounded bg-emerald-100 text-emerald-700 hover:bg-emerald-200"
                        title="Aumentar 10"
                      >
                        +10
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* ==================== ORDEN ACTUAL ==================== */}
      <section className="bg-white rounded-xl shadow p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Orden actual</h2>
          <button
            type="button"
            onClick={handleNewOrder}
            className="px-4 py-2 rounded-full text-sm font-medium bg-black text-white"
          >
            Nueva orden
          </button>
        </div>

        {!currentOrder && (
          <p className="text-sm text-gray-500">
            No hay orden activa. Crea una nueva orden para empezar a agregar
            productos.
          </p>
        )}

        {currentOrder && (
          <>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">
                  Orden: <span className="font-mono">{currentOrder.id}</span>
                </p>
                {currentOrder.transactionId && (
                  <p className="text-xs text-emerald-600 mt-1">
                    ✓ Transacción: <span className="font-mono">{currentOrder.transactionId.substring(0, 8)}...</span>
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={() => setShowTransactionModal(true)}
                className="px-4 py-2 rounded-full text-sm font-medium bg-blue-600 text-white hover:bg-blue-700"
              >
                {currentOrder.transactionId ? "Cambiar Transacción" : "Mapear Transacción"}
              </button>
            </div>

            {/* Agregar detalle */}
            <form
              onSubmit={handleAddDetail}
              className="grid grid-cols-3 gap-4 items-end"
            >
              <div className="col-span-2">
                <label className="block text-sm font-medium mb-1">
                  Producto
                </label>
                <select
                  className="w-full border rounded-lg px-3 py-2 text-sm"
                  value={selectedProductId}
                  onChange={(e) => setSelectedProductId(e.target.value)}
                >
                  <option value="">Selecciona un producto</option>
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} – ${p.unitPrice.toFixed(2)}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">
                  Cantidad
                </label>
                <input
                  type="number"
                  className="w-full border rounded-lg px-3 py-2 text-sm"
                  value={detailQty}
                  min={1}
                  onChange={(e) => setDetailQty(Number(e.target.value))}
                />
              </div>
              <div className="col-span-3 flex justify-end">
                <button
                  type="submit"
                  className="px-4 py-2 rounded-full text-sm font-medium bg-black text-white"
                >
                  Agregar a la orden
                </button>
              </div>
            </form>

            {/* Detalles de la orden */}
            <div className="border rounded-lg mt-4">
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="text-left px-3 py-2">Producto</th>
                    <th className="text-right px-3 py-2">Cant.</th>
                    <th className="text-right px-3 py-2">P. Unitario</th>
                    <th className="text-right px-3 py-2">Subtotal</th>
                  </tr>
                </thead>
                <tbody>
                  {orderDetails.length === 0 && (
                    <tr>
                      <td className="px-3 py-2 text-center" colSpan={4}>
                        La orden está vacía.
                      </td>
                    </tr>
                  )}
                  {orderDetails.map((d, idx) => (
                    <tr key={idx} className="border-t">
                      <td className="px-3 py-2">
                        {d.barProduct?.name ?? "Producto"}
                      </td>
                      <td className="px-3 py-2 text-right">{d.qty}</td>
                      <td className="px-3 py-2 text-right">
                        ${d.unitPrice.toFixed(2)}
                      </td>
                      <td className="px-3 py-2 text-right">
                        ${(d.unitPrice * d.qty).toFixed(2)}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-gray-50">
                  <tr>
                    <td className="px-3 py-2 font-semibold" colSpan={3}>
                      Total
                    </td>
                    <td className="px-3 py-2 text-right font-semibold">
                      ${orderTotal.toFixed(2)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </>
        )}
      </section>

      {/* ==================== ÓRDENES REGISTRADAS ==================== */}
      <section className="bg-white rounded-xl shadow p-6 space-y-4">
        <h2 className="text-lg font-semibold">Órdenes registradas</h2>

        {loadingOrders ? (
          <p className="text-sm text-gray-500">Cargando órdenes...</p>
        ) : orders.length === 0 ? (
          <p className="text-sm text-gray-500">No hay órdenes registradas.</p>
        ) : (
          <div className="border rounded-lg overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="text-left px-3 py-2">Fecha</th>
                  <th className="text-left px-3 py-2">ID Orden</th>
                  <th className="text-left px-3 py-2">Cliente</th>
                  <th className="text-left px-3 py-2">Productos</th>
                  <th className="text-right px-3 py-2">Total</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((o) => {
                  const total =
                    o.total ??
                    (o.details ?? []).reduce(
                      (acc, d) => acc + d.unitPrice * d.qty,
                      0
                    );

                  const date =
                    (o as any).orderDate ??
                    (o as any).OrderDate ??
                    null;

                  const clientName =
                    (o as any).clientName ??
                    (o as any).ClientName ??
                    (o as any).customerName ??
                    (o as any).CustomerName ??
                    "-";

                  const productsSummary =
                    (o.details ?? []).length === 0
                      ? "-"
                      : (o.details ?? [])
                          .map(
                            (d) =>
                              `${d.barProduct?.name ?? "Producto"} x${
                                d.qty
                              }`
                          )
                          .join(", ");

                  return (
                    <tr key={o.id} className="border-t">
                      <td className="px-3 py-2">
                        {date
                          ? new Date(date).toLocaleString("es-EC")
                          : "-"}
                      </td>
                      <td className="px-3 py-2 font-mono text-xs">
                        {o.id}
                      </td>
                      <td className="px-3 py-2">{clientName}</td>
                      <td className="px-3 py-2">{productsSummary}</td>
                      <td className="px-3 py-2 text-right font-medium">
                        ${total.toFixed(2)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Transaction Mapping Modal */}
      <TransactionMappingModal
        open={showTransactionModal}
        onClose={() => setShowTransactionModal(false)}
        onTransactionSelected={handleTransactionSelected}
        currentTransactionId={currentOrder?.transactionId}
      />
    </div>
  );
}
