// Single source of truth for the cross-client email scaffold (XHTML doctype,
// MSO conditionals, [data-ogsc]/[data-ogsb] dark-mode overrides, brand pill,
// footer pill, page background). Every transactional template renders its
// unique middle section into a `bodySlot` string and lets this module emit
// the rest. This guarantees that a future change to the chrome (e.g. add a
// tracking-pixel ban or a new hostile-webmail override) lands in exactly one
// file rather than being copy-pasted into four.
//
// Body copy is intentionally NOT wrapped in <font color="#ffffff">. The
// [data-ogsc]/[data-ogsb] selectors plus inline `!important` declarations
// are the body-copy protection against forced-light-mode webmail rewrites.
// <font> tags are reserved for chrome (brand wordmark, <h1>) where the
// !important pathway cannot reach. (C-8.)

export type Stripe = 'purple' | 'red' | 'green';

export interface IconSpec {
  glyph: string;
  tint: Stripe;
}

export interface LayoutOpts {
  title: string;          // <title> in <head>
  preheader: string;      // hidden preheader text
  stripe: Stripe;         // top-of-card gradient
  icon: IconSpec;         // small icon tile
  heading: string;        // <h1>
  intro: string;          // first <p> (already-escaped)
  sub?: string;           // optional second <p> (already-escaped HTML)
  bodySlot: string;       // already-rendered HTML for the unique middle section
  footerNote: string;     // text inside footer pill (already-escaped)
}

const STRIPE_GRADIENT: Record<Stripe, string> = {
  purple: 'linear-gradient(90deg,#7c3aed 0%,#a855f7 50%,#c084fc 100%)',
  red:    'linear-gradient(90deg,#dc2626 0%,#f87171 50%,#fca5a5 100%)',
  green:  'linear-gradient(90deg,#16a34a 0%,#22c55e 50%,#86efac 100%)',
};
const STRIPE_BASE: Record<Stripe, string> = {
  purple: '#a855f7',
  red:    '#f87171',
  green:  '#22c55e',
};

const ICON_TILE: Record<Stripe, { bg: string; border: string; fg: string }> = {
  purple: { bg: 'rgba(168,85,247,0.12)', border: 'rgba(168,85,247,0.35)', fg: '#d8b4fe' },
  red:    { bg: 'rgba(248,113,113,0.12)', border: 'rgba(248,113,113,0.35)', fg: '#fca5a5' },
  green:  { bg: 'rgba(34,197,94,0.18)',   border: 'rgba(34,197,94,0.5)',   fg: '#bbf7d0' },
};

