export function passwordChangedTemplate(): { subject: string; html: string; text: string } {
  const subject = 'Your Better Bookmarks password was changed';
  const text = [
    'Your Better Bookmarks password was successfully changed.',
    '',
    'If you made this change, no action is needed.',
    '',
    'If you did not change your password, someone may have access to your account.',
    'Contact support immediately if this was not you.',
  ].join('\n');
  const html = `<!DOCTYPE html><html><body style="font-family:sans-serif;max-width:600px;margin:0 auto">
<h2>Password changed</h2>
<p>Your Better Bookmarks password was successfully changed.</p>
<p>If you made this change, no action is needed.</p>
<p style="color:#dc2626">If you did not change your password, someone may have access to your account. Contact support immediately if this was not you.</p>
</body></html>`;
  return { subject, html, text };
}
