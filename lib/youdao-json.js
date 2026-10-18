/**
 * Primary data source: Youdao's JSON endpoint (dict.youdao.com/jsonapi).
 * Structured JSON, works for contractions ("don't"), includes Collins data.
 */

import { decodeEntities } from './html.js';
import { LookupError } from './errors.js';

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const REQUEST_TIMEOUT_MS = 15000;

const CJK_RE = /[\u3400-\u4dbf\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/;

/** Split "English definition. 中文释义" into { en, zh } (shared rules). */
export function splitEnZh(s) {
  const i = s.search(CJK_RE);
  if (i < 0) return { en: s, zh: '' };
  let en = s.slice(0, i).trim();
  let zh = s.slice(i).trim();
  // Split landed just after an opening parenthesis: move it to the Chinese side.
  // "…that bank. ( 在某银行)开户" → en "…that bank." / zh "(在某银行)开户"
  if (en.endsWith('(')) {
    en = en.slice(0, -1).trim();
    zh = '(' + zh;
  }
  // Split landed right before a Chinese continuation of a trailing English gloss:
  // "…of \"do not.\" (do not)的常用口语形式" → move "(do not)" to the Chinese side
  const m = /^(.*?)\s*(\([^()]*\))$/.exec(en);
  if (m && m[2] && zh.startsWith('的')) {
    en = m[1].trim();
    zh = m[2] + zh;
  }
  if (!en) return { en: '', zh };
  return { en, zh };
}

function stripHtml(s) {
  return decodeEntities(String(s).replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim();
}

/** Accept string | [string] | [{i: ...}|{l: ...}|{s: ...}] and return a plain string. */
function flattenText(v) {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) return v.map(flattenText).filter(Boolean).join('; ');
  if (typeof v === 'object') {
    if ('i' in v) return flattenText(v.i);
    if ('l' in v) return flattenText(v.l);
    if ('s' in v) return flattenText(v.s);
  }
  return '';
}

function joinPhon(label, phone) {
  if (!phone) return null;
  const ipa = phone.startsWith('[') ? phone : '[' + phone + ']';
  return { label, ipa };
}

function parseCollins(json) {
  const entries = [];
  const collins = json && json.collins && json.collins.collins_entries;
  if (!Array.isArray(collins)) return entries;

  for (const ce of collins) {
    const entry = { title: '', phonetic: '', pattern: '', rank: '', stars: 0, senses: [] };
    entry.title = ce.headword || '';
    if (ce.phonetic) entry.phonetic = '/' + ce.phonetic + '/';
    if (ce.hwas) {
      // hwas is usually already phrased as "also hullo", but be defensive
      entry.pattern = /^also\s/i.test(ce.hwas) ? '(' + ce.hwas + ')' : '(also ' + ce.hwas + ')';
    }
    const basic = ce.basic_entries && ce.basic_entries.basic_entry;
    if (Array.isArray(basic) && basic[0] && basic[0].cet) entry.rank = basic[0].cet;
    if (ce.star) entry.stars = Number(ce.star) || 0;

    const list = ce.entries && ce.entries.entry;
    if (Array.isArray(list)) {
      list.forEach((e, idx) => {
        const tranEntries = e && Array.isArray(e.tran_entry) ? e.tran_entry : [];
        for (const te of tranEntries) {
          const sense = {
            order: String(idx + 1),
            pos: null,
            en: '',
            zh: '',
            examples: [],
          };
          if (te.pos_entry && te.pos_entry.pos) {
            sense.pos = { abbr: te.pos_entry.pos, cn: te.pos_entry.pos_tips || '' };
          }
          const { en, zh } = splitEnZh(stripHtml(te.tran || ''));
          sense.en = en;
          let extraZh = zh;
          if (te.box_extra) {
            const note = '[' + stripHtml(te.box_extra) + ']';
            if (extraZh) extraZh += ' ' + note;
            else sense.en += ' ' + note;
          }
          sense.zh = extraZh;

          const sent = te.exam_sents && te.exam_sents.sent;
          if (Array.isArray(sent)) {
            for (const s of sent) {
              const enSent = s.eng_sent ? stripHtml(s.eng_sent) : '';
              const zhSent = s.chn_sent ? stripHtml(s.chn_sent) : '';
              if (enSent || zhSent) sense.examples.push({ en: enSent, zh: zhSent });
            }
          }
          if (sense.en || sense.zh) entry.senses.push(sense);
        }
      });
    }
    if (entry.senses.length) entries.push(entry);
  }
  return entries;
}

function parseEc(json) {
  const basic = { word: '', phonetics: [], meanings: [], wordForms: [] };
  const words = json && json.ec && json.ec.word;
  if (!Array.isArray(words) || !words[0]) return basic;
  const w = words[0];

  const phrase = w['return-phrase'];
  basic.word = flattenText(Array.isArray(phrase) ? phrase[0] : phrase);

  const uk = joinPhon('英', w.ukphone);
  const us = joinPhon('美', w.usphone);
  if (uk) basic.phonetics.push(uk);
  if (us) basic.phonetics.push(us);

  if (Array.isArray(w.trs)) {
    for (const trGroup of w.trs) {
      const trs = Array.isArray(trGroup.tr) ? trGroup.tr : [trGroup.tr];
      for (const tr of trs) {
        const t = flattenText(tr && tr.l);
        if (t) basic.meanings.push(t);
      }
    }
  }
  if (Array.isArray(w.wfs)) {
    for (const g of w.wfs) {
      if (g.wf && g.wf.name && g.wf.value) basic.wordForms.push(g.wf.name + ' ' + g.wf.value);
    }
  }
  return basic;
}

function parsePhrases(json) {
  const out = [];
  const phrs = json && json.phrs && json.phrs.phrs;
  if (!Array.isArray(phrs)) return out;
  for (const item of phrs) {
    const p = item && item.phr;
    if (!p) continue;
    const head = flattenText(p.headword);
    let tr = '';
    if (Array.isArray(p.trs)) {
      tr = p.trs.map((t) => flattenText(t.tr ? t.tr.l : '')).filter(Boolean).join('; ');
    }
    const line = (head + ' ' + tr).trim();
    if (line) out.push(line);
  }
  return out;
}

export async function fetchJson(word) {
  const dicts = encodeURIComponent(JSON.stringify(['collins', 'ec', 'phrs']));
  const q = encodeURIComponent(word.trim()).replace(/'/g, '%27');
  const url = `https://dict.youdao.com/jsonapi?q=${q}&dicts=${dicts}`;

  let res;
  try {
    res = await fetch(url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'application/json,text/plain,*/*',
        'Accept-Language': 'en-US,en;q=0.9,zh-CN;q=0.8',
        Referer: 'https://dict.youdao.com/',
      },
    });
  } catch (err) {
    if (err.name === 'TimeoutError' || err.name === 'AbortError') {
      throw new LookupError('request timed out – check your network connection');
    }
    throw new LookupError(`network error: ${err.message}`);
  }
  if (!res.ok) throw new LookupError(`dictionary server responded with HTTP ${res.status}`);

  try {
    return await res.json();
  } catch {
    throw new LookupError('dictionary server returned an unreadable response');
  }
}

/** Look the word up via the JSON endpoint. Returns the shared result shape. */
export async function lookupJson(word) {
  const json = await fetchJson(word);

  const ec = parseEc(json);
  const collins = parseCollins(json);
  const phrases = parsePhrases(json);

  return {
    word: ec.word || word.trim(),
    phonetics: ec.phonetics,
    meanings: ec.meanings,
    wordForms: ec.wordForms,
    collins,
    phrases,
    found: ec.meanings.length > 0 || collins.length > 0,
  };
}
