"use client";

import { useState } from "react";
import { Download, Loader2 } from "lucide-react";
import { exportToExcel } from "@/lib/exportExcel";

// Reusable "Export to Excel" button. Pass the filename base, the column spec and
// the rows currently on screen (already filtered/sorted by the page):
//   <ExportButton filename="quotations" columns={COLS} rows={filtered} />
//
// For server-paginated lists where `rows` is only the current page, pass an async
// `getRows` that fetches the FULL filtered set; it's called on click (with a
// spinner) and its result is exported instead of `rows`.
export default function ExportButton({ filename, columns, rows, getRows, disabled, className = "" }) {
  const [busy, setBusy] = useState(false);
  const staticCount = rows?.length || 0;

  const handleClick = async () => {
    let data = rows || [];
    if (getRows) {
      setBusy(true);
      try {
        data = (await getRows()) || [];
      } catch {
        data = rows || [];
      } finally {
        setBusy(false);
      }
    }
    exportToExcel(filename, columns, data);
  };

  const isDisabled = disabled || busy || (!getRows && staticCount === 0);

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={isDisabled}
      title={getRows ? "Export all matching rows to Excel" : staticCount ? `Export ${staticCount} row${staticCount === 1 ? "" : "s"} to Excel` : "Nothing to export"}
      className={`inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-white px-3 py-2 text-sm font-semibold text-emerald-700 transition-colors hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-50 ${className}`}
    >
      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} Export Excel
    </button>
  );
}
