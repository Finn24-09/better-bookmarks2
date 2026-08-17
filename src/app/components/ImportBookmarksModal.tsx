import { useState, useRef } from "react";
import { X, Upload, ChevronDown, ChevronUp } from "lucide-react";
import {
  Dialog,
  DialogPortal,
  DialogOverlay,
  DialogClose,
} from "./ui/dialog";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { cn } from "./ui/utils";
import { validateCsvFile, parseCsvText, CsvParseError, type ParsedCsvRow } from "../../lib/csv";
import { validateJsonFile, parseJsonExport, JsonImportError, type ParsedJsonBookmark } from "../../lib/importJson";
import { getTags, createTag, setBookmarkTags } from "../../lib/tags";
import { createBookmark } from "../../lib/bookmarks";
import { uploadThumbnailFromBytes } from "../../lib/thumbnails";
import { withRetry, type RetryOptions } from "../../lib/utils";
import { useAuth } from "../contexts/AuthContext";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// POST /thumbnail_images is the only request in the import loop that lands in
// a rate-limited nginx zone (api_read, 60 r/m, burst ~21) — bookmarks, tags and
// bookmark_tags all go through the unlimited /api/ block. The loop is
// sequential and each iteration takes well under a second, so restoring a
// backup larger than the burst starts drawing 429s partway through.
//
// Five attempts is generous for a sequential caller: the bucket refills at
// 1 req/s, so an upload rejected on the first try almost always lands on the
// second. There is no concurrent worker here to starve one request behind
// another, which is why this needs a smaller budget than key rotation's.
const THUMBNAIL_UPLOAD_RETRY: RetryOptions = { attempts: 5, baseMs: 800, maxDelayMs: 3000 };

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ImportBookmarksModalProps {
  open: boolean;
  onClose: () => void;
  onImport: () => void;
}

type ModalState = "idle" | "parsed" | "importing" | "done";

/** Unified bookmark shape used internally after parsing either format. */
interface ImportRow {
  title: string;
  url: string;
  tags: string[];
  thumbnailUrl: string | null;
  /** Decoded JPEG bytes from a JSON data URI — must be uploaded before creating bookmark. */
  thumbnailData: Uint8Array<ArrayBuffer> | null;
  thumbnailOriginalName: string | null;
}

interface ParsedResult {
  format: "csv" | "json";
  valid: ImportRow[];
  skipped: Array<{ index: number; reason: string }>;
}

// ---------------------------------------------------------------------------
// Converters
// ---------------------------------------------------------------------------

function csvRowToImportRow(row: ParsedCsvRow): ImportRow {
  return {
    title: row.title,
    url: row.url,
    tags: row.tags,
    thumbnailUrl: row.thumbnailUrl,
    thumbnailData: null,
    thumbnailOriginalName: null,
  };
}

