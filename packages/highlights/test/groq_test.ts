import assert from 'node:assert';
import t from 'node:test';

import {
  assertLineFedParity,
  checkInvariants,
  distinctColor,
  distinctTheme,
  exactColor,
  loadLang,
  makeRand,
  spansOf,
  type TestLang,
  textOf,
  tokenKinds,
  wordColor,
} from './_util';

let lexer: TestLang;
t.before(() => {
  lexer = loadLang('groq', '$hlGroq');
});

/** Highlight under the distinct theme after checking the lexer invariants. */
const distinctHl = (src: string) =>
  checkInvariants(lexer.hl, src, { theme: distinctTheme });

/** Join lines with `\n` and end with a trailing newline, like a saved file. */
const lines = (...ls: string[]): string => ls.join('\n') + '\n';

/**
 * Check every token of a documentation query against `table`, which maps a
 * token's trimmed text to the kind it must have everywhere it appears, or to
 * the kinds of its successive occurrences when one spelling classifies
 * differently by position (`text` as `pt::text(` and as `text::query(`).
 * Neighboring tokens of one kind arrive merged, so brackets are listed as
 * they run together (`]{`, `))`). Every entry must be used, and only `//`
 * comments may go unlisted: they are checked by shape instead, so the table
 * stays about the query rather than the prose beside it. The query must also
 * highlight losslessly and stream line-fed exactly like the whole buffer.
 */
function expectKinds(
  code: string,
  table: Record<string, string | readonly string[]>
): void {
  checkInvariants(lexer.hl, code);
  assertLineFedParity('groq', code);
  const seen = new Map<string, number>();
  for (const [text, kind] of tokenKinds('groq', code)) {
    if (text.startsWith('//')) {
      assert.equal(kind, 'comment', text);
      continue;
    }
    assert.notEqual(kind, 'comment', text);
    const want = table[text];
    assert.ok(want !== undefined, `unlisted ${JSON.stringify(text)}: ${kind}`);
    const n = seen.get(text) ?? 0;
    seen.set(text, n + 1);
    const expected = typeof want === 'string' ? want : want[n];
    assert.equal(kind, expected, `${JSON.stringify(text)} #${n + 1}`);
  }
  for (const [text, want] of Object.entries(table)) {
    const n = seen.get(text) ?? 0;
    assert.ok(n > 0, `unused entry ${JSON.stringify(text)}`);
    if (typeof want !== 'string') {
      assert.equal(n, want.length, `occurrences of ${JSON.stringify(text)}`);
    }
  }
}

void t.test(
  'groq: filters, pipes, projections, dereferences, and ranges',
  () => {
    const html = distinctHl(
      '// Latest posts\n*[_type == "post" && !(_id in path("drafts.**"))] | order(publishedAt desc) [0...10] {\n  title,\n  "excerpt": pt::text(body[0..1]),\n  "author": author-> { name, "avatar": image.asset->url },\n  "categories": categories[]-> { title, slug }\n}'
    );
    assert.equal(wordColor(html, '//'), distinctColor('comment'));
    assert.equal(exactColor(html, '*'), distinctColor('variable.special'));
    for (const prop of [
      '_type',
      '_id',
      'publishedAt',
      'title',
      'body',
      'author',
      'name',
      'image',
      'asset',
      'url',
      'categories',
      'slug',
    ]) {
      assert.equal(wordColor(html, prop), distinctColor('property'), prop);
    }
    for (const s of ['"post"', '"drafts.**"', '"excerpt"', '"author"']) {
      assert.equal(exactColor(html, s), distinctColor('string'), s);
    }
    for (const kw of ['in', 'desc']) {
      assert.equal(exactColor(html, kw), distinctColor('keyword.operator'), kw);
    }
    for (const fn of ['path', 'order', 'text']) {
      assert.equal(exactColor(html, fn), distinctColor('function'), fn);
    }
    assert.equal(exactColor(html, 'pt'), distinctColor('namespace'));
    for (const op of ['==', '|', '...', '..', '->']) {
      assert.equal(wordColor(html, op), distinctColor('operator'), op);
    }
    assert.equal(wordColor(html, '&&'), distinctColor('operator'));
    for (const n of ['0', '10', '1']) {
      assert.equal(wordColor(html, n), distinctColor('number'), n);
    }
    assert.equal(
      exactColor(html, '::'),
      distinctColor('punctuation.delimiter')
    );
  }
);

// ---- the GROQ query cheat sheet, section by section ----

void t.test('groq cheat sheet: filters', () => {
  expectKinds(
    lines(
      '* // Everything, i.e. all documents',
      '*[] // Everything with no filters applied, i.e. all documents',
      '*[_type == "movie"] // All movie documents',
      '*[_id == "abc.123"] // _id equals',
      '*[_type in ["movie", "person"]] // _type is movie or person',
      '*[_type == "movie" && popularity > 15 && releaseDate > "2016-04-25"] // multiple filters AND',
      '*[_type == "movie" && (popularity > 15 || releaseDate > "2016-04-25")] // multiple filters OR',
      '*[popularity < 15] // less than',
      '*[popularity <= 15] // less than or equal',
      '*[popularity >= 15] // greater than or equal',
      '*[releaseDate != "2016-04-27"] // not equal',
      '*[!(releaseDate == "2016-04-27")] // not equal',
      '*[!(releaseDate != "2016-04-27")] // even equal via double negatives "not not equal"',
      "*[dateTime(_updatedAt) > dateTime('2018-04-20T20:43:31Z')] // Use zulu-time when comparing datetimes to strings",
      '*[name < "Baker"] // Records whose name precedes "Baker" alphabetically',
      '*[awardWinner == true] // match boolean',
      '*[!awardWinner] // true if awardWinner == false',
      '*[defined(awardWinner)] // has been assigned an award winner status (any kind of value)',
      '*[!defined(awardWinner)] // has not been assigned an award winner status (any kind of value)',
      '*[title in ["Aliens", "Interstellar", "Passengers"]]',
      '*[_id in path("a.b.c.*")] // _id matches a.b.c.d but not a.b.c.d.e',
      '*[!(_id in path("a.b.c.**"))] // _id matches anything that is not under the a.b.c path or deeper',
      '*["yolo" in tags] // documents that have the string "yolo" in the array "tags"',
      '*["person_sigourney-weaver" in castMembers[].person._ref] // Any document having a castMember referencing sigourney as its person',
      '*[slug.current == "some-slug"] // nested properties',
      '*[count((categories[]->slug.current)[@ in ["action", "thriller"]]) > 0] // documents that reference categories with slugs of "action" or "thriller"',
      "*[sanity::dataset() == 'production'] // compare dataset where query is run. Useful in webhooks or functions",
      "*[sanity::dataset() in ['prod', 'staging', 'next']] // compare dataset name with list",
      "*[string::startsWith(sanity::dataset(), 'prod_')] // check for prefixed dataset names, such as prod_marketing, prod_cs, etc.",
      '*[_type == "movie" && genre == user::attributes().genre] // All movie documents that have a genre that matches the genre attribute on the current user (premium feature)'
    ),
    {
      '*': 'variable.special',
      '[]': 'punctuation.bracket',
      '[': 'punctuation.bracket',
      _type: 'property',
      '==': 'operator',
      '"movie"': 'string',
      ']': 'punctuation.bracket',
      _id: 'property',
      '"abc.123"': 'string',
      in: 'keyword.operator',
      ',': 'punctuation.delimiter',
      '"person"': 'string',
      ']]': 'punctuation.bracket',
      '&&': 'operator',
      popularity: 'property',
      '>': 'operator',
      '15': 'number',
      releaseDate: 'property',
      '"2016-04-25"': 'string',
      '(': 'punctuation.bracket',
      '||': 'operator',
      ')]': 'punctuation.bracket',
      '<': 'operator',
      '<=': 'operator',
      '>=': 'operator',
      '!=': 'operator',
      '"2016-04-27"': 'string',
      '!': 'operator',
      dateTime: 'function',
      _updatedAt: 'property',
      ')': 'punctuation.bracket',
      "'2018-04-20T20:43:31Z'": 'string',
      name: 'property',
      '"Baker"': 'string',
      awardWinner: 'property',
      true: 'boolean',
      defined: 'function',
      title: 'property',
      '"Aliens"': 'string',
      '"Interstellar"': 'string',
      '"Passengers"': 'string',
      path: 'function',
      '"a.b.c.*"': 'string',
      '"a.b.c.**"': 'string',
      '))]': 'punctuation.bracket',
      '"yolo"': 'string',
      tags: 'property',
      '"person_sigourney-weaver"': 'string',
      castMembers: 'property',
      '.': 'punctuation.delimiter',
      person: 'property',
      _ref: 'property',
      slug: 'property',
      current: 'property',
      '"some-slug"': 'string',
      count: 'function',
      '((': 'punctuation.bracket',
      categories: 'property',
      '->': 'operator',
      ')[': 'punctuation.bracket',
      '@': 'variable.special',
      '"action"': 'string',
      '"thriller"': 'string',
      ']])': 'punctuation.bracket',
      '0': 'number',
      sanity: 'namespace',
      '::': 'punctuation.delimiter',
      dataset: 'function',
      '()': 'punctuation.bracket',
      "'production'": 'string',
      "'prod'": 'string',
      "'staging'": 'string',
      "'next'": 'string',
      string: 'namespace',
      startsWith: 'function',
      "'prod_'": 'string',
      genre: 'property',
      user: 'namespace',
      attributes: 'function',
    }
  );
  // the week filter multiplies after an operand and selects after `(`
  assert.deepEqual(
    tokenKinds(
      'groq',
      '*[dateTime(_updatedAt) > dateTime(now()) - 60*60*24*7] // Updated within the past week'
    ),
    [
      ['*', 'variable.special'],
      ['[', 'punctuation.bracket'],
      ['dateTime', 'function'],
      ['(', 'punctuation.bracket'],
      ['_updatedAt', 'property'],
      [')', 'punctuation.bracket'],
      ['>', 'operator'],
      ['dateTime', 'function'],
      ['(', 'punctuation.bracket'],
      ['now', 'function'],
      ['())', 'punctuation.bracket'],
      ['-', 'operator'],
      ['60', 'number'],
      ['*', 'operator'],
      ['60', 'number'],
      ['*', 'operator'],
      ['24', 'number'],
      ['*', 'operator'],
      ['7', 'number'],
      [']', 'punctuation.bracket'],
      ['// Updated within the past week', 'comment'],
    ]
  );
});