export function renderEmail(opts: LayoutOpts): string {
  const stripeGradient = STRIPE_GRADIENT[opts.stripe];
  const stripeBase     = STRIPE_BASE[opts.stripe];
  const icon           = ICON_TILE[opts.icon.tint];

  return `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office" lang="en">
<head>
<meta charset="utf-8" />
<meta http-equiv="X-UA-Compatible" content="IE=edge" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="x-apple-disable-message-reformatting" />
<meta name="color-scheme" content="dark" />
<meta name="supported-color-schemes" content="dark" />
<title>${opts.title}</title>
<!--[if mso]>
<noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript>
<![endif]-->
<style type="text/css">
  body, table, td, a { -webkit-text-size-adjust:100%; -ms-text-size-adjust:100%; }
  table, td { mso-table-lspace:0pt; mso-table-rspace:0pt; }
  img { -ms-interpolation-mode:bicubic; border:0; outline:none; text-decoration:none; display:block; }
  body { margin:0 !important; padding:0 !important; width:100% !important; background:#0f0521; }
  a { color:#d8b4fe; text-decoration:none; }
  @media only screen and (max-width: 620px) {
    .container { width:100% !important; max-width:100% !important; }
    .px { padding-left:24px !important; padding-right:24px !important; }
    .py-lg { padding-top:32px !important; padding-bottom:32px !important; }
    .h1 { font-size:24px !important; line-height:32px !important; }
    .btn a { display:block !important; width:100% !important; box-sizing:border-box !important; }
    .link-box { font-size:12px !important; }
    .meta-row td { display:block !important; width:100% !important; padding:6px 0 !important; }
    .token { font-size:16px !important; letter-spacing:1px !important; padding:14px 12px !important; }
    .step-num { width:28px !important; height:28px !important; }
  }
</style>
<style type="text/css">
  /* Outlook.com / Outlook (Android) / Yahoo forced-color-scheme overrides.
     Inert in clients that do not inject data-ogsc/ogsb. */
  [data-ogsc] .text-white,  [data-ogsb] .text-white  { color:#ffffff !important; }
  [data-ogsc] .text-light,  [data-ogsb] .text-light  { color:#f0e6ff !important; }
  [data-ogsc] .text-muted,  [data-ogsb] .text-muted  { color:#d8c5f0 !important; }
  [data-ogsc] .text-faint,  [data-ogsb] .text-faint  { color:#c4b5e0 !important; }
  [data-ogsc] .text-mauve,  [data-ogsb] .text-mauve  { color:#b09bd6 !important; }
  [data-ogsc] .text-link,   [data-ogsb] .text-link   { color:#d8b4fe !important; }
  [data-ogsc] .text-danger, [data-ogsb] .text-danger { color:#fca5a5 !important; }
  [data-ogsc] .text-danger-body, [data-ogsb] .text-danger-body { color:#fde2e2 !important; }
  [data-ogsc] .bg-page,     [data-ogsb] .bg-page     { background:#0f0521 !important; }
  [data-ogsc] .bg-card,     [data-ogsb] .bg-card     { background:#1f0f3d !important; }
</style>
</head>
<body bgcolor="#0f0521" class="bg-page" style="margin:0;padding:0;background:#0f0521;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
  <div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:#0f0521;opacity:0;">
    ${opts.preheader}
  </div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#0f0521" class="bg-page" style="background:#0f0521;background-image:linear-gradient(180deg,#1a0a2e 0%,#0f0521 100%);">
    <tr>
      <td align="center" style="padding:40px 16px;">
        <table role="presentation" class="container" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:600px;">
          <tr>
            <td align="left" style="padding:0 0 24px 0;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" bgcolor="#1f0f3d" class="bg-card" style="background:#1f0f3d;border:1px solid #3d2a5f;border-radius:12px;">
                <tr>
                  <td class="text-white" style="vertical-align:middle;padding:10px 14px;font-family:Helvetica,Arial,sans-serif;font-size:18px;font-weight:700;color:#ffffff !important;letter-spacing:-0.2px;">
                    <font color="#ffffff">Better Bookmarks 2</font>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td bgcolor="#1f0f3d" class="card bg-card" style="background:#1f0f3d;background-image:linear-gradient(160deg,#2a1a47 0%,#1a0a36 100%);border:1px solid #3d2a5f;border-radius:16px;overflow:hidden;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr><td height="3" style="height:3px;line-height:3px;font-size:0;background:${stripeBase};background-image:${stripeGradient};">&nbsp;</td></tr>
              </table>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td class="px py-lg" align="left" style="padding:40px 48px 8px 48px;">
                    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="56" height="56" style="background:${icon.bg};border:1px solid ${icon.border};border-radius:14px;">
                      <tr><td align="center" valign="middle" width="56" height="56" style="font-family:Helvetica,Arial,sans-serif;font-size:24px;line-height:24px;color:${icon.fg} !important;font-weight:700;">${opts.icon.glyph}</td></tr>
                    </table>
                  </td>
                </tr>
              </table>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td class="px" style="padding:20px 48px 0 48px;font-family:Helvetica,Arial,sans-serif;">
                    <h1 class="h1 text-white" style="margin:0 0 12px 0;font-size:28px;line-height:36px;color:#ffffff !important;font-weight:700;letter-spacing:-0.4px;">
                      <font color="#ffffff">${opts.heading}</font>
                    </h1>
                    <p class="text-light" style="margin:0 0 ${opts.sub ? '8' : '28'}px 0;font-size:15px;line-height:24px;color:#f0e6ff !important;">
                      ${opts.intro}
                    </p>
${opts.sub ? `                    <p class="text-muted" style="margin:0 0 28px 0;font-size:13px;line-height:20px;color:#d8c5f0 !important;">
                      ${opts.sub}
                    </p>
` : ''}                  </td>
                </tr>
              </table>
${opts.bodySlot}              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr><td class="px" style="padding:0 48px;"><div style="height:1px;line-height:1px;font-size:0;background:#3d2a5f;">&nbsp;</div></td></tr>
              </table>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td class="px" style="padding:20px 48px 36px 48px;font-family:Helvetica,Arial,sans-serif;">
                    <p class="text-faint" style="margin:0;font-size:12px;line-height:18px;color:#c4b5e0 !important;">
                      Didn't expect this email? You can safely ignore it unless it's a password change - your account is unchanged unless you act on the contents above.
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td align="center" style="padding:24px 16px 0 16px;font-family:Helvetica,Arial,sans-serif;">
              <table role="presentation" align="center" cellpadding="0" cellspacing="0" border="0" bgcolor="#1f0f3d" class="bg-card" style="background:#1f0f3d;border:1px solid #3d2a5f;border-radius:12px;">
                <tr>
                  <td align="center" style="padding:14px 18px;">
                    <p class="text-faint" style="margin:0 0 6px 0;font-size:12px;line-height:18px;color:#c4b5e0 !important;">
                      Better Bookmarks 2 · Save what matters
                    </p>
                    <p class="text-mauve" style="margin:0;font-size:11px;line-height:16px;color:#b09bd6 !important;">
                      ${opts.footerNote}
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}