function jsonRowToImportRow(row: ParsedJsonBookmark): ImportRow {
  return {
    title: row.title,
    url: row.url,
    tags: row.tags,
    thumbnailUrl: row.thumbnailUrl,
    thumbnailData: row.thumbnailData,
    thumbnailOriginalName: row.thumbnailOriginalName,
  };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ImportBookmarksModal({ open, onClose, onImport }: ImportBookmarksModalProps) {
  const { cryptoKey, userId } = useAuth();

  const [state, setState] = useState<ModalState>("idle");
  const [parseResult, setParseResult] = useState<ParsedResult | null>(null);
  const [parseError, setParseError] = useState<string>("");
  const [showFormat, setShowFormat] = useState(false);
  const [progress, setProgress] = useState(0);
  const [importedCount, setImportedCount] = useState(0);
  const [skippedThumbnails, setSkippedThumbnails] = useState(0);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // ---- Reset ----

  const reset = () => {
    setState("idle");
    setParseResult(null);
    setParseError("");
    setShowFormat(false);
    setProgress(0);
    setImportedCount(0);
    setSkippedThumbnails(0);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  // ---- File pick ----

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setParseError("");

    const isJson = file.name.toLowerCase().endsWith(".json");
    const isCsv = file.name.toLowerCase().endsWith(".csv");

    if (!isJson && !isCsv) {
      setParseError("The file must be a .csv or .json file.");
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }

    if (isJson) {
      try {
        validateJsonFile(file);
      } catch (err) {
        setParseError(err instanceof JsonImportError ? err.message : "Invalid file.");
        if (fileInputRef.current) fileInputRef.current.value = "";
        return;
      }

      const text = await file.text();
      try {
        const result = parseJsonExport(text);
        setParseResult({
          format: "json",
          valid: result.valid.map(jsonRowToImportRow),
          skipped: result.skipped,
        });
        setState("parsed");
      } catch (err) {
        setParseError(err instanceof JsonImportError ? err.message : "Could not parse JSON.");
        if (fileInputRef.current) fileInputRef.current.value = "";
      }
      return;
    }

    // CSV path
    try {
      validateCsvFile(file);
    } catch (err) {
      setParseError(err instanceof CsvParseError ? err.message : "Invalid file.");
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }

    const text = await file.text();
    try {
      const result = parseCsvText(text);
      setParseResult({
        format: "csv",
        valid: result.valid.map(csvRowToImportRow),
        skipped: result.skipped.map((s) => ({ index: s.rowNumber, reason: s.reason })),
      });
      setState("parsed");
    } catch (err) {
      setParseError(err instanceof CsvParseError ? err.message : "Could not parse CSV.");
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  // ---- Import ----

  const handleImport = async () => {
    if (!parseResult || !cryptoKey || !userId) return;
    const rows = parseResult.valid;

    setState("importing");
    setProgress(0);

    // 1. Load existing tags, build name → id map (case-insensitive keys)
    const existingTags = await getTags(cryptoKey);
    const tagMap = new Map<string, string>(
      existingTags.map((t) => [t.name.toLowerCase(), t.id]),
    );

    // 2. Collect unique tag names that need to be created
    const allTagNames = new Set(
      rows.flatMap((r) => r.tags.map((t) => t.toLowerCase())),
    );
    for (const name of allTagNames) {
      if (!tagMap.has(name)) {
        const tag = await createTag(name, userId, cryptoKey);
        tagMap.set(name, tag.id);
      }
    }

    // 3. Create each bookmark sequentially, bottom-up so that the first row
    // ends up with the newest created_at and appears at the top of the list
    // (bookmarks are ordered created_at DESC).
    let imported = 0;
    let thumbnailsLost = 0;
    for (let i = rows.length - 1; i >= 0; i--) {
      const { thumbnailSkipped } = await createImportRow(rows[i], tagMap, cryptoKey, userId);
      if (thumbnailSkipped) thumbnailsLost++;
      imported++;
      setProgress(imported);
    }

    setImportedCount(imported);
    setSkippedThumbnails(thumbnailsLost);
    setState("done");
    onImport();
  };

  const createImportRow = async (
    row: ImportRow,
    tagMap: Map<string, string>,
    key: CryptoKey,
    uid: string,
  ): Promise<{ thumbnailSkipped: boolean }> => {
    // Upload embedded thumbnail bytes (from JSON export) before creating the bookmark.
    let thumbnailFileId: string | null = null;
    let thumbnailSkipped = false;

    // Bound to a const so the narrowing survives into the retry closure.
    const bytes = row.thumbnailData;
    if (bytes) {
      try {
        thumbnailFileId = await withRetry(
          () => uploadThumbnailFromBytes(
            bytes,
            row.thumbnailOriginalName ?? "thumbnail.jpg",
            key,
            uid,
          ),
          THUMBNAIL_UPLOAD_RETRY,
        );
      } catch {
        // Still create the bookmark. Aborting mid-import would leave a partial
        // library the user has to de-duplicate by hand before retrying, which
        // is worse than one missing image. But the loss is counted and shown:
        // reporting "Imported 200 bookmarks" while silently discarding their
        // images is the failure mode this replaces.
        thumbnailFileId = null;
        thumbnailSkipped = true;
      }
    }

    const { id } = await createBookmark(
      {
        title: row.title,
        url: row.url,
        thumbnailUrl: thumbnailFileId ? null : row.thumbnailUrl,
        thumbnailFileId,
      },
      key,
      uid,
    );

    const tagIds = row.tags
      .map((t) => tagMap.get(t.toLowerCase()))
      .filter((id): id is string => id !== undefined);
    if (tagIds.length > 0) {
      await setBookmarkTags(id, tagIds, []);
    }

    return { thumbnailSkipped };
  };

  // ---------------------------------------------------------------------------
  // Shared class strings
  // ---------------------------------------------------------------------------

  const btnPrimary =
    "px-6 py-2.5 bg-linear-to-br from-purple-600 to-purple-800 text-white rounded-full hover:scale-105 active:scale-95 transition-all duration-300 text-sm shadow-lg shadow-purple-500/30 disabled:opacity-60 disabled:pointer-events-none";
  const btnSecondary =
    "px-6 py-2.5 bg-white/5 border border-white/10 text-white/70 rounded-full hover:bg-white/10 hover:text-white hover:scale-105 active:scale-95 transition-all duration-300 text-sm";

  // ---------------------------------------------------------------------------
  // Render helpers
  // ---------------------------------------------------------------------------

  const renderIdle = () => (
    <div className="space-y-4">
      {/* Hidden file input — accepts both CSV and JSON */}
      <input
        type="file"
        accept=".csv,.json"
        className="hidden"
        ref={fileInputRef}
        onChange={handleFileChange}
      />

      {/* Drop / click area */}
      <button
        type="button"
        onClick={() => fileInputRef.current?.click()}
        className="w-full flex flex-col items-center gap-3 px-6 py-10 bg-white/5 border-2 border-dashed border-white/20 rounded-2xl hover:bg-white/10 hover:border-white/30 transition-all duration-300 text-center"
      >
        <Upload className="w-8 h-8 text-white/40" />
        <span className="text-sm text-white/60">Choose a CSV or JSON file</span>
        <span className="text-xs text-white/30">or drag and drop</span>
      </button>

      {parseError && (
        <p className="text-sm text-red-400">{parseError}</p>
      )}

      {/* Format help */}
      <div className="border border-white/10 rounded-2xl overflow-hidden">
        <button
          type="button"
          onClick={() => setShowFormat((v) => !v)}
          className="w-full flex items-center justify-between px-4 py-3 text-sm text-white/50 hover:text-white/70 hover:bg-white/5 transition-all duration-200"
        >
          <span>What file formats are supported?</span>
          {showFormat
            ? <ChevronUp className="w-4 h-4" />
            : <ChevronDown className="w-4 h-4" />
          }
        </button>
        {showFormat && (
          <div className="px-4 pb-4 space-y-4 text-xs text-white/50 border-t border-white/10 pt-3">
            <div>
              <p className="text-white/70 font-medium mb-1">JSON (recommended)</p>
              <p>Better Bookmarks export files (<span className="text-white/60">.json</span>). Restores all bookmark data including uploaded thumbnail images. Max 5,000 bookmarks, 100 MB.</p>
            </div>
            <div>
              <p className="text-white/70 font-medium mb-1">CSV</p>
              <ul className="space-y-0.5 list-disc list-inside">
                <li>Required: <span className="text-white/60">Title</span>, <span className="text-white/60">URL</span> (http/https)</li>
                <li>Optional: <span className="text-white/60">Tags</span> (pipe-separated), <span className="text-white/60">Thumbnail URL</span></li>
              </ul>
              <p className="mt-1">Max 500 rows, 5 MB.</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );

  const renderParsed = () => {
    const { valid, skipped } = parseResult!;
    const hasThumbnails = valid.some((r) => r.thumbnailData !== null);
    return (
      <div className="space-y-4">
        <div className="p-4 bg-white/5 border border-white/10 rounded-2xl space-y-1">
          <p className="text-sm text-white/80">
            <span className="text-white font-medium">{valid.length} bookmark{valid.length !== 1 ? "s" : ""}</span> ready to import
          </p>
          {hasThumbnails && (
            <p className="text-xs text-white/50">
              Thumbnail images will be encrypted and uploaded.
            </p>
          )}
          {skipped.length > 0 && (
            <p className="text-sm text-white/50">
              {skipped.length} item{skipped.length !== 1 ? "s" : ""} will be skipped
            </p>
          )}
        </div>

        {skipped.length > 0 && (
          <div className="max-h-36 overflow-y-auto space-y-1 p-3 bg-white/5 border border-white/10 rounded-2xl">
            {skipped.map((s) => (
              <p key={s.index} className="text-xs text-amber-400/80">{s.reason}</p>
            ))}
          </div>
        )}

        <div className="flex items-center justify-end gap-3 pt-2">
          <button type="button" onClick={reset} className={btnSecondary}>
            Cancel
          </button>
          <button
            type="button"
            onClick={handleImport}
            disabled={valid.length === 0}
            className={btnPrimary}
          >
            Import {valid.length} bookmark{valid.length !== 1 ? "s" : ""}
          </button>
        </div>
      </div>
    );
  };

  const renderImporting = () => (
    <div className="flex flex-col items-center gap-4 py-6">
      <div className="w-8 h-8 rounded-full border-2 border-white/20 border-t-white/60 animate-spin" />
      <p className="text-sm text-white/60">
        Importing {progress} of {parseResult?.valid.length ?? 0}…
      </p>
    </div>
  );

  const renderDone = () => (
    <div className="flex flex-col items-center gap-4 py-6 text-center">
      <p className="text-white font-medium">
        Imported {importedCount} bookmark{importedCount !== 1 ? "s" : ""}
      </p>
      {parseResult && parseResult.skipped.length > 0 && (
        <p className="text-sm text-white/50">
          {parseResult.skipped.length} item{parseResult.skipped.length !== 1 ? "s were" : " was"} skipped
        </p>
      )}
      {skippedThumbnails > 0 && (
        <p className="text-sm text-amber-400/80">
          {skippedThumbnails} thumbnail image{skippedThumbnails !== 1 ? "s" : ""} could not be uploaded
          {skippedThumbnails !== 1 ? " and were" : " and was"} skipped. Those bookmarks were imported
          without their image.
        </p>
      )}
      <DialogClose asChild>
        <button type="button" onClick={handleClose} className={btnPrimary}>
          Done
        </button>
      </DialogClose>
    </div>
  );

  // ---------------------------------------------------------------------------
  // JSX
  // ---------------------------------------------------------------------------

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) handleClose(); }}>
      <DialogPortal>
        <DialogOverlay className="bg-black/60" />
        <DialogPrimitive.Content
          className={cn(
            "fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50",
            "w-full max-w-[calc(100%-2rem)] sm:max-w-lg",
            "bg-white/10 backdrop-blur-xl border border-white/20 rounded-2xl",
            "shadow-2xl shadow-purple-500/20",
            "p-6",
            "data-[state=open]:animate-in data-[state=closed]:animate-out",
            "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
            "data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95",
            "duration-200",
          )}
        >
          {/* Header */}
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-lg font-semibold text-white">Import Bookmarks</h2>
            <DialogClose asChild>
              <button
                onClick={handleClose}
                className="w-9 h-9 bg-white/10 border border-white/20 rounded-full flex items-center justify-center hover:bg-white/20 hover:scale-110 active:scale-95 transition-all duration-300"
              >
                <X className="w-4 h-4 text-white" />
              </button>
            </DialogClose>
          </div>

          {/* Body */}
          {state === "idle" && renderIdle()}
          {state === "parsed" && renderParsed()}
          {state === "importing" && renderImporting()}
          {state === "done" && renderDone()}
        </DialogPrimitive.Content>
      </DialogPortal>
    </Dialog>
  );
}
