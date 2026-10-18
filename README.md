# translate-cli

Look up an English word in the terminal and **list all of its meanings** from the
**Collins dictionary** (柯林斯英汉双解大词典), with phonetics, part-of-speech tags,
example sentences and related phrases.

```console
$ translate hello
hello
英 [həˈləʊ]   美 [həˈloʊ]
词形  复数 hellos · 第三人称单数 helloes · 现在分词 helloing · 过去式 helloed · 过去分词 helloed

基本释义
  int. 喂，你好（用于问候或打招呼）…；喂，你好（打电话时的招呼语）…
  n. 招呼，问候…
  v. 说（或大声说）“喂”；打招呼

柯林斯英汉双解大词典
  /hɛˈləʊ/  CET4 TEM4  ★★★  (also hullo)

  1. CONVENTION 习惯表达
     You say "Hello" to someone when you meet them.
     你好 (打招呼用语) [套语]
     例 Hello, Trish. I won't shake hands, because I'm filthy.
        你好，特里斯。我就不握手了，我的手好脏。

  2. N-COUNT 可数名词
     Hello is also a noun.
     招呼
     ...

相关短语
  say hello 打招呼；问好
```

## Install

Requires Node.js ≥ 18 (no dependencies at all).

```sh
# make the `translate` command available everywhere
npm link
```

Or without linking, run it directly:

```sh
node bin/translate.js hello
```

To remove the global command later: `npm unlink -g translate-cli`

## Usage

```sh
translate <word or phrase>
translate hello
translate "look after"
translate don't
```

| Option         | Effect                              |
| -------------- | ----------------------------------- |
| `-h, --help`   | show help                           |
| `-v, --version`| show version                        |
| `--no-color`   | disable colored output              |
| `--no-examples`| hide example sentences              |

Colors are disabled automatically when output is piped or when `NO_COLOR` is set.

## Output sections

| Section              | Meaning                                                  |
| -------------------- | -------------------------------------------------------- |
| phonetics / 词形     | UK & US pronunciation, inflected forms                   |
| 基本释义             | short part-of-speech + meaning list                      |
| 柯林斯英汉双解大词典  | all numbered Collins senses: POS tag, English definition, Chinese meaning, examples |
| 相关短语             | common phrases containing the word                       |

## How it works / data sources

1. **Primary** – Youdao's JSON endpoint (`dict.youdao.com/jsonapi`) returns
   structured data including the *Collins English-Chinese Advanced Dictionary*
   (柯林斯英汉双解大词典). This works even for contractions like `don't`.
2. **Fallback** – if the JSON endpoint fails, the CLI downloads the dictionary
   page (`dict.youdao.com/w/<word>`) and parses the HTML with a built-in
   zero-dependency HTML parser.

Notes:

- `collinsdictionary.com` itself is protected by Cloudflare and blocks
  non-browser clients, which is why the Collins content is read through
  Youdao, which legitimately publishes the Collins bilingual data.
- Bing Dictionary renders its content with JavaScript (not readable via plain
  HTTP) and Baidu Hanyu returns an empty shell, so neither is used.

## Project layout

```
bin/translate.js    CLI entry point: args, formatting, output
lib/youdao.js       source chain (JSON → HTML fallback), HTML-page parsing
lib/youdao-json.js  JSON endpoint fetch + Collins/ec/phrases parsing
lib/html.js         minimal dependency-free HTML parser + query helpers
lib/errors.js       shared LookupError
```

## License

MIT