void t.test('groq cheat sheet: text matching', () => {
  expectKinds(
    lines(
      '// Text contains the word "word"',
      '*[text match "word"]',
      '',
      '// Title contains a word starting with "wo"',
      '*[title match "wo*"]',
      '',
      '// Inverse of the previous query; animal matches the start of the word "caterpillar" (perhaps animal == "cat")',
      '*["caterpillar" match animal + "*"]',
      '',
      '// Title and body combined contains a word starting with "wo" and the full word "zero"',
      '*[[title, body] match ["wo*", "zero"]]',
      '',
      '// Are there aliens in my rich text?',
      '*[body[].children[].text match "aliens"]',
      '',
      '// Note how match operates on tokens!',
      '"foo bar" match "fo*"  // -> true',
      '"my-pretty-pony-123.jpg" match "my*.jpg"  // -> false'
    ),
    {
      '*': 'variable.special',
      '[': 'punctuation.bracket',
      text: 'property',
      match: 'keyword.operator',
      '"word"': 'string',
      ']': 'punctuation.bracket',
      title: 'property',
      '"wo*"': 'string',
      '"caterpillar"': 'string',
      animal: 'property',
      '+': 'operator',
      '"*"': 'string',
      '[[': 'punctuation.bracket',
      ',': 'punctuation.delimiter',
      body: 'property',
      '"zero"': 'string',
      ']]': 'punctuation.bracket',
      '[]': 'punctuation.bracket',
      '.': 'punctuation.delimiter',
      children: 'property',
      '"aliens"': 'string',
      '"foo bar"': 'string',
      '"fo*"': 'string',
      '"my-pretty-pony-123.jpg"': 'string',
      '"my*.jpg"': 'string',
    }
  );
});

void t.test('groq cheat sheet: slice operations', () => {
  expectKinds(
    lines(
      '*[_type == "movie"][0] // a single movie (an object is returned, not an array)',
      '*[_type == "movie"][0..5] // first 6 movies (inclusive)',
      '*[_type == "movie"][0...5] // first 5 movies (non-inclusive)',
      '*[_type == "movie"]{title}[0...10] // first 10 movie titles',
      '*[_type == "movie"][0...10]{title} // first 10 movie titles',
      '*[_type == "movie"][10...20]{title} // first 10 movie titles, offset by 10',
      '*[_type == "movie"] // no slice specified --> all movies are returned'
    ),
    {
      '*': 'variable.special',
      '[': 'punctuation.bracket',
      _type: 'property',
      '==': 'operator',
      '"movie"': 'string',
      '][': 'punctuation.bracket',
      '0': 'number',
      ']': 'punctuation.bracket',
      '..': 'operator',
      '5': 'number',
      '...': 'operator',
      ']{': 'punctuation.bracket',
      title: 'property',
      '}[': 'punctuation.bracket',
      '10': 'number',
      '}': 'punctuation.bracket',
      '20': 'number',
    }
  );
});

void t.test('groq cheat sheet: ordering', () => {
  expectKinds(
    lines(
      '// order results',
      '*[_type == "movie"] | order(_createdAt asc)',
      '',
      '// order results by multiple attributes',
      '*[_type == "movie"] | order(releaseDate desc) | order(_createdAt asc)',
      '',
      '// order todo items by descending priority,',
      '// where priority is equal, list most recently updated',
      '// item first',
      '*[_type == "todo"] | order(priority desc, _updatedAt desc)',
      '',
      '// the single, oldest document',
      '*[_type == "movie"] | order(_createdAt asc)[0]',
      '',
      '// oldest 10 documents',
      '*[_type == "movie"] | order(_createdAt asc)[0..9]',
      '',
      '// BEWARE! This selects 10 documents using the default',
      '// ordering, and *only the selection* is ordered by',
      '// _createdAt in ascending order',
      '*[_type == "movie"][0..9] | order(_createdAt asc)',
      '',
      '// order results alphabetically by a string field,',
      '// ignoring case',
      '*[_type == "movie"] | order(lower(title) asc)'
    ),
    {
      '*': 'variable.special',
      '[': 'punctuation.bracket',
      _type: 'property',
      '==': 'operator',
      '"movie"': 'string',
      ']': 'punctuation.bracket',
      '|': 'operator',
      order: 'function',
      '(': 'punctuation.bracket',
      _createdAt: 'property',
      asc: 'keyword.operator',
      ')': 'punctuation.bracket',
      releaseDate: 'property',
      desc: 'keyword.operator',
      '"todo"': 'string',
      priority: 'property',
      ',': 'punctuation.delimiter',
      _updatedAt: 'property',
      ')[': 'punctuation.bracket',
      '0': 'number',
      '..': 'operator',
      '9': 'number',
      '][': 'punctuation.bracket',
      lower: 'function',
      title: 'property',
    }
  );
});

void t.test('groq cheat sheet: joins', () => {
  expectKinds(
    lines(
      '// Fetch movies with title, and join with poster asset with path + url',
      "*[_type=='movie']{title,poster{asset->{path,url}}}",
      '',
      '// Say castMembers is an array containing objects with character name and a reference to the person:',
      '// We want to fetch movie with title and an attribute named "cast" which is an array of actor names',
      "*[_type=='movie']{title,'cast': castMembers[].person->name}",
      '',
      '// Same query as above, except "cast" now contains objects with person._id and person.name',
      "*[_type=='movie']{title,'cast': castMembers[].person->{_id, name}}",
      '',
      '// Using the ^ operator to refer to the enclosing document. Here ^._id refers to the id',
      '// of the enclosing person record.',
      '*[_type=="person"]{',
      '  name,',
      '  "relatedMovies": *[_type==\'movie\' && references(^._id)]{ title }',
      '}',
      '',
      '// Books by author.name (book.author is a reference)',
      '*[_type == "book" && author._ref in *[_type=="author" && name=="John Doe"]._id ]{...}'
    ),
    {
      '*': 'variable.special',
      '[': 'punctuation.bracket',
      _type: 'property',
      '==': 'operator',
      "'movie'": 'string',
      ']{': 'punctuation.bracket',
      title: 'property',
      ',': 'punctuation.delimiter',
      poster: 'property',
      '{': 'punctuation.bracket',
      asset: 'property',
      '->': 'operator',
      path: 'property',
      url: 'property',
      '}}}': 'punctuation.bracket',
      "'cast'": 'string',
      ':': 'punctuation.delimiter',
      castMembers: 'property',
      '[]': 'punctuation.bracket',
      '.': 'punctuation.delimiter',
      person: 'property',
      name: 'property',
      '}': 'punctuation.bracket',
      _id: 'property',
      '}}': 'punctuation.bracket',
      '"person"': 'string',
      '"relatedMovies"': 'string',
      '&&': 'operator',
      references: 'function',
      '(': 'punctuation.bracket',
      '^': 'variable.special',
      ')]{': 'punctuation.bracket',
      '"book"': 'string',
      author: 'property',
      _ref: 'property',
      in: 'keyword.operator',
      '"author"': 'string',
      '"John Doe"': 'string',
      ']': 'punctuation.bracket',
      '...': 'operator',
    }
  );
});

void t.test('groq cheat sheet: objects and arrays', () => {
  expectKinds(
    lines(
      '// Create your own objects',
      '{',
      '  // People ordered by Nobel prize year',
      '  "peopleByPrizeYear": *[]|order(prizes[0].year desc){',
      '    "name": firstname + " " + surname,',
      '    "orderYear": prizes[0].year,',
      '    prizes',
      '  },',
      '  // List of all prizes ordered by year awarded',
      '  "allPrizes": *[].prizes[]|order(year desc)',
      '}',
      '',
      '// Get all Nobel prizes from all root person documents',
      '*[].prizes[]',
      '',
      'array::join(tags, ", ")                    // tags = ["Rust", "Go", null, "GROQ"] => "Rust, Go, <INVALID>, GROQ"',
      'array::join(["a", "b", "c"], ".")          // "a.b.c"',
      'array::join(values, 1)                     // values = [10, 20, 30] => null (separator must be a string)',
      'array::compact(numbers)                    // numbers = [1, null, 2, null, 3] => [1, 2, 3]',
      'array::unique(items)                       // items = [1, 2, 2, 3, 4, 5, 5] => [1, 2, 3, 4, 5]',
      'array::intersects(firstList, secondList)   // firstList = [1, 2, 3], secondList = [3, 4, 5] => true'
    ),
    {
      '{': 'punctuation.bracket',
      '"peopleByPrizeYear"': 'string',
      ':': 'punctuation.delimiter',
      '*': 'variable.special',
      '[]': 'punctuation.bracket',
      '|': 'operator',
      order: 'function',
      '(': 'punctuation.bracket',
      prizes: 'property',
      '[': 'punctuation.bracket',
      '0': 'number',
      ']': 'punctuation.bracket',
      '.': 'punctuation.delimiter',
      year: 'property',
      desc: 'keyword.operator',
      '){': 'punctuation.bracket',
      '"name"': 'string',
      firstname: 'property',
      '+': 'operator',
      '" "': 'string',
      surname: 'property',
      ',': 'punctuation.delimiter',
      '"orderYear"': 'string',
      '}': 'punctuation.bracket',
      '"allPrizes"': 'string',
      ')': 'punctuation.bracket',
      array: 'namespace',
      '::': 'punctuation.delimiter',
      join: 'function',
      tags: 'property',
      '", "': 'string',
      '([': 'punctuation.bracket',
      '"a"': 'string',
      '"b"': 'string',
      '"c"': 'string',
      '"."': 'string',
      values: 'property',
      '1': 'number',
      compact: 'function',
      numbers: 'property',
      unique: 'function',
      items: 'property',
      intersects: 'function',
      firstList: 'property',
      secondList: 'property',
    }
  );
});

