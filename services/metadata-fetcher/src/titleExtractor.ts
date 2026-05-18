import { Parser } from 'htmlparser2';
import { decodeHTML } from 'entities';

export const MAX_TITLE_LENGTH = 500;

const SUPPORTED_DECODERS = new Set([
  'utf-8', 'utf8', 'utf-16le', 'utf-16be',
  'iso-8859-1', 'latin1', 'windows-1252', 'iso-8859-15',
]);

function decodeBody(bytes: Buffer, charset: string): string {
  const label = SUPPORTED_DECODERS.has(charset.toLowerCase()) ? charset : 'utf-8';
  try {
    return new TextDecoder(label, { fatal: false }).decode(bytes);
  } catch {
    return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  }
}

function postProcess(raw: string): string | null {
  const decoded = decodeHTML(raw);
  const collapsed = decoded.replace(/\s+/g, ' ').trim();
  if (!collapsed) return null;
  return collapsed.length > MAX_TITLE_LENGTH ? collapsed.slice(0, MAX_TITLE_LENGTH) : collapsed;
}

/**
 * Stream-parse the response head and return the best title candidate.
 *
 * Priority: og:title → twitter:title → <title>. The first non-empty
 * post-processed candidate wins. Parsing stops at </head>; content inside
 * <body> is never read so a hostile <script> embedded "<title>" cannot
 * influence the result.
 *
 * The parser is fed the entire decoded string; htmlparser2 in its default
 * mode is robust to malformed markup (unclosed tags, missing </head>, etc.)
 * — the caller (fetcher.ts) is responsible for the on-wire body-size cap.
 */
export function extractTitle(bytes: Buffer, charset: string): string | null {
  if (bytes.length === 0) return null;
  const text = decodeBody(bytes, charset);

  let inHead = true;
  let inTitleTag = false;
  let titleChars: string[] = [];
  let titleSeen: string | null = null;
  let ogTitle: string | null = null;
  let twitterTitle: string | null = null;

  const parser = new Parser(
    {
      onopentag(name, attrs) {
        if (!inHead) return;
        if (name === 'title') {
          inTitleTag = true;
          titleChars = [];
          return;
        }
        if (name !== 'meta') return;
        const property = (attrs.property ?? '').toLowerCase();
        const metaName = (attrs.name ?? '').toLowerCase();
        const content = attrs.content;
        if (typeof content !== 'string') return;
        if (property === 'og:title' && ogTitle === null) ogTitle = content;
        else if (metaName === 'twitter:title' && twitterTitle === null) twitterTitle = content;
      },
      ontext(text) {
        if (inHead && inTitleTag) titleChars.push(text);
      },
      onclosetag(name) {
        if (name === 'title' && inTitleTag) {
          inTitleTag = false;
          if (titleSeen === null) titleSeen = titleChars.join('');
        }
        if (name === 'head') {
          inHead = false;
          parser.end();
        }
      },
    },
    { decodeEntities: false, lowerCaseTags: true, recognizeSelfClosing: true },
  );

  parser.write(text);
  parser.end();

  for (const candidate of [ogTitle, twitterTitle, titleSeen]) {
    if (candidate === null) continue;
    const cleaned = postProcess(candidate);
    if (cleaned !== null) return cleaned;
  }
  return null;
}
