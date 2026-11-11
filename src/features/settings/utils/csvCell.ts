/**
 * CSV output uses the existing Tag Audit safety contract: UTF-8 BOM,
 * quoted fields, escaped quotes, CRLF and formula injection protection.
 */
export function csvCell(value: string | number | boolean | null): string {
  let text = String(value ?? '');
  if (/^\s*[=+\-@\t\r]/.test(text)) text = "'" + text;
  return '"' + text.replace(/"/g, '""') + '"';
}
