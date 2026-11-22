//! WAT sources: src/langs/jsx.wat src/langs/tsx.wat src/langs/tsrx.wat src/langs/js.wat src/langs/ts.wat src/sig.wat src/scan.wat src/common.wat
//!
//! Native JSX, TSX, and TSRX highlighter: the `$hlEcma` pipeline of
//! `src/langs/tsx.wat` with the JSX feature (and TypeScript, and TSRX), in
//! one pass. Each token is scanned and colored in the same step, with no
//! token buffer. A token whose color depends on the token after it
//! (identifiers, contextual words, `?`, and `:`) waits until that token is
//! scanned. A `<` in operand position with a tag shape, and a `}` that
//! closes an expression container, hand over to the markup steps of
//! `jsx.wat` ([`markup`]), which scan tags and children byte by byte until
//! an expression container (or a TSRX directive or script body) returns to
//! tokens. The records equal the translated `jsx`/`tsx`/`tsrx` lexers'.
//!
//! The token core is a copy of the JavaScript/TypeScript lexer in
//! `native/fast.rs`, with the classifier copied into [`ecma`] for the TSRX
//! rules; the tables and scans of `native/ecma_scan.rs` are shared.

mod ecma;
mod markup;

use self::ecma::{Sig, Ts};
use self::markup::JsxStack;
use super::Lexer;
use super::ecma::{
    COLON_OR_QUESTION, LEX_HL_TABLE, MULTI, NO_NEXT, Next, emit_multi, is, metadata_marker,
    tag_marker,
};
use super::ecma_scan::{
    BRACKETS, KIND_TABLE, TEMPLATES, code_point, keyword, kf, scan_regexp, scan_string,
    scan_template, utf8_bits,
};
use super::input::Input;
use super::recs::Recs;
use super::scan;
use crate::generated::Instance;
use crate::lex_ids as lex;
use crate::simd::V;
use crate::token_ids as tok;

/// The kind's color waits for the next token.
const DEFER: u32 = 1 << 20;
/// Before an identifier: a kind that a rule of `$identHl` ahead of its
/// word rules tests, apart from `(`.
const ID_PREV: u32 = 1 << 21;
/// After an identifier: a kind that a rule of `$identHl` ahead of its word
/// rules tests, apart from `(` and the kinds in [`ID_PAREN_NEXT`].
const ID_NEXT: u32 = 1 << 22;
/// After `( identifier`: a kind that makes a parameter rule apply.
const ID_PAREN_NEXT: u32 = 1 << 23;

/// Set `bit` in `t` for each of `kinds`.
const fn mark(mut t: [u32; 256], kinds: &[u8], bit: u32) -> [u32; 256] {
    let mut i = 0;
    while i < kinds.len() {
        t[kinds[i] as usize] |= bit;
        i += 1;
    }
    t
}

/// Per-kind flags: the [`kf`] bits and [`DEFER`], with the kind's fixed
/// color (`$LexHl`) in the top byte.
static FLAGS: [u32; 256] = {
    let mut t = [0u32; 256];
    let mut k = 0;
    while k < 256 {
        let hl = LEX_HL_TABLE[k];
        let mut f = KIND_TABLE[k] | (hl as u32) << 24;
        if hl >= COLON_OR_QUESTION {
            f |= DEFER;
        }
        if f & kf::CTX_IDENT_NEXT != 0 {
            f |= ID_NEXT;
        }
        t[k] = f;
        k += 1;
    }
    use lex::*;
    t = mark(
        t,
        &[
            DOT,
            QUESTION_MARK_DOT,
            COLON,
            IDENTIFIER,
            KEYWORD_EXTENDS,
            KEYWORD_NEW,
            KEYWORD_CLASS,
            KEYWORD_INTERFACE,
            KEYWORD_ENUM,
            CTXWORD_TYPE,
            KEYWORD_FUNCTION,
            // A TSRX rule names the identifier after `module`.
            CTXWORD_NAMESPACE,
        ],
        ID_PREV,
    );
    t = mark(t, &[FUNCTION_ARROW, CTXWORD_IS], ID_NEXT);
    t = mark(t, &[R_PAREN, COLON, QUESTION_MARK], ID_PAREN_NEXT);
    t
};

/// First bytes of identifiers that only the "variable" rule can match
/// (not uppercase, `_`, or the first letter of `undefined`): lowercase
/// letters and `$`.
static PLAIN_START: [bool; 256] = {
    let mut t = [false; 256];
    let mut c = 0;
    while c < 256 {
        let b = c as u8;
        t[c] = (b.is_ascii_lowercase() && b != b'u') || b == b'$';
        c += 1;
    }
    t
};

/// Identifier-continuation bytes: `[A-Za-z0-9_$]`.
static IDENT_CONT: [bool; 256] = {
    let mut t = [false; 256];
    let mut c = 0;
    while c < 256 {
        let b = c as u8;
        t[c] = b.is_ascii_alphanumeric() || b == b'_' || b == b'$';
        c += 1;
    }
    t
};

/// The end of the run of `[A-Za-z0-9_$]` bytes starting at `p`. The input
/// ends with a NUL and slack, so the run stops by the end.
#[inline(always)]
fn ident_end(src: Input, mut p: usize) -> usize {
    // SAFETY: `p` is at most the input length (callers pass a position right after a token's first
    // byte).
    if !IDENT_CONT[unsafe { src.byte_unchecked(p) } as usize] {
        return p;
    }
    loop {
        // SAFETY: the NUL after the input ends the run, so `p` is at most the input length and the
        // 16 bytes lie inside the slack.
        let v = unsafe { src.vec_unchecked(p) };
        let alpha = v.or(V::splat(0x20)).sub(V::splat(b'a')).le(V::splat(25));
        let digit = v.sub(V::splat(b'0')).le(V::splat(9));
        let extra = v.eq(V::splat(b'_')).or(v.eq(V::splat(b'$')));
        let stop = alpha.or(digit).or(extra).not().lanes();
        if stop.any() {
            return p + stop.first();
        }
        p += 16;
    }
}

/// The end of the run of whitespace bytes (space, TAB..CR) starting at
/// `p`, and whether it holds a line break.
#[inline(always)]
fn space_run(src: Input, mut p: usize) -> (usize, bool) {
    let mut nl = false;
    loop {
        // SAFETY: the NUL after the input ends the run (NUL is not whitespace), so `p` is at most
        // the input length and the 16 bytes lie inside the slack.
        let v = unsafe { src.vec_unchecked(p) };
        let sp = v.eq(V::splat(b' ')).or(v.sub(V::splat(9)).le(V::splat(4)));
        let br = v.eq(V::splat(b'\n')).or(v.eq(V::splat(b'\r')));
        let stop = sp.not().lanes();
        let br = br.lanes();
        if stop.any() {
            nl |= br.and(stop.before_first()).any();
            return (p + stop.first(), nl);
        }
        nl |= br.any();
        p += 16;
    }
}

