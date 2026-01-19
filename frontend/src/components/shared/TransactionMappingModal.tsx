"use client";

import { useState, useEffect, useMemo } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Client } from "@/types/client";
import { Transaction } from "@/types/transaction";
import { createTransaction, getTransaction } from "@/lib/apiv2/transactions";
import ClientSelector from "./ClientSelector";
import { isUUID } from "@/lib/utils/validation";
import { debounce } from "@/lib/utils/debounce";
import Swal from "sweetalert2";
import { toast } from "@/lib/ui/swal";

interface TransactionMappingModalProps {
  open: boolean;
  onClose: () => void;
  onTransactionSelected: (transactionId: string) => void;
  currentTransactionId?: string | null;
}

const createSchema = z.object({
  clientId: z.string().uuid("Selecciona un cliente válido"),
});

const linkSchema = z.object({
  transactionId: z.string().min(1, "Ingresa un ID de transacción"),
});

type CreateFormValues = z.infer<typeof createSchema>;
type LinkFormValues = z.infer<typeof linkSchema>;

export default function TransactionMappingModal({
  open,
  onClose,
  onTransactionSelected,
  currentTransactionId,
}: TransactionMappingModalProps) {
  const [activeTab, setActiveTab] = useState<"create" | "link">("create");
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);

  // Link tab state
  const [transactionIdInput, setTransactionIdInput] = useState("");
  const [validating, setValidating] = useState(false);
  const [validationResult, setValidationResult] = useState<{
    valid: boolean;
    transaction?: Transaction;
  } | null>(null);

  // Create form
  const createForm = useForm<CreateFormValues>({
    resolver: zodResolver(createSchema),
    defaultValues: {
      clientId: "",
    },
  });

  // Link form
  const linkForm = useForm<LinkFormValues>({
    resolver: zodResolver(linkSchema),
    defaultValues: {
      transactionId: "",
    },
  });

  // Reset forms when modal opens/closes
  useEffect(() => {
    if (open) {
      setActiveTab("create");
      createForm.reset();
      linkForm.reset();
      setSelectedClient(null);
      setTransactionIdInput("");
      setValidationResult(null);
    }
  }, [open]);

  // Real-time validation for transaction ID
  const validateTransactionId = useMemo(
    () =>
      debounce(async (id: string) => {
        if (!id) {
          setValidationResult(null);
          return;
        }

        if (!isUUID(id)) {
          setValidationResult({ valid: false });
          return;
        }

        setValidating(true);
        try {
          const transaction = await getTransaction(id);
          if (transaction) {
            setValidationResult({ valid: true, transaction });
          } else {
            setValidationResult({ valid: false });
          }
        } catch (error) {
          setValidationResult({ valid: false });
        } finally {
          setValidating(false);
        }
      }, 300),
    []
  );

  useEffect(() => {
    if (activeTab === "link") {
      validateTransactionId(transactionIdInput);
    }
  }, [transactionIdInput, activeTab, validateTransactionId]);

  // Handle create new transaction
  const handleCreateTransaction = async (data: CreateFormValues) => {
    try {
      Swal.showLoading();
      const transaction = await createTransaction({ clientId: data.clientId });

      await Swal.fire({
        icon: "success",
        title: "Transacción creada",
        text: `ID: ${transaction.id}`,
        timer: 2000,
        showConfirmButton: false,
      });

      onTransactionSelected(transaction.id);
      onClose();
    } catch (error: any) {
      await Swal.fire({
        icon: "error",
        title: "Error",
        text: error?.message ?? "No se pudo crear la transacción",
      });
    }
  };

  // Handle link existing transaction
  const handleLinkTransaction = async (data: LinkFormValues) => {
    if (!validationResult?.valid) {
      await Swal.fire({
        icon: "error",
        title: "ID inválido",
        text: "El ID de transacción no es válido o no existe",
      });
      return;
    }

    onTransactionSelected(data.transactionId);
    toast("success", "Transacción vinculada");
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Mapear Transacción</DialogTitle>
          <DialogDescription>
            Crea una nueva transacción o vincula una existente
          </DialogDescription>
        </DialogHeader>

        {/* Tabs */}
        <div className="flex gap-2 border-b border-neutral-200 mb-4">
          <button
            type="button"
            onClick={() => setActiveTab("create")}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === "create"
                ? "border-blue-600 text-blue-600"
                : "border-transparent text-neutral-600 hover:text-neutral-900"
            }`}
          >
            Crear Nueva
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("link")}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === "link"
                ? "border-blue-600 text-blue-600"
                : "border-transparent text-neutral-600 hover:text-neutral-900"
            }`}
          >
            Vincular Existente
          </button>
        </div>

        {/* Create Tab */}
        {activeTab === "create" && (
          <form
            onSubmit={createForm.handleSubmit(handleCreateTransaction)}
            className="space-y-4"
          >
            <div>
              <ClientSelector
                value={selectedClient?.id || ""}
                onChange={(clientId, client) => {
                  setSelectedClient(client);
                  createForm.setValue("clientId", clientId);
                  createForm.clearErrors("clientId");
                }}
                error={createForm.formState.errors.clientId?.message}
                label="Seleccionar Cliente"
                placeholder="Buscar cliente..."
              />
            </div>

            {selectedClient && (
              <div className="rounded-lg bg-blue-50 border border-blue-200 p-3 text-sm">
                <p className="font-medium text-blue-900">{selectedClient.name}</p>
                <p className="text-blue-700 text-xs">
                  Cédula: {selectedClient.nationalId}
                </p>
              </div>
            )}

            <div className="flex gap-3 pt-2">
              <button
                type="submit"
                disabled={createForm.formState.isSubmitting}
                className="flex-1 rounded-full px-5 py-2.5 bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 shadow-sm"
              >
                {createForm.formState.isSubmitting
                  ? "Creando..."
                  : "Crear Transacción"}
              </button>
              <button
                type="button"
                onClick={onClose}
                className="px-5 py-2.5 rounded-full border border-neutral-300 bg-white hover:bg-neutral-50"
              >
                Cancelar
              </button>
            </div>
          </form>
        )}

        {/* Link Tab */}
        {activeTab === "link" && (
          <form
            onSubmit={linkForm.handleSubmit(handleLinkTransaction)}
            className="space-y-4"
          >
            <div>
              <label className="block text-sm font-medium mb-1">
                ID de Transacción
              </label>
              <div className="relative">
                <input
                  type="text"
                  className={`w-full rounded-2xl border ${
                    linkForm.formState.errors.transactionId
                      ? "border-red-500"
                      : "border-neutral-300"
                  } bg-white px-4 py-3 pr-10 outline-none focus:ring-2 focus:ring-blue-500`}
                  placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                  {...linkForm.register("transactionId")}
                  onChange={(e) => {
                    linkForm.setValue("transactionId", e.target.value);
                    setTransactionIdInput(e.target.value);
                  }}
                />

                {/* Validation indicator */}
                <div className="absolute right-3 top-1/2 -translate-y-1/2">
                  {validating && (
                    <div className="w-5 h-5 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
                  )}
                  {!validating && validationResult?.valid && (
                    <span className="text-emerald-600 text-xl">✓</span>
                  )}
                  {!validating &&
                    validationResult !== null &&
                    !validationResult.valid &&
                    transactionIdInput && (
                      <span className="text-red-600 text-xl">✗</span>
                    )}
                </div>
              </div>
              {linkForm.formState.errors.transactionId && (
                <p className="text-sm text-red-600 mt-1">
                  {linkForm.formState.errors.transactionId.message}
                </p>
              )}
            </div>

            {/* Transaction details when valid */}
            {validationResult?.valid && validationResult.transaction && (
              <div className="rounded-lg bg-emerald-50 border border-emerald-200 p-3 text-sm space-y-1">
                <p className="font-medium text-emerald-900">
                  Transacción válida
                </p>
                <p className="text-emerald-700 text-xs">
                  Cliente: {validationResult.transaction.client?.name || "N/A"}
                </p>
                <p className="text-emerald-700 text-xs">
                  Fecha:{" "}
                  {validationResult.transaction.openedAt
                    ? new Date(
                        validationResult.transaction.openedAt
                      ).toLocaleDateString("es-EC")
                    : "N/A"}
                </p>
              </div>
            )}

            {/* Invalid message */}
            {!validating &&
              validationResult !== null &&
              !validationResult.valid &&
              transactionIdInput && (
                <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm">
                  <p className="font-medium text-red-900">
                    ID de transacción inválido o no existe
                  </p>
                </div>
              )}

            <div className="flex gap-3 pt-2">
              <button
                type="submit"
                disabled={
                  linkForm.formState.isSubmitting ||
                  !validationResult?.valid ||
                  validating
                }
                className="flex-1 rounded-full px-5 py-2.5 bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 shadow-sm"
              >
                {linkForm.formState.isSubmitting
                  ? "Vinculando..."
                  : "Vincular Transacción"}
              </button>
              <button
                type="button"
                onClick={onClose}
                className="px-5 py-2.5 rounded-full border border-neutral-300 bg-white hover:bg-neutral-50"
              >
                Cancelar
              </button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
