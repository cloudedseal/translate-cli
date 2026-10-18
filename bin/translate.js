#!/usr/bin/env node
/**
 * translate – list all meanings of an English word from the Collins dictionary
 * (Collins data is served through Youdao Dictionary, which is not bot-blocked).
 *
 * Usage:
 *   translate <english word or phrase>
 *   translate --help
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { lookup, LookupError } from '../lib/youdao.js';

/* ---------------- flags & colors (defined early: used while parsing args) ---- */

const flags = { help: false, version: false, color: null, examples: true };

// Evaluated lazily so that --no-color / NO_COLOR are honored wherever used.
const colorAllowed = () =>
  flags.color !== null
    ? flags.color
    : Boolean(process.stdout.isTTY) && !('NO_COLOR' in process.env);

const wrap = (open, close) => (s) => (colorAllowed() ? `\x1b[${open}m${s}\x1b[${close}m` : String(s));
const bold = wrap(1, 22);
const dim = wrap(2, 22);
const red = wrap(31, 39);
const green = wrap(32, 39);
const yellow = wrap(33, 39);
const cyan = wrap(36, 39);
const magenta = wrap(35, 39);

function printError(msg) {
  console.error(`${red('error')}: ${msg}`);
}

function printHelp() {
  console.log(`
${bold('translate')} – list all meanings of an English word (source: Collins dictionary via Youdao)

${bold('Usage')}
  translate <word or phrase>
  translate hello
  translate "look after"

${bold('Options')}
  -h, --help        show this help
  -v, --version     show version
  --no-color        disable colored output
  --no-examples     hide example sentences

${bold('Output sections')}
  基本释义            short part-of-speech meanings
  柯林斯英汉双解大词典   Collins English-Chinese senses (numbered, with examples)
  相关短语             related phrases
`);
}

/* ---------------- CLI arguments ---------------- */

const argv = process.argv.slice(2);
const words = [];

for (const arg of argv) {
  switch (arg) {
    case '-h':
    case '--help': flags.help = true; break;
    case '-v':
    case '--version': flags.version = true; break;
    case '--no-color': flags.color = false; break;
    case '--color': flags.color = true; break;
    case '--no-examples': flags.examples = false; break;
    default:
      if (arg.startsWith('-') && arg.length > 1) {
        printError(`unknown option: ${arg}`);
        process.exit(2);
      }
      words.push(arg);
  }
}

const query = words.join(' ').trim();

function packageVersion() {
  try {
    const pkgPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'package.json');
    return JSON.parse(readFileSync(pkgPath, 'utf8')).version;
  } catch {
    return 'unknown';
  }
}

if (flags.version) {
  console.log('translate ' + packageVersion());
  process.exit(0);
}
if (flags.help || !query) {
  printHelp();
  process.exit(flags.help ? 0 : 1);
}

/* ---------------- main ---------------- */

function indent(s, width) {
  return s.replace(/\n/g, '\n' + ' '.repeat(width));
}

function stars(entry) {
  return entry.stars ? '★'.repeat(entry.stars) : '';
}

function renderEntry(entry, isPrimary) {
  const out = [];

  if (entry.title && entry.title.toLowerCase() !== query.toLowerCase()) {
    out.push('');
    out.push(bold('▸ ' + entry.title));
  }

  const meta = [entry.phonetic, entry.rank, stars(entry), entry.pattern]
    .filter(Boolean)
    .map(dim)
    .join('  ');
  if (meta && !isPrimary) out.push('  ' + meta);

  entry.senses.forEach((sense, i) => {
    out.push('');
    const num = sense.order || String(i + 1);
    let line = `  ${green(bold(num + '.'))} `;
    if (sense.pos) {
      line += magenta(sense.pos.abbr);
      if (sense.pos.cn) line += ' ' + dim(sense.pos.cn);
    }
    out.push(line.trimEnd());
    if (sense.en) out.push(indent('     ' + sense.en, 5));
    if (sense.zh) out.push(indent('     ' + cyan(sense.zh), 5));
    if (flags.examples) {
      for (const ex of sense.examples) {
        if (ex.en) out.push(indent('     ' + dim('例 ' + ex.en), 5));
        if (ex.zh) out.push(indent('     ' + dim('   ' + ex.zh), 5));
      }
    }
  });
  return out;
}

async function main() {
  let result;
  try {
    result = await lookup(query);
  } catch (err) {
    if (err instanceof LookupError) printError(err.message);
    else printError(err.stack || String(err));
    process.exit(1);
  }

  if (!result.found) {
    printError(`no dictionary entry found for "${query}"`);
    process.exit(1);
  }

  const out = [];

  // Header: word + phonetics
  out.push(bold(result.word || query));
  const ph = result.phonetics
    .map((p) => (p.label ? p.label + ' ' : '') + p.ipa)
    .join('   ');
  if (ph) out.push(cyan(ph));
  if (result.wordForms && result.wordForms.length) {
    out.push(dim('词形  ' + result.wordForms.join(' · ')));
  }

  // Basic meanings
  if (result.meanings.length) {
    out.push('');
    out.push(yellow(bold('基本释义')));
    for (const m of result.meanings) out.push('  ' + m);
  }

  // Collins
  if (result.collins.length) {
    out.push('');
    out.push(yellow(bold('柯林斯英汉双解大词典')));
    const firstEntry = result.collins[0];
    const meta = [firstEntry.phonetic, firstEntry.rank, stars(firstEntry), firstEntry.pattern]
      .filter(Boolean)
      .map(dim)
      .join('  ');
    if (meta) out.push('  ' + meta);
    result.collins.forEach((entry, idx) => out.push(...renderEntry(entry, idx === 0)));
  }

  // Phrases
  if (result.phrases.length) {
    out.push('');
    out.push(yellow(bold('相关短语')));
    for (const p of result.phrases) out.push('  ' + p);
  }

  console.log(out.join('\n'));
}

main();