/// The end of the run of spaces (0x20) starting at `p`, eight bytes at a
/// time. The input ends with a NUL, so the run stops by the end.
#[inline(always)]
fn spaces_end(src: Input, p: usize) -> usize {
    run_end(src, p, 0x2020_2020_2020_2020)
}

/// The end of the run of the byte repeated in `fill` starting at `p`,
/// eight bytes at a time. The input ends with a NUL, so the run stops by
/// the end.
#[inline(always)]
fn run_end(src: Input, mut p: usize, fill: u64) -> usize {
    loop {
        // SAFETY: the NUL after the input ends the run, so `p` is at most the input length and the
        // 8 bytes lie inside the slack.
        let w = unsafe { src.word_unchecked(p) };
        let x = w ^ fill;
        if x != 0 {
            return p + (x.trailing_zeros() / 8) as usize;
        }
        p += 8;
    }
}

/// Skip whitespace from `p`, including no-break spaces, the line and
/// paragraph separators, and byte order marks: the new position, and
/// whether a line break was crossed.
#[inline(always)]
fn skip_space(src: Input, mut p: usize, end: usize) -> (usize, bool) {
    let mut nl = false;
    while p < end {
        // SAFETY: `p` is below `end`.
        let c = unsafe { src.byte_unchecked(p) };
        if c.wrapping_sub(33) <= 93 {
            break;
        }
        if c == b' ' || c.wrapping_sub(9) <= 4 {
            let (q, br) = space_run(src, p);
            p = q;
            nl |= br;
            continue;
        }
        // SAFETY: `p + 1` is below `end`.
        if c == 194 && p + 1 < end && unsafe { src.byte_unchecked(p + 1) } == 160 {
            p += 2;
            continue;
        }
        if p + 3 <= end
            && c == 0xe2
            // SAFETY: `p + 2` is below `end`.
            && unsafe { src.byte_unchecked(p + 1) } == 0x80
            && unsafe { src.byte_unchecked(p + 2) } & 0xfe == 0xa8
        {
            nl = true;
            p += 3;
            continue;
        }
        if p + 3 <= end
            && c == 0xef
            // SAFETY: `p + 2` is below `end`.
            && unsafe { src.byte_unchecked(p + 1) } == 0xbb
            && unsafe { src.byte_unchecked(p + 2) } == 0xbf
        {
            p += 3;
            continue;
        }
        break;
    }
    (p, nl)
}

/// The end of an identifier's tail from `p`, through ASCII and Unicode
/// identifier characters.
#[cold]
#[inline(never)]
fn ident_tail_unicode(src: Input, end: usize, mut p: usize) -> usize {
    while p < end && src.byte(p) >= 128 {
        let bits = utf8_bits(src.byte(p));
        if bits == 0 {
            break;
        }
        let ok = code_point(src.bytes(), p, bits).is_some_and(|c| {
            c == '\u{200c}' || c == '\u{200d}' || unicode_ident::is_xid_continue(c)
        });
        if !ok {
            break;
        }
        p = ident_end(src, p + bits);
    }
    p.min(end)
}

/// A token starting with the non-ASCII byte `c` at `lhs`: an identifier,
/// or one invalid code point. Returns its kind and end.
#[cold]
#[inline(never)]
fn non_ascii(src: Input, end: usize, c: u8, lhs: usize) -> (u8, usize) {
    let bits = utf8_bits(c);
    if bits != 0 && code_point(src.bytes(), lhs, bits).is_some_and(unicode_ident::is_xid_start) {
        let p = ident_end(src, lhs + bits);
        return (lex::IDENTIFIER, ident_tail_unicode(src, end, p));
    }
    (lex::INVALID, (lhs + bits.max(1)).min(end))
}

/// A number's tail from `p`; the first digit or leading dot at `lhs` is
/// already consumed (`$scanNumber`). Returns its end.
#[inline(always)]
fn number(src: Input, end: usize, lhs: usize, mut p: usize, seen_dot: bool) -> usize {
    let byte = |q: usize| if q < end { src.byte(q) } else { 0 };
    let hex = src.byte(lhs) == b'0' && byte(lhs + 1) | 32 == b'x';
    let mut seen_dot = seen_dot;
    let mut prev = 0u8;
    while p < end {
        let c = src.byte(p);
        let take = c.is_ascii_alphanumeric()
            || c == b'_'
            || ((c == b'+' || c == b'-') && !hex && prev | 32 == b'e')
            || (c == b'.' && !seen_dot && {
                seen_dot = true;
                true
            });
        if !take {
            break;
        }
        prev = c;
        p += 1;
    }
    p
}

/// State the hot loop touches rarely, kept in memory so the loop's own
/// variables stay in registers. The out-of-line helpers take it by
/// reference.
struct Cold<'a> {
    src: Input<'a>,
    end: usize,
    /// Lexer memory offset of the input, for delegated calls.
    base: usize,
    /// TypeScript syntax and rules (`$ecmaHasTypeScript`).
    ts: bool,
    /// TSRX syntax and rules (`$ecmaHasTsrx`).
    tsrx: bool,
    /// The last non-comment kind as scanned (`$lto`) and as classified
    /// (`$prevTok`), handed to and from the markup steps, which change
    /// them; the hot loop keeps its own copies.
    lto: u8,
    prev: u8,
    /// The markup mode stack.
    jsx: JsxStack,
    /// The parameter-list machine (`sig.wat`).
    sig: Sig,
    /// An import or export clause is open (`$ecmaImport`).
    import: bool,
    /// `$jsTemplateMarker`, handed to the delegated emitters.
    marker: i32,
    /// The last non-comment kind before the last string literal, which
    /// `$rxAllowedAfter` reads after a string.
    before_string: u8,
    /// The range of the token waiting for the next one.
    pend_lhs: usize,
    pend_rhs: usize,
    source_start: usize,
    brace_depth: i32,
    brk_sp: usize,
    rx_closer: u8,
    tpl_sp: usize,
    brk: [u8; BRACKETS],
    tpl: [i32; TEMPLATES],
}

