import nodemailer from 'nodemailer';
import { config } from './config.js';

const transport = nodemailer.createTransport({
  host: config.SMTP_HOST,
  port: config.SMTP_PORT,
  secure: config.SMTP_SECURE,
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
