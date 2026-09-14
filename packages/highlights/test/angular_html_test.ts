import assert from 'node:assert';
import t from 'node:test';

import {
  assertLineFedParity,
  checkInvariants,
  loadLang,
  tokenKinds,
} from './_util';

void t.test(
  'angular-html: bindings contain expressions and plain attributes stay strings',
  () => {
    const kinds = tokenKinds(
      'angular-html',
      '<input [(ngModel)]="user.name" [disabled]="!ready" (click)="save($event)" *ngIf="visible" #field class="plain" let-item="value" />'
    );
    for (const attribute of [
      '[(ngModel)]',
      '[disabled]',
      '(click)',
      '*ngIf',
      '#field',
      'class',
      'let-item',
    ]) {
      assert.ok(
        kinds.some(
          ([text, kind]) =>
            text.split(/\s+/).includes(attribute) && kind === 'attribute'
        ),
        attribute
      );
    }
    for (const [text, kind] of [
      ['user', 'variable'],
      ['name', 'property'],
      ['!', 'operator'],
      ['ready', 'variable'],
      ['save', 'function'],
      ['$event', 'variable.special'],
      ['visible', 'variable'],
      ['"plain"', 'string'],
      ['"value"', 'string'],
    ]) {
      assert.ok(
        kinds.some(([value, capture]) => value === text && capture === kind),
        text
      );
    }
  }
);

void t.test(
  'angular-html: interpolations, pipes, strings, and nested object braces',
  () => {
    const kinds = tokenKinds(
      'angular-html',
      '<p title="Hello {{ user.name }}!">{{ {name: "}}"} | json }} {{ total | currency : "USD" }} {{ ready || fallback }}</p>'
    );
    assert.equal(
      kinds.filter(
        ([text, kind]) => text === '{{' && kind === 'punctuation.special'
      ).length,
      4
    );
    assert.equal(
      kinds.filter(
        ([text, kind]) => text === '}}' && kind === 'punctuation.special'
      ).length,
      4
    );
    for (const pipe of ['json', 'currency']) {
      assert.ok(
        kinds.some(([text, kind]) => text === pipe && kind === 'function')
      );
    }
    assert.ok(
      kinds.some(([text, kind]) => text === '"}}"' && kind === 'string')
    );
    assert.ok(kinds.some(([text, kind]) => text === '!"' && kind === 'string'));
    assert.ok(
      kinds.some(([text, kind]) => text === 'fallback' && kind === 'variable')
    );
  }
);

void t.test(
  'angular-html: control flow, variables, and deferred blocks',
  () => {
    const code = `@let user = profile();
@if (user) { <p>{{ user.name }}</p> } @else if (pending) { <p>Wait</p> } @else { <p>No user</p> }
@for (item of items; track item.id; let i = $index) { <p>{{ i + 1 }}</p> } @empty { <p>Empty</p> }
@switch (kind) { @case ('a') { <app-a /> } @default { <app-b /> } }
@defer (on viewport; when ready; prefetch on idle) { <app-card /> }
@placeholder (minimum 500ms) { <p>Placeholder</p> }
@loading (after 100ms; minimum 1s) { <p>Loading</p> } @error { <p>Error</p> }
`;
    const kinds = tokenKinds('angular-html', code);
    for (const keyword of [
      '@if',
      '@else if',
      '@else',
      '@for',
      '@empty',
      '@switch',
      '@case',
      '@default',
      '@defer',
      '@placeholder',
      '@loading',
      '@error',
    ]) {
      assert.ok(
        kinds.some(
          ([text, kind]) => text === keyword && kind === 'keyword.control'
        ),
        keyword
      );
    }
    assert.ok(
      kinds.some(
        ([text, kind]) => text === '@let' && kind === 'keyword.declaration'
      )
    );
    assert.ok(
      kinds.some(([text, kind]) => text === 'track' && kind === 'keyword')
    );
    assert.ok(
      kinds.some(
        ([text, kind]) => text === '$index' && kind === 'variable.special'
      )
    );
    assertLineFedParity('angular-html', code);
  }
);

void t.test(
  'angular-html: multiline markup and expressions preserve state',
  () => {
    for (const code of [
      '<!-- {{ ignored }}\n @if (ignored) {} -->\n<p>&commat; &#64; &amp;</p>\n',
      '<ng-template\n #row let-item>\n <p [title]\n =\n "user.\nname"\n (click)="save(\n $event\n)">\n {{\n user.name |\n uppercase\n }}\n </p>\n</ng-template>\n',
      '<p title="Hello {{\n user.name\n }}!">{{ {\n name: "}}"\n} | json }}</p>\n',
      '@if\n (ready && (count > 0))\n { <app-card /> }\n @else\n if (pending) { Wait }\n',
      '@let user =\n profile({\n active: true\n });\n{{ user.name }}\n',
      "<p [title]=\"'first\nsecond'\">{{ 'one\ntwo' }}</p>\n",
    ]) {
      assertLineFedParity('angular-html', code);
    }
  }
);

void t.test('angular-html: malformed and split input stays lossless', () => {
  const angular = loadLang('angular-html', '$hlAngularHtml');
  for (const code of [
    '<',
    '<p [',
    '<p [title]=',
    '<p [title]="',
    '<p title="{{',
    '{{',
    '{{ "}}',
    '{{ {a: 1}',
    '@if (',
    '@let value =',
    '@unknown text',
    '<!-- {{ ignored }} -->',
    '<p [title]=name/>',
    '<p title="{literal}">',
  ]) {
    checkInvariants(angular.hl, code);
  }
  const split = loadLang('angular-html', '$hlAngularHtml', 17);
  checkInvariants(split.hl, '<p [title]="name">{{ name }}</p>');
});

void t.test('angular-html: Markdown fences use the Angular lexer', () => {
  const body = '<p [title]="name">{{ name | uppercase }}</p>\n';
  const kinds = tokenKinds('markdown', '```angular-html\n' + body + '```\n');
  assert.ok(
    kinds.some(([text, kind]) => text === 'uppercase' && kind === 'function')
  );
  assert.ok(
    kinds.some(
      ([text, kind]) => text === '{{' && kind === 'punctuation.special'
    )
  );
  assertLineFedParity('markdown', '```angular-html\n' + body + '```\n');
});