impl<'a> Cold<'a> {
    /// The classifier's view of the state, with `prev` the last
    /// non-comment kind.
    #[inline(always)]
    fn ts(&self, prev: u8) -> Ts<'a> {
        Ts {
            src: self.src,
            end: self.end,
            ts: self.ts,
            tsrx: self.tsrx,
            brk_top: if self.tsrx { self.brk_top_kind() } else { 0 },
            sig: self.sig,
            ecma_import: self.import,
            prev_tok: prev,
        }
    }

    /// Whether the parameter-list machine has a list open or a function
    /// head pending; otherwise it only tracks the paren depth.
    #[inline(always)]
    fn busy(&self) -> bool {
        self.sig.fn_pend || self.sig.mask != 0
    }

    /// The kind of the innermost open bracket, or 0 with none open
    /// (`$brkTopKind`).
    fn brk_top_kind(&self) -> u8 {
        if self.brk_sp == 0 || self.brk_sp > BRACKETS {
            return 0;
        }
        self.brk[self.brk_sp - 1]
    }

    /// `$brkPush`.
    #[inline(always)]
    fn brk_push(&mut self, k: u8) {
        if self.brk_sp < BRACKETS {
            self.brk[self.brk_sp] = k;
        }
        self.brk_sp += 1;
    }

    /// `$brkPop`.
    #[inline(always)]
    fn brk_pop(&mut self) {
        self.rx_closer = 0;
        if self.brk_sp == 0 {
            return;
        }
        self.brk_sp -= 1;
        if self.brk_sp < BRACKETS {
            self.rx_closer = self.brk[self.brk_sp] & 1;
        }
    }

    /// Template characters from `p`; a `${` pushes the brace depth it
    /// returns to. Returns the kind and end.
    #[inline(always)]
    fn template(&mut self, p: usize) -> (u8, usize) {
        let (kind, q) = scan_template(self.src.bytes(), p, self.end, self.tpl_sp >= TEMPLATES);
        if kind == lex::DOLLAR_BRACE {
            self.tpl[self.tpl_sp] = self.brace_depth;
            self.tpl_sp += 1;
        }
        (kind, q)
    }

    /// Whether `/` after `lto` starts a regexp (`$rxAllowedAfter`); `nl`
    /// is whether a line break precedes the `/`.
    #[inline(always)]
    fn rx_allowed_after(&self, lto: u8, nl: bool) -> bool {
        let f = FLAGS[lto as usize];
        if f & kf::RX_DYNAMIC == 0 {
            return f & kf::RX_OK != 0;
        }
        if lto == lex::STRING_LITERAL {
            return nl
                && matches!(
                    self.before_string,
                    lex::CTXWORD_FROM | lex::KEYWORD_IMPORT | lex::KEYWORD_EXPORT
                );
        }
        self.rx_closer != 0
    }

    /// Whether a `<` after the classified kind `prev` can open a JSX
    /// element (`$jsxCanStart`).
    #[inline(always)]
    fn jsx_can_start(&self, prev: u8) -> bool {
        prev != lex::STRING_LITERAL && self.rx_allowed_after(prev, false)
    }
}

/// `$sigStep` for a kind other than an identifier or accessor word while
/// the machine is busy. Returns whether it stays busy.
#[cold]
#[inline(never)]
fn sig_busy(cold: &mut Cold, prev: u8, t: u8) -> bool {
    cold.sig.step(prev, t, cold.tsrx);
    cold.busy()
}

/// `$classify` for kind `t` through the full rules, keeping the
/// parameter-list machine's changes.
#[cold]
#[inline(never)]
fn classify(cold: &mut Cold, prev: u8, t: u8, next: Next, lhs: usize, rhs: usize) -> u32 {
    let mut ts = cold.ts(prev);
    let hl = ts.classify(t, next, lhs, rhs);
    cold.sig = ts.sig;
    hl
}

/// `$classify` for an identifier with a function head pending or a
/// parameter list open (or a `constructor(` head). The function's name and
/// a top-level parameter take their color directly when no rule ahead of
/// theirs applies: no contextual word can follow, and the parameter-list
/// machine passes over a name.
#[cold]
#[inline(never)]
fn busy_ident(cold: &mut Cold, prev: u8, next: Next, lhs: usize, rhs: usize) -> u32 {
    if FLAGS[next.t as usize] & ID_NEXT == 0 && !(next.t == lex::L_PAREN && rhs - lhs == 11) {
        let s = &cold.sig;
        if prev == lex::KEYWORD_FUNCTION && !builtin_const(cold.src, lhs, rhs) {
            return tok::FUNCTION;
        }
        if FLAGS[prev as usize] & kf::SIG_PARAM_PREV != 0
            && s.active()
            && s.obscure == 0
            && s.angle == 0
        {
            return tok::VARIABLE_PARAMETER;
        }
    }
    classify(cold, prev, lex::IDENTIFIER, next, lhs, rhs)
}

/// The word rules for an identifier no context rule applies to: builtin
/// constants, calls, SCREAMING_CASE constants, and capitalized types.
#[inline(never)]
fn ident_word(cold: &Cold, prev: u8, next: Next, lhs: usize, rhs: usize) -> u32 {
    let ts = cold.ts(prev);
    if next.t == lex::L_PAREN && !ts.is_builtin_const(lhs, rhs) {
        return tok::FUNCTION;
    }
    ts.ident_by_word(prev, next, lhs, rhs)
}

/// Color a waiting contextual word, `?`, or `:`, and set the template
/// marker after it.
#[cold]
#[inline(never)]
fn resolve_other(cold: &mut Cold, prev: u8, t: u8, next: Next, lhs: usize, rhs: usize) -> u32 {
    let hl = classify(cold, prev, t, next, lhs, rhs);
    // A metadata key's marker survives to the template after its colon.
    cold.marker = if t == lex::COLON && cold.marker & 0x4000_0000 != 0 {
        cold.marker & 0xbfff_ffffu32 as i32
    } else {
        0
    };
    hl
}

/// Whether `[lhs, rhs)` names a predefined TypeScript type
/// (`$isPredefinedType`).
#[inline(never)]
fn predefined_type(src: Input, lhs: usize, rhs: usize) -> bool {
    matches!(
        &src.bytes()[lhs..rhs],
        b"any" | b"never" | b"number" | b"string" | b"symbol" | b"object" | b"boolean" | b"unknown"
    )
}

/// Whether `=>` follows `after` past whitespace and control bytes
/// (`$sigArrowAhead`).
#[inline(never)]
fn arrow_ahead(src: Input, end: usize, after: usize) -> bool {
    let byte = |q: usize| if q < end { src.byte(q) } else { 0 };
    let mut p = after;
    let mut c = byte(p);
    while c != 0 && c <= 32 {
        p += 1;
        c = byte(p);
    }
    c == b'=' && byte(p + 1) == b'>'
}

/// Whether `[lhs, rhs)` spells `undefined`, `NaN`, or `Infinity`
/// (`$isBuiltinConst`).
#[inline(always)]
fn builtin_const(src: Input, lhs: usize, rhs: usize) -> bool {
    matches!(rhs - lhs, 3 | 8 | 9)
        && matches!(&src.bytes()[lhs..rhs], b"undefined" | b"NaN" | b"Infinity")
}

/// The end of at most `max` ASCII hex digits from `p`, bounded by `end`
/// (`$scanHexRun`).
#[inline(always)]
fn hex_run(src: Input, mut p: usize, max: usize, end: usize) -> usize {
    let stop = (p + max).min(end);
    while p < stop && src.byte(p).is_ascii_hexdigit() {
        p += 1;
    }
    p
}

