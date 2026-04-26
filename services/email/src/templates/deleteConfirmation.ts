export function deleteConfirmationTemplate(token: string): { subject: string; html: string; text: string } {
  const subject = 'Confirm your Better Bookmarks account deletion';
  const text = [
    'You requested to delete your Better Bookmarks account.',
    '',
    'Copy the token below and paste it into the deletion confirmation dialog.',
    'The token expires in 15 minutes. You will also need to enter your password.',
    '',
    'Your deletion token:',
    token,
    '',
    'If you did not request account deletion, you can ignore this email — your account is safe.',
  ].join('\n');
  const html = `<!DOCTYPE html><html><body style="font-family:sans-serif;max-width:600px;margin:0 auto">
<h2>Confirm account deletion</h2>
<p>You requested to delete your Better Bookmarks account. This will permanently delete all your data.</p>
<p>Copy the token below and paste it into the deletion confirmation dialog. The token expires in <strong>15 minutes</strong>. You will also need to enter your password.</p>
<div style="margin:24px 0;padding:16px 20px;background:#1e1e2e;border:1px solid #374151;border-radius:8px">
  <p style="margin:0 0 8px;color:#9ca3af;font-size:0.85em">Your deletion token — copy this:</p>
  <code style="display:block;color:#f9fafb;font-size:1em;word-break:break-all;letter-spacing:0.05em">${token}</code>
</div>
<p style="color:#666;font-size:0.9em">If you did not request account deletion, you can ignore this email — your account is safe.</p>
</body></html>`;
  return { subject, html, text };
}
