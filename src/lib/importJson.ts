// =============================================================================
// JSON import parser — validates and normalises Better Bookmarks export files.
//
// Security posture:
//  - JSON.parse only; no eval, no Function constructor.
//  - File extension and size are validated before reading bytes.
//  - Every URL is validated with the URL constructor (http/https only).
//  - Thumbnail data URIs must carry a JPEG magic-byte prefix after decoding.
//  - Field lengths are capped to prevent memory and storage abuse.
//  - Bookmark count is capped at MAX_BOOKMARKS.
// =============================================================================

import { parseHttpUrl } from './url';
import { MAX_TAG_LENGTH } from './tags';

const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100 MB — large enough for full thumbnail export
const MAX_BOOKMARKS = 5000;
const MAX_TITLE_LENGTH = 500;
const MAX_URL_LENGTH = 2000;
const MAX_TAGS_PER_BOOKMARK = 50;
const MAX_THUMBNAIL_BYTES = 5 * 1024 * 1024; // 5 MB decoded
const JPEG_DATA_URI_PREFIX = 'data:image/jpeg;base64,';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export class JsonImportError extends Error {
  name = 'JsonImportError';
  constructor(message: string) {
    super(message);
  }
}

export interface ParsedJsonBookmark {
  title: string;
  url: string;
  tags: string[];
  /** Direct URL thumbnail — passed through as thumbnailUrl on the bookmark. */
  thumbnailUrl: string | null;
  /** Decoded JPEG bytes from an embedded data URI. Encrypt + upload on import. */
  thumbnailData: Uint8Array<ArrayBuffer> | null;
  thumbnailOriginalName: string | null;
}

export interface JsonParseResult {
  valid: ParsedJsonBookmark[];
  skipped: Array<{ index: number; reason: string }>;
}

// ---------------------------------------------------------------------------
// File-level validation (call before reading file text)
// ---------------------------------------------------------------------------

export function validateJsonFile(file: File): void {
  if (!file.name.toLowerCase().endsWith('.json')) {
    throw new JsonImportError('The file must be a .json file.');
  }
  if (file.size > MAX_FILE_SIZE) {
    throw new JsonImportError('File is too large (max 100 MB).');
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function hasJpegMagic(bytes: Uint8Array): boolean {
  return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

function parseThumbnail(thumb: unknown): Pick<ParsedJsonBookmark, 'thumbnailUrl' | 'thumbnailData' | 'thumbnailOriginalName'> {
  const none = { thumbnailUrl: null, thumbnailData: null, thumbnailOriginalName: null };

  if (thumb === null || typeof thumb !== 'object' || Array.isArray(thumb)) return none;

  const obj = thumb as Record<string, unknown>;

  if (obj['type'] === 'url') {
    if (typeof obj['value'] !== 'string') return none;
    const url = parseHttpUrl(obj['value'].slice(0, MAX_URL_LENGTH));
    return { thumbnailUrl: url, thumbnailData: null, thumbnailOriginalName: null };
  }

  if (obj['type'] === 'data') {
    if (typeof obj['value'] !== 'string') return none;
    const dataUri = obj['value'];

    if (!dataUri.startsWith(JPEG_DATA_URI_PREFIX)) return none;

    let bytes: Uint8Array<ArrayBuffer>;
    try {
      bytes = base64ToBytes(dataUri.slice(JPEG_DATA_URI_PREFIX.length));
    } catch {
      return none; // malformed base64
    }

    if (bytes.length > MAX_THUMBNAIL_BYTES) return none;
    if (!hasJpegMagic(bytes)) return none;

    const originalName = typeof obj['originalName'] === 'string'
      ? obj['originalName'].slice(0, 255)
      : 'thumbnail.jpg';

    return { thumbnailUrl: null, thumbnailData: bytes, thumbnailOriginalName: originalName };
  }

  return none;
}

// ---------------------------------------------------------------------------
// Main parse function
// ---------------------------------------------------------------------------

export function parseJsonExport(text: string): JsonParseResult {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new JsonImportError('File is not valid JSON.');
  }

  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    throw new JsonImportError('File does not contain a valid export object.');
  }

  const obj = data as Record<string, unknown>;

  if (obj['version'] !== 1) {
    throw new JsonImportError('Unsupported export version. Only version 1 is supported.');
  }

  if (!Array.isArray(obj['bookmarks'])) {
    throw new JsonImportError('File does not contain a bookmarks array.');
  }

  const bookmarks = obj['bookmarks'] as unknown[];

  if (bookmarks.length === 0) {
    throw new JsonImportError('No bookmarks found in file.');
  }

  if (bookmarks.length > MAX_BOOKMARKS) {
    throw new JsonImportError(`Too many bookmarks — maximum ${MAX_BOOKMARKS} per import.`);
  }

  const valid: ParsedJsonBookmark[] = [];
  const skipped: JsonParseResult['skipped'] = [];

  bookmarks.forEach((entry, idx) => {
    const num = idx + 1;

    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      skipped.push({ index: num, reason: `Bookmark ${num}: not an object` });
      return;
    }

    const bm = entry as Record<string, unknown>;

    // Title
    const rawTitle = bm['title'];
    if (typeof rawTitle !== 'string' || !rawTitle.trim()) {
      skipped.push({ index: num, reason: `Bookmark ${num}: title is empty` });
      return;
    }
    const title = rawTitle.trim().slice(0, MAX_TITLE_LENGTH);

    // URL
    const rawUrl = bm['url'];
    if (typeof rawUrl !== 'string') {
      skipped.push({ index: num, reason: `Bookmark ${num}: URL is missing` });
      return;
    }
    const validUrl = parseHttpUrl(rawUrl.slice(0, MAX_URL_LENGTH));
    if (!validUrl) {
      skipped.push({
        index: num,
        reason: `Bookmark ${num}: URL is invalid (must start with http:// or https://)`,
      });
      return;
    }

    // Tags
    const rawTags = bm['tags'];
    const tags: string[] = [];
    if (Array.isArray(rawTags)) {
      for (const t of rawTags.slice(0, MAX_TAGS_PER_BOOKMARK)) {
        if (typeof t === 'string' && t.trim()) {
          tags.push(t.trim().slice(0, MAX_TAG_LENGTH));
        }
      }
    }

    // Thumbnail
    const { thumbnailUrl, thumbnailData, thumbnailOriginalName } = parseThumbnail(bm['thumbnail']);

    valid.push({ title, url: validUrl, tags, thumbnailUrl, thumbnailData, thumbnailOriginalName });
  });

  return { valid, skipped };
}
