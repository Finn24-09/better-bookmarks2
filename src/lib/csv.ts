// =============================================================================
// CSV import parser — RFC 4180 compliant, no external dependencies.
//
// Security posture:
//  - All parsing is purely client-side string manipulation; no eval.
//  - File extension and size are validated before reading bytes.
//  - Every URL is validated with the URL constructor (http/https only).
//  - Row and file-size limits prevent memory exhaustion.
// =============================================================================

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB
const MAX_ROWS = 500;

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export class CsvParseError extends Error {
  name = 'CsvParseError';
  constructor(message: string) {
    super(message);
  }
}

export interface ParsedCsvRow {
  title: string;
  url: string;
  thumbnailUrl: string | null;
  tags: string[];
}

export interface CsvParseResult {
  valid: ParsedCsvRow[];
  skipped: Array<{ rowNumber: number; reason: string }>;
}

// ---------------------------------------------------------------------------
// File-level validation (call before FileReader)
// ---------------------------------------------------------------------------

export function validateCsvFile(file: File): void {
  if (!file.name.toLowerCase().endsWith('.csv')) {
    throw new CsvParseError('The file must be a .csv file.');
  }
  if (file.size > MAX_FILE_SIZE) {
    throw new CsvParseError('File is too large (max 5 MB).');
  }
}

// ---------------------------------------------------------------------------
// RFC 4180 character-by-character CSV tokeniser
// ---------------------------------------------------------------------------

function tokeniseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = 0;

  while (i < text.length) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          // Escaped quote inside a quoted field
          field += '"';
          i += 2;
        } else {
          inQuotes = false;
          i++;
        }
      } else {
        field += ch;
        i++;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
        i++;
      } else if (ch === ',') {
        row.push(field.trim());
        field = '';
        i++;
      } else if (ch === '\r' && text[i + 1] === '\n') {
        row.push(field.trim());
        if (row.some((f) => f !== '')) rows.push(row);
        row = [];
        field = '';
        i += 2;
      } else if (ch === '\n') {
        row.push(field.trim());
        if (row.some((f) => f !== '')) rows.push(row);
        row = [];
        field = '';
        i++;
      } else {
        field += ch;
        i++;
      }
    }
  }

  // Flush the last field / row
  row.push(field.trim());
  if (row.some((f) => f !== '')) rows.push(row);

  return rows;
}

// ---------------------------------------------------------------------------
// URL helper — returns null for anything that isn't http/https
// ---------------------------------------------------------------------------

function parseHttpUrl(raw: string): string | null {
  if (!raw) return null;
  try {
    const u = new URL(raw);
    return u.protocol === 'http:' || u.protocol === 'https:' ? raw : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Main parse + validate function
// ---------------------------------------------------------------------------

export function parseCsvText(text: string): CsvParseResult {
  const rows = tokeniseCsv(text);
  if (rows.length === 0) {
    throw new CsvParseError('No bookmark rows found.');
  }

  // ---- Header analysis ----
  const header = rows[0].map((h) => h.toLowerCase());

  const titleIdx = header.indexOf('title');
  const urlIdx = header.indexOf('url');
  const tagsIdx = header.indexOf('tags');
  const thumbIdx = header.indexOf('thumbnail url');

  const missing: string[] = [];
  if (titleIdx === -1) missing.push('Title');
  if (urlIdx === -1) missing.push('URL');
  if (missing.length > 0) {
    throw new CsvParseError(`Missing required columns: ${missing.join(', ')}`);
  }

  const dataRows = rows.slice(1);

  if (dataRows.length === 0) {
    throw new CsvParseError('No bookmark rows found.');
  }
  if (dataRows.length > MAX_ROWS) {
    throw new CsvParseError(`Too many rows — maximum ${MAX_ROWS} per import.`);
  }

  // ---- Row-level validation ----
  const valid: ParsedCsvRow[] = [];
  const skipped: CsvParseResult['skipped'] = [];

  dataRows.forEach((cols, idx) => {
    const rowNumber = idx + 2; // 1-based, accounting for header

    const title = cols[titleIdx] ?? '';
    const url = cols[urlIdx] ?? '';

    if (!title) {
      skipped.push({ rowNumber, reason: `Row ${rowNumber}: Title is empty` });
      return;
    }

    const validUrl = parseHttpUrl(url);
    if (!validUrl) {
      skipped.push({ rowNumber, reason: `Row ${rowNumber}: URL is invalid (must start with http:// or https://)` });
      return;
    }

    // Tags: split on |, trim each, drop empties, truncate at 100 chars
    const rawTags = tagsIdx !== -1 ? (cols[tagsIdx] ?? '') : '';
    const tags = rawTags
      .split('|')
      .map((t) => t.trim().slice(0, 100))
      .filter((t) => t.length > 0);

    // Thumbnail URL: silently drop if not http/https
    const rawThumb = thumbIdx !== -1 ? (cols[thumbIdx] ?? '') : '';
    const thumbnailUrl = parseHttpUrl(rawThumb);

    valid.push({ title, url: validUrl, thumbnailUrl, tags });
  });

  return { valid, skipped };
}
