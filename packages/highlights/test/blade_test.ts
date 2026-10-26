import { expect, test } from 'bun:test';

import { assertLineFedParity, tokenKinds } from './_util';

test('blade: echoes, raw echoes, comments, and escaped echoes', () => {
  expect(
    tokenKinds('blade', '{{-- c --}}{{ $a }} {!! $b !!} @{{ c }}')
  ).toEqual([
    ['{{-- c --}}', 'comment'],
    ['{{', 'punctuation.special'],
    ['$a', 'variable'],
    ['}}', 'punctuation.special'],
    ['{!!', 'punctuation.special'],
    ['$b', 'variable'],
    ['!!}', 'punctuation.special'],
    ['@{{', 'string.escape'],
    ['c }}', null],
  ]);
  // the first `}}` closes an echo, as in Blade's compiler
  expect(tokenKinds('blade', "{{ $a ?? '}}' }}")).toEqual([
    ['{{', 'punctuation.special'],
    ['$a', 'variable'],
    ['??', 'operator'],
    ["'", 'string'],
    ['}}', 'punctuation.special'],
    ["' }}", null],
  ]);
  const code = '{{-- one\n  two --}}\n{{ $user\n  ->name }}\n';
  expect(assertLineFedParity('blade', code).flat().length).toBeGreaterThan(0);
  expect(tokenKinds('blade', code)).toEqual([
    ['{{-- one', 'comment'],
    ['two --}}', 'comment'],
    ['{{', 'punctuation.special'],
    ['$user', 'variable'],
    ['->', 'operator'],
    ['name', 'property'],
    ['}}', 'punctuation.special'],
  ]);
});

test('blade: directives by class, in any case, with PHP arguments', () => {
  expect(
    tokenKinds(
      'blade',
      "@extends('app') @section('a') @if($n > 1) @else @endif @endsection"
    )
  ).toEqual([
    ['@extends', 'keyword.import'],
    ['(', 'punctuation.bracket'],
    ["'app'", 'string'],
    [')', 'punctuation.bracket'],
    ['@section', 'keyword'],
    ['(', 'punctuation.bracket'],
    ["'a'", 'string'],
    [')', 'punctuation.bracket'],
    ['@if', 'keyword.control'],
    ['(', 'punctuation.bracket'],
    ['$n', 'variable'],
    ['>', 'operator'],
    ['1', 'number'],
    [')', 'punctuation.bracket'],
    ['@else', 'keyword.control'],
    ['@endif', 'keyword.control'],
    ['@endsection', 'keyword'],
  ]);
  // unknown names are custom directives only with arguments; an `@` after a
  // word byte is part of an address
  expect(
    tokenKinds('blade', '@includeIf(1) @datetime($d) @media x@y.z @endPushOnce')
  ).toEqual([
    ['@includeIf', 'keyword.import'],
    ['(', 'punctuation.bracket'],
    ['1', 'number'],
    [')', 'punctuation.bracket'],
    ['@datetime', 'function'],
    ['(', 'punctuation.bracket'],
    ['$d', 'variable'],
    [')', 'punctuation.bracket'],
    ['@media x@y.z', null],
    ['@endPushOnce', 'keyword'],
  ]);
  // arguments run to the `)` that balances them, outside strings
  const code = "@include('x', [\n  'a' => ')',\n]) done\n";
  assertLineFedParity('blade', code);
  expect(tokenKinds('blade', code)).toEqual([
    ['@include', 'keyword.import'],
    ['(', 'punctuation.bracket'],
    ["'x'", 'string'],
    [',', 'punctuation.delimiter'],
    ['[', 'punctuation.bracket'],
    ["'a'", 'string'],
    ['=>', 'operator'],
    ["')'", 'string'],
    [',', 'punctuation.delimiter'],
    ['])', 'punctuation.bracket'],
    ['done', null],
  ]);
});

test('blade: constructs inside tags, quoted values, and components', () => {
  expect(
    tokenKinds(
      'blade',
      '<div class="a {{ $b }}" @click="go" @class([$c])>@@if</div>'
    )
  ).toEqual([
    ['<', 'punctuation.bracket.html'],
    ['div', 'tag'],
    ['class', 'attribute'],
    ['=', 'punctuation.delimiter.html'],
    ['"a', 'string'],
    ['{{', 'punctuation.special'],
    ['$b', 'variable'],
    ['}}', 'punctuation.special'],
    ['"', 'string'],
    ['@click', 'attribute'],
    ['=', 'punctuation.delimiter.html'],
    ['"go"', 'string'],
    ['@class', 'keyword'],
    ['([', 'punctuation.bracket'],
    ['$c', 'variable'],
    ['])', 'punctuation.bracket'],
    ['>', 'punctuation.bracket.html'],
    ['@@', 'string.escape'],
    ['if', null],
    ['</', 'punctuation.bracket.html'],
    ['div', 'tag'],
    ['>', 'punctuation.bracket.html'],
  ]);
  // only a component's `:name` values are PHP; `::name` stays markup
  expect(tokenKinds('blade', '<x-alert :type="$t" ::a="b" :c="d" />')).toEqual([
    ['<', 'punctuation.bracket.html'],
    ['x-alert', 'tag'],
    [':type', 'attribute'],
    ['=', 'punctuation.delimiter.html'],
    ['"', 'string'],
    ['$t', 'variable'],
    ['"', 'string'],
    ['::a', 'attribute'],
    ['=', 'punctuation.delimiter.html'],
    ['"b"', 'string'],
    [':c', 'attribute'],
    ['=', 'punctuation.delimiter.html'],
    ['"', 'string'],
    ['d', 'variable'],
    ['"', 'string'],
    ['/>', 'punctuation.bracket.html'],
  ]);
  expect(tokenKinds('blade', '<p :a="$b">')).toContainEqual(['"$b"', 'string']);
});

test('blade: PHP blocks and verbatim blocks', () => {
  const code =
    "@php\n  $a = 'x'; /* c\n  d */\n@endphp\n<?= $a ?>\n@verbatim\n<b>{{ v }}</b> @if\n@endverbatim\n";
  assertLineFedParity('blade', code);
  expect(tokenKinds('blade', code)).toEqual([
    ['@php', 'keyword'],
    ['$a', 'variable'],
    ['=', 'operator'],
    ["'x'", 'string'],
    [';', 'punctuation.delimiter'],
    ['/* c', 'comment'],
    ['d */', 'comment'],
    ['@endphp', 'keyword'],
    ['<?=', 'preproc'],
    ['$a', 'variable'],
    ['?>', 'preproc'],
    ['@verbatim', 'keyword'],
    ['<', 'punctuation.bracket.html'],
    ['b', 'tag'],
    ['>', 'punctuation.bracket.html'],
    ['{{ v }}', null],
    ['</', 'punctuation.bracket.html'],
    ['b', 'tag'],
    ['>', 'punctuation.bracket.html'],
    ['@if', null],
    ['@endverbatim', 'keyword'],
  ]);
  // a script body keeps its own lexer across lines
  assertLineFedParity(
    'blade',
    '@verbatim\n<script>\nlet a = `{{ x }}\n`;\n</script>\n@endverbatim\n'
  );
});
