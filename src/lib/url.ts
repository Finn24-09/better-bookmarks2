/**
 * Strict http/https URL validator.
 *
 * Returns the original string if `raw` parses as a URL with protocol
 * `http:` or `https:`; otherwise returns `null`. Used by both the CSV
 * importer and the JSON importer to gate user-supplied URLs at the entry
 * boundary; the rest of the app trusts that bookmark URLs already passed
 * through this filter.
 *
 * (Extracted from csv.ts and importJson.ts to remove duplication — CR-054.)
 */
export function parseHttpUrl(raw: string): string | null {
  if (!raw) return null;
  try {
    const u = new URL(raw);
    return u.protocol === 'http:' || u.protocol === 'https:' ? raw : null;
  } catch {
    return null;
  }
}
