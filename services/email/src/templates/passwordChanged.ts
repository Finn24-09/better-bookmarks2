import { config } from '../config.js';
import { esc, safeUrl } from './escape.js';
import { renderEmail } from './layout.js';

// Required `changedAt` (C-4): the route always passes one, and an "omit
// the When cell" path serves no real caller. Removing `userEmail` is S-3:
// the To: header already carries the address; re-rendering it inside the
// body is privacy-leaky on forward / screenshot / inbox-search and adds
// no defence-in-depth.
export interface PasswordChangedOpts {
  changedAt: Date;
}

export function passwordChangedTemplate(
  opts: PasswordChangedOpts,
): { subject: string; html: string; text: string } {
  const subject = 'Your Better Bookmarks password was changed';

  // C-7: WHATWG URL composition is robust to trailing slashes, paths, or a
  // future APP_BASE_URL with a sub-path. The try/catch is defence-in-depth
  // for gap 4 — `new URL('/login', 'javascript:...')` can throw on certain
  // base shapes. Falling back to the raw config string lets safeUrl()
  // collapse the result to about:blank rather than blowing the whole
  // template up.
  let loginUrl: string;
  try {
    loginUrl = new URL('/login', config.APP_BASE_URL).toString();
  } catch {
    loginUrl = config.APP_BASE_URL;
  }
  const loginUrlEsc = safeUrl(loginUrl);

  // C-2: pin the displayed timestamp to UTC and label it explicitly. With
  // no `timeZone` option Date.toLocaleString uses the host TZ, which means
  // a user in Europe/Berlin sees the email's "9:14 AM" as a UTC value with
  // no marker — they cannot tell whether the timestamp matches their own
  // password change action and may panic-reset (which wipes all their data).
  // Intl rejects `timeZoneName` together with the `dateStyle`/`timeStyle`
  // shorthands, so spell out the components instead. Output shape matches
  // the prior `dateStyle:'medium' + timeStyle:'short'` rendering plus a
  // trailing UTC label, e.g. "Apr 27, 2026, 9:14 AM UTC".
  const changedAtHuman = opts.changedAt.toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'UTC',
    timeZoneName: 'short',
  });
  const changedAtEsc = esc(changedAtHuman);
  const changedAtIso = opts.changedAt.toISOString();

  const text = [
    'Your Better Bookmarks password was successfully changed.',
    '',
    `When: ${changedAtHuman} (${changedAtIso})`,
    '',
    'If you made this change, no action is needed.',
    '',
    'If you did NOT change your password, your account may be compromised. Use the "Forgot password" link on the sign-in page to reset it — this will wipe all your bookmarks and tags, but it is the only way to lock out anyone who has your old password and stop them from reading or misusing your saved data.',
    '',
    'Sign-in page: ' + loginUrl,
  ].join('\n');

  const metaPanel = `              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td class="px" style="padding:0 48px 28px 48px;font-family:Helvetica,Arial,sans-serif;">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="meta-row" style="background:rgba(15,5,33,0.6);border:1px solid #3d2a5f;border-radius:12px;">
                      <tr>
                        <td style="padding:14px 18px;font-family:Helvetica,Arial,sans-serif;">
                          <div class="text-faint" style="font-size:11px;line-height:14px;color:#c4b5e0 !important;text-transform:uppercase;letter-spacing:1px;font-weight:600;">When</div>
                          <div class="text-white" style="font-size:14px;line-height:20px;color:#ffffff !important;font-weight:500;margin-top:4px;">${changedAtEsc}</div>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
`;

  const dangerCallout = `              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td class="px" style="padding:0 48px 28px 48px;font-family:Helvetica,Arial,sans-serif;">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:rgba(248,113,113,0.08);border:1px solid rgba(248,113,113,0.35);border-radius:12px;">
                      <tr>
                        <td style="padding:16px 18px;font-family:Helvetica,Arial,sans-serif;">
                          <div class="text-danger" style="font-size:13px;line-height:18px;color:#fca5a5 !important;font-weight:700;margin-bottom:6px;">
                            Didn't change your password?
                          </div>
                          <p class="text-danger-body" style="margin:0;font-size:13px;line-height:20px;color:#fde2e2 !important;">
                            If you didn't make this change, your account may be compromised. Use the <strong style="color:#fca5a5 !important;font-weight:700;">Forgot password</strong> link on the <a href="${loginUrlEsc}" class="text-danger" style="color:#fca5a5 !important;text-decoration:underline;font-weight:700;">sign-in page</a> to reset it — this will wipe all your bookmarks and tags, but it's the only way to lock out anyone who has your old password and stop them from reading or misusing your saved data.
                          </p>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
`;

  const html = renderEmail({
    title: 'Password changed — Better Bookmarks 2',
    preheader: 'Your Better Bookmarks 2 password was just changed.',
    stripe: 'green',
    icon: { glyph: '&#10003;', tint: 'green' },
    heading: 'Password changed',
    intro: "Your Better Bookmarks 2 password was successfully changed. If you made this change, you're all set — no further action needed.",
    bodySlot: metaPanel + dangerCallout,
    footerNote: 'This is a security notification — we always send these when your password changes.',
  });

  return { subject, html, text };
}