void t.test('groq cheat sheet: object projections', () => {
  expectKinds(
    lines(
      '// return only title',
      "*[_type == 'movie']{title}",
      '',
      '// return values for multiple attributes',
      "*[_type == 'movie']{_id, _type, title}",
      '',
      '// explicitly name the return field for _id',
      "*[_type == 'movie']{'renamedId': _id, _type, title}",
      '',
      '// Return an array of attribute values (no object wrapper)',
      "*[_type == 'movie'].title",
      "*[_type == 'movie']{'characterNames': castMembers[].characterName}",
      '',
      '// movie titled Arrival and its posterUrl',
      "*[_type=='movie' && title == 'Arrival']{title,'posterUrl': poster.asset->url}",
      '',
      '// Explicitly return all attributes',
      "*[_type == 'movie']{...}",
      '',
      '// Some computed attributes, then also add all attributes of the result',
      "*[_type == 'movie']{'posterUrl': poster.asset->url, ...}",
      '',
      '// Default values when missing or null in document',
      "*[_type == 'movie']{..., 'rating': coalesce(rating, 'unknown')}",
      '',
      "// Number of elements in array 'actors' on each movie",
      '*[_type == \'movie\']{"actorCount": count(actors)}',
      '',
      '// Apply a projection to every member of an array',
      "*[_type == 'movie']{castMembers[]{characterName, person}}",
      '',
      '// Filter embedded objects',
      "*[_type == 'movie']{castMembers[characterName match 'Ripley']{characterName, person}}",
      '',
      '// Follow every reference in an array of references',
      "*[_type == 'book']{authors[]->{name, bio}}",
      '',
      '// Explicity name the outer return field',
      "{'threeMovieTitles': *[_type=='movie'][0..2].title}",
      '',
      '// Combining several unrelated queries in one request',
      "{'featuredMovie': *[_type == 'movie' && title == 'Alien'][0], 'scifiMovies': *[_type == 'movie' && 'sci-fi' in genres]}"
    ),
    {
      '*': 'variable.special',
      '[': 'punctuation.bracket',
      _type: 'property',
      '==': 'operator',
      "'movie'": 'string',
      ']{': 'punctuation.bracket',
      title: 'property',
      '}': 'punctuation.bracket',
      _id: 'property',
      ',': 'punctuation.delimiter',
      "'renamedId'": 'string',
      ':': 'punctuation.delimiter',
      ']': 'punctuation.bracket',
      '.': 'punctuation.delimiter',
      "'characterNames'": 'string',
      castMembers: 'property',
      '[]': 'punctuation.bracket',
      characterName: 'property',
      '&&': 'operator',
      "'Arrival'": 'string',
      "'posterUrl'": 'string',
      poster: 'property',
      asset: 'property',
      '->': 'operator',
      url: 'property',
      '...': 'operator',
      "'rating'": 'string',
      coalesce: 'function',
      '(': 'punctuation.bracket',
      rating: 'property',
      "'unknown'": 'string',
      ')}': 'punctuation.bracket',
      '"actorCount"': 'string',
      count: 'function',
      actors: 'property',
      '[]{': 'punctuation.bracket',
      person: 'property',
      '}}': 'punctuation.bracket',
      match: 'keyword.operator',
      "'Ripley'": 'string',
      "'book'": 'string',
      authors: 'property',
      '{': 'punctuation.bracket',
      name: 'property',
      bio: 'property',
      "'threeMovieTitles'": 'string',
      '][': 'punctuation.bracket',
      '0': 'number',
      '..': 'operator',
      '2': 'number',
      "'featuredMovie'": 'string',
      "'Alien'": 'string',
      "'scifiMovies'": 'string',
      "'sci-fi'": 'string',
      in: 'keyword.operator',
      genres: 'property',
      ']}': 'punctuation.bracket',
    }
  );
});

void t.test('groq cheat sheet: special variables `*`, `@`, and `^`', () => {
  expectKinds(
    lines(
      '// *',
      '*   // Everything, i.e. all documents',
      '',
      '// @',
      '*[ @["1"] ] // @ refers to the root value (document) of the scope',
      '*[ @[$prop]._ref == $refId ] // Select reference prop from an outside variable.',
      '*{"arraySizes": arrays[]{"size": count(@)}} // @ also works for nested scopes',
      '',
      '// ^',
      '// ^ refers to the enclosing document. Here ^._id refers to the id',
      '// of the enclosing person record.',
      '*[_type=="person"]{',
      '  name,',
      '  "relatedMovies": *[_type==\'movie\' && references(^._id)]{ title }',
      '}'
    ),
    {
      '*': 'variable.special',
      '[': 'punctuation.bracket',
      '@': 'variable.special',
      '"1"': 'string',
      '] ]': 'punctuation.bracket',
      $prop: 'variable',
      ']': 'punctuation.bracket',
      '.': 'punctuation.delimiter',
      _ref: 'property',
      '==': 'operator',
      $refId: 'variable',
      '{': 'punctuation.bracket',
      '"arraySizes"': 'string',
      ':': 'punctuation.delimiter',
      arrays: 'property',
      '[]{': 'punctuation.bracket',
      '"size"': 'string',
      count: 'function',
      '(': 'punctuation.bracket',
      ')}}': 'punctuation.bracket',
      _type: 'property',
      '"person"': 'string',
      ']{': 'punctuation.bracket',
      name: 'property',
      ',': 'punctuation.delimiter',
      '"relatedMovies"': 'string',
      "'movie'": 'string',
      '&&': 'operator',
      references: 'function',
      '^': 'variable.special',
      _id: 'property',
      ')]{': 'punctuation.bracket',
      title: 'property',
      '}': 'punctuation.bracket',
    }
  );
});

void t.test('groq cheat sheet: conditionals and `select()`', () => {
  expectKinds(
    lines(
      '// select() returns the first => pair whose left-hand side evaluates to true',
      '*[_type==\'movie\']{..., "popularity": select(',
      '  popularity > 20 => "high",',
      '  popularity > 10 => "medium",',
      '  popularity <= 10 => "low"',
      ')}',
      '',
      '// The first select() parameter without => is returned if no previous matches are found',
      '*[_type==\'movie\']{..., "popularity": select(',
      '  popularity > 20 => "high",',
      '  popularity > 10 => "medium",',
      '  "low"',
      ')}',
      '',
      '// Projections also have syntactic sugar for inline conditionals',
      "*[_type=='movie']{",
      '  ...,',
      "  releaseDate >= '2018-06-01' => {",
      '    "screenings": *[_type == \'screening\' && movie._ref == ^._id],',
      '    "news": *[_type == \'news\' && movie._ref == ^._id],',
      '  },',
      '  popularity > 20 && rating > 7.0 => {',
      '    "featured": true,',
      '    "awards": *[_type == \'award\' && movie._ref == ^._id],',
      '  },',
      '}',
      '',
      '// The above is exactly equivalent to:',
      "*[_type=='movie']{",
      '  ...,',
      "  ...select(releaseDate >= '2018-06-01' => {",
      '    "screenings": *[_type == \'screening\' && movie._ref == ^._id],',
      '  }),',
      '  ...select(popularity > 20 && rating > 7.0 => {',
      '    "featured": true,',
      '  }),',
      '}',
      '',
      '// Specify sets of projections for different content types in an array',
      'content[]{',
      "  _type == 'type1' => {",
      '    // Your selection of fields for type1',
      '  },',
      "  _type == 'type2' => {",
      '    // Your selection of fields for type2',
      '    "url": file.asset->url // Use joins to get data of referenced document',
      '  }',
      '}',
      '',
      "'content': content[]{",
      "  _type == 'reference' => @->,",
      "  _type != 'reference' => @,",
      '}'
    ),
    {
      '*': 'variable.special',
      '[': 'punctuation.bracket',
      _type: 'property',
      '==': 'operator',
      "'movie'": 'string',
      ']{': 'punctuation.bracket',
      '...': 'operator',
      ',': 'punctuation.delimiter',
      '"popularity"': 'string',
      ':': 'punctuation.delimiter',
      select: 'function',
      '(': 'punctuation.bracket',
      popularity: 'property',
      '>': 'operator',
      '20': 'number',
      '=>': 'operator',
      '"high"': 'string',
      '10': 'number',
      '"medium"': 'string',
      '<=': 'operator',
      '"low"': 'string',
      ')}': 'punctuation.bracket',
      releaseDate: 'property',
      '>=': 'operator',
      "'2018-06-01'": 'string',
      '{': 'punctuation.bracket',
      '"screenings"': 'string',
      "'screening'": 'string',
      '&&': 'operator',
      movie: 'property',
      '.': 'punctuation.delimiter',
      _ref: 'property',
      '^': 'variable.special',
      _id: 'property',
      ']': 'punctuation.bracket',
      '"news"': 'string',
      "'news'": 'string',
      '}': 'punctuation.bracket',
      rating: 'property',
      '7.0': 'number',
      '"featured"': 'string',
      true: 'boolean',
      '"awards"': 'string',
      "'award'": 'string',
      '})': 'punctuation.bracket',
      content: 'property',
      '[]{': 'punctuation.bracket',
      "'type1'": 'string',
      "'type2'": 'string',
      '"url"': 'string',
      file: 'property',
      asset: 'property',
      '->': 'operator',
      url: 'property',
      "'content'": 'string',
      "'reference'": 'string',
      '@': 'variable.special',
      '!=': 'operator',
    }
  );
});

