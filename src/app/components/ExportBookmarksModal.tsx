import { useState, useRef } from "react";
import { X, Download, AlertTriangle, CheckCircle, AlertCircle, Loader2, Check } from "lucide-react";
import {
  Dialog,
  DialogPortal,
  DialogOverlay,
} from "./ui/dialog";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { cn } from "./ui/utils";
import { useAuth } from "../contexts/AuthContext";
import {
  exportBookmarks,
  exportToCsv,
  triggerDownload,
  type ExportProgress,
} from "../../lib/export";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ExportBookmarksModalProps {
  open: boolean;
  onClose: () => void;
}

type ExportPhase =
  | { phase: "idle" }
  | {
      phase: "exporting";
      step: "bookmarks" | "tags" | "thumbnails" | "serializing";
      bookmarksCurrent: number;
      bookmarksTotal: number;
      thumbnailsCurrent: number;
      thumbnailsTotal: number;
    }
  | { phase: "done"; count: number; filename: string }
  | { phase: "error"; message: string };

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ExportBookmarksModal({ open, onClose }: ExportBookmarksModalProps) {
  const { cryptoKey } = useAuth();

  const [state, setState] = useState<ExportPhase>({ phase: "idle" });
  const [format, setFormat] = useState<"json" | "csv">("json");
  const [includeThumbnails, setIncludeThumbnails] = useState(true);
  const [acknowledged, setAcknowledged] = useState(false);
  const [isExporting, setIsExporting] = useState(false);

  const abortRef = useRef<AbortController | null>(null);

  // ---- Reset ----

  const reset = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setState({ phase: "idle" });
    setAcknowledged(false);
    setIsExporting(false);
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  // ---- Progress callback ----

  const handleProgress = (p: ExportProgress) => {
    if (p.phase === "bookmarks") {
      setState((prev) => ({
        phase: "exporting",
        step: "bookmarks",
        bookmarksCurrent: p.current,
        bookmarksTotal: p.total,
        thumbnailsCurrent: prev.phase === "exporting" ? prev.thumbnailsCurrent : 0,
        thumbnailsTotal: prev.phase === "exporting" ? prev.thumbnailsTotal : 0,
      }));
    } else if (p.phase === "tags") {
      setState((prev) => ({
        phase: "exporting",
        step: "tags",
        bookmarksCurrent: prev.phase === "exporting" ? prev.bookmarksCurrent : 0,
        bookmarksTotal: prev.phase === "exporting" ? prev.bookmarksTotal : 0,
        thumbnailsCurrent: 0,
        thumbnailsTotal: 0,
      }));
    } else if (p.phase === "thumbnails") {
      setState((prev) => ({
        phase: "exporting",
        step: "thumbnails",
        bookmarksCurrent: prev.phase === "exporting" ? prev.bookmarksCurrent : 0,
        bookmarksTotal: prev.phase === "exporting" ? prev.bookmarksTotal : 0,
        thumbnailsCurrent: p.current,
        thumbnailsTotal: p.total,
      }));
    }
  };

  // ---- Export ----

  const handleExport = async () => {
    if (isExporting || !cryptoKey) return;
    setIsExporting(true);

    const ctrl = new AbortController();
    abortRef.current = ctrl;

    const today = new Date().toISOString().slice(0, 10);
    const ext = format;
    const filename = `better-bookmarks-export-${today}.${ext}`;

    // Request file handle before starting the export (requires user gesture context)
    let fileHandle: FileSystemFileHandle | null = null;
    if (format === "json" && "showSaveFilePicker" in window) {
      try {
        fileHandle = await (window as typeof window & {
          showSaveFilePicker: (opts: unknown) => Promise<FileSystemFileHandle>;
        }).showSaveFilePicker({
          suggestedName: filename,
          types: [{ description: "JSON file", accept: { "application/json": [".json"] } }],
        });
      } catch {
        // User cancelled the picker or the API is unavailable — fall back to blob download
        fileHandle = null;
      }
    }

    setState({
      phase: "exporting",
      step: "bookmarks",
      bookmarksCurrent: 0,
      bookmarksTotal: 0,
      thumbnailsCurrent: 0,
      thumbnailsTotal: 0,
    });

    try {
      const data = await exportBookmarks(
        cryptoKey,
        {
          format,
          includeThumbnails: format === "json" && includeThumbnails,
          thumbnailConcurrency: 3,
          thumbnailErrorPolicy: "skip",
        },
        handleProgress,
        ctrl.signal,
      );

      if (format === "csv") {
        const csv = exportToCsv(data);
        triggerDownload(new Blob([csv], { type: "text/csv;charset=utf-8" }), filename);
      } else if (fileHandle) {
        // Stream to the user-chosen file without holding an extra copy in memory
        const writable = await fileHandle.createWritable();
        try {
          await writable.write(JSON.stringify(data, null, 2));
          await writable.close();
        } catch (writeErr) {
          await writable.abort();
          throw writeErr;
        }
      } else {
        triggerDownload(
          new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
          filename,
        );
      }

      setState({ phase: "done", count: data.totalBookmarks, filename });
    } catch (err) {
      if ((err as Error).name === "AbortError") {
        setState({ phase: "idle" });
      } else {
        setState({ phase: "error", message: (err as Error).message || "Export failed" });
      }
    } finally {
      setIsExporting(false);
      abortRef.current = null;
    }
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

  const renderWarningBanner = () => (
    <div className="flex items-start gap-3 p-4 bg-amber-500/10 border border-amber-500/20 rounded-xl">
      <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
      <p className="text-sm text-amber-200/80 leading-relaxed">
        This file will contain your bookmark titles, URLs, and tags in <strong>plain text</strong>.
        It is <strong>not encrypted</strong> and can be read by anyone who obtains it.
      </p>
    </div>
  );

  const renderIdle = () => (
    <div className="space-y-5">
      {renderWarningBanner()}

      {/* Format selector */}
      <div className="space-y-2">
        <p className="text-xs text-white/50 uppercase tracking-wider">Format</p>
        <div className="flex gap-2">
          {(["json", "csv"] as const).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFormat(f)}
              className={cn(
                "flex-1 py-2 px-4 rounded-full text-sm font-medium border transition-all duration-300",
                format === f
                  ? "bg-white/20 border-white/30 text-white"
                  : "bg-white/5 border-white/10 text-white/60 hover:bg-white/10 hover:border-white/20 hover:text-white/80",
              )}
            >
              {f.toUpperCase()}
              <span className="block text-xs font-normal opacity-60 mt-0.5">
                {f === "json" ? "Full backup + thumbnails" : "Basic data, no thumbnails"}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Thumbnail toggle (JSON only) */}
      {format === "json" && (
        <label className="flex items-center gap-3 cursor-pointer select-none">
          <div className="relative">
            <input
              type="checkbox"
              checked={includeThumbnails}
              onChange={(e) => setIncludeThumbnails(e.target.checked)}
              className="sr-only"
            />
            <div
              className={cn(
                "w-10 h-5 rounded-full transition-all duration-300",
                includeThumbnails ? "bg-purple-600" : "bg-white/20",
              )}
            />
            <div
              className={cn(
                "absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-all duration-300",
                includeThumbnails ? "left-5.5" : "left-0.5",
              )}
              style={{ left: includeThumbnails ? "calc(100% - 1.125rem)" : "0.125rem" }}
            />
          </div>
          <span className="text-sm text-white/70">Include uploaded thumbnail images</span>
        </label>
      )}

      {/* Acknowledgement checkbox */}
      <label className="flex items-start gap-3 cursor-pointer select-none">
        <div className="relative mt-0.5 shrink-0">
          <input
            type="checkbox"
            checked={acknowledged}
            onChange={(e) => setAcknowledged(e.target.checked)}
            className="sr-only"
          />
          <div
            className={cn(
              "w-5 h-5 rounded border-2 flex items-center justify-center transition-all duration-300",
              acknowledged
                ? "bg-purple-600 border-purple-500"
                : "bg-white/5 border-white/30 hover:border-white/50",
            )}
          >
            {acknowledged && <Check className="w-3 h-3 text-white" />}
          </div>
        </div>
        <span className="text-sm text-white/70 leading-relaxed">
          I understand this file is not encrypted and will store it securely.
        </span>
      </label>

      {/* Footer */}
      <div className="flex items-center justify-end gap-3 pt-1">
        <button type="button" onClick={handleClose} className={btnSecondary}>
          Cancel
        </button>
        <button
          type="button"
          onClick={handleExport}
          disabled={!acknowledged || isExporting}
          className={btnPrimary}
        >
          <Download className="w-4 h-4 inline mr-2" />
          Export
        </button>
      </div>
    </div>
  );

  const renderExporting = () => {
    if (state.phase !== "exporting") return null;
    const { step, bookmarksCurrent, bookmarksTotal, thumbnailsCurrent, thumbnailsTotal } = state;

    const stepItem = (
      isActive: boolean,
      isDone: boolean,
      label: string,
    ) => (
      <div className="flex items-center gap-3">
        <div className="w-5 h-5 shrink-0 flex items-center justify-center">
          {isDone ? (
            <CheckCircle className="w-5 h-5 text-emerald-400" />
          ) : isActive ? (
            <Loader2 className="w-5 h-5 text-purple-400 animate-spin" />
          ) : (
            <div className="w-3 h-3 rounded-full bg-white/20" />
          )}
        </div>
        <span
          className={cn(
            "text-sm transition-colors duration-300",
            isDone ? "text-emerald-400" : isActive ? "text-white" : "text-white/40",
          )}
        >
          {label}
        </span>
      </div>
    );

    const bookmarksDone = step === "tags" || step === "thumbnails" || step === "serializing";
    const bookmarksLabel = bookmarksTotal > 0
      ? `Fetching bookmarks (${bookmarksCurrent} of ${bookmarksTotal})`
      : bookmarksCurrent > 0
      ? `Fetching bookmarks (${bookmarksCurrent} so far)`
      : "Fetching bookmarks";

    const tagsDone = step === "thumbnails" || step === "serializing";
    const showThumbnails = format === "json" && includeThumbnails;

    return (
      <div className="space-y-5">
        {renderWarningBanner()}

        <div className="space-y-4 py-2">
          {stepItem(step === "bookmarks", bookmarksDone, bookmarksLabel)}
          {stepItem(step === "tags", tagsDone, "Fetching tags")}
          {showThumbnails && stepItem(
            step === "thumbnails",
            step === "serializing",
            thumbnailsTotal > 0
              ? `Embedding thumbnails (${thumbnailsCurrent} of ${thumbnailsTotal})`
              : "Embedding thumbnails",
          )}
        </div>

        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => { abortRef.current?.abort(); }}
            className={btnSecondary}
          >
            Cancel
          </button>
        </div>
      </div>
    );
  };

  const renderDone = () => {
    if (state.phase !== "done") return null;
    return (
      <div className="flex flex-col items-center gap-4 py-6 text-center">
        <CheckCircle className="w-12 h-12 text-emerald-400" />
        <div className="space-y-1">
          <p className="text-white font-medium">
            {state.count} bookmark{state.count !== 1 ? "s" : ""} exported
          </p>
          <p className="text-sm text-white/50 font-mono">{state.filename}</p>
        </div>
        <button type="button" onClick={handleClose} className={btnPrimary}>
          Done
        </button>
      </div>
    );
  };

  const renderError = () => {
    if (state.phase !== "error") return null;
    return (
      <div className="space-y-5">
        {renderWarningBanner()}
        <div className="flex flex-col items-center gap-3 py-4 text-center">
          <AlertCircle className="w-10 h-10 text-red-400" />
          <p className="text-sm text-red-300/80">{state.message}</p>
        </div>
        <div className="flex items-center justify-end gap-3">
          <button type="button" onClick={handleClose} className={btnSecondary}>
            Cancel
          </button>
          <button
            type="button"
            onClick={() => { setState({ phase: "idle" }); setAcknowledged(false); }}
            className={btnPrimary}
          >
            Retry
          </button>
        </div>
      </div>
    );
  };

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
            <h2 className="text-lg font-semibold text-white flex items-center gap-2">
              <Download className="w-5 h-5 text-white/60" />
              Export Bookmarks
            </h2>
            <button
              onClick={handleClose}
              className="w-9 h-9 bg-white/10 border border-white/20 rounded-full flex items-center justify-center hover:bg-white/20 hover:scale-110 active:scale-95 transition-all duration-300"
            >
              <X className="w-4 h-4 text-white" />
            </button>
          </div>

          {/* Body */}
          {state.phase === "idle" && renderIdle()}
          {state.phase === "exporting" && renderExporting()}
          {state.phase === "done" && renderDone()}
          {state.phase === "error" && renderError()}
        </DialogPrimitive.Content>
      </DialogPortal>
    </Dialog>
  );
}
