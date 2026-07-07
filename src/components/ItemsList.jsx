"use client";

// Shared quotation item list. Rendered as a <table> on purpose: browsers copy
// table cells tab-separated and rows newline-separated, so selecting + copying
// this list yields a clean "Item name<TAB>Qty" per line that pastes straight
// into Excel / Sheets / WhatsApp. Quantity is a plain number (no "×") for the
// same reason. Used everywhere an item list is shown so the copy format is
// identical across the app.
export default function ItemsList({
  items,
  nameKey = "item_name",
  countKey = "item_count",
  className = "",
}) {
  if (!items || items.length === 0) return null;
  return (
    <table className={`w-full text-sm ${className}`}>
      <tbody className="divide-y divide-slate-100">
        {items.map((it, i) => (
          <tr key={i}>
            <td className="py-2 pr-4 capitalize text-slate-700">{it[nameKey] || "—"}</td>
            <td className="w-16 py-2 text-right font-semibold tabular-nums text-slate-700">
              {it[countKey] ?? "—"}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