void t.test('groq cheat sheet: functions, scoring, and boosting', () => {
  expectKinds(
    lines(
      '// any document that references the document',
      '// with id person_sigourney-weaver,',
      '// return only title',
      '*[references("person_sigourney-weaver")]{title}',
      '',
      '// Movies which reference ancient people',
      '*[_type=="movie" && references(*[_type=="person" && age > 99]._id)]{title}',
      '',
      "*[defined(tags)] // any document that has the attribute 'tags'",
      '',
      '// coalesce takes a number of attribute references',
      '// and returns the value of the first attribute',
      '// that is non-null.',
      '*{"title": coalesce(title.fi, title.en)}',
      '',
      '// count counts the number of items in a collection',
      "count(*[_type == 'movie' && rating == 'R']) // returns number of R-rated movies",
      '',
      "*[_type == 'movie']{",
      '  title,',
      '  "actorCount": count(actors) // Counts the number of elements in the array actors',
      '}',
      '',
      '// round() rounds number to the nearest integer, or the given number of decimals',
      'round(3.14) // 3',
      'round(3.14, 1) // 3.1',
      '',
      '// score() adds points to the score value depending',
      '// on the use of the string "GROQ" in each post\'s description',
      '// The value is then used to order the posts',
      '*[_type == "post"]',
      '  | score(description match "GROQ")',
      '  | order(_score desc)',
      '  { _score, title }',
      '',
      '// boost() adds a defined boost integer to scores of items matching a condition',
      '*[_type == "movie" && movieRating > 3] |',
      '  score(',
      '    title match $term,',
      '    boost(movieRating > 8, 3)',
      '  )',
      '',
      '// Creates a scoring system where $term matching in the title',
      '// is worth more than matching in the body',
      '*[_type == "movie" && movieRating > 3] | score(',
      '  boost(title match $term, 4),',
      '  boost(body match $term, 1)',
      ')',
      '',
      '// Returns the body Portable Text data as plain text',
      '*[_type == "post"]',
      '  { "plaintextBody": pt::text(body) }',
      '',
      '// text::semanticSimilarity() ranks results by semantic meaning',
      '*[_type == "product"]',
      '  | score(text::semanticSimilarity("leather waterproof boots"))',
      '  | order(_score desc)',
      '  { _score, title }',
      '',
      '// Hybrid search: combine keyword matching with semantic scoring',
      '*[_type == "product"]',
      '  | score(',
      '      @ match text::query("waterproof boots"),',
      '      text::semanticSimilarity("waterproof boots")',
      '    )',
      '  | order(_score desc)',
      '',
      '// Get all versions and drafts of a document.',
      "*[sanity::versionOf('document-id')]",
      '',
      '// Get all documents that are part of a release.',
      "*[sanity::partOfRelease('release-id')]",
      '',
      '// Orders blog posts by GROQ matches',
      '// Then filters the results for only items that matched',
      '*[_type == "post"]',
      '  | score(description match "GROQ")',
      '  | order(_score desc)',
      '  { _score, title }',
      '  [ _score > 0 ]',
      '',
      '// Each term that is true will increment _score by 1',
      "* | score(featured, internal, _type == 'post')"
    ),
    {
      '*': 'variable.special',
      '[': 'punctuation.bracket',
      references: 'function',
      '(': 'punctuation.bracket',
      '"person_sigourney-weaver"': 'string',
      ')]{': 'punctuation.bracket',
      title: 'property',
      '}': 'punctuation.bracket',
      _type: 'property',
      '==': 'operator',
      '"movie"': 'string',
      '&&': 'operator',
      '"person"': 'string',
      age: 'property',
      '>': 'operator',
      '99': 'number',
      ']': 'punctuation.bracket',
      '.': 'punctuation.delimiter',
      _id: 'property',
      defined: 'function',
      tags: 'property',
      ')]': 'punctuation.bracket',
      '{': 'punctuation.bracket',
      '"title"': 'string',
      ':': 'punctuation.delimiter',
      coalesce: 'function',
      fi: 'property',
      ',': 'punctuation.delimiter',
      en: 'property',
      ')}': 'punctuation.bracket',
      count: 'function',
      "'movie'": 'string',
      rating: 'property',
      "'R'": 'string',
      '])': 'punctuation.bracket',
      ']{': 'punctuation.bracket',
      '"actorCount"': 'string',
      actors: 'property',
      ')': 'punctuation.bracket',
      round: 'function',
      '3.14': 'number',
      '1': 'number',
      '"post"': 'string',
      '|': 'operator',
      score: 'function',
      description: 'property',
      match: 'keyword.operator',
      '"GROQ"': 'string',
      order: 'function',
      _score: 'property',
      desc: 'keyword.operator',
      movieRating: 'property',
      '3': 'number',
      $term: 'variable',
      boost: 'function',
      '8': 'number',
      '4': 'number',
      body: 'property',
      '"plaintextBody"': 'string',
      pt: 'namespace',
      '::': 'punctuation.delimiter',
      // `pt::text(` calls text; `text::` names a namespace
      text: ['function', 'namespace', 'namespace', 'namespace'],
      ') }': 'punctuation.bracket',
      '"product"': 'string',
      semanticSimilarity: 'function',
      '"leather waterproof boots"': 'string',
      '))': 'punctuation.bracket',
      '@': 'variable.special',
      query: 'function',
      '"waterproof boots"': 'string',
      sanity: 'namespace',
      versionOf: 'function',
      "'document-id'": 'string',
      partOfRelease: 'function',
      "'release-id'": 'string',
      '0': 'number',
      featured: 'property',
      internal: 'property',
      "'post'": 'string',
    }
  );
});

void t.test('groq cheat sheet: geolocation', () => {
  expectKinds(
    lines(
      '// Returns all documents that are storefronts',
      '// within 10 miles of the user-provided currentLocation parameter',
      '*[',
      "  _type == 'storefront' &&",
      '  geo::distance(geoPoint, $currentLocation) < 16093.4',
      ']',
      '',
      '// For a given $currentLocation geopoint and deliveryZone area',
      "// Return stores that deliver to a user's location",
      '*[',
      '  _type == "storefront" &&',
      '  geo::contains(deliveryZone, $currentLocation)',
      ']',
      '',
      '// Creates a "marathonRoutes" array that contains',
      '// all marathons whose routes intersect with the current neighborhood',
      '*[_type == "neighborhood"] {',
      '  "marathonRoutes": *[_type == "marathon" &&',
      '                      geo::intersects(^.neighborhoodRegion, routeLine)',
      '                    ]',
      '}'
    ),
    {
      '*': 'variable.special',
      '[': 'punctuation.bracket',
      _type: 'property',
      '==': 'operator',
      "'storefront'": 'string',
      '&&': 'operator',
      geo: 'namespace',
      '::': 'punctuation.delimiter',
      distance: 'function',
      '(': 'punctuation.bracket',
      geoPoint: 'property',
      ',': 'punctuation.delimiter',
      $currentLocation: 'variable',
      ')': 'punctuation.bracket',
      '<': 'operator',
      '16093.4': 'number',
      ']': 'punctuation.bracket',
      '"storefront"': 'string',
      contains: 'function',
      deliveryZone: 'property',
      '"neighborhood"': 'string',
      '] {': 'punctuation.bracket',
      '"marathonRoutes"': 'string',
      ':': 'punctuation.delimiter',
      '"marathon"': 'string',
      intersects: 'function',
      '^': 'variable.special',
      '.': 'punctuation.delimiter',
      neighborhoodRegion: 'property',
      routeLine: 'property',
      '}': 'punctuation.bracket',
    }
  );
});

void t.test('groq cheat sheet: arithmetic and concatenation', () => {
  expectKinds(
    lines(
      '// Standard arithmetic operations are supported',
      '1 + 2  // 3 (addition)',
      '3 - 2  // 1 (subtraction)',
      '2 * 3  // 6 (multiplication)',
      '8 / 4  // 2 (division)',
      '2 ** 4 // 16 (exponentiation)',
      '8 % 3  // 2 (modulo)',
      '',
      '// Exponentiation can be used to take square- and cube-roots too',
      '9 ** (1/2)  // 3 (square root)',
      '27 ** (1/3) // 3 (cube root)',
      '',
      '// + can also concatenate strings, arrays, and objects:',
      '"abc" + "def" // "abcdef"',
      '[1,2] + [3,4] // [1,2,3,4]',
      '{"a":1,"b":2} + {"c":3} // {"a":1,"b":2,"c":3}',
      '',
      '// Concatenation of a string and a number requires the number be',
      '// converted to a string. Otherwise, the operation returns null',
      '3 + " p.m."         // null',
      'string(3) + " p.m." // "3 p.m."'
    ),
    {
      '1': 'number',
      '+': 'operator',
      '2': 'number',
      '3': 'number',
      '-': 'operator',
      '*': 'operator',
      '8': 'number',
      '/': 'operator',
      '4': 'number',
      '**': 'operator',
      '%': 'operator',
      '9': 'number',
      '(': 'punctuation.bracket',
      ')': 'punctuation.bracket',
      '27': 'number',
      '"abc"': 'string',
      '"def"': 'string',
      '[': 'punctuation.bracket',
      ',': 'punctuation.delimiter',
      ']': 'punctuation.bracket',
      '{': 'punctuation.bracket',
      '"a"': 'string',
      ':': 'punctuation.delimiter',
      '"b"': 'string',
      '}': 'punctuation.bracket',
      '"c"': 'string',
      '" p.m."': 'string',
      // `string(3)` is the conversion function; `string::` the namespace
      string: 'function',
    }
  );
});

// ---- the GROQ functions reference ----

