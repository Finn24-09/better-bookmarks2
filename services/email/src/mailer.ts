import nodemailer from 'nodemailer';
import { config } from './config.js';

// H-3: Reject any SMTP session that does not negotiate TLS.
// - secure:true  → implicit TLS (port 465). Always encrypted.
// - secure:false → STARTTLS upgrade (port 587). Without requireTLS:true an
//   on-path attacker can strip the STARTTLS capability from the server
//   greeting, downgrading the session to plaintext and leaking SMTP
//   credentials and any tokens contained in outgoing mail.
// rejectUnauthorized:true and minVersion:TLSv1.2 prevent MitM via forged
// or stale certificates and disallow obsolete TLS versions.
//
// Dev escape hatch: SMTP_REQUIRE_TLS=false omits requireTLS so that local
// MailHog / Mailpit servers (which don't speak STARTTLS) work in dev. The
// config layer refuses to start the process if SMTP_REQUIRE_TLS=false in
// production, so this branch is unreachable on a real deployment.
const transport = nodemailer.createTransport({
  host: config.SMTP_HOST,
  port: config.SMTP_PORT,
  secure: config.SMTP_SECURE,
  ...(config.SMTP_REQUIRE_TLS ? { requireTLS: true } : {}),
  tls: {
    minVersion: 'TLSv1.2',
    rejectUnauthorized: true,
  },
  auth: { user: config.SMTP_USER, pass: config.SMTP_PASS },
});

interface MailOptions {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export async function sendMail(opts: MailOptions): Promise<void> {
  const headers: Record<string, string> = {
    'X-Mailer': '',  // suppress mailer fingerprint (L-4)
  };
  if (config.AWS_SES_CONFIGURATION_SET) {
    headers['X-SES-Configuration-Set'] = config.AWS_SES_CONFIGURATION_SET;
  }
  if (config.AWS_SES_FROM_ARN) {
    headers['X-SES-Source-ARN'] = config.AWS_SES_FROM_ARN;
  }

  await transport.sendMail({
    from: config.SMTP_FROM,
    to: opts.to,
    subject: opts.subject,
    html: opts.html,
    text: opts.text,
    headers,
  });
}
