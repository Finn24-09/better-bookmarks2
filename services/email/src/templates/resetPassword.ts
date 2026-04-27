import { config } from '../config.js';
import { esc, safeUrl } from './escape.js';
import { renderEmail } from './layout.js';

export function resetPasswordTemplate(token: string): { subject: string; html: string; text: string } {
  // C-7: WHATWG URL composition + safeUrl() for the href context (gap 4).
  let link: string;
  try {
    const u = new URL('/api/email/reset-password', config.APP_BASE_URL);
    u.searchParams.set('token', token);
    link = u.toString();
  } catch {
    link = config.APP_BASE_URL;
  }
  const linkEsc = safeUrl(link);

  const warning = 'WARNING: Resetting your password will permanently delete all your bookmarks, tags, and thumbnails. This cannot be undone. Your data is encrypted with a key derived from your password — a new password creates an irrecoverable new key.';
  const warningEsc = esc(warning);

  const subject = 'Reset your Better Bookmarks password';
  const text = [
    warning,
    '',
    'If you still wish to proceed, click the link below. The link expires in 1 hour.',
    '',
    link,
    '',
    'If you did not request a password reset, you can ignore this email — your account is safe.',
  ].join('\n');

  const dangerCallout = `              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td class="px" style="padding:0 48px 24px 48px;font-family:Helvetica,Arial,sans-serif;">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:rgba(248,113,113,0.08);border:1px solid rgba(248,113,113,0.35);border-radius:12px;">
                      <tr>
                        <td style="padding:16px 18px;font-family:Helvetica,Arial,sans-serif;">
                          <div class="text-danger" style="font-size:13px;line-height:18px;color:#fca5a5 !important;font-weight:700;margin-bottom:6px;">
                            Data loss warning
                          </div>
                          <p class="text-danger-body" style="margin:0;font-size:13px;line-height:20px;color:#fde2e2 !important;">
                            ${warningEsc}
                          </p>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
`;

  const ctaAndLinkBox = `              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td class="px btn" style="padding:0 48px 28px 48px;">
                    <!--[if mso]>
                    <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${linkEsc}" style="height:48px;v-text-anchor:middle;width:300px;" arcsize="100%" stroke="f" fillcolor="#dc2626">
                      <w:anchorlock/>
                      <center style="color:#ffffff;font-family:Helvetica,Arial,sans-serif;font-size:15px;font-weight:700;">Reset password (deletes all data)</center>
                    </v:roundrect>
                    <![endif]-->
                    <!--[if !mso]><!-- -->
                    <a href="${linkEsc}" class="text-white" style="display:inline-block;background:#dc2626;background-image:linear-gradient(135deg,#dc2626 0%,#ef4444 50%,#f87171 100%);color:#ffffff !important;font-family:Helvetica,Arial,sans-serif;font-size:15px;font-weight:700;line-height:48px;text-align:center;text-decoration:none;border-radius:24px;padding:0 32px;mso-padding-alt:0;letter-spacing:0.2px;">
                      <font color="#ffffff">Reset password (deletes all data)</font>
                    </a>
                    <!--<![endif]-->
                  </td>
                </tr>
              </table>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td class="px" style="padding:0 48px 32px 48px;font-family:Helvetica,Arial,sans-serif;">
                    <p class="text-muted" style="margin:0 0 8px 0;font-size:12px;line-height:18px;color:#d8c5f0 !important;text-transform:uppercase;letter-spacing:1px;font-weight:600;">
                      Or paste this link
                    </p>
                    <div class="link-box" style="background:rgba(15,5,33,0.6);border:1px solid #3d2a5f;border-radius:10px;padding:12px 14px;font-family:'SF Mono',Menlo,Consolas,monospace;font-size:12px;line-height:18px;color:#d8b4fe !important;word-break:break-all;">
                      <a href="${linkEsc}" class="text-link" style="color:#d8b4fe !important;text-decoration:none;">${linkEsc}</a>
                    </div>
                  </td>
                </tr>
              </table>
`;

  const html = renderEmail({
    title: 'Reset your password — Better Bookmarks 2',
    preheader: 'Reset your Better Bookmarks 2 password. This link is valid for 1 hour.',
    stripe: 'red',
    icon: { glyph: '!', tint: 'red' },
    heading: 'Reset your password',
    intro: 'We received a request to reset the password for your Better Bookmarks 2 account. Click below to choose a new one.',
    sub: 'This link expires in <strong style="color:#fca5a5 !important;">1 hour</strong>.',
    bodySlot: dangerCallout + ctaAndLinkBox,
    footerNote: 'Sent because a password reset was requested for this address.',
  });

  return { subject, html, text };
}