void t.test('groq functions: delta, diff, and selectors', () => {
  expectKinds(
    lines(
      '// Delta GROQ: the attributes before and after the change',
      'after().score > before().score',
      "'Title changed from ' + before().title + ' to ' + after().title",
      'delta::operation() == "update"',
      '',
      '// Example: Return true when title has changed',
      'delta::changedAny(title)',
      'delta::changedOnly((title, _rev, _updatedAt))',
      '',
      '// Example: This returns true because last name has changed.',
      'diff::changedAny(',
      '  {"firstName":"Bob","lastName":"Odenkirk"},',
      '  {"firstName":"Bob","lastName":"Holm"},',
      '  (firstName, lastName)',
      ')',
      '',
      '// Selectors',
      'delta::changedAny((title, description))',
      'delta::changedAny(slug.current)',
      'delta::changedAny(authors[].year)',
      'delta::changedAny(authors[].(year, name))',
      'delta::changedAny(authors[year > 1950].name)'
    ),
    {
      after: 'function',
      '()': 'punctuation.bracket',
      '.': 'punctuation.delimiter',
      score: 'property',
      '>': 'operator',
      before: 'function',
      "'Title changed from '": 'string',
      '+': 'operator',
      title: 'property',
      "' to '": 'string',
      delta: 'namespace',
      '::': 'punctuation.delimiter',
      operation: 'function',
      '==': 'operator',
      '"update"': 'string',
      changedAny: 'function',
      '(': 'punctuation.bracket',
      ')': 'punctuation.bracket',
      changedOnly: 'function',
      '((': 'punctuation.bracket',
      ',': 'punctuation.delimiter',
      _rev: 'property',
      _updatedAt: 'property',
      '))': 'punctuation.bracket',
      diff: 'namespace',
      '{': 'punctuation.bracket',
      '"firstName"': 'string',
      ':': 'punctuation.delimiter',
      '"Bob"': 'string',
      '"lastName"': 'string',
      '"Odenkirk"': 'string',
      '}': 'punctuation.bracket',
      '"Holm"': 'string',
      firstName: 'property',
      lastName: 'property',
      description: 'property',
      slug: 'property',
      current: 'property',
      authors: 'property',
      '[]': 'punctuation.bracket',
      year: 'property',
      name: 'property',
      '[': 'punctuation.bracket',
      '1950': 'number',
      ']': 'punctuation.bracket',
    }
  );
});

void t.test('groq functions: math, string, array, dateTime namespaces', () => {
  expectKinds(
    lines(
      'math::avg([1, 2, 3, 4, null])',
      'math::max([1, 10, 100, 1000])',
      'math::min([])',
      'math::sum([1, 2, 3, 4, "5"])',
      'string::startsWith("alphabet", "alpha")',
      'string::split("Split this sentence up", " ")',
      'string::split(12, "1")',
      'array::unique([1, 2, 2, 2, 3, 4, 5, 5])',
      "array::intersects([1, 2, 3], ['foo', 'bar', 'baz'])",
      'array::compact([1, null, 2, null, 3])',
      'dateTime::now()',
      'dateTime(now()) - 60*60*24*7',
      "global::references('someId')",
      '*[references(^._id) && releases::inRelease($release)]'
    ),
    {
      math: 'namespace',
      '::': 'punctuation.delimiter',
      avg: 'function',
      '([': 'punctuation.bracket',
      '1': 'number',
      ',': 'punctuation.delimiter',
      '2': 'number',
      '3': 'number',
      '4': 'number',
      null: 'constant.builtin',
      '])': 'punctuation.bracket',
      max: 'function',
      '10': 'number',
      '100': 'number',
      '1000': 'number',
      min: 'function',
      '([])': 'punctuation.bracket',
      sum: 'function',
      '"5"': 'string',
      string: 'namespace',
      startsWith: 'function',
      '(': 'punctuation.bracket',
      '"alphabet"': 'string',
      '"alpha"': 'string',
      ')': 'punctuation.bracket',
      split: 'function',
      '"Split this sentence up"': 'string',
      '" "': 'string',
      '12': 'number',
      '"1"': 'string',
      array: 'namespace',
      unique: 'function',
      '5': 'number',
      intersects: 'function',
      ']': 'punctuation.bracket',
      '[': 'punctuation.bracket',
      "'foo'": 'string',
      "'bar'": 'string',
      "'baz'": 'string',
      compact: 'function',
      // `dateTime::now()` names the namespace; `dateTime(now())` calls it
      dateTime: ['namespace', 'function'],
      now: 'function',
      '()': 'punctuation.bracket',
      '())': 'punctuation.bracket',
      '-': 'operator',
      '60': 'number',
      '*': ['operator', 'operator', 'operator', 'variable.special'],
      '24': 'number',
      '7': 'number',
      global: 'namespace',
      references: 'function',
      "'someId'": 'string',
      '^': 'variable.special',
      '.': 'punctuation.delimiter',
      _id: 'property',
      '&&': 'operator',
      releases: 'namespace',
      inRelease: 'function',
      $release: 'variable',
      ')]': 'punctuation.bracket',
    }
  );
});

// ---- custom GROQ functions ----

void t.test('groq custom functions: every supported body format', () => {
  expectKinds(
    lines(
      'fn ex::name($author) = $author-> { "name": firstName + " " + lastName };',
      '',
      '*[_type == "post"]{',
      '  "author": ex::name(author)',
      '}',
      '',
      'fn ex::details($person) = $person{name, age};',
      '*[_type == "person"] { "info": ex::details(@) }',
      '',
      'fn ex::title($ref) = $ref->{title};',
      '*[_type == "person"] { "occupation": ex::title(occupation) }',
      '',
      'fn ex::items($arr) = $arr[]{name};',
      '*[_type == "person"] { "stuff": ex::items(belongings) }',
      '',
      'fn ex::pets($items) = $items[]->{name};',
      '*[_type == "person"] {"pet": ex::pets(pet)}'
    ),
    {
      fn: 'keyword.declaration',
      ex: 'namespace',
      '::': 'punctuation.delimiter',
      // declared, then called, then the `name` attribute in three bodies
      name: [
        'function.definition',
        'function',
        'property',
        'property',
        'property',
      ],
      '(': 'punctuation.bracket',
      $author: 'variable',
      ')': 'punctuation.bracket',
      '=': 'operator',
      '->': 'operator',
      '{': 'punctuation.bracket',
      '"name"': 'string',
      ':': 'punctuation.delimiter',
      firstName: 'property',
      '+': 'operator',
      '" "': 'string',
      lastName: 'property',
      '}': 'punctuation.bracket',
      ';': 'punctuation.delimiter',
      '*': 'variable.special',
      '[': 'punctuation.bracket',
      _type: 'property',
      '==': 'operator',
      '"post"': 'string',
      ']{': 'punctuation.bracket',
      '"author"': 'string',
      author: 'property',
      details: ['function.definition', 'function'],
      $person: 'variable',
      ',': 'punctuation.delimiter',
      age: 'property',
      '"person"': 'string',
      '] {': 'punctuation.bracket',
      '"info"': 'string',
      '@': 'variable.special',
      ') }': 'punctuation.bracket',
      title: ['function.definition', 'property', 'function'],
      $ref: 'variable',
      '"occupation"': 'string',
      occupation: 'property',
      items: ['function.definition', 'function'],
      $arr: 'variable',
      '[]{': 'punctuation.bracket',
      '"stuff"': 'string',
      belongings: 'property',
      pets: ['function.definition', 'function'],
      $items: 'variable',
      '[]': 'punctuation.bracket',
      '"pet"': 'string',
      pet: 'property',
      ')}': 'punctuation.bracket',
    }
  );
});

void t.test('groq custom functions: nested Portable Text projection', () => {
  expectKinds(
    lines(
      'fn ex::blocks($arr) = $arr {',
      '  ...,',
      '  _type == "docsCallout" => {',
      '    ...,',
      '    content[] {',
      '      ...,',
      '      markDefs[] {',
      '        ...,',
      '        _type == "link" => {',
      '          isInternal,',
      '          _key,',
      '          _type,',
      '          reference->,',
      '          url',
      '        },',
      '        _type == "acronym" => {',
      '          _key,',
      '          _type,',
      '          value',
      '        }',
      '      }',
      '    }',
      '  }',
      '};',
      '',
      '*[_type == "article"] {',
      '  _id,',
      '  title,',
      '  "slug": slug.current,',
      '  "content": ex::blocks(content[])',
      '}'
    ),
    {
      fn: 'keyword.declaration',
      ex: 'namespace',
      '::': 'punctuation.delimiter',
      blocks: ['function.definition', 'function'],
      '(': 'punctuation.bracket',
      $arr: 'variable',
      ')': 'punctuation.bracket',
      '=': 'operator',
      '{': 'punctuation.bracket',
      '...': 'operator',
      ',': 'punctuation.delimiter',
      _type: 'property',
      '==': 'operator',
      '"docsCallout"': 'string',
      '=>': 'operator',
      content: 'property',
      '[] {': 'punctuation.bracket',
      markDefs: 'property',
      '"link"': 'string',
      isInternal: 'property',
      _key: 'property',
      reference: 'property',
      '->': 'operator',
      url: 'property',
      '}': 'punctuation.bracket',
      '"acronym"': 'string',
      value: 'property',
      ';': 'punctuation.delimiter',
      '*': 'variable.special',
      '[': 'punctuation.bracket',
      '"article"': 'string',
      '] {': 'punctuation.bracket',
      _id: 'property',
      title: 'property',
      '"slug"': 'string',
      ':': 'punctuation.delimiter',
      slug: 'property',
      '.': 'punctuation.delimiter',
      current: 'property',
      '"content"': 'string',
      '[])': 'punctuation.bracket',
    }
  );
});

// ---- the GROQ syntax reference ----

