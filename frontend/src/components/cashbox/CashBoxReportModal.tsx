"use client";

import React from "react";

export function CashboxReportModal({
  open,
  title,
  html,
  onClose,
}: {
  open: boolean;
  title: string;
  html: string;
  onClose: () => void;
}) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <div className="w-full max-w-5xl h-[85vh] rounded-2xl bg-white shadow-xl border overflow-hidden flex flex-col">
        <div className="p-4 border-b flex items-center justify-between gap-2">
          <div className="font-semibold">{title}</div>
          <div className="flex gap-2">
            <button className="px-3 py-2 rounded-xl border" onClick={onClose}>
              Cerrar
            </button>
          </div>
        </div>

        <div className="flex-1 bg-slate-50">
          <iframe
            title="cashbox-report"
            className="w-full h-full"
            sandbox="allow-same-origin allow-modals allow-popups allow-downloads allow-forms allow-scripts"
            srcDoc={html}
          />
        </div>
      </div>
    </div>
  );
}
