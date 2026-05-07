import { describe, it, expect } from 'vitest';
import { validateCsvFile, parseCsvText, CsvParseError } from './csv';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFile(name: string, sizeBytes: number): File {
  const content = 'x'.repeat(sizeBytes);
  return new File([content], name, { type: 'text/csv' });
}

const VALID_HEADER = '"ID","Title","URL","Description","Tags","Favicon URL","Thumbnail URL","Created At","Updated At"';

function csvWith(...dataRows: string[]): string {
  return [VALID_HEADER, ...dataRows].join('\n');
}

const ROW_SIMPLE = '"1","My Bookmark","https://example.com","","tag1|tag2","","https://example.com/thumb.jpg","2026-01-01","2026-01-01"';

// ---------------------------------------------------------------------------
// validateCsvFile
// ---------------------------------------------------------------------------

describe('validateCsvFile', () => {
  it('throws for a non-.csv extension', () => {
    const file = new File(['content'], 'bookmarks.txt', { type: 'text/plain' });
    expect(() => validateCsvFile(file)).toThrow(CsvParseError);
    expect(() => validateCsvFile(file)).toThrow('must be a .csv file');
  });

  it('throws for a file exceeding 5 MB', () => {
    const file = makeFile('bookmarks.csv', 5 * 1024 * 1024 + 1);
    expect(() => validateCsvFile(file)).toThrow(CsvParseError);
    expect(() => validateCsvFile(file)).toThrow('too large');
  });

  it('accepts a valid .csv file within size limit', () => {
    const file = makeFile('bookmarks.csv', 100);
    expect(() => validateCsvFile(file)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// parseCsvText — structural errors
// ---------------------------------------------------------------------------

describe('parseCsvText — structural errors', () => {
  it('throws when the Title column is absent from the header', () => {
    const text = '"ID","URL","Tags"\n"1","https://example.com","tag1"';
    expect(() => parseCsvText(text)).toThrow(CsvParseError);
    expect(() => parseCsvText(text)).toThrow('Title');
  });

  it('throws when the URL column is absent from the header', () => {
    const text = '"ID","Title","Tags"\n"1","My Bookmark","tag1"';
    expect(() => parseCsvText(text)).toThrow(CsvParseError);
    expect(() => parseCsvText(text)).toThrow('URL');
  });

  it('throws when there are no data rows after the header', () => {
    expect(() => parseCsvText(VALID_HEADER)).toThrow(CsvParseError);
    expect(() => parseCsvText(VALID_HEADER)).toThrow('No bookmark rows found');
  });

  it('throws when row count exceeds 500', () => {
    const rows = Array.from({ length: 501 }, (_, i) =>
      `"${i}","Title ${i}","https://example.com/${i}","","","","","",""`,
    );
    expect(() => parseCsvText(csvWith(...rows))).toThrow(CsvParseError);
    expect(() => parseCsvText(csvWith(...rows))).toThrow('Too many rows');
  });
});

// ---------------------------------------------------------------------------
// parseCsvText — valid rows
// ---------------------------------------------------------------------------

describe('parseCsvText — valid rows', () => {
  it('returns correctly mapped fields for a well-formed row', () => {
    const result = parseCsvText(csvWith(ROW_SIMPLE));
    expect(result.valid).toHaveLength(1);
    expect(result.valid[0]).toEqual({
      title: 'My Bookmark',
      url: 'https://example.com',
      thumbnailUrl: 'https://example.com/thumb.jpg',
      tags: ['tag1', 'tag2'],
    });
  });

  it('splits pipe-separated tags into an array and trims whitespace', () => {
    const row = '"1","Title","https://example.com","","work | reading | tools","","","",""';
    const result = parseCsvText(csvWith(row));
    expect(result.valid[0].tags).toEqual(['work', 'reading', 'tools']);
  });

  it('returns empty tags array when Tags column is blank', () => {
    const row = '"1","Title","https://example.com","","","","","",""';
    const result = parseCsvText(csvWith(row));
    expect(result.valid[0].tags).toEqual([]);
  });

  it('returns null thumbnailUrl when Thumbnail URL column is blank', () => {
    const row = '"1","Title","https://example.com","","","","","",""';
    const result = parseCsvText(csvWith(row));
    expect(result.valid[0].thumbnailUrl).toBeNull();
  });

  it('ignores extra/unknown columns gracefully', () => {
    const header = '"ID","Title","URL","Extra1","Tags","Extra2","Thumbnail URL","Created At","Updated At"';
    const row = '"1","Title","https://example.com","ignored","tag1","also ignored","https://example.com/t.jpg","",""';
    const result = parseCsvText([header, row].join('\n'));
    expect(result.valid).toHaveLength(1);
    expect(result.valid[0].title).toBe('Title');
    expect(result.valid[0].tags).toEqual(['tag1']);
  });

  it('truncates titles longer than MAX_TITLE_LENGTH (500) to 500 characters', () => {
    const longTitle = 'a'.repeat(600);
    const csv = '"Title","URL"\n"' + longTitle + '","https://example.com"';
    const result = parseCsvText(csv);
    expect(result.valid).toHaveLength(1);
    expect(result.valid[0].title).toHaveLength(500);
  });

  it('truncates URLs longer than MAX_URL_LENGTH (2000) to 2000 characters before validation', () => {
    // Build a 2500-char URL — still a valid http URL after slice to 2000.
    const longUrl = 'https://example.com/' + 'a'.repeat(2480);
    expect(longUrl.length).toBe(2500);
    const csv = '"Title","URL"\n"T","' + longUrl + '"';
    const result = parseCsvText(csv);
    expect(result.valid).toHaveLength(1);
    // The .slice(0, 2000) truncates the URL before parseHttpUrl validates it,
    // so the stored value is exactly 2000 chars and still parses as http.
    expect(result.valid[0].url).toHaveLength(2000);
  });

  it('truncates Thumbnail URLs longer than MAX_URL_LENGTH (2000) to 2000 characters before validation', () => {
    // Same shape as the URL truncation test — the thumbnail field uses the
    // same MAX_URL_LENGTH cap and is sliced before parseHttpUrl. Locks the
    // third slice site in csv.ts:192 (rawThumb) for full parity with importJson.
    const longThumb = 'https://thumb.example.com/' + 'a'.repeat(2474);
    expect(longThumb.length).toBe(2500);
    const csv = '"Title","URL","Thumbnail URL"\n"T","https://example.com","' + longThumb + '"';
    const result = parseCsvText(csv);
    expect(result.valid).toHaveLength(1);
    expect(result.valid[0].thumbnailUrl).not.toBeNull();
    expect(result.valid[0].thumbnailUrl).toHaveLength(2000);
  });
});

// ---------------------------------------------------------------------------
// parseCsvText — per-row skips
// ---------------------------------------------------------------------------

describe('parseCsvText — per-row skips', () => {
  it('skips rows where Title is empty and records the reason', () => {
    const row = '"1","","https://example.com","","","","","",""';
    const result = parseCsvText(csvWith(row));
    expect(result.valid).toHaveLength(0);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0].reason).toMatch(/Title is empty/i);
  });

  it('skips rows where URL is not http or https and records the reason', () => {
    const row = '"1","Title","ftp://example.com","","","","","",""';
    const result = parseCsvText(csvWith(row));
    expect(result.valid).toHaveLength(0);
    expect(result.skipped[0].reason).toMatch(/URL is invalid/i);
  });

  it('skips rows with a completely empty URL', () => {
    const row = '"1","Title","","","","","","",""';
    const result = parseCsvText(csvWith(row));
    expect(result.valid).toHaveLength(0);
    expect(result.skipped[0].reason).toMatch(/URL is invalid/i);
  });

  it('silently drops Thumbnail URL when it is not http/https (row still valid)', () => {
    const row = '"1","Title","https://example.com","","","","ftp://bad","",""';
    const result = parseCsvText(csvWith(row));
    expect(result.valid).toHaveLength(1);
    expect(result.valid[0].thumbnailUrl).toBeNull();
    expect(result.skipped).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// parseCsvText — CSV parser edge cases
// ---------------------------------------------------------------------------

describe('parseCsvText — CSV parser edge cases', () => {
  it('handles quoted fields that contain commas', () => {
    const row = '"1","Title, with comma","https://example.com","","","","","",""';
    const result = parseCsvText(csvWith(row));
    expect(result.valid[0].title).toBe('Title, with comma');
  });

  it('handles escaped double-quotes ("") inside quoted fields', () => {
    const row = '"1","Title with ""quotes""","https://example.com","","","","","",""';
    const result = parseCsvText(csvWith(row));
    expect(result.valid[0].title).toBe('Title with "quotes"');
  });

  it('accepts files with bare \\r line endings (Classic Mac OS style) (CR-026)', () => {
    const text = VALID_HEADER + '\r' + ROW_SIMPLE + '\r';
    const result = parseCsvText(text);
    expect(result.valid).toHaveLength(1);
    expect(result.valid[0].title).toBe('My Bookmark');
  });

  // -------------------------------------------------------------------------
  // Round-trip: strip leading ' on import only when followed by a formula
  // trigger char (=/+/-/@). Mirrors the export-side single-quote prefix.
  // (M-08, conditional strip per code-reviewer gating defect 9)
  // -------------------------------------------------------------------------
  it.each([
    ["'=SUM(1+1)", '=SUM(1+1)'],
    ["'+1+1", '+1+1'],
    ["'-cmd", '-cmd'],
    ["'@evil", '@evil'],
  ])('strips a leading single-quote when followed by formula trigger %s', (input, expected) => {
    const row = `"1","${input}","https://x.com","","","","","",""`;
    const result = parseCsvText(csvWith(row));
    expect(result.valid[0].title).toBe(expected);
  });

  it('does NOT strip a leading apostrophe when the next character is text', () => {
    const row = `"1","'Twas the night","https://x.com","","","","","",""`;
    const result = parseCsvText(csvWith(row));
    expect(result.valid[0].title).toBe("'Twas the night");
  });
});