void t.test('groq syntax: query form, JSON superset, comments, scopes', () => {
  expectKinds(
    lines(
      '*[ <filter> ]{ <projection> }',
      '',
      '*[ _type == "director" && birthYear >= 1970 ]{',
      '  name,',
      '  birthYear,',
      '  "movies": *[ _type == "movie" && director._ref == ^._id ]',
      '}',
      '',
      '"Hi! 👋"',
      '["An", "array", "of", "strings"]',
      '{',
      '  "array": ["string", 3.14, true, null],',
      '  "boolean": true,',
      '  "number": 3.14,',
      '  "null": null,',
      '  "object": {"key": "value"},',
      '  "string": "Hi! 👋"',
      '}',
      '',
      '{',
      '  // Comments can be on a separate line',
      '  "key": "value" // Or at the end of a line',
      '}',
      '',
      '*[ category == "news" ]',
      '@["1 illegal name 🚫"]',
      '',
      '// @ refers to the current number being evaluated',
      'numbers[ @ >= 10 ]',
      '*{"arraySizes": myArray[]{"size": count(@)}}',
      '',
      '*[ _type == "movie" && releaseYear >= 2000 ]{',
      '  title,',
      '  releaseYear,',
      '  crew{name, title},',
      '  "related": *[ _type == "movie" && genre == ^.genre ]',
      '}',
      '',
      '!true',
      'ref->',
      '1 + 2',
      'function(arg1, arg2)',
      '*[_type == "post"] | order(_createdAt desc)'
    ),
    {
      '*': 'variable.special',
      '[': 'punctuation.bracket',
      '<': 'operator',
      filter: 'property',
      '>': 'operator',
      ']{': 'punctuation.bracket',
      projection: 'property',
      '}': 'punctuation.bracket',
      _type: 'property',
      '==': 'operator',
      '"director"': 'string',
      '&&': 'operator',
      birthYear: 'property',
      '>=': 'operator',
      '1970': 'number',
      name: 'property',
      ',': 'punctuation.delimiter',
      '"movies"': 'string',
      ':': 'punctuation.delimiter',
      '"movie"': 'string',
      director: 'property',
      '.': 'punctuation.delimiter',
      _ref: 'property',
      '^': 'variable.special',
      _id: 'property',
      ']': 'punctuation.bracket',
      '"Hi! 👋"': 'string',
      '"An"': 'string',
      '"array"': 'string',
      '"of"': 'string',
      '"strings"': 'string',
      '{': 'punctuation.bracket',
      '"string"': 'string',
      '3.14': 'number',
      true: 'boolean',
      null: 'constant.builtin',
      '"boolean"': 'string',
      '"number"': 'string',
      '"null"': 'string',
      '"object"': 'string',
      '"key"': 'string',
      '"value"': 'string',
      category: 'property',
      '"news"': 'string',
      '@': 'variable.special',
      '"1 illegal name 🚫"': 'string',
      numbers: 'property',
      '10': 'number',
      '"arraySizes"': 'string',
      myArray: 'property',
      '[]{': 'punctuation.bracket',
      '"size"': 'string',
      count: 'function',
      '(': 'punctuation.bracket',
      ')}}': 'punctuation.bracket',
      releaseYear: 'property',
      '2000': 'number',
      title: 'property',
      crew: 'property',
      '"related"': 'string',
      genre: 'property',
      '!': 'operator',
      ref: 'property',
      '->': 'operator',
      '1': 'number',
      '+': 'operator',
      '2': 'number',
      function: 'function',
      arg1: 'property',
      arg2: 'property',
      ')': 'punctuation.bracket',
      '"post"': 'string',
      '|': 'operator',
      order: 'function',
      _createdAt: 'property',
      desc: 'keyword.operator',
    }
  );
});

void t.test('groq syntax: every literal form and escape', () => {
  expectKinds(
    lines(
      '// Boolean, null, integer, and float literals',
      '[true, false, null]',
      '[42, 007, 3.0, 3.14, 3e6, 3E6, 3.14e0, 3.14e-2, 3.14E+2, 1e10]',
      '[-1, -3.14, -2e-3, 1 - 2, 1-2, 1 -2, 2 ** -1]',
      '// String literals and every escape',
      '"Hello world! 👋"',
      "'single \\'quoted\\' with \"doubles\"'",
      '"double \\"quoted\\" with \'singles\'"',
      '["\\\\", "\\/", "\\\'", "\\"", "\\b", "\\f", "\\n", "\\r", "\\t", "\\u0041", "\\uD83D\\uDE00", "\\u{1F600}", "\\u{41}"]',
      '// Array, object, pair, and range literals',
      '[1, 2, 3,]',
      '{"a": 1, "b": 2,}',
      '"a" => 1',
      '[1..3, 1...3]',
      'array[0]',
      'array[1..3]',
      'object["attribute"]'
    ),
    {
      '[': 'punctuation.bracket',
      true: 'boolean',
      ',': 'punctuation.delimiter',
      false: 'boolean',
      null: 'constant.builtin',
      ']': 'punctuation.bracket',
      '42': 'number',
      '007': 'number',
      '3.0': 'number',
      '3.14': 'number',
      '3e6': 'number',
      '3E6': 'number',
      '3.14e0': 'number',
      '3.14e-2': 'number',
      '3.14E+2': 'number',
      '1e10': 'number',
      '-1': 'number',
      '-3.14': 'number',
      '-2e-3': 'number',
      '1': 'number',
      // `1 - 2`, `1-2`, and `1 -2` all subtract; only `** -1` signs a number
      '-': 'operator',
      '2': 'number',
      '**': 'operator',
      '"Hello world! 👋"': 'string',
      "'single": 'string',
      "\\'": 'string.escape',
      quoted: 'string',
      'with "doubles"\'': 'string',
      '"double': 'string',
      '\\"': 'string.escape',
      "with 'singles'\"": 'string',
      '"': 'string',
      '\\\\': 'string.escape',
      '\\/': 'string.escape',
      '\\b': 'string.escape',
      '\\f': 'string.escape',
      '\\n': 'string.escape',
      '\\r': 'string.escape',
      '\\t': 'string.escape',
      '\\u0041': 'string.escape',
      '\\uD83D\\uDE00': 'string.escape',
      '\\u{1F600}': 'string.escape',
      '\\u{41}': 'string.escape',
      '3': 'number',
      '{': 'punctuation.bracket',
      '"a"': 'string',
      ':': 'punctuation.delimiter',
      '"b"': 'string',
      '}': 'punctuation.bracket',
      '=>': 'operator',
      '..': 'operator',
      '...': 'operator',
      array: 'property',
      '0': 'number',
      object: 'property',
      '"attribute"': 'string',
    }
  );
});

void t.test('groq syntax: whitespace separates tokens', () => {
  // tab, newline, vertical tab, form feed, carriage return, and space
  assert.deepEqual(
    tokenKinds('groq', 'title\tmatch\u000b$q\u000c&&\rx\n== 1'),
    [
      ['title', 'property'],
      ['match', 'keyword.operator'],
      ['$q', 'variable'],
      ['&&', 'operator'],
      ['x', 'property'],
      ['==', 'operator'],
      ['1', 'number'],
    ]
  );
  // whitespace inside a string literal is string text
  assert.deepEqual(tokenKinds('groq', '"a\tb\u000bc\u000cd"'), [
    ['"a\tb\u000bc\u000cd"', 'string'],
  ]);
});

// ---- boundary cases ----

void t.test('groq: identifiers classify by the token before them', () => {
  assert.deepEqual(
    tokenKinds(
      'groq',
      '*[_type == "post"]{match, in, desc, asc, true, false, null, order, score, x.null, y->in}'
    ),
    [
      ['*', 'variable.special'],
      ['[', 'punctuation.bracket'],
      ['_type', 'property'],
      ['==', 'operator'],
      ['"post"', 'string'],
      [']{', 'punctuation.bracket'],
      ['match', 'property'],
      [',', 'punctuation.delimiter'],
      ['in', 'property'],
      [',', 'punctuation.delimiter'],
      ['desc', 'property'],
      [',', 'punctuation.delimiter'],
      ['asc', 'property'],
      [',', 'punctuation.delimiter'],
      ['true', 'boolean'],
      [',', 'punctuation.delimiter'],
      ['false', 'boolean'],
      [',', 'punctuation.delimiter'],
      ['null', 'constant.builtin'],
      [',', 'punctuation.delimiter'],
      ['order', 'property'],
      [',', 'punctuation.delimiter'],
      ['score', 'property'],
      [',', 'punctuation.delimiter'],
      ['x', 'property'],
      ['.', 'punctuation.delimiter'],
      ['null', 'property'],
      [',', 'punctuation.delimiter'],
      ['y', 'property'],
      ['->', 'operator'],
      ['in', 'property'],
      ['}', 'punctuation.bracket'],
    ]
  );
  // the same words are operators after an operand
  assert.deepEqual(
    tokenKinds('groq', '* | order(title asc, _createdAt desc)[title match $q]'),
    [
      ['*', 'variable.special'],
      ['|', 'operator'],
      ['order', 'function'],
      ['(', 'punctuation.bracket'],
      ['title', 'property'],
      ['asc', 'keyword.operator'],
      [',', 'punctuation.delimiter'],
      ['_createdAt', 'property'],
      ['desc', 'keyword.operator'],
      [')[', 'punctuation.bracket'],
      ['title', 'property'],
      ['match', 'keyword.operator'],
      ['$q', 'variable'],
      [']', 'punctuation.bracket'],
    ]
  );
  // attributes named like the word operators, in filters, values, and
  // ordering clauses
  assert.deepEqual(
    tokenKinds(
      'groq',
      '*[asc > desc && in == match]{ "k": in, "m": match } | order(asc desc, desc asc)'
    ),
    [
      ['*', 'variable.special'],
      ['[', 'punctuation.bracket'],
      ['asc', 'property'],
      ['>', 'operator'],
      ['desc', 'property'],
      ['&&', 'operator'],
      ['in', 'property'],
      ['==', 'operator'],
      ['match', 'property'],
      [']{', 'punctuation.bracket'],
      ['"k"', 'string'],
      [':', 'punctuation.delimiter'],
      ['in', 'property'],
      [',', 'punctuation.delimiter'],
      ['"m"', 'string'],
      [':', 'punctuation.delimiter'],
      ['match', 'property'],
      ['}', 'punctuation.bracket'],
      ['|', 'operator'],
      ['order', 'function'],
      ['(', 'punctuation.bracket'],
      ['asc', 'property'],
      ['desc', 'keyword.operator'],
      [',', 'punctuation.delimiter'],
      ['desc', 'property'],
      ['asc', 'keyword.operator'],
      [')', 'punctuation.bracket'],
    ]
  );
});

