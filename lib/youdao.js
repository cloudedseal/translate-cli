/**
 * Fetch an English word from Youdao Dictionary (dict.youdao.com) and extract:
 *   - word + phonetics (英/美)
 *   - basic meanings (part of speech + short definitions)
 *   - Collins English-Chinese Advanced Dictionary senses (柯林斯英汉双解)
 *   - related phrases
 */

import { parse, byId, byClass, first, hasClass, text } from './html.js';
import { LookupError } from './errors.js';
import { lookupJson, splitEnZh } from './youdao-json.js';

export { LookupError };

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const REQUEST_TIMEOUT_MS = 15000;

export function buildUrl(word) {
  return 'https://dict.youdao.com/w/' + encodeURIComponent(word.trim());
}

export async function fetchHtml(url) {
  let res;
  try {
    res = await fetch(url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9,zh-CN;q=0.8,zh;q=0.7',
      },
    });
  } catch (err) {
    if (err.name === 'TimeoutError' || err.name === 'AbortError') {
      throw new LookupError('request timed out – check your network connection');
    }
    throw new LookupError(`network error: ${err.message}`);
  }
  if (!res.ok) throw new LookupError(`dictionary server responded with HTTP ${res.status}`);

  const buf = Buffer.from(await res.arrayBuffer());
  const charset = detectCharset(res.headers.get('content-type'), buf);
  let html;
  try {
    html = new TextDecoder(charset).decode(buf);
  } catch {
    html = new TextDecoder('utf-8').decode(buf);
  }
  if (/Just a moment|cf-browser-verification/i.test(html.slice(0, 2000))) {
    throw new LookupError('the dictionary site is blocking automated requests (try again later)');
  }
  return html;
}

