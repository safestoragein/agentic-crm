// Client-side "Export to Excel" — builds a UTF-8 CSV (with BOM so Excel renders
// ₹ and other unicode correctly) from the rows currently on screen and triggers
// a download. CSV opens directly in Excel with no extra dependency.
//
// columns: [{ header: "Name", value: (row) => row.name }]
// rows:    array of objects (already filtered/sorted by the page)

function csvCell(v) {
  if (v == null) return "";
  let s = String(v);
  // Strip newlines so a note doesn't break the row; Excel-escape quotes.
  s = s.replace(/\r?\n/g, " ").trim();
  if (/[",;]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function exportToExcel(filename, columns, rows) {
  const cols = columns.filter(Boolean);
  const header = cols.map((c) => csvCell(c.header)).join(",");
  const body = (rows || [])
    .map((r) => cols.map((c) => csvCell(typeof c.value === "function" ? c.value(r) : r[c.value])).join(","))
    .join("\n");
  const csv = `﻿${header}\n${body}`; // BOM + rows

  const stamp = ymdStamp();
  const name = `${filename}-${stamp}.csv`;
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function ymdStamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