/// Emit the string `[from, to)` with its escapes (`$emitEscaped`): the text
/// between escapes as strings, and each `\x`, `\u`, `\u{...}`, or
/// single-character escape as an escape, never splitting a code point.
#[inline(never)]
fn emit_escaped(recs: &mut Recs, src: Input, end: usize, from: usize, to: usize) {
    let byte = |q: usize| if q < end { src.byte(q) } else { 0 };
    let mut seg = from;
    let mut p = from;
    while p < to {
        let q = scan::find3(src.bytes(), p, to, b'\\', b'\\', b'\\');
        if q >= to {
            break;
        }
        if seg < q {
            recs.tok(tok::STRING, q);
        }
        let mut e = match byte(q + 1) {
            b'u' if byte(q + 2) == b'{' => {
                let e = hex_run(src, q + 3, 16, end);
                if e < to && src.byte(e) == b'}' {
                    e + 1
                } else {
                    e
                }
            }
            b'u' => hex_run(src, q + 2, 4, end),
            b'x' => hex_run(src, q + 2, 2, end),
            _ => q + 2,
        };
        e = scan::utf8_span_end(src.bytes(), e, to);
        if q < e {
            recs.tok(tok::STRING_ESCAPE, e);
        }
        p = e;
        seg = e;
    }
    if seg < to {
        recs.tok(tok::STRING, to);
    }
}

/// Whether the block comment `[lhs, rhs)` is a `/** ... */` doc comment
/// (`$isDocComment`): a third `*`, except in the empty `/**/`. A comment
/// still open at its end is judged by its opener alone.
#[inline(always)]
fn is_doc_comment(src: Input, end: usize, lhs: usize, rhs: usize) -> bool {
    let open = rhs - lhs < 4 || &src.bytes()[rhs - 2..rhs] != b"*/";
    lhs + 2 < end && src.byte(lhs + 2) == b'*' && (rhs - lhs > 4 || open)
}

/// Whether the JSDoc tag name `[lhs, rhs)` takes a parameter path
/// (`$isParamTag`).
#[inline(always)]
fn is_param_tag(src: Input, lhs: usize, rhs: usize) -> bool {
    matches!(
        &src.bytes()[lhs..rhs],
        b"param"
            | b"arg"
            | b"argument"
            | b"prop"
            | b"property"
            | b"template"
            | b"typedef"
            | b"callback"
    )
}

/// A JSDoc parameter path byte: identifier characters and `.`
/// (`$docNameChar`).
#[inline(always)]
fn doc_name_char(c: u8) -> bool {
    c.is_ascii_alphanumeric() || c == b'_' || c == b'$' || c == b'.'
}

/// The first byte at or after `p` that is not a space or tab, or `rhs`
/// (`$blanksEnd`).
#[inline(always)]
fn blanks_end(src: Input, mut p: usize, rhs: usize) -> usize {
    while p < rhs && matches!(src.byte(p), b' ' | b'\t') {
        p += 1;
    }
    p
}

/// Emit the doc comment `[lhs, rhs)` (`$emitDocCommentRange` with the
/// `/**` opener skipped): `@tag` as a JSDoc keyword, a balanced `{type}`
/// right after it on the same line as a JSDoc type in brackets, and the
/// name path after parameter-like tags as a JSDoc variable. Everything else
/// is doc comment text.
#[inline(never)]
fn emit_doc_comment(recs: &mut Recs, src: Input, lhs: usize, rhs: usize) {
    // `$emitTok`: empty ranges emit nothing.
    let emit = |recs: &mut Recs, hl: u32, a: usize, b: usize| {
        if a < b {
            recs.tok(hl, b);
        }
    };
    let mut seg = lhs;
    let mut p = lhs + 3;
    loop {
        p = scan::find3(src.bytes(), p, rhs, b'@', b'@', b'@').max(p);
        if p >= rhs {
            break;
        }
        // A tag starts a word, after whitespace, `*`, `{`, or `(`.
        let c = if p > lhs { src.byte(p - 1) } else { b' ' };
        if !(c == b' ' || c.wrapping_sub(9) <= 4 || matches!(c, b'*' | b'{' | b'(')) {
            p += 1;
            continue;
        }
        // ... and a letter follows the `@`.
        let mut e = p + 1;
        if e >= rhs || !src.byte(e).is_ascii_alphabetic() {
            p = e;
            continue;
        }
        loop {
            e += 1;
            if e >= rhs || !src.byte(e).is_ascii_alphanumeric() {
                break;
            }
        }
        emit(recs, tok::COMMENT_DOC, seg, p);
        emit(recs, tok::KEYWORD_JSDOC, p, e);
        let param = e - (p + 1) <= 8 && is_param_tag(src, p + 1, e);
        seg = e;
        p = e;
        // An optional `{type}`, balanced and on this line.
        let q = blanks_end(src, p, rhs);
        if q < rhs && src.byte(q) == b'{' {
            let mut b = q + 1;
            let mut depth = 1;
            let closed = loop {
                if b >= rhs || matches!(src.byte(b), b'\n' | b'\r') {
                    break false;
                }
                match src.byte(b) {
                    b'{' => depth += 1,
                    b'}' => depth -= 1,
                    _ => {}
                }
                b += 1;
                if depth == 0 {
                    break true;
                }
            };
            if closed {
                emit(recs, tok::COMMENT_DOC, seg, q);
                emit(recs, tok::PUNCTUATION_BRACKET, q, q + 1);
                emit(recs, tok::TYPE_JSDOC, q + 1, b - 1);
                emit(recs, tok::PUNCTUATION_BRACKET, b - 1, b);
                seg = b;
                p = b;
            }
        }
        // The tag's name argument.
        if param {
            let q = blanks_end(src, p, rhs);
            if q < rhs {
                let mut b = q;
                while b < rhs && doc_name_char(src.byte(b)) {
                    b += 1;
                }
                if b != q {
                    emit(recs, tok::COMMENT_DOC, seg, q);
                    emit(recs, tok::VARIABLE_JSDOC, q, b);
                    seg = b;
                    p = b;
                }
            }
        }
    }
    emit(recs, tok::COMMENT_DOC, seg, rhs);
}

/// Emit a token that neither waits nor is plain: import clause words,
/// strings, templates, comments, and invalid bytes. Records go through
/// `inst.ext.recs`.
#[cold]
#[inline(never)]
fn other(
    cold: &mut Cold,
    inst: &mut Instance,
    base: usize,
    prev: u8,
    t: u8,
    lhs: usize,
    rhs: usize,
) {
    let flags = FLAGS[t as usize];
    if t == lex::KEYWORD_IMPORT || t == lex::KEYWORD_EXPORT {
        cold.import = true;
    } else if cold.import && flags & kf::IMPORT_END != 0 {
        cold.import = false;
    }
    let mut metadata = 0i32;
    if t == lex::STRING_LITERAL && matches!(prev, lex::EOF | lex::L_BRACE | lex::COMMA) {
        metadata = metadata_marker(cold.src, t, lhs, rhs);
    }
    if (flags >> 24) as u8 != MULTI {
        let hl = classify(cold, prev, t, NO_NEXT, lhs, rhs);
        let mut recs = Recs::load(inst);
        recs.tok(hl, rhs);
        recs.store(inst);
    } else if t == lex::STRING_LITERAL
        || (t == lex::INVALID && matches!(cold.src.byte(lhs), b'"' | b'\''))
    {
        let mut recs = Recs::load(inst);
        emit_escaped(&mut recs, cold.src, cold.end, lhs, rhs);
        recs.store(inst);
    } else if t == lex::MULTILINE_COMMENT {
        let mut recs = Recs::load(inst);
        if is_doc_comment(cold.src, cold.end, lhs, rhs) {
            emit_doc_comment(&mut recs, cold.src, lhs, rhs);
        } else {
            recs.tok(tok::COMMENT, rhs);
        }
        recs.store(inst);
    } else {
        let abs = |p: usize| (base + p) as i32;
        // Delegated emitters read `$ptr`, `$end`, and the template globals.
        inst.g_ptr = abs(rhs);
        inst.g_jsTemplateMarker = cold.marker;
        emit_multi(inst, cold.src.bytes(), t, abs(lhs), abs(rhs));
        cold.marker = inst.g_jsTemplateMarker;
        // SAFETY: `base..base + end + SLACK` lies inside lexer memory, which
        // the translated emitters may have moved.
        cold.src = unsafe { Input::new(inst, base, cold.end) };
    }
    let marker_before = cold.marker;
    cold.marker = 0;
    if t == lex::MULTILINE_COMMENT {
        cold.marker = tag_marker(cold.src.bytes(), t, lhs, rhs);
    }
    if flags & kf::COMMENT != 0 && cold.marker == 0 {
        cold.marker = marker_before;
    }
    if metadata != 0 {
        cold.marker = metadata;
    }
}

