import { config } from '../config.js';
import { safeUrl } from './escape.js';
import { renderEmail } from './layout.js';

export function verifyEmailTemplate(token: string): { subject: string; html: string; text: string } {
  // C-7: WHATWG URL composition is robust to trailing slashes / sub-paths.
  // The try/catch is defence-in-depth (gap 4): if APP_BASE_URL is ever an
  // unparseable value like `javascript:alert(1)`, fall back so safeUrl()
  // collapses the result to about:blank rather than throwing in the body.
  let link: string;
  try {
    const u = new URL('/api/email/verify-email', config.APP_BASE_URL);
    u.searchParams.set('token', token);
    link = u.toString();
  } catch {
    link = config.APP_BASE_URL;
  }
  const linkEsc = safeUrl(link);

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

  const ctaAndLinkBox = `              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td class="px btn" style="padding:0 48px 28px 48px;">
                    <!--[if mso]>
                    <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${linkEsc}" style="height:48px;v-text-anchor:middle;width:240px;" arcsize="100%" stroke="f" fillcolor="#a855f7">
                      <w:anchorlock/>
                      <center style="color:#ffffff;font-family:Helvetica,Arial,sans-serif;font-size:15px;font-weight:700;">Verify email address</center>
                    </v:roundrect>
                    <![endif]-->
                    <!--[if !mso]><!-- -->
                    <a href="${linkEsc}" class="text-white" style="display:inline-block;background:#a855f7;background-image:linear-gradient(135deg,#9333ea 0%,#a855f7 50%,#c084fc 100%);color:#ffffff !important;font-family:Helvetica,Arial,sans-serif;font-size:15px;font-weight:700;line-height:48px;text-align:center;text-decoration:none;border-radius:24px;padding:0 32px;mso-padding-alt:0;letter-spacing:0.2px;">
                      <font color="#ffffff">Verify email address</font>
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
    title: 'Verify your email — Better Bookmarks 2',
    preheader: 'Confirm your email address to activate your Better Bookmarks 2 account. Link expires in 24 hours.',
    stripe: 'purple',
    icon: { glyph: '&#10003;', tint: 'purple' },
    heading: 'Welcome to Better Bookmarks',
    intro: 'Just one more step. Confirm your email address to activate your account and start organizing your bookmarks.',
    sub: 'This link expires in <strong style="color:#e0d4f5 !important;">24 hours</strong>.',
    bodySlot: ctaAndLinkBox,
    footerNote: 'You received this email because someone signed up using this address.',
  });

  return { subject, html, text };
}
