#!/usr/bin/env node

import { writeFileSync } from 'node:fs';

const COMMONMARK = 'https://spec.commonmark.org/0.31.2/spec.json';
const GFM =
  'https://raw.githubusercontent.com/github/cmark-gfm/0.29.0.gfm.13/test/spec.txt';

async function fetchText(url) {
  console.log('🔍 Fetching', url, '...');
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: ${response.status}`);
  return response.text();
}

/** extract the example blocks from a GFM spec document */
function extractExamples(text) {
  const lines = text.split('\n');
  const fence = /^`{32,}\s*example(\s+.*)?$/;
  const out = [];
  let section = '';
  for (let i = 0; i < lines.length; ) {
    const heading = lines[i].match(/^#{1,6} (.*)$/);
    if (heading) section = heading[1].trim();
    if (!fence.test(lines[i])) {
      i++;
      continue;
    }
    const startLine = i + 1;
    i++;
    const markdown = [];
    const html = [];
    while (i < lines.length && lines[i] !== '.') markdown.push(lines[i++]);
    i++;
    while (i < lines.length && !/^`{32,}\s*$/.test(lines[i]))
      html.push(lines[i++]);
    i++;
    // the spec writes tab characters as a visible arrow
    const join = (a) =>
      (a.length ? a.join('\n') + '\n' : '').replace(/→/g, '\t');
    out.push({
      markdown: join(markdown),
      html: join(html),
      example: out.length + 1,
      start_line: startLine,
      section,
    });
  }
  return out;
}

const commonmark = JSON.parse(await fetchText(COMMONMARK));
writeFileSync(
  new URL('../test/spec/commonmark-spec.json', import.meta.url),
  JSON.stringify(commonmark, null, 1)
);
const gfm = extractExamples(await fetchText(GFM));
writeFileSync(
  new URL('../test/spec/gfm-spec.json', import.meta.url),
  JSON.stringify(gfm, null, 1)
);
!console.log(
  '✨ Done!',
  'commonmark:',
  commonmark.length,
  'examples, gfm:',
  gfm.length,
  'examples'
);