/// Lex every token from `cold.source_start` to the end into
/// `inst.ext.recs` (`$hlEcmaImpl`), with TypeScript when `TS` and TSRX
/// when `TSRX`.
// The end-of-input step updates loop state that is not read again.
#[allow(unused_assignments)]
#[inline(always)]
fn lex<const TS: bool, const TSRX: bool>(cold: &mut Cold, inst: &mut Instance, base: usize) {
    // Made again from `cold.src` after the steps that may call translated
    // code, which makes a new input.
    let mut src = cold.src;
    let end = cold.end;
    // The byte at `q`, or 0 at or past the end (`$tsxByte`).
    macro_rules! byte {
        ($q:expr) => {{
            let q: usize = $q;
            if q < end {
                // SAFETY: `q` is below `end`, the input length.
                unsafe { src.byte_unchecked(q) }
            } else {
                0
            }
        }};
    }
    let mut p = cold.source_start;
    // Kind of the last non-comment token as scanned, and as classified.
    let mut lto = lex::EOF;
    let mut prev = lex::EOF;
    let mut busy = false;
    // The token waiting for the next one (`EOF` when none).
    let mut pend = lex::EOF;
    let mut done = p;
    // A line break precedes the current token.
    let mut nl: bool;
    let mut recs = Recs::load(inst);

    // `$classify` for the waiting identifier at `lhs..rhs`.
    macro_rules! identifier {
        ($next:expr, $lhs:expr, $rhs:expr) => {{
            let (next, lhs, rhs): (Next, usize, usize) = ($next, $lhs, $rhs);
            let pf = FLAGS[prev as usize];
            let nf = FLAGS[next.t as usize];
            if busy || (next.t == lex::L_PAREN && rhs - lhs == 11) {
                core::hint::cold_path();
                let hl = busy_ident(cold, prev, next, lhs, rhs);
                busy = cold.busy();
                hl
            } else if prev == lex::DOT || prev == lex::QUESTION_MARK_DOT {
                if next.t != lex::L_PAREN {
                    tok::PROPERTY
                // SAFETY: `lhs` starts the waiting identifier, inside the input.
                } else if !unsafe { src.byte_unchecked(lhs) }.is_ascii_uppercase() {
                    tok::FUNCTION_METHOD
                } else {
                    classify(cold, prev, lex::IDENTIFIER, next, lhs, rhs)
                }
            } else if pf & ID_PREV == 0
                && nf & ID_NEXT == 0
                && (pf & kf::KEY_PREV == 0 || nf & kf::KEY_NEXT == 0)
                && (prev != lex::L_PAREN || nf & ID_PAREN_NEXT == 0)
            {
                // Only the builtin-constant, call, and word rules remain.
                // SAFETY: `lhs` starts the waiting identifier, inside the input.
                if PLAIN_START[unsafe { src.byte_unchecked(lhs) } as usize] {
                    if next.t == lex::L_PAREN {
                        tok::FUNCTION
                    } else {
                        tok::VARIABLE
                    }
                } else {
                    ident_word(cold, prev, next, lhs, rhs)
                }
            } else if TS && prev == lex::COLON && nf & ID_NEXT == 0 {
                // A TypeScript annotation `: name` with no parameter list
                // open: predefined types, then the word rules.
                if predefined_type(src, lhs, rhs) {
                    tok::TYPE_BUILTIN
                // SAFETY: `lhs` starts the waiting identifier, inside the input.
                } else if PLAIN_START[unsafe { src.byte_unchecked(lhs) } as usize] {
                    if next.t == lex::L_PAREN {
                        tok::FUNCTION
                    } else {
                        tok::VARIABLE
                    }
                } else {
                    ident_word(cold, prev, next, lhs, rhs)
                }
            } else if prev == lex::L_PAREN && next.t == lex::R_PAREN {
                // `(name)`: an arrow's sole parameter before `=>`, else
                // only the word rules apply.
                if arrow_ahead(src, end, next.rhs) {
                    tok::VARIABLE_PARAMETER
                // SAFETY: `lhs` starts the waiting identifier, inside the input.
                } else if PLAIN_START[unsafe { src.byte_unchecked(lhs) } as usize] {
                    tok::VARIABLE
                } else {
                    ident_word(cold, prev, next, lhs, rhs)
                }
            } else if (prev == lex::L_BRACE || prev == lex::COMMA || (TS && prev == lex::SEMICOLON))
                && (next.t == lex::COLON
                    || (TS && next.t == lex::QUESTION_MARK && byte!(next.rhs) == b':'))
                && !builtin_const(src, lhs, rhs)
            {
                // An object or member key: with no parameter list open, no
                // rule of `$identHl` ahead of the key rule applies.
                tok::PROPERTY
            } else {
                core::hint::cold_path();
                let hl = classify(cold, prev, lex::IDENTIFIER, next, lhs, rhs);
                busy = cold.busy();
                hl
            }
        }};
    }
    // Color and emit the waiting token, if any, now that `t` at
    // `lhs..rhs` follows it.
    macro_rules! resolve {
        ($t:expr, $lhs:expr, $rhs:expr) => {{
            if pend != lex::EOF {
                let next = Next {
                    t: $t,
                    lhs: $lhs,
                    rhs: $rhs,
                    nl,
                };
                let (t, lhs, rhs) = (pend, cold.pend_lhs, cold.pend_rhs);
                pend = lex::EOF;
                if t == lex::IDENTIFIER {
                    // A component metadata key (`template:`, `styles:`) or a
                    // template tag (`html`, `css`) sets the marker.
                    let mut metadata = 0i32;
                    if matches!(prev, lex::EOF | lex::L_BRACE | lex::COMMA) {
                        metadata = metadata_marker(src, t, lhs, rhs);
                    }
                    let hl = if metadata != 0
                        && (next.t == lex::COLON || next.t == lex::EOF || is(next.t, kf::COMMENT))
                    {
                        tok::PROPERTY
                    } else {
                        identifier!(next, lhs, rhs)
                    };
                    recs.tok(hl, rhs);
                    cold.marker = if metadata != 0 {
                        metadata
                    } else if (rhs - lhs).wrapping_sub(3) <= 1 {
                        tag_marker(src.bytes(), t, lhs, rhs)
                    } else {
                        0
                    };
                } else if t == lex::CTXWORD_FROM && next.t == lex::STRING_LITERAL {
                    // `from 'module'`, which the parameter-list machine
                    // passes over.
                    cold.marker = 0;
                    recs.tok(tok::KEYWORD_IMPORT, rhs);
                } else if !busy && (t == lex::COLON || t == lex::QUESTION_MARK) {
                    // `$classify` for `:` and `?` with no parameter list
                    // open: TypeScript's `: Type` and `?:` are special.
                    let hl = if t == lex::COLON {
                        if TS
                            && next.t == lex::IDENTIFIER
                            // SAFETY: `next.lhs` starts the next token, inside the input.
                            && (unsafe { src.byte_unchecked(next.lhs) }.is_ascii_uppercase()
                                || predefined_type(src, next.lhs, next.rhs))
                        {
                            tok::PUNCTUATION_SPECIAL
                        } else {
                            tok::PUNCTUATION_DELIMITER
                        }
                    } else if TS && next.t == lex::COLON {
                        tok::PUNCTUATION_SPECIAL
                    } else {
                        tok::OPERATOR
                    };
                    // A metadata key's marker survives to the template
                    // after its colon.
                    cold.marker = if t == lex::COLON && cold.marker & 0x4000_0000 != 0 {
                        cold.marker & 0xbfff_ffffu32 as i32
                    } else {
                        0
                    };
                    recs.tok(hl, rhs);
                } else {
                    core::hint::cold_path();
                    let hl = resolve_other(cold, prev, t, next, lhs, rhs);
                    busy = cold.busy();
                    recs.tok(hl, rhs);
                }
                done = rhs;
                prev = t;
            }
        }};
    }
    // Finish the scanned token `t` at `lhs..rhs`: color the waiting token,
    // then emit this one or make it wait.
    // Hand the loop's state to a markup step, which writes records and
    // changes the last kinds, and take it back after.
    macro_rules! markup {
        ($call:expr) => {{
            recs.store(inst);
            cold.lto = lto;
            cold.prev = prev;
            p = $call;
            recs = Recs::load(inst);
            src = cold.src;
            lto = cold.lto;
            prev = cold.prev;
            done = p;
        }};
    }
    // Emit the plain single-span token `t` ending at `rhs`, stepping the
    // parameter-list machine.
    macro_rules! plain {
        ($t:expr, $rhs:expr, $f:expr) => {{
            let (t, rhs, f): (u8, usize, u32) = ($t, $rhs, $f);
            if busy {
                core::hint::cold_path();
                busy = sig_busy(cold, prev, t);
            } else if f & kf::SIG_IDLE != 0 {
                if t == lex::L_PAREN {
                    cold.sig.parens += 1;
                } else if t == lex::R_PAREN {
                    cold.sig.parens = cold.sig.parens.saturating_sub(1);
                } else {
                    cold.sig.fn_pend = true;
                    cold.sig.fn_angle = 0;
                    busy = true;
                }
            }
            recs.tok(f >> 24, rhs);
            cold.marker = 0;
            prev = t;
            done = rhs;
        }};
    }
    macro_rules! finish {
        ($t:expr, $lhs:expr, $rhs:expr) => {{
            let (t, lhs, rhs): (u8, usize, usize) = ($t, $lhs, $rhs);
            let f = FLAGS[t as usize];
            if f & kf::NOT_LTO == 0 {
                if t == lex::STRING_LITERAL {
                    cold.before_string = lto;
                }
                lto = t;
            }
            resolve!(t, lhs, rhs);
            recs.gap(done, lhs);
            if f & DEFER != 0 {
                pend = t;
                cold.pend_lhs = lhs;
                cold.pend_rhs = rhs;
            } else if f & kf::PLAIN != 0 && (f & kf::IMPORT_END == 0 || !cold.import) {
                plain!(t, rhs, f);
            } else if t == lex::COMMENT || t == lex::HASH_BANG {
                // A line comment keeps the marker and the previous kind.
                recs.tok(tok::COMMENT, rhs);
            } else if t == lex::STRING_LITERAL
                && scan::find3(src.bytes(), lhs, rhs, b'\\', b'\\', b'\\') >= rhs
            {
                // A string without escapes is one string token; it ends an
                // import clause, and as a component metadata key sets the
                // template marker (as in `other`).
                cold.import = false;
                let metadata = if matches!(prev, lex::EOF | lex::L_BRACE | lex::COMMA) {
                    metadata_marker(src, t, lhs, rhs)
                } else {
                    0
                };
                recs.tok(tok::STRING, rhs);
                cold.marker = metadata;
                prev = t;
                done = rhs;
            } else if !busy && (t == lex::KEYWORD_IMPORT || t == lex::KEYWORD_EXPORT) {
                // `import` and `export` open an import clause.
                cold.import = true;
                recs.tok(tok::KEYWORD_IMPORT, rhs);
                cold.marker = 0;
                prev = t;
                done = rhs;
            } else {
                recs.store(inst);
                core::hint::cold_path();
                other(cold, inst, base, prev, t, lhs, rhs);
                recs = Recs::load(inst);
                src = cold.src;
                busy = cold.busy();
                if f & kf::COMMENT == 0 {
                    prev = t;
                }
                done = rhs;
            }
        }};
    }
    // A fixed-length token of kind `t`.
    macro_rules! take {
        ($lhs:expr, $t:expr, $len:expr) => {{
            p = $lhs + $len;
            finish!($t, $lhs, p);
        }};
    }
    // An operator family: `XX=`, `XX`, `X=`, or `X`, whose kinds sit at
    // `x - 3`, `x - 2`, `x - 1`, and `x` in `$Lex`. `forms`: 1 `X=`,
    // 2 `XX`, 4 `XX=`.
    macro_rules! family {
        ($lhs:expr, $c:expr, $x:expr, $forms:expr) => {{
            let (lhs, c, x, forms): (usize, u8, u8, u8) = ($lhs, $c, $x, $forms);
            let c2 = byte!(lhs + 1);
            let (kind, len) = if c2 == c && forms & 2 != 0 {
                if forms & 4 != 0 && byte!(lhs + 2) == b'=' {
                    (x - 3, 3)
                } else {
                    (x - 2, 2)
                }
            } else if forms & 1 != 0 && c2 == b'=' {
                (x - 1, 2)
            } else {
                (x, 1)
            };
            take!(lhs, kind, len);
        }};
    }

    loop {
        // SAFETY: `p` is at most the input length: every token ends there or before.
        let mut c = unsafe { src.byte_unchecked(p) };
        nl = false;
        if (c as u32).wrapping_sub(33) > 93 {
            if c == b' ' || c == b'\n' {
                // A line break and indentation, or spaces between tokens.
                if c == b'\n' {
                    nl = true;
                    p += 1;
                    // Tab indentation.
                    // SAFETY: `p` follows a line feed inside the input, so it is at most the input
                    // length.
                    if unsafe { src.byte_unchecked(p) } == b'\t' {
                        p = run_end(src, p, 0x0909_0909_0909_0909);
                    }
                }
                p = spaces_end(src, p);
                // SAFETY: `p` ends a run of spaces, at most the input length.
                if (unsafe { src.byte_unchecked(p) } as u32).wrapping_sub(33) > 93 {
                    let (q, br) = skip_space(src, p, end);
                    p = q;
                    nl |= br;
                }
            } else {
                core::hint::cold_path();
                (p, nl) = skip_space(src, p, end);
            }
            // SAFETY: `p` ends a whitespace run, at most the input length.
            c = unsafe { src.byte_unchecked(p) };
        }
        let lhs = p;
        match c {
            b'a'..=b'z' | b'A'..=b'Z' | b'_' | b'$' => {
                let mut q = ident_end(src, lhs + 1);
                // SAFETY: `q` ends an identifier run, at most the input length.
                if unsafe { src.byte_unchecked(q) } >= 128 {
                    q = ident_tail_unicode(src, end, q);
                }
                p = q;
                let t = if lto == lex::DOT || lto == lex::QUESTION_MARK_DOT {
                    lex::IDENTIFIER
                } else {
                    match keyword(src, lhs, q) {
                        // TSRX declaration words live outside the keyword
                        // table.
                        None if TSRX && matches!((q - lhs, c), (6, b'm') | (8, b'f')) => {
                            markup::word_kind(src, end, lhs, q)
                        }
                        None => lex::IDENTIFIER,
                        Some(kw) if !TS && kw >= lex::CTXWORD_ABSTRACT => lex::IDENTIFIER,
                        Some(kw) => kw,
                    }
                };
                finish!(t, lhs, q);
            }
            b'0'..=b'9' => {
                p = number(src, end, lhs, lhs + 1, false);
                finish!(lex::NUMBER_LITERAL, lhs, p);
            }
            0 if lhs >= end => break,
            0x80..=0xff => {
                core::hint::cold_path();
                let (t, q) = non_ascii(src, end, c, lhs);
                p = q;
                finish!(t, lhs, q);
            }
            b'(' => {
                let k = (FLAGS[lto as usize] & kf::CTRL_PAREN_PREV != 0) as u8;
                cold.brk_push(k);
                take!(lhs, lex::L_PAREN, 1);
            }
            b')' => {
                cold.brk_pop();
                take!(lhs, lex::R_PAREN, 1);
            }
            b'.' => {
                let c2 = byte!(lhs + 1);
                if c2 == b'.' && byte!(lhs + 2) == b'.' {
                    take!(lhs, lex::SPREAD, 3);
                } else if c2.is_ascii_digit() {
                    p = number(src, end, lhs, lhs + 1, true);
                    finish!(lex::NUMBER_LITERAL, lhs, p);
                } else {
                    take!(lhs, lex::DOT, 1);
                }
            }
            b';' => take!(lhs, lex::SEMICOLON, 1),
            b',' => take!(lhs, lex::COMMA, 1),
            b':' => take!(lhs, lex::COLON, 1),
            b'{' => {
                let block = !cold.rx_allowed_after(lto, nl)
                    || FLAGS[lto as usize] & kf::BRACE_BLOCK_PREV != 0;
                cold.brk_push(block as u8);
                cold.brace_depth += 1;
                take!(lhs, lex::L_BRACE, 1);
            }
            b'}' => {
                if cold.tpl_sp > 0 && cold.brace_depth == cold.tpl[cold.tpl_sp - 1] {
                    cold.tpl_sp -= 1;
                    let (t, q) = cold.template(lhs + 1);
                    p = q;
                    finish!(t, lhs, q);
                } else {
                    cold.brk_pop();
                    cold.brace_depth -= 1;
                    p = lhs + 1;
                    // A `}` that closes an expression container, or a TSRX
                    // directive block, resumes the tag or children.
                    if cold.jsx.sp != 0 {
                        let m = cold.jsx.top_mode();
                        if (m == 3 || (TSRX && m == 4)) && cold.brace_depth <= cold.jsx.top_target()
                        {
                            lto = lex::R_BRACE;
                            resolve!(lex::R_BRACE, lhs, p);
                            recs.gap(done, lhs);
                            markup!(markup::close_container::<TS, TSRX>(cold, inst, lhs, p));
                            continue;
                        }
                    }
                    finish!(lex::R_BRACE, lhs, p);
                }
            }
            b'=' => {
                if byte!(lhs + 1) == b'>' {
                    take!(lhs, lex::FUNCTION_ARROW, 2);
                } else {
                    family!(lhs, c, lex::EQUAL, 6);
                }
            }
            b'/' => {
                let c2 = byte!(lhs + 1);
                if c2 == b'/' {
                    p = scan::line_end(src.bytes(), lhs + 2, end);
                    finish!(lex::COMMENT, lhs, p);
                } else if c2 == b'*' {
                    p = scan::block_comment_end(src.bytes(), (lhs + 2).min(end), end);
                    finish!(lex::MULTILINE_COMMENT, lhs, p);
                } else if cold.rx_allowed_after(lto, nl) {
                    let (t, q) = scan_regexp(src.bytes(), lhs, end);
                    p = q;
                    finish!(t, lhs, q);
                } else {
                    family!(lhs, c, lex::SLASH, 1);
                }
            }
            b'&' => family!(lhs, c, lex::AMPERSAND, 7),
            b'!' => {
                if byte!(lhs + 1) == b'=' {
                    if byte!(lhs + 2) == b'=' {
                        take!(lhs, lex::BANG_EQUAL_EQUAL, 3);
                    } else {
                        take!(lhs, lex::BANG_EQUAL, 2);
                    }
                } else {
                    take!(lhs, lex::BANG, 1);
                }
            }
            b'|' => family!(lhs, c, lex::PIPE, 7),
            b'?' => {
                if byte!(lhs + 1) == b'.' {
                    if byte!(lhs + 2).is_ascii_digit() {
                        take!(lhs, lex::QUESTION_MARK, 1);
                    } else {
                        take!(lhs, lex::QUESTION_MARK_DOT, 2);
                    }
                } else {
                    family!(lhs, c, lex::QUESTION_MARK, 6);
                }
            }
            b'[' => {
                cold.brk_push(0);
                take!(lhs, lex::L_BRACKET, 1);
            }
            b']' => {
                cold.brk_pop();
                take!(lhs, lex::R_BRACKET, 1);
            }
            b'"' | b'\'' => {
                let (t, q) = scan_string(src.bytes(), lhs, end, c);
                p = q;
                finish!(t, lhs, q);
            }
            b'<' => {
                // A TSRX `<script>` body ends at `</script`, which the
                // scanner reports as the end of input.
                if TSRX && cold.jsx.top_mode() == 5 && markup::raw_close(src, end, lhs, 1) {
                    resolve!(lex::EOF, lhs, lhs);
                    recs.gap(done, lhs);
                    markup!(markup::close_script::<TS, TSRX>(cold, inst, lhs));
                    continue;
                }
                let c2 = byte!(lhs + 1);
                if c2 == b'<' || c2 == b'=' {
                    family!(lhs, c, lex::L_ANGLE, 7);
                } else {
                    p = lhs + 1;
                    lto = lex::L_ANGLE;
                    resolve!(lex::L_ANGLE, lhs, p);
                    recs.gap(done, lhs);
                    // In operand position with a tag-like shape, `<` opens
                    // JSX; otherwise it stays a comparison.
                    if cold.jsx_can_start(prev) && markup::validate::<TS, TSRX>(src, end, p) {
                        cold.marker = 0;
                        markup!(markup::open_element::<TS, TSRX>(cold, inst, lhs));
                        continue;
                    }
                    plain!(lex::L_ANGLE, p, FLAGS[lex::L_ANGLE as usize]);
                }
            }
            b'>' => {
                if byte!(lhs + 1) == b'>' && byte!(lhs + 2) == b'>' {
                    if byte!(lhs + 3) == b'=' {
                        take!(lhs, lex::R_UNSIGNED_SHIFT_EQUAL, 4);
                    } else {
                        take!(lhs, lex::R_UNSIGNED_SHIFT, 3);
                    }
                } else {
                    family!(lhs, c, lex::R_ANGLE, 7);
                }
            }
            b'+' => family!(lhs, c, lex::PLUS, 3),
            b'-' => family!(lhs, c, lex::MINUS, 3),
            b'*' => family!(lhs, c, lex::ASTERISK, 7),
            b'%' => family!(lhs, c, lex::PERCENT, 1),
            b'^' => family!(lhs, c, lex::CARET, 1),
            b'~' => take!(lhs, lex::TILDE, 1),
            b'`' => {
                let (t, q) = cold.template(lhs + 1);
                p = q;
                finish!(t, lhs, q);
            }
            b'@' => {
                if TSRX && byte!(lhs + 1) == b'{' {
                    // `@{` opens a TSRX statement container: one two-byte
                    // `{`, a block, whose `@` keeps the directive color.
                    cold.brk_push(1);
                    cold.brace_depth += 1;
                    p = lhs + 2;
                    lto = lex::L_BRACE;
                    resolve!(lex::L_BRACE, lhs, p);
                    recs.gap(done, lhs);
                    if busy {
                        core::hint::cold_path();
                        busy = sig_busy(cold, prev, lex::L_BRACE);
                    }
                    recs.tok(tok::KEYWORD_CONTROL, lhs + 1);
                    recs.tok(tok::PUNCTUATION_BRACKET, p);
                    cold.marker = 0;
                    prev = lex::L_BRACE;
                    done = p;
                    continue;
                }
                let mut q = ident_end(src, lhs + 1);
                // SAFETY: `q` ends an identifier run, at most the input length.
                if unsafe { src.byte_unchecked(q) } >= 128 {
                    q = ident_tail_unicode(src, end, q);
                }
                p = q;
                // TSRX `@if` and the other directive heads act as the
                // keyword they name, `@` included.
                let t = if TSRX {
                    match markup::directive_kind(src, lhs + 1, q) {
                        lex::INVALID => lex::AT_IDENTIFIER,
                        k => k,
                    }
                } else {
                    lex::AT_IDENTIFIER
                };
                finish!(t, lhs, q);
            }
            b'#' => {
                if lhs == cold.source_start && byte!(lhs + 1) == b'!' {
                    p = scan::line_end(src.bytes(), lhs + 2, end);
                    finish!(lex::HASH_BANG, lhs, p);
                } else {
                    let mut q = ident_end(src, lhs + 1);
                    // SAFETY: `q` ends an identifier run, at most the input length.
                    if unsafe { src.byte_unchecked(q) } >= 128 {
                        q = ident_tail_unicode(src, end, q);
                    }
                    p = q;
                    finish!(lex::HASH_IDENTIFIER, lhs, q);
                }
            }
            _ => take!(lhs, lex::INVALID, 1),
        }
    }
    // The end of input: color the waiting token before it.
    resolve!(lex::EOF, p, p);
    recs.gap(done, p);
    recs.store(inst);
    inst.g_jsTemplateMarker = cold.marker;
}

