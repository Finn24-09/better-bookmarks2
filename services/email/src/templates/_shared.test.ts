import { describe, it, expect, vi } from 'vitest';

// Single source of truth for the structural / cross-client invariants every
// rewritten template MUST satisfy. Each file used to assert these (~6 tests)
// individually; consolidating here means a future change only updates one
// place. Per-template files keep their content/contract checks but rely on
// THIS file for the chrome.

vi.mock('../config.js', () => ({
  config: { APP_BASE_URL: 'https://example.test' },
}));

const { deleteConfirmationTemplate } = await import('./deleteConfirmation.js');
const { verifyEmailTemplate } = await import('./verifyEmail.js');
const { resetPasswordTemplate } = await import('./resetPassword.js');
const { passwordChangedTemplate } = await import('./passwordChanged.js');

const TOKEN = 'safe-token_-ABC123';
const FIXED_DATE = new Date('2026-04-27T09:14:00Z');

type TemplateOut = { subject: string; html: string; text: string };

const TEMPLATES: ReadonlyArray<readonly [string, () => TemplateOut]> = [
  ['deleteConfirmation', () => deleteConfirmationTemplate(TOKEN)],
  ['verifyEmail',        () => verifyEmailTemplate(TOKEN)],
  ['resetPassword',      () => resetPasswordTemplate(TOKEN)],
  ['passwordChanged',    () => passwordChangedTemplate({ changedAt: FIXED_DATE })],
];

describe.each(TEMPLATES)('%s — shared structural contract', (_name, render) => {
  it('html starts with the XHTML doctype', () => {
    expect(render().html).toContain('<!DOCTYPE');
  });

  it('html declares Apple disable-message-reformatting', () => {
    expect(render().html).toContain('x-apple-disable-message-reformatting');
  });

  it('html includes the mobile @media breakpoint', () => {
    expect(render().html).toContain('@media only screen and (max-width: 620px)');
  });

  it('html declares mso-table-lspace for Outlook', () => {
    expect(render().html).toContain('mso-table-lspace');
  });

  it('html includes Outlook.com / Yahoo dark-mode override selectors', () => {
    const html = render().html;
    expect(html).toContain('[data-ogsc]');
    expect(html).toContain('[data-ogsb]');
  });

  it('html locks in the page background via a bgcolor= HTML attribute', () => {
    // The presence of *some* bgcolor= attribute is the real cross-client
    // invariant — the exact hex is a branding choice, not a contract.
    expect(render().html).toMatch(/bgcolor="#[0-9a-fA-F]{6}"/);
  });

  it('html wraps brand chrome in legacy <font color> tags', () => {
    expect(render().html).toContain('<font color="#ffffff"');
  });

  it('html applies !important to the brand foreground colour', () => {
    expect(render().html).toContain('color:#ffffff !important');
  });

  it('html does NOT contain inline <svg> (most clients strip it)', () => {
    expect(render().html).not.toContain('<svg');
  });

  it('html does NOT contain box-shadow (renders as a distracting glow)', () => {
    expect(render().html).not.toContain('box-shadow');
  });

  // Coverage gap 7: pin "no tracking pixels / external image resources".
  it('html does NOT load any external http(s) image (no tracking pixels)', () => {
    const html = render().html;
    expect(html).not.toMatch(/<img\b[^>]*\bsrc\s*=\s*["']?https?:/i);
  });

  it('html does NOT contain any <img> tag at all (we ship pure HTML, no embeds)', () => {
    expect(render().html).not.toContain('<img');
  });

  // Brand-pill + footer-pill consistency.
  it('html renders the "Better Bookmarks 2" wordmark', () => {
    expect(render().html).toContain('Better Bookmarks 2');
  });
});
