import { config } from '../config.js';

export function resetPasswordTemplate(token: string): { subject: string; html: string; text: string } {
  const link = `${config.APP_BASE_URL}/api/email/reset-password?token=${encodeURIComponent(token)}`;
  const warning = 'WARNING: Resetting your password will permanently delete all your bookmarks, tags, and thumbnails. This cannot be undone. Your data is encrypted with a key derived from your password — a new password creates an irrecoverable new key.';
  const subject = 'Reset your Better Bookmarks password';
  const text = [
    '⚠️  ' + warning,
    '',
    'If you still wish to proceed, click the link below. The link expires in 1 hour.',
    '',
    link,
    '',
    'If you did not request a password reset, you can ignore this email — your account is safe.',
  ].join('\n');
  const html = `<!DOCTYPE html><html><body style="font-family:sans-serif;max-width:600px;margin:0 auto">
<div style="background:#7c2d12;border:1px solid #9a3412;border-radius:8px;padding:16px;margin-bottom:24px">
<strong style="color:#fed7aa">⚠️ Data loss warning</strong>
<p style="color:#fdba74;margin:8px 0 0">${warning}</p>
</div>
<p>If you still wish to proceed, click the button below. The link expires in <strong>1 hour</strong>.</p>
<p><a href="${link}" style="display:inline-block;padding:12px 24px;background:#dc2626;color:#fff;text-decoration:none;border-radius:8px">Reset password (deletes all data)</a></p>
<p style="color:#666;font-size:0.9em">Or copy this link: <a href="${link}">${link}</a></p>
<p style="color:#666;font-size:0.9em">If you did not request a password reset, you can ignore this email — your account is safe.</p>
</body></html>`;
  return { subject, html, text };
}