function detectCharset(contentType, buf) {
  const fromHeader = /charset=([\w-]+)/i.exec(contentType || '');
  if (fromHeader) return fromHeader[1].toLowerCase();
  const head = buf.subarray(0, 4096).toString('latin1');
  const fromMeta = /charset=["']?([\w-]+)/i.exec(head);
  if (fromMeta) return fromMeta[1].toLowerCase();
  return 'utf-8';
}

/* ------------------------------------------------------------------ */
/* Parsing                                                            */
/* ------------------------------------------------------------------ */

/* Split "English definition. 中文释义" into { en, zh } – shared with the JSON
   source, imported from lib/youdao-json.js above. */

/** Pull the POS tag and definition text out of a Collins <p>. */
function extractDefinition(p) {
  let pos = null;
  let posTaken = false;
  let rest = '';
  for (const c of p.children) {
    if (c.type === 'text') { rest += c.data; continue; }
    if (c.tag === 'span' && hasClass(c, 'additional')) {
      const t = text(c);
      const title = c.attrs.title || '';
      if (!posTaken && (title || /^[A-Z][A-Z-]*$/.test(t))) {
        pos = { abbr: t, cn: title };
        posTaken = true;
      } else {
        rest += ' ' + t;
      }
      continue;
    }
    rest += text(c);
  }
  rest = rest.replace(/\s+/g, ' ').trim();
  const { en, zh } = splitEnZh(rest);
  return { pos, en, zh };
}

function parseBasic(root) {
  const basic = { word: '', phonetics: [], meanings: [] };
  const phrs = byId(root, 'phrsListTab');
  if (!phrs) return basic;

  const kw = first(phrs, (n) => hasClass(n, 'keyword'));
  if (kw) basic.word = text(kw);

  for (const p of byClass(phrs, 'pronounce')) {
    const ipaNode = first(p, (n) => hasClass(n, 'phonetic'));
    const ipa = ipaNode ? text(ipaNode) : '';
    let label = '';
    for (const c of p.children) if (c.type === 'text') label += c.data;
    label = label.trim();
    if (ipa) basic.phonetics.push({ label, ipa });
  }

  const box = first(phrs, (n) => hasClass(n, 'trans-container'));
  const ul = box ? first(box, (n) => n.tag === 'ul') : null;
  if (ul) {
    for (const li of ul.children) {
      if (li.type !== 'tag' || li.tag !== 'li') continue;
      const t = text(li);
      if (t) basic.meanings.push(t);
    }
  }
  return basic;
}

function parseCollins(root) {
  const entries = [];
  const section = byId(root, 'collinsResult');
  if (!section) return entries;

  for (const wt of byClass(section, 'wt-container')) {
    const entry = { title: '', phonetic: '', pattern: '', rank: '', senses: [] };

    const h4 = first(wt, (n) => n.tag === 'h4');
    if (h4) {
      const title = first(h4, (n) => hasClass(n, 'title'));
      const phon = first(h4, (n) => hasClass(n, 'phonetic'));
      const pattern = first(h4, (n) => hasClass(n, 'pattern'));
      const rank = first(h4, (n) => hasClass(n, 'rank'));
      if (title) entry.title = text(title);
      if (phon) entry.phonetic = text(phon);
      if (pattern) entry.pattern = text(pattern);
      if (rank) entry.rank = text(rank);
    }

    const ol = first(wt, (n) => n.tag === 'ul' && hasClass(n, 'ol'));
    const items = ol ? ol.children.filter((c) => c.type === 'tag' && c.tag === 'li') : [];

    for (const li of items) {
      const major = first(li, (n) => hasClass(n, 'collinsMajorTrans'));
      if (!major) continue;

      const sense = { order: '', pos: null, en: '', zh: '', examples: [] };
      const orderNode = first(major, (n) => hasClass(n, 'collinsOrder'));
      if (orderNode) sense.order = text(orderNode).replace(/[.\s]+$/, '');

      const p = first(major, (n) => n.tag === 'p');
      if (p) Object.assign(sense, extractDefinition(p));

      for (const exWrap of byClass(li, 'exampleLists')) {
        const exBox = first(exWrap, (n) => hasClass(n, 'examples'));
        if (!exBox) continue;
        const ps = exBox.children
          .filter((c) => c.type === 'tag' && c.tag === 'p')
          .map(text)
          .filter(Boolean);
        for (let k = 0; k < ps.length; k += 2) {
          sense.examples.push({ en: ps[k] || '', zh: ps[k + 1] || '' });
        }
      }

      if (sense.en || sense.zh) entry.senses.push(sense);
    }

    if (entry.senses.length) entries.push(entry);
  }
  return entries;
}

function parsePhrases(root) {
  const out = [];
  const section = byId(root, 'webPhrase');
  if (!section) return out;
  for (const p of byClass(section, 'wordGroup')) {
    const t = text(p);
    if (t) out.push(t);
  }
  return out;
}

export function parseDictionary(html, queriedWord = '') {
  const root = parse(html);
  const basic = parseBasic(root);
  const collins = parseCollins(root);
  const phrases = parsePhrases(root);

  return {
    word: basic.word || queriedWord,
    phonetics: basic.phonetics,
    meanings: basic.meanings,
    wordForms: [],
    collins,
    phrases,
    found: basic.meanings.length > 0 || collins.length > 0,
  };
}

/**
 * One-stop lookup: try the JSON endpoint first (covers contractions like
 * "don't"), fall back to parsing the HTML dictionary page.
 * Both return the same result shape.
 */
export async function lookup(word) {
  let jsonError = null;
  try {
    const result = await lookupJson(word);
    if (result.found) {
      result.source = 'json';
      return result;
    }
  } catch (err) {
    if (!(err instanceof LookupError)) throw err;
    // network/HTTP failure – remember it, but still try the HTML source below
    jsonError = err;
  }

  try {
    const html = await fetchHtml(buildUrl(word));
    const result = parseDictionary(html, word.trim());
    result.source = 'html';
    if (result.found || !jsonError) return result;
  } catch (err) {
    if (jsonError && err instanceof LookupError) throw jsonError;
    throw err;
  }

  // JSON errored, HTML loaded but found nothing → report the JSON error
  throw jsonError;
}
