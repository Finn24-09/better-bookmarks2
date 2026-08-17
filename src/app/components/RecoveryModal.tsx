import { useRef } from "react";
import { useForm } from "react-hook-form";
import { AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { signIn, changePassword, rotationStatus } from "../../lib/auth";
import { deriveKey, decrypt } from "../../lib/crypto";
import { getBookmarkRows, decryptBookmark } from "../../lib/bookmarks";
import { getTagRows } from "../../lib/tags";
import { reencryptRecords } from "../../lib/keyRotation";
import { useAuth } from "../contexts/AuthContext";

interface FormFields {
  currentPassword: string;
  newPassword: string;
}

export function RecoveryModal() {
  const { email, cryptoKey, updateKey, clearPartialRotation } = useAuth();
  const isRecoveringRef = useRef(false);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormFields>();

  const onSubmit = async (data: FormFields) => {
    if (isRecoveringRef.current) return;
    isRecoveringRef.current = true;

    try {
      if (!cryptoKey || !email) throw new Error("Not authenticated");

      await signIn(email, data.currentPassword);

      const newKey = await deriveKey(data.newPassword, email);

      const status = await rotationStatus();
      const targetVersion = status.keyVersion + 1;

      if (!status.hasStaleRecords) {
        // Rotation already complete — just commit the password change.
        await changePassword(data.currentPassword, data.newPassword);
        updateKey(newKey);
        clearPartialRotation();
        toast.success("Account recovered");
        return;
      }

      const [bookmarkRows, tagRows] = await Promise.all([
        getBookmarkRows(),
        getTagRows(),
      ]);

      // Only rows still BEHIND targetVersion need work. Rows already at
      // targetVersion were re-encrypted by the interrupted attempt and must be
      // left alone — which is why this flow requires the same intended new
      // password as that attempt.
      const staleBookmarkRows = bookmarkRows.filter((r) => r.key_version < targetVersion);
      const staleThumbRows = staleBookmarkRows.filter(
        (r) => r.thumbnail_file_id && (r.thumbnail_key_version ?? 0) < targetVersion,
      );
      const staleTagRows = tagRows.filter((r) => r.key_version < targetVersion);

      // Decrypt the stale records with the old key before any write, then hand
      // the whole set to reencryptRecords, which finishes every read before it
      // writes and bounds the fan-out. The previous unbounded Promise.all
      // fan-outs could be rate-limited into leaving this recovery itself
      // half-applied — the failure it exists to repair.
      const [staleBookmarks, staleTags] = await Promise.all([
        Promise.all(staleBookmarkRows.map((r) => decryptBookmark(r, cryptoKey))),
        Promise.all(
          staleTagRows.map(async (r) => ({
            id: r.id,
            name: await decrypt(cryptoKey, r.name_enc),
          })),
        ),
      ]);

      await reencryptRecords({
        bookmarks: staleBookmarks,
        thumbnailImageIds: staleThumbRows.map((r) => r.thumbnail_file_id!),
        tags: staleTags,
        oldKey: cryptoKey,
        newKey,
        targetVersion,
      });

      await changePassword(data.currentPassword, data.newPassword);
      updateKey(newKey);
      clearPartialRotation();
      toast.success("Account recovered");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Recovery failed. Please try again.");
    } finally {
      isRecoveringRef.current = false;
    }
  };

  const inputCls =
    "w-full bg-white/5 border border-white/10 rounded-2xl px-4 py-3 text-white placeholder:text-white/40 focus:outline-none focus:bg-white/10 focus:border-white/20 transition-all duration-300";
  const errorInputCls =
    "w-full bg-white/5 border border-red-500/60 rounded-2xl px-4 py-3 text-white placeholder:text-white/40 focus:outline-none focus:bg-white/10 focus:border-red-500/80 transition-all duration-300";

  return (
    <div className="fixed inset-0 bg-linear-to-br from-slate-950 via-purple-950 to-slate-950 flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-white/10 backdrop-blur-xl border border-white/20 rounded-2xl shadow-2xl shadow-purple-500/20 p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 bg-amber-500/20 border border-amber-500/30 rounded-full flex items-center justify-center">
            <AlertTriangle className="w-5 h-5 text-amber-400" />
          </div>
          <h1 className="text-lg font-semibold text-white">Incomplete Password Change Detected</h1>
        </div>

        <p className="text-sm text-white/70 mb-6">
          A previous password change was interrupted before it could complete. Enter your old and
          intended new password to finish re-encrypting your data.
        </p>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-sm text-white/70">Current (old) password</label>
            <input
              type="password"
              placeholder="Enter current password…"
              autoComplete="current-password"
              className={errors.currentPassword ? errorInputCls : inputCls}
              {...register("currentPassword", { required: "Required" })}
            />
            {errors.currentPassword && (
              <p className="text-xs text-red-400">{errors.currentPassword.message}</p>
            )}
          </div>

          <div className="space-y-1.5">
            <label className="text-sm text-white/70">Intended new password</label>
            <input
              type="password"
              placeholder="Enter new password…"
              autoComplete="new-password"
              className={errors.newPassword ? errorInputCls : inputCls}
              {...register("newPassword", { required: "Required" })}
            />
            {errors.newPassword && (
              <p className="text-xs text-red-400">{errors.newPassword.message}</p>
            )}
          </div>

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full px-6 py-3 bg-linear-to-br from-purple-600 to-purple-800 text-white rounded-full hover:scale-105 active:scale-95 transition-all duration-300 text-sm font-medium shadow-lg shadow-purple-500/30 disabled:opacity-60 disabled:pointer-events-none"
          >
            {isSubmitting ? "Recovering…" : "Recover Account"}
          </button>
        </form>
      </div>
    </div>
  );
}
