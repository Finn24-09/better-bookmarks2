import { config } from '../config.js';

export function verifyEmailTemplate(token: string): { subject: string; html: string; text: string } {
  const link = `${config.APP_BASE_URL}/api/email/verify-email?token=${encodeURIComponent(token)}`;
  const subject = 'Verify your Better Bookmarks email address';
  const text = [
    'Welcome to Better Bookmarks!',
    '',
    'Click the link below to verify your email address. The link expires in 24 hours.',
    '',
    link,
    '',
    'If you did not create this account, you can ignore this email.',
  ].join('\n');
  const html = `<!DOCTYPE html><html><body style="font-family:sans-serif;max-width:600px;margin:0 auto">
<h2>Welcome to Better Bookmarks!</h2>
<p>Click the button below to verify your email address. The link expires in 24 hours.</p>
<p><a href="${link}" style="display:inline-block;padding:12px 24px;background:#7c3aed;color:#fff;text-decoration:none;border-radius:8px">Verify email address</a></p>
<p style="color:#666;font-size:0.9em">Or copy this link: <a href="${link}">${link}</a></p>
<p style="color:#666;font-size:0.9em">If you did not create this account, you can ignore this email.</p>
</body></html>`;
  return { subject, html, text };
}
