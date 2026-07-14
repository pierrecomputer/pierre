import { describe, expect, test } from 'bun:test';

import { TextDocument } from '../../src/editor/textDocument';

function doc(text: string) {
  return new TextDocument('inmemory://1', text, 'plain');
}

// Applies a single insert whose range carries malformed numeric components,
// then reports whether the document survived. A correct implementation may
// either reject the edit (throw) or clamp the position to something valid —
// both count as surviving. What must never happen is unrelated content
// vanishing.
function insertAtMalformed(
  original: string,
  line: number,
  character: number
): { threw: boolean; text: string } {
  const d = doc(original);
  let threw = false;
  try {
    d.applyEdits([
      {
        range: {
          start: { line, character },
          end: { line, character },
        },
        newText: '#',
      },
    ]);
  } catch {
    threw = true;
  }
  return { threw, text: d.getText() };
}

describe('malformed numeric position components', () => {
  // Atom's clipPosition throws 'Invalid Point' on non-numeric components;
  // pierre-fe's normalizePosition has no finiteness guard, so NaN flows
  // through Math.min/max into offsetAt, the resolved offset becomes NaN,
  // and the edit range degenerates into a whole-document replace.

  test.failing(
    'an insert with a NaN component never destroys unrelated content',
    () => {
      // atom-legacy: atom-text-buffer/spec/text-buffer-spec.coffee — position clipping rejects non-numeric components instead of producing garbage offsets
      // KNOWN BUG: NaN in either component resolves to a NaN offset and the
      // edit replaces the ENTIRE document with the inserted text.
      for (const [line, character] of [
        [Number.NaN, 1],
        [0, Number.NaN],
        [Number.NaN, Number.NaN],
      ]) {
        const { threw, text } = insertAtMalformed(
          'harbor\nlantern',
          line,
          character
        );
        if (!threw) {
          expect(text).toContain('harbor');
          expect(text).toContain('lantern');
        }
      }
    }
  );

  test.failing(
    'an insert with fractional components never destroys unrelated content',
    () => {
      // atom-legacy: atom-text-buffer/spec/text-buffer-spec.coffee — position clipping rejects non-integer components instead of producing garbage offsets
      // KNOWN BUG: a fractional line (0.5) makes offsetAt return NaN via the
      // line-offset lookup, taking the same whole-document-replace path as
      // NaN inputs.
      const { threw, text } = insertAtMalformed('harbor\nlantern', 0.5, 2.5);
      if (!threw) {
        expect(text).toContain('harbor');
        expect(text).toContain('lantern');
      }
    }
  );

  test('Infinity components clamp to a valid position without data loss', () => {
    // atom-legacy: atom-text-buffer/spec/text-buffer-spec.coffee — position clipping bounds oversized components
    // DIVERGENCE: Atom throws on non-finite components; pierre-fe's
    // Math.min/max clamping happens to bound Infinity to a real offset, so
    // the insert lands at a valid spot and nothing is lost. Pinned so a
    // future finiteness guard (which may prefer to throw) shows up here.
    const { threw, text } = insertAtMalformed('harbor\nlantern', Infinity, 0);
    expect(threw).toBe(false);
    expect(text).toContain('harbor');
    expect(text).toContain('lantern');
    expect(text).toContain('#');
  });
});