void t.test('groq: `*` selects everything or multiplies', () => {
  assert.deepEqual(
    tokenKinds(
      'groq',
      '{\n  "*": *,\n  "double": count * 2,\n  "six": 2 * 3,\n  "limited": *[price > count * price],\n  "pow": 2 ** 3\n}\n*\n*[a]\n'
    ),
    [
      ['{', 'punctuation.bracket'],
      ['"*"', 'string'],
      [':', 'punctuation.delimiter'],
      ['*', 'variable.special'],
      [',', 'punctuation.delimiter'],
      ['"double"', 'string'],
      [':', 'punctuation.delimiter'],
      ['count', 'property'],
      ['*', 'operator'],
      ['2', 'number'],
      [',', 'punctuation.delimiter'],
      ['"six"', 'string'],
      [':', 'punctuation.delimiter'],
      ['2', 'number'],
      ['*', 'operator'],
      ['3', 'number'],
      [',', 'punctuation.delimiter'],
      ['"limited"', 'string'],
      [':', 'punctuation.delimiter'],
      ['*', 'variable.special'],
      ['[', 'punctuation.bracket'],
      ['price', 'property'],
      ['>', 'operator'],
      ['count', 'property'],
      ['*', 'operator'],
      ['price', 'property'],
      [']', 'punctuation.bracket'],
      [',', 'punctuation.delimiter'],
      ['"pow"', 'string'],
      [':', 'punctuation.delimiter'],
      ['2', 'number'],
      ['**', 'operator'],
      ['3', 'number'],
      ['}', 'punctuation.bracket'],
      ['*', 'variable.special'],
      ['*', 'variable.special'],
      ['[', 'punctuation.bracket'],
      ['a', 'property'],
      [']', 'punctuation.bracket'],
    ]
  );
  // a selector on the line after an operand, followed by a comment, a
  // filter, a projection, a pipe, or nothing
  assert.deepEqual(
    tokenKinds(
      'groq',
      '*[_type == "movie"][0..5] // first 6 movies (inclusive)\n*   // Everything, i.e. all documents\n*[b]\n*{title}\n* | order(x asc)\n*'
    ).filter(([text]) => text === '*'),
    Array<[string, string]>(6).fill(['*', 'variable.special'])
  );
  // `*` and `**` inside strings and comments are text
  assert.deepEqual(tokenKinds('groq', '"a.b.c.**" // *only* this'), [
    ['"a.b.c.**"', 'string'],
    ['// *only* this', 'comment'],
  ]);
});

void t.test('groq: multiplication stays an operator when its RHS wraps', () => {
  // a known left operand on the same line always makes `*` multiply, even
  // when the right-hand side moves to the next line or past a trailing
  // `//` comment - a bare line break or comment after `*` only reads as the
  // Everything selector when `*` itself opens a fresh line
  assert.deepEqual(tokenKinds('groq', 'price *\n  taxRate\n'), [
    ['price', 'property'],
    ['*', 'operator'],
    ['taxRate', 'property'],
  ]);
  assert.deepEqual(tokenKinds('groq', 'price * // apply tax\n  taxRate\n'), [
    ['price', 'property'],
    ['*', 'operator'],
    ['// apply tax', 'comment'],
    ['taxRate', 'property'],
  ]);
  // the same right-hand sides still read as filters, projections, pipes,
  // or comments when `*` starts its own line instead of following an
  // operand on the same line
  assert.deepEqual(
    tokenKinds('groq', '*[_type == "post"]\n*\n  taxRate\n').filter(
      ([text]) => text === '*'
    ),
    [
      ['*', 'variable.special'],
      ['*', 'variable.special'],
    ]
  );
  assertLineFedParity('groq', 'price *\n  taxRate\n');
  assertLineFedParity('groq', 'price * // apply tax\n  taxRate\n');
});

void t.test('groq: `..`, `...`, `->`, and `-` at their boundaries', () => {
  assert.deepEqual(tokenKinds('groq', 'a[0..5][0...5]{...}'), [
    ['a', 'property'],
    ['[', 'punctuation.bracket'],
    ['0', 'number'],
    ['..', 'operator'],
    ['5', 'number'],
    ['][', 'punctuation.bracket'],
    ['0', 'number'],
    ['...', 'operator'],
    ['5', 'number'],
    [']{', 'punctuation.bracket'],
    ['...', 'operator'],
    ['}', 'punctuation.bracket'],
  ]);
  // four dots are a spread and an accessor
  assert.deepEqual(tokenKinds('groq', 'x....y'), [
    ['x', 'property'],
    ['...', 'operator'],
    ['.', 'punctuation.delimiter'],
    ['y', 'property'],
  ]);
  // `...select(` spreads a call; `..` inside a string is text
  assert.deepEqual(tokenKinds('groq', '{...select(a => "..")}'), [
    ['{', 'punctuation.bracket'],
    ['...', 'operator'],
    ['select', 'function'],
    ['(', 'punctuation.bracket'],
    ['a', 'property'],
    ['=>', 'operator'],
    ['".."', 'string'],
    [')}', 'punctuation.bracket'],
  ]);
  // `->` dereferences; `-` then `>` subtract and compare
  assert.deepEqual(tokenKinds('groq', 'author->name'), [
    ['author', 'property'],
    ['->', 'operator'],
    ['name', 'property'],
  ]);
  assert.deepEqual(tokenKinds('groq', 'price - 1 > 0'), [
    ['price', 'property'],
    ['-', 'operator'],
    ['1', 'number'],
    ['>', 'operator'],
    ['0', 'number'],
  ]);
  assert.deepEqual(tokenKinds('groq', 'price - > 0'), [
    ['price', 'property'],
    ['- >', 'operator'],
    ['0', 'number'],
  ]);
  // a trailing dereference, with and without an attribute after it
  assert.deepEqual(tokenKinds('groq', '{ reference->, @-> }'), [
    ['{', 'punctuation.bracket'],
    ['reference', 'property'],
    ['->', 'operator'],
    [',', 'punctuation.delimiter'],
    ['@', 'variable.special'],
    ['->', 'operator'],
    ['}', 'punctuation.bracket'],
  ]);
  // a negative range and a negative index sign their numbers
  assert.deepEqual(tokenKinds('groq', 'a[-5..-1][-1]'), [
    ['a', 'property'],
    ['[', 'punctuation.bracket'],
    ['-5', 'number'],
    ['..', 'operator'],
    ['-1', 'number'],
    ['][', 'punctuation.bracket'],
    ['-1', 'number'],
    [']', 'punctuation.bracket'],
  ]);
});

void t.test(
  'groq: function definitions, namespaced calls, parameters, and scopes',
  () => {
    assert.deepEqual(
      tokenKinds(
        'groq',
        'fn my::double($x) = $x * 2;\nfn plain($y) = $y;\n*[references(^._id) && @ in ^.^.tags] { "d": my::double(count(*)), "now": dateTime::now(), "geo": geo::distance(location, $point) }'
      ),
      [
        ['fn', 'keyword.declaration'],
        ['my', 'namespace'],
        ['::', 'punctuation.delimiter'],
        ['double', 'function.definition'],
        ['(', 'punctuation.bracket'],
        ['$x', 'variable'],
        [')', 'punctuation.bracket'],
        ['=', 'operator'],
        ['$x', 'variable'],
        ['*', 'operator'],
        ['2', 'number'],
        [';', 'punctuation.delimiter'],
        ['fn', 'keyword.declaration'],
        ['plain', 'function.definition'],
        ['(', 'punctuation.bracket'],
        ['$y', 'variable'],
        [')', 'punctuation.bracket'],
        ['=', 'operator'],
        ['$y', 'variable'],
        [';', 'punctuation.delimiter'],
        ['*', 'variable.special'],
        ['[', 'punctuation.bracket'],
        ['references', 'function'],
        ['(', 'punctuation.bracket'],
        ['^', 'variable.special'],
        ['.', 'punctuation.delimiter'],
        ['_id', 'property'],
        [')', 'punctuation.bracket'],
        ['&&', 'operator'],
        ['@', 'variable.special'],
        ['in', 'keyword.operator'],
        ['^', 'variable.special'],
        ['.', 'punctuation.delimiter'],
        ['^', 'variable.special'],
        ['.', 'punctuation.delimiter'],
        ['tags', 'property'],
        ['] {', 'punctuation.bracket'],
        ['"d"', 'string'],
        [':', 'punctuation.delimiter'],
        ['my', 'namespace'],
        ['::', 'punctuation.delimiter'],
        ['double', 'function'],
        ['(', 'punctuation.bracket'],
        ['count', 'function'],
        ['(', 'punctuation.bracket'],
        ['*', 'variable.special'],
        ['))', 'punctuation.bracket'],
        [',', 'punctuation.delimiter'],
        ['"now"', 'string'],
        [':', 'punctuation.delimiter'],
        ['dateTime', 'namespace'],
        ['::', 'punctuation.delimiter'],
        ['now', 'function'],
        ['()', 'punctuation.bracket'],
        [',', 'punctuation.delimiter'],
        ['"geo"', 'string'],
        [':', 'punctuation.delimiter'],
        ['geo', 'namespace'],
        ['::', 'punctuation.delimiter'],
        ['distance', 'function'],
        ['(', 'punctuation.bracket'],
        ['location', 'property'],
        [',', 'punctuation.delimiter'],
        ['$point', 'variable'],
        [') }', 'punctuation.bracket'],
      ]
    );
    // the supported custom function body formats
    for (const body of [
      '$param{...}',
      '$param->{...}',
      '$param[]{...}',
      '$param[]->{...}',
    ]) {
      const kinds = tokenKinds('groq', `fn ex::f($param) = ${body};`);
      assert.deepEqual(kinds.slice(0, 4), [
        ['fn', 'keyword.declaration'],
        ['ex', 'namespace'],
        ['::', 'punctuation.delimiter'],
        ['f', 'function.definition'],
      ]);
      assert.deepEqual(
        kinds.filter(([text]) => text === '$param'),
        [
          ['$param', 'variable'],
          ['$param', 'variable'],
        ],
        body
      );
      assert.deepEqual(kinds.at(-1), [';', 'punctuation.delimiter'], body);
    }
  }
);

