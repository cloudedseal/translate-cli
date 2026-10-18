/**
 * Minimal dependency-free HTML parser.
 * Produces a simple node tree:
 *   { type: 'tag', tag, attrs, children, parent }
 *   { type: 'text', data, parent }
 */

const VOID_TAGS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr',
]);

const RAW_TEXT_TAGS = new Set(['script', 'style']);

const ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'",
  nbsp: ' ', ensp: ' ', emsp: ' ', thinsp: ' ',
  ndash: '–', mdash: '—', hellip: '…',
  lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”',
  bull: '•', middot: '·', copy: '©', reg: '®', trade: '™',
  laquo: '«', raquo: '»', times: '×', divide: '÷',
  plusmn: '±', deg: '°', sect: '§', para: '¶',
  shy: '', zwj: '', lrm: '', rlm: '',
};

export function decodeEntities(str) {
  if (!str || str.indexOf('&') === -1) return str;
  return str.replace(/&(?:#x([0-9a-fA-F]+)|#(\d+)|([a-zA-Z]+));/g, (m, hex, dec, named) => {
    try {
      if (hex) return String.fromCodePoint(parseInt(hex, 16));
      if (dec) return String.fromCodePoint(parseInt(dec, 10));
      const key = named.toLowerCase();
      if (Object.prototype.hasOwnProperty.call(ENTITIES, key)) return ENTITIES[key];
    } catch {
      /* invalid code point – keep original */
    }
    return m;
  });
}

function parseTag(html, lt) {
  let i = lt + 1;
  const nameMatch = /^[a-zA-Z][^\s/>]*/.exec(html.slice(i, i + 64));
  if (!nameMatch) return null;
  const tag = nameMatch[0].toLowerCase();
  i += nameMatch[0].length;
  const attrs = {};
  const len = html.length;
  while (i < len) {
    while (i < len && /\s/.test(html[i])) i++;
    if (i >= len) break;
    if (html[i] === '>') { i++; break; }
    if (html[i] === '/' && html[i + 1] === '>') { i += 2; return { tag, attrs, end: i, selfClose: true }; }
    // attribute name
    const start = i;
    while (i < len && !/[\s=>/]/.test(html[i])) i++;
    const name = html.slice(start, i);
    while (i < len && /\s/.test(html[i])) i++;
    let value = '';
    if (html[i] === '=') {
      i++;
      while (i < len && /\s/.test(html[i])) i++;
      const q = html[i];
      if (q === '"' || q === "'") {
        i++;
        const e = html.indexOf(q, i);
        value = html.slice(i, e < 0 ? len : e);
        i = e < 0 ? len : e + 1;
      } else {
        const vs = i;
        while (i < len && !/[\s>]/.test(html[i])) i++;
        value = html.slice(vs, i);
      }
    }
    if (name) attrs[name.toLowerCase()] = decodeEntities(value);
  }
  return { tag, attrs, end: i, selfClose: false };
}

export function parse(html) {
  const root = { type: 'tag', tag: '#root', attrs: {}, children: [], parent: null };
  const stack = [root];
  const len = html.length;
  let i = 0;

  const top = () => stack[stack.length - 1];
  const addText = (raw) => {
    const data = decodeEntities(raw);
    if (data) top().children.push({ type: 'text', data, parent: top() });
  };

  while (i < len) {
    const lt = html.indexOf('<', i);
    if (lt < 0) { addText(html.slice(i)); break; }
    if (lt > i) addText(html.slice(i, lt));

    if (html.startsWith('<!--', lt)) {
      const e = html.indexOf('-->', lt);
      i = e < 0 ? len : e + 3;
      continue;
    }
    if (html.startsWith('<!', lt)) { // doctype, cdata
      const e = html.indexOf('>', lt);
      i = e < 0 ? len : e + 1;
      continue;
    }
    if (html.startsWith('</', lt)) {
      const e = html.indexOf('>', lt);
      if (e < 0) break;
      const name = html.slice(lt + 2, e).trim().toLowerCase();
      for (let s = stack.length - 1; s > 0; s--) {
        if (stack[s].tag === name) { stack.length = s; break; }
      }
      i = e + 1;
      continue;
    }

    const parsed = parseTag(html, lt);
    if (!parsed) { addText('<'); i = lt + 1; continue; }

    const node = { type: 'tag', tag: parsed.tag, attrs: parsed.attrs, children: [], parent: top() };
    top().children.push(node);

    if (RAW_TEXT_TAGS.has(parsed.tag)) {
      const closeIdx = html.toLowerCase().indexOf('</' + parsed.tag, parsed.end);
      if (closeIdx < 0) { i = len; } else {
        const e = html.indexOf('>', closeIdx);
        i = e < 0 ? len : e + 1;
      }
      continue;
    }
    if (!VOID_TAGS.has(parsed.tag) && !parsed.selfClose) stack.push(node);
    i = parsed.end;
  }
  return root;
}

/* ---------- query helpers ---------- */

export function findAll(node, pred, out = []) {
  for (const child of node.children) {
    if (child.type !== 'tag') continue;
    if (pred(child)) out.push(child);
    findAll(child, pred, out);
  }
  return out;
}

export function first(node, pred) {
  for (const child of node.children) {
    if (child.type !== 'tag') continue;
    if (pred(child)) return child;
    const found = first(child, pred);
    if (found) return found;
  }
  return null;
}

export function byId(root, id) {
  return first(root, (n) => n.attrs.id === id);
}

export function hasClass(node, name) {
  const cls = node.attrs.class;
  if (!cls) return false;
  return cls.split(/\s+/).includes(name);
}

export function byClass(root, name) {
  return findAll(root, (n) => hasClass(n, name));
}

/** Text content of a node (scripts/styles excluded), whitespace collapsed. */
export function text(node) {
  if (!node) return '';
  let out = '';
  const walk = (n) => {
    for (const c of n.children) {
      if (c.type === 'text') out += c.data;
      else if (!RAW_TEXT_TAGS.has(c.tag)) walk(c);
    }
  };
  if (node.type === 'text') out = node.data;
  else walk(node);
  return out.replace(/[ ​⁠]/g, ' ').replace(/\s+/g, ' ').trim();
}