/// Highlight `len` bytes of JSX, or TSX with `TS`, or TSRX with `TSRX`
/// too, at lexer memory offset `base` into `inst.ext.recs`.
fn highlight<const TS: bool, const TSRX: bool>(inst: &mut Instance, base: usize, len: usize) {
    let abs = |p: usize| (base + p) as i32;

    inst.g_srcBase = base as i32;
    inst.g_eof = abs(len);
    inst.g_end = abs(len);
    inst.g_ecmaFeatures = TS as i32 | 2 | (TSRX as i32) << 2;
    inst.g_tsxStreaming = 0;
    inst.g_tsxStreamExpressionClose = 0;
    inst.f_ecmaReset();
    inst.ext.recs.clear();
    inst.ext.recs.reserve(len + 2);
    // SAFETY: `base..base + len + SLACK` lies inside lexer memory. The steps
    // that call translated code make the input again afterwards.
    let src = unsafe { Input::new(inst, base, len) };

    // A range that starts inside a code point keeps its continuation bytes.
    let start = scan::utf8_span_end(src.bytes(), 0, len);
    let mut recs = Recs::load(inst);
    recs.gap(0, start);
    recs.store(inst);
    let mut cold = Cold {
        src,
        end: len,
        base,
        ts: TS,
        tsrx: TSRX,
        lto: lex::EOF,
        prev: lex::EOF,
        jsx: JsxStack::new(),
        sig: Sig::default(),
        import: false,
        marker: 0,
        before_string: lex::EOF,
        pend_lhs: 0,
        pend_rhs: 0,
        source_start: start,
        brace_depth: 0,
        brk_sp: 0,
        rx_closer: 0,
        tpl_sp: 0,
        brk: [0; BRACKETS],
        tpl: [0; TEMPLATES],
    };
    lex::<TS, TSRX>(&mut cold, inst, base);
}

/// The JSX lexer.
fn jsx(inst: &mut Instance, base: usize, len: usize) {
    highlight::<false, false>(inst, base, len);
}

/// The TSX lexer.
#[cfg(feature = "native-tsx")]
pub(super) fn tsx(inst: &mut Instance, base: usize, len: usize) {
    highlight::<true, false>(inst, base, len);
}

/// The TSRX lexer.
#[cfg(feature = "native-tsrx")]
pub(super) fn tsrx(inst: &mut Instance, base: usize, len: usize) {
    highlight::<true, true>(inst, base, len);
}

pub(crate) fn lexer(name: &str) -> Option<Lexer> {
    (name == "jsx").then_some(jsx as Lexer)
}