void t.test('groq: operators, literals, strings, and escapes', () => {
  const html = distinctHl(
    'select(onSale == true => round(price * 0.8, 2), a != b && c <= 1.5e3 || d >= -2 || !e, items[-1], 7 % 3 / 2 + 1 - 1, null, false)\n["a\\"b", \'c\\\'d\', "\\u0041 \\u{1F600} \\n", "multi\nline"]'
  );
  for (const op of [
    '==',
    '=>',
    '*',
    '!=',
    '&&',
    '<=',
    '||',
    '>=',
    '%',
    '/',
    '+',
  ]) {
    assert.equal(wordColor(html, op), distinctColor('operator'), op);
  }
  assert.equal(wordColor(html, '!'), distinctColor('operator'));
  for (const n of ['0.8', '2', '1.5e3', '-2', '-1', '7', '3']) {
    assert.equal(wordColor(html, n), distinctColor('number'), n);
  }
  // a minus after an operand subtracts
  assert.deepEqual(tokenKinds('groq', 'a -1'), [
    ['a', 'property'],
    ['-', 'operator'],
    ['1', 'number'],
  ]);
  assert.equal(exactColor(html, 'true'), distinctColor('boolean'));
  assert.equal(exactColor(html, 'false'), distinctColor('boolean'));
  assert.equal(exactColor(html, 'null'), distinctColor('constant.builtin'));
  assert.equal(exactColor(html, 'select'), distinctColor('function'));
  assert.equal(exactColor(html, 'round'), distinctColor('function'));
  for (const s of ['"a', 'b"', "'c", "d'", '"multi', 'line"']) {
    assert.equal(wordColor(html, s), distinctColor('string'), s);
  }
  for (const e of ['\\"', "\\'", '\\u0041', '\\u{1F600}', '\\n']) {
    assert.equal(exactColor(html, e), distinctColor('string.escape'), e);
  }
  // a short or unbraced code unit keeps its following text
  assert.deepEqual(tokenKinds('groq', '"\\u00 \\u{} \\u{41 \\é"'), [
    ['"', 'string'],
    ['\\u00', 'string.escape'],
    ['\\u{}', 'string.escape'],
    ['\\u{41', 'string.escape'],
    ['\\é', 'string.escape'],
    ['"', 'string'],
  ]);
});

void t.test(
  'groq: strings keep parameters, comments, and quotes inside',
  () => {
    // `$`, `//`, `*`, and the other quote are string text
    assert.deepEqual(
      tokenKinds(
        'groq',
        '["$term is not a param // nor a comment", \'$x\', "https://example.com/a?b=c", "it\'s", \'say "hi"\', "a * b"]'
      ),
      [
        ['[', 'punctuation.bracket'],
        ['"$term is not a param // nor a comment"', 'string'],
        [',', 'punctuation.delimiter'],
        ["'$x'", 'string'],
        [',', 'punctuation.delimiter'],
        ['"https://example.com/a?b=c"', 'string'],
        [',', 'punctuation.delimiter'],
        ['"it\'s"', 'string'],
        [',', 'punctuation.delimiter'],
        ['\'say "hi"\'', 'string'],
        [',', 'punctuation.delimiter'],
        ['"a * b"', 'string'],
        [']', 'punctuation.bracket'],
      ]
    );
    // a string runs over line breaks until its quote
    assert.deepEqual(
      tokenKinds(
        'groq',
        '*[title == "one\ntwo"] | order(\n  _createdAt desc\n)'
      ),
      [
        ['*', 'variable.special'],
        ['[', 'punctuation.bracket'],
        ['title', 'property'],
        ['==', 'operator'],
        ['"one', 'string'],
        ['two"', 'string'],
        [']', 'punctuation.bracket'],
        ['|', 'operator'],
        ['order', 'function'],
        ['(', 'punctuation.bracket'],
        ['_createdAt', 'property'],
        ['desc', 'keyword.operator'],
        [')', 'punctuation.bracket'],
      ]
    );
    // an unterminated string takes the rest of the input, parameters, comment
    // markers, and selectors included
    assert.deepEqual(tokenKinds('groq', '*[a == "open $x // not\n*[b]'), [
      ['*', 'variable.special'],
      ['[', 'punctuation.bracket'],
      ['a', 'property'],
      ['==', 'operator'],
      ['"open $x // not', 'string'],
      ['*[b]', 'string'],
    ]);
    assert.deepEqual(tokenKinds('groq', "'open \\' still"), [
      ["'open", 'string'],
      ["\\'", 'string.escape'],
      ['still', 'string'],
    ]);
    // a parameter needs a name starting with a letter or `_`; a bare `$` is
    // plain text (neighbors of one kind arrive merged)
    assert.deepEqual(tokenKinds('groq', '$ $1 $_a1 $$b'), [
      ['$ $', null],
      ['1', 'number'],
      ['$_a1', 'variable'],
      ['$', null],
      ['$b', 'variable'],
    ]);
  }
);

void t.test('groq: comments end at the line and `/` divides', () => {
  assert.deepEqual(
    tokenKinds('groq', '// head\n*[a / 2 > 1] // tail\n{ b } //'),
    [
      ['// head', 'comment'],
      ['*', 'variable.special'],
      ['[', 'punctuation.bracket'],
      ['a', 'property'],
      ['/', 'operator'],
      ['2', 'number'],
      ['>', 'operator'],
      ['1', 'number'],
      [']', 'punctuation.bracket'],
      ['// tail', 'comment'],
      ['{', 'punctuation.bracket'],
      ['b', 'property'],
      ['}', 'punctuation.bracket'],
      ['//', 'comment'],
    ]
  );
  // a comment swallows quotes, operators, and selectors to the line end
  assert.deepEqual(
    tokenKinds('groq', '{"a":1} // {"a":1,"b":2} => * "unclosed\n"b"'),
    [
      ['{', 'punctuation.bracket'],
      ['"a"', 'string'],
      [':', 'punctuation.delimiter'],
      ['1', 'number'],
      ['}', 'punctuation.bracket'],
      ['// {"a":1,"b":2} => * "unclosed', 'comment'],
      ['"b"', 'string'],
    ]
  );
});

void t.test('groq: malformed constructs stay total and lossless', () => {
  for (const src of [
    '',
    '/',
    '//',
    '"unterminated',
    "'unterminated",
    '"a\\',
    '"\\u{',
    '"\\u',
    '"\\uD83D\\',
    '$',
    '@',
    '^',
    '^^^',
    '.',
    '..',
    '...',
    '....',
    ':',
    '::',
    '-',
    '->',
    '-x',
    '=',
    '=>',
    '*',
    '**',
    '***',
    'fn',
    'fn ::',
    'fn ex::',
    'in',
    ')',
    '{,}',
    '[,]',
    '1.',
    '1e',
    '1e+',
    '.5',
    'é 日本語',
    '\0',
    '\u00a0\u0085',
    '~`?#\\',
  ]) {
    checkInvariants(lexer.hl, src);
  }
});

void t.test('groq: split ranges bound every lookahead', () => {
  const src =
    'fn my::f($a) = $a;\n*[_type == "post" && a in b] | order(x desc) [0...10] { "s": pt::text(body), ..., c->d } // c\n\'q\\\'\' -1 ** 2 ^.^._id @\n*   // x\n"\\u{1F600}\\uD83D\\uDE00"';
  for (let split = 0; split <= new TextEncoder().encode(src).length; split++) {
    checkInvariants(loadLang('groq', '$hlGroq', split).hl, src);
  }
});

void t.test(
  'groq: malformed UTF-8 stays balanced and decodes losslessly',
  () => {
    const bytes = Uint8Array.of(
      0x66,
      0x6f,
      0x6f,
      0x20,
      0xf0,
      0x28,
      0x8c,
      0x28,
      0x20,
      0xff
    );
    const html = lexer.hl(bytes);
    assert.equal(textOf(html), new TextDecoder().decode(bytes));
    spansOf(html);
  }
);

void t.test('groq: deterministic fuzz preserves lexer invariants', () => {
  const rand = makeRand(0x6720);
  const alphabet = 'abcXYZ09_ /\\"\'`\n\t{}[]().,:;+-*=!<>&|#@$%^~?é';
  for (let n = 0; n < 160; n++) {
    let src = '';
    for (let i = 0, len = rand() & 63; i < len; i++) {
      src += alphabet[rand() % alphabet.length];
    }
    checkInvariants(lexer.hl, src);
  }
});

void t.test('groq: multi-line constructs resume line-fed', () => {
  for (const code of [
    '*[title == "one\ntwo"] { title }\n',
    "*[title == 'one\ntwo'] { title }\n",
    '*[title == "a \\\n b"] { title }\n',
    // escapes keep their GROQ shape on a continued line
    '*[title == "one\n\\u0041 \\u{1F600} \\" two\n\\\n"] { title }\n',
    "*[title == 'one\n\\u0041 \\' two'] { title }\n",
    '"\\uD83D\n\\uDE00 $x // not a comment\n*[a]"\n',
    // $operand decides `*`, `-`, and word operators on the next line
    '*[_type == "post"]\n  | order(publishedAt desc)\n  [0...10]\n{ title }\n',
    '{\n  "a": count\n    * 2,\n  "b": items[\n    -1\n  ],\n  "c": title\n    match $q\n}\n',
    '*[_type == "post"] { title }\n\n*[_type == "page"] { title }\n',
    '*[_type == "movie"][0..5] // first 6 movies (inclusive)\n*   // Everything, i.e. all documents\n',
    // $member and $expect carry across a line break
    'author\n  ->\n  in\n',
    'fn\n  my\n  ::\n  f($a) = $a;\n',
    // the documentation's multi-line queries
    'fn ex::name($author) = $author-> { "name": firstName + " " + lastName };\n\n*[_type == "post"]{\n  "author": ex::name(author)\n}\n',
    '*[_type==\'movie\']{..., "popularity": select(\n  popularity > 20 => "high",\n  popularity > 10 => "medium",\n  "low"\n)}\n',
    '*[_type == "movie" && movieRating > 3] |\n  score(\n    title match $term,\n    boost(movieRating > 8, 3)\n  )\n',
    "*[\n  _type == 'storefront' &&\n  geo::distance(geoPoint, $currentLocation) < 16093.4\n]\n",
    'diff::changedAny(\n  {"firstName":"Bob","lastName":"Odenkirk"},\n  {"firstName":"Bob","lastName":"Holm"},\n  (firstName, lastName)\n)\n',
    "'content': content[]{\n  _type == 'reference' => @->,\n  _type != 'reference' => @,\n}\n",
  ]) {
    assertLineFedParity('groq', code);
  }
});
