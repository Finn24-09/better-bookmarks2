import { esc } from './escape.js';
import { renderEmail } from './layout.js';

// Strip characters that have NO legitimate place inside a base64url token
// (or any user-facing rendered token):
//   - C0 control bytes 0x00-0x1F + DEL 0x7F  (gaps 1, 2: CRLF + null + 0x7F)
//   - U+200B zero-width space
//   - U+202A-U+202E bidi embed / override codepoints  (gap 3: RTL override)
//   - U+2066-U+2069 bidi isolate codepoints
// esc() handles HTML metacharacters but does NOT strip these. The threat
// model is "garbage that survives display" rather than "characters that
// break out of a context", so the right primitive is removal, not
// entity-encoding. Real tokens are base64url, so removal is lossless.
const UNSAFE_RE = /[\x00-\x1F\x7F​‪-‮⁦-⁩]/g;
function stripUnsafe(s: string): string {
  return s.replace(UNSAFE_RE, '');
}

export function deleteConfirmationTemplate(token: string): { subject: string; html: string; text: string } {
  const cleanToken = stripUnsafe(token);
  const tokenEsc = esc(cleanToken);
  const subject = 'Confirm your Better Bookmarks account deletion';
  const text = [
    'You requested to delete your Better Bookmarks account.',
    '',
    'Copy the token below and paste it into the deletion confirmation dialog.',
    'The token expires in 15 minutes. You will also need to enter your password.',
    '',
    'Your deletion token:',
    cleanToken,
    '',
    'If you did not request account deletion, you can ignore this email — your account is safe.',
  ].join('\n');

  const tokenBlock = `              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td class="px" style="padding:0 48px 8px 48px;font-family:Helvetica,Arial,sans-serif;">
                    <p class="text-muted" style="margin:0 0 10px 0;font-size:11px;line-height:14px;color:#d8c5f0 !important;text-transform:uppercase;letter-spacing:1px;font-weight:600;">
                      Your deletion token
                    </p>
                    <div class="token text-danger" style="background:rgba(15,5,33,0.8);border:1px solid #3d2a5f;border-left:3px solid #f87171;border-radius:10px;padding:18px 16px;font-family:'SF Mono',Menlo,Consolas,monospace;font-size:18px;line-height:24px;color:#fca5a5 !important;font-weight:700;letter-spacing:1.5px;word-break:break-all;text-align:center;">
                      ${tokenEsc}
                    </div>
                  </td>
                </tr>
              </table>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td class="px" style="padding:24px 48px 8px 48px;font-family:Helvetica,Arial,sans-serif;">
                    <p class="text-muted" style="margin:0 0 14px 0;font-size:11px;line-height:14px;color:#d8c5f0 !important;text-transform:uppercase;letter-spacing:1px;font-weight:600;">
                      How to use it
                    </p>
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                      <tr>
                        <td valign="top" style="padding:0 12px 12px 0;width:36px;">
                          <table role="presentation" cellpadding="0" cellspacing="0" border="0" class="step-num" width="28" height="28" style="background:rgba(168,85,247,0.18);border:1px solid rgba(168,85,247,0.4);border-radius:50%;">
                            <tr><td align="center" valign="middle" height="28" style="font-family:Helvetica,Arial,sans-serif;font-size:12px;line-height:12px;color:#d8b4fe !important;font-weight:700;">1</td></tr>
                          </table>
                        </td>
                        <td valign="top" class="text-light" style="padding:4px 0 12px 0;font-size:14px;line-height:20px;color:#f0e6ff !important;">
                          Copy the token above.
                        </td>
                      </tr>
                      <tr>
                        <td valign="top" style="padding:0 12px 12px 0;width:36px;">
                          <table role="presentation" cellpadding="0" cellspacing="0" border="0" class="step-num" width="28" height="28" style="background:rgba(168,85,247,0.18);border:1px solid rgba(168,85,247,0.4);border-radius:50%;">
                            <tr><td align="center" valign="middle" height="28" style="font-family:Helvetica,Arial,sans-serif;font-size:12px;line-height:12px;color:#d8b4fe !important;font-weight:700;">2</td></tr>
                          </table>
                        </td>
                        <td valign="top" class="text-light" style="padding:4px 0 12px 0;font-size:14px;line-height:20px;color:#f0e6ff !important;">
                          Paste it into the deletion confirmation dialog in Better Bookmarks 2.
                        </td>
                      </tr>
                      <tr>
                        <td valign="top" style="padding:0 12px 16px 0;width:36px;">
                          <table role="presentation" cellpadding="0" cellspacing="0" border="0" class="step-num" width="28" height="28" style="background:rgba(168,85,247,0.18);border:1px solid rgba(168,85,247,0.4);border-radius:50%;">
                            <tr><td align="center" valign="middle" height="28" style="font-family:Helvetica,Arial,sans-serif;font-size:12px;line-height:12px;color:#d8b4fe !important;font-weight:700;">3</td></tr>
                          </table>
                        </td>
                        <td valign="top" class="text-light" style="padding:4px 0 16px 0;font-size:14px;line-height:20px;color:#f0e6ff !important;">
                          Enter your password to confirm.
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
`;

  const html = renderEmail({
    title: 'Confirm account deletion — Better Bookmarks 2',
    preheader: 'Confirm your Better Bookmarks 2 account deletion. Token expires in 15 minutes.',
    stripe: 'red',
    icon: { glyph: '!', tint: 'red' },
    heading: 'Confirm account deletion',
    intro: 'You requested to delete your Better Bookmarks 2 account. This will <strong style="color:#fca5a5 !important;">permanently delete all your bookmarks, tags, and account data</strong>. This action cannot be undone.',
    sub: 'The token below expires in <strong style="color:#fca5a5 !important;">15 minutes</strong>.',
    bodySlot: tokenBlock,
    footerNote: 'Account deletion was requested for this address.',
  });

  return { subject, html, text };
}
