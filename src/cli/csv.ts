// Minimal RFC-4180 CSV parser — quoted fields, escaped quotes, CRLF. No dep.

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;

  const pushField = () => {
    row.push(field);
    field = "";
  };
  const pushRow = () => {
    // skip fully-empty trailing rows
    if (row.length > 1 || (row.length === 1 && row[0] !== "")) rows.push(row);
    row = [];
  };

  while (i < text.length) {
    const ch = text[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (ch === ",") {
      pushField();
      i += 1;
      continue;
    }
    if (ch === "\r") {
      i += 1;
      continue;
    }
    if (ch === "\n") {
      pushField();
      pushRow();
      i += 1;
      continue;
    }
    field += ch;
    i += 1;
  }
  if (field !== "" || row.length > 0) {
    pushField();
    pushRow();
  }
  return rows;
}

export interface CsvProspectRow {
  linkedin_url: string;
  company_url?: string;
  name?: string;
  company?: string;
  notes?: string;
}

/**
 * Parse a prospects CSV. Requires a `linkedin_url` column (header row);
 * `company_url`, `name`, `company`, `notes` are optional. Unknown columns
 * are ignored. Throws with a friendly message on a missing header.
 */
export function parseProspectsCsv(text: string): CsvProspectRow[] {
  const rows = parseCsv(text);
  if (rows.length === 0) throw new Error("CSV is empty");
  const header = rows[0]!.map((h) => h.trim().toLowerCase());
  const urlCol = header.indexOf("linkedin_url");
  if (urlCol === -1) {
    throw new Error(
      `CSV must have a "linkedin_url" header column (found: ${header.join(", ") || "none"})`,
    );
  }
  const col = (name: string) => header.indexOf(name);
  const companyUrlCol = col("company_url");
  const nameCol = col("name");
  const companyCol = col("company");
  const notesCol = col("notes");

  const out: CsvProspectRow[] = [];
  for (const r of rows.slice(1)) {
    const linkedin_url = r[urlCol]?.trim();
    if (!linkedin_url) continue;
    const get = (idx: number) => (idx === -1 ? undefined : r[idx]?.trim() || undefined);
    out.push({
      linkedin_url,
      company_url: get(companyUrlCol),
      name: get(nameCol),
      company: get(companyCol),
      notes: get(notesCol),
    });
  }
  return out;
}
