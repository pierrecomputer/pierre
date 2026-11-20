//! WAT sources: src/langs/kotlin.wat src/common.wat src/scan.wat
//!
//! Native Kotlin lexer. One pass over the input: each token is scanned and
//! colored in the same step, with the same rules, in the same order, as the
//! translated `$hlKotlin`. The records equal the translated lexer's records.
//!
//! The WAT tests its rules in one long chain. Each rule matches its own
//! first bytes, so this lexer dispatches on the first byte's class and, for
//! each class, tests only the rules that can match it, in the WAT's order.
//! A `"` string's body is scanned right after its opener, and again right
//! after the `}` that closes one of its `${…}` interpolations; the WAT
//! scans it at the top of its loop, which comes to the same thing.

use super::Lexer;
use super::input::Input;
use super::recs::Recs;
use super::scan;
use super::tables::byteset;
use crate::generated::Instance;
use crate::simd::V;
use crate::token_ids as tok;
use crate::wat_tables::KOTLIN_WORDS;

/// The lexer for `name`, if this module handles it.
pub(crate) fn lexer(name: &str) -> Option<Lexer> {
    match name {
        "kotlin" => Some(highlight),
        _ => None,
    }
}

/// `$kotlinWords` and the two words `$kotlinWordHl` matches outside the
/// table, `Short` and `where`, with the same result as table entries, as a
/// perfect hash on a word's bytes. A word of up to 16 bytes is two
/// little-endian integers, `lo` (bytes 0-7) and `hi` (bytes 8-15), zero
/// past its end; identifiers hold no NUL, so equal integers mean equal
/// words. Each word has its own slot, found from `lo` alone.
struct Words {
    keys: [(u64, u64); WORD_SLOTS],
    /// The word's `keyword-table.value`: its token in the low byte, the
    /// next-name capture in bits 8-9 (1 = function, 2 = type), and bit 10
    /// for a contextual modifier.
    values: [i32; WORD_SLOTS],
    /// For each first byte, a bit per length of the words starting with it.
    lengths: [u32; 256],
    mul: u64,
}

const WORD_SLOTS: usize = 512;

/// The longest word.
const WORD_MAX: usize = 12;

/// The words `$kotlinWordHl` matches outside the table.
const EXTRA_WORDS: [(&[u8], i32); 2] = [
    (b"Short", tok::TYPE_BUILTIN as i32),
    (b"where", tok::KEYWORD as i32),
];

/// The slot of the word whose first 8 bytes are `lo`.
#[inline(always)]
const fn word_slot(lo: u64, mul: u64) -> usize {
    (lo.wrapping_mul(mul) >> (64 - WORD_SLOTS.trailing_zeros())) as usize
}

/// The integers of the word `w`.
const fn word_key(w: &[u8]) -> (u64, u64) {
    let mut lo = 0u64;
    let mut hi = 0u64;
    let mut i = 0;
    while i < w.len() {
        if i < 8 {
            lo |= (w[i] as u64) << (8 * i);
        } else {
            hi |= (w[i] as u64) << (8 * (i - 8));
        }
        i += 1;
    }
    (lo, hi)
}

/// The words, placed by searching for a multiplier that gives each its own
/// slot.
static WORDS: Words = {
    let n = KOTLIN_WORDS.len() + EXTRA_WORDS.len();
    let mut lengths = [0u32; 256];
    let mut i = 0;
    while i < n {
        let w = word_entry(i).0;
        assert!(w.len() <= WORD_MAX);
        lengths[w[0] as usize] |= 1 << w.len();
        i += 1;
    }
    let mut mul: u64 = 0x2545_f491_4f6c_dd1d;
    let mut attempt = 0;
    'search: loop {
        assert!(attempt < 100_000, "no collision-free hash: use more slots");
        let mut keys = [(0u64, 0u64); WORD_SLOTS];
        let mut values = [-1i32; WORD_SLOTS];
        let mut i = 0;
        while i < n {
            let (w, value) = word_entry(i);
            let (lo, hi) = word_key(w);
            let s = word_slot(lo, mul);
            if keys[s].0 != 0 {
                mul = mul.wrapping_add(0x6a09_e667_f3bc_c909) | 1;
                attempt += 1;
                continue 'search;
            }
            keys[s] = (lo, hi);
            values[s] = value;
            i += 1;
        }
        break Words {
            keys,
            values,
            lengths,
            mul,
        };
    }
};

/// Word `i` of the table's words followed by [`EXTRA_WORDS`], with its
/// value.
const fn word_entry(i: usize) -> (&'static [u8], i32) {
    if i < KOTLIN_WORDS.len() {
        (KOTLIN_WORDS[i].word, KOTLIN_WORDS[i].value)
    } else {
        EXTRA_WORDS[i - KOTLIN_WORDS.len()]
    }
}

/// The value of the word `[lhs, rhs)`, or -1 when it is none
/// (`$kotlinWordHl`).
#[inline(always)]
fn word_value(src: Input, lhs: usize, rhs: usize) -> i32 {
    let n = rhs - lhs;
    // SAFETY: `lhs` lies inside the input, so 16 bytes from it lie inside
    // the slack.
    if n > WORD_MAX || WORDS.lengths[unsafe { src.byte_unchecked(lhs) } as usize] >> n & 1 == 0 {
        return -1;
    }
    // SAFETY: as above.
    let lo =
        unsafe { src.word_unchecked(lhs) } & if n >= 8 { u64::MAX } else { (1 << (8 * n)) - 1 };
    // (`n` is at most 12, so the shift stays below 64)
    // SAFETY: as above.
    let hi = unsafe { src.word_unchecked(lhs + 8) } & ((1 << (8 * n.saturating_sub(8))) - 1);
    let s = word_slot(lo, WORDS.mul);
    if WORDS.keys[s] == (lo, hi) {
        WORDS.values[s]
    } else {
        -1
    }
}

/// Operator bytes (`$kotlinIsOp`).
static OPS: [bool; 256] = byteset(b"!%&*+-/<=>?^|");

/// Byte classes for the main dispatch.
mod class {
    /// An identifier start: a letter, `_`, `$`, or any byte from 0x80.
    pub const IDENT: u8 = 0;
    /// Anything else: one byte colored `none`.
    pub const OTHER: u8 = 1;
    pub const DIGIT: u8 = 2;
    pub const SLASH: u8 = 3;
    pub const DQUOTE: u8 = 4;
    pub const SQUOTE: u8 = 5;
    pub const AT: u8 = 6;
    /// `(`, `)`, `[`, or `]`.
    pub const BRACKET: u8 = 7;
    /// `{` or `}`, which also count `${…}` interpolation depth.
    pub const BRACE: u8 = 8;
    /// `,` or `;`.
    pub const DELIMITER: u8 = 9;
    pub const COLON: u8 = 10;
    pub const DOT: u8 = 11;
    pub const QUESTION: u8 = 12;
    /// An operator byte other than `/` and `?` (`$kotlinIsOp`).
    pub const OP: u8 = 13;
    /// NUL: the end of the input, or one byte colored `none` inside it.
    pub const NUL: u8 = 14;
}

/// The [`class`] of each byte.
static CLASS: [u8; 256] = {
    let mut t = [class::OTHER; 256];
    let mut c = 0;
    while c < 256 {
        let b = c as u8;
        t[c] = if is_ident_start(b) {
            class::IDENT
        } else if is_digit(b) {
            class::DIGIT
        } else {
            match b {
                0 => class::NUL,
                b'/' => class::SLASH,
                b'"' => class::DQUOTE,
                b'\'' => class::SQUOTE,
                b'@' => class::AT,
                b'(' | b')' | b'[' | b']' => class::BRACKET,
                b'{' | b'}' => class::BRACE,
                b',' | b';' => class::DELIMITER,
                b':' => class::COLON,
                b'.' => class::DOT,
                b'?' => class::QUESTION,
                _ if OPS[c] => class::OP,
                _ => class::OTHER,
            }
        };
        c += 1;
    }
    t
};

/// Identifier bytes (`$lexIsIdentContinue`).
static IDENT_CONT: [bool; 256] = {
    let mut t = [false; 256];
    let mut c = 0;
    while c < 256 {
        t[c] = is_ident_continue(c as u8);
        c += 1;
    }
    t
};

/// Whether `c` is an ASCII digit (`$lexIsDigit`).
#[inline(always)]
const fn is_digit(c: u8) -> bool {
    c.wrapping_sub(b'0') <= 9
}

/// Whether `c` starts an identifier: a letter, `_`, `$`, or any byte from
/// 0x80 (`$lexIsIdentStart`).
#[inline(always)]
const fn is_ident_start(c: u8) -> bool {
    c >= 0x80 || (c | 32).wrapping_sub(b'a') <= 25 || c == b'_' || c == b'$'
}

/// Whether `c` continues an identifier (`$lexIsIdentContinue`).
#[inline(always)]
const fn is_ident_continue(c: u8) -> bool {
    is_ident_start(c) || is_digit(c)
}

/// Whether `c` is ASCII whitespace: space or TAB through CR (`$lexIsSpace`).
#[inline(always)]
const fn is_space(c: u8) -> bool {
    c == b' ' || c.wrapping_sub(9) <= 4
}

/// Whether `c` is an ASCII capital letter.
#[inline(always)]
const fn is_upper(c: u8) -> bool {
    c.wrapping_sub(b'A') <= 25
}

/// The end of the whitespace run from `p` (`$scanWhitespace`). The NUL
/// after the input ends every run.
#[inline(always)]
fn whitespace_end(src: Input, mut p: usize) -> usize {
    loop {
        // Skip spaces 8 bytes at a time, then step over one other
        // whitespace byte (TAB to CR) and go on.
        // SAFETY: `p` lies at or before the NUL after the input, which
        // ends every run, so 8 bytes from it lie inside the slack.
        let w = unsafe { src.word_unchecked(p) };
        let x = w ^ 0x2020_2020_2020_2020;
        let other =
            (((x & 0x7f7f_7f7f_7f7f_7f7f) + 0x7f7f_7f7f_7f7f_7f7f) | x) & 0x8080_8080_8080_8080;
        if other == 0 {
            p += 8;
            continue;
        }
        p += (other.trailing_zeros() / 8) as usize;
        // SAFETY: as above.
        if !is_space(unsafe { src.byte_unchecked(p) }) {
            return p;
        }
        p += 1;
    }
}

/// The end of the identifier run from `p`: `[A-Za-z0-9_$]` and bytes from
/// 0x80 (`$lexScanIdent`, `$scanIdentRun`). The NUL after the input ends
/// every run.
#[inline(always)]
fn ident_end(src: Input, mut p: usize) -> usize {
    // Most names are short: test a few bytes one by one first.
    for _ in 0..8 {
        // SAFETY: `p` starts at or before the NUL after the input, and the
        // NUL ends the run, so `p` never passes it.
        if !IDENT_CONT[unsafe { src.byte_unchecked(p) } as usize] {
            return p;
        }
        p += 1;
    }
    loop {
        // SAFETY: as above, `p` lies at or before the NUL, so 16 bytes
        // from it lie inside the slack.
        let v = unsafe { src.vec_unchecked(p) };
        let alpha = v.or(V::splat(0x20)).sub(V::splat(b'a')).le(V::splat(25));
        let digit = v.sub(V::splat(b'0')).le(V::splat(9));
        let extra = v.eq(V::splat(b'_')).or(v.eq(V::splat(b'$')));
        let ok = alpha.or(digit).or(extra.or(v.high()));
        let k = ok.not().first();
        if k < 16 {
            return p + k;
        }
        p += 16;
    }
}

/// Skip spaces and tabs from `p` on the current line (`$lexSkipSpaceAt`).
#[inline(always)]
fn skip_space_at(src: Input, mut p: usize) -> usize {
    // SAFETY: `p` starts at or before the NUL after the input, which ends
    // the run, so `p` never passes it.
    while unsafe { src.byte_unchecked(p) } == b' ' || unsafe { src.byte_unchecked(p) } == b'\t' {
        p += 1;
    }
    p
}

/// SCREAMING_CASE: at least two bytes, one uppercase letter, and only
/// `[A-Z0-9_]` (`$lexIsConstCase`).
#[inline(always)]
fn is_const_case(src: Input, lhs: usize, rhs: usize) -> bool {
    if rhs - lhs < 2 {
        return false;
    }
    let mut upper = false;
    for p in lhs..rhs {
        // SAFETY: the name `[lhs, rhs)` lies inside the input.
        let c = unsafe { src.byte_unchecked(p) };
        if is_upper(c) {
            upper = true;
        } else if !(is_digit(c) || c == b'_') {
            return false;
        }
    }
    upper
}

/// The end of the escape at backslash `p`: one character, kept whole when
/// it is UTF-8, and CRLF as one (`$lexEscapeEnd`).
#[inline(always)]
fn escape_end(src: Input, p: usize, end: usize) -> usize {
    let mut e = scan::utf8_span_end(src.bytes(), p + 2, end);
    // SAFETY: the backslash at `p` is an input byte, and `e` is below `end`.
    if e == p + 2
        && unsafe { src.byte_unchecked(p + 1) } == b'\r'
        && e < end
        && unsafe { src.byte_unchecked(e) } == b'\n'
    {
        e += 1;
    }
    e
}

/// Emit the string bytes `[seg, p)`, then the escape at backslash `p`.
/// Returns the escape's end (`$stringEscapeAt`).
#[inline(always)]
fn string_escape_at(src: Input, out: &mut Recs, seg: usize, p: usize, end: usize) -> usize {
    out.emit(tok::STRING, seg, p);
    let e = escape_end(src, p, end);
    out.tok(tok::STRING_ESCAPE, e);
    e
}

/// The rest of the quoted literal opened at `seg`, from `p`, where the
/// first quote, backslash, or line break after the opening quote is: escapes
/// get their own tokens, and a raw line break ends it unterminated. Returns
/// its end (`$lexString` with `$multiline` 0, `$lexStringBody`).
#[cold]
#[inline(never)]
fn string_rest(src: Input, out: &mut Recs, mut seg: usize, mut p: usize, end: usize) -> usize {
    let s = &src.bytes()[..end];
    let quote = s[seg];
    loop {
        if p >= end {
            break;
        }
        let c = s[p];
        if c == quote {
            p += 1;
            break;
        }
        if c != b'\\' {
            break;
        }
        p = string_escape_at(src, out, seg, p, end);
        seg = p;
        p = scan::string_special(src.bytes(), p, end, quote);
    }
    out.emit(tok::STRING, seg, p);
    p
}

/// The end of the number at `lhs`: radix digits, separators, exponents,
/// and suffixes, with `.` only before a digit (`$lexScanNumber`,
/// `$lexScanNumberBody`).
#[inline(always)]
fn number_end(src: Input, lhs: usize) -> usize {
    // SAFETY: `lhs` lies inside the input, and the number ends at or
    // before the NUL after it.
    let hex =
        unsafe { src.byte_unchecked(lhs) == b'0' && src.byte_unchecked(lhs + 1) | 32 == b'x' };
    let mut p = lhs;
    let mut prev = 0u8;
    loop {
        // SAFETY: `p` starts inside the input and the NUL after it ends the
        // number, so `p` never passes the NUL.
        let c = unsafe { src.byte_unchecked(p) };
        if IDENT_CONT[c as usize] {
            prev = c;
            p += 1;
            continue;
        }
        if c == b'.' {
            // SAFETY: `p` is below `end`.
            if !is_digit(unsafe { src.byte_unchecked(p + 1) }) {
                break;
            }
            prev = c;
            p += 1;
            continue;
        }
        if (c == b'+' || c == b'-') && ((!hex && prev | 32 == b'e') || prev | 32 == b'p') {
            prev = c;
            p += 1;
            continue;
        }
        break;
    }
    p
}

/// The end of the nested block comment whose `/*` is at `lhs`: through the
/// `*/` that balances it, or the end. Pairs are found left to right, each
/// consuming both its bytes (`$lexNestedBlockComment`, `$lexNestedScan`).
#[inline(never)]
fn nested_comment_end(src: Input, lhs: usize, end: usize) -> usize {
    let s = &src.bytes()[..end];
    let mut p = lhs + 2;
    let mut depth = 1u32;
    loop {
        // the earliest `/*` or `*/` at or after `p`
        loop {
            p = scan::find3(src.bytes(), p, end, b'/', b'*', b'*');
            if p + 1 >= end || matches!((s[p], s[p + 1]), (b'/', b'*') | (b'*', b'/')) {
                break;
            }
            p += 1;
        }
        if p + 1 >= end {
            return end;
        }
        if s[p] == b'/' {
            depth += 1;
            p += 2;
            continue;
        }
        depth -= 1;
        p += 2;
        if depth == 0 {
            return p;
        }
    }
}

/// The end of the name run from `p` inside a string template: letters,
/// digits, `_`, and bytes from 0x80, but not `$` (`$scanIdentRun` with
/// `_`). The NUL after the input ends every run.
#[inline(always)]
fn template_name_end(src: Input, mut p: usize) -> usize {
    loop {
        // SAFETY: `p` starts at or before the input end, and the NUL there
        // ends the run.
        let c = unsafe { src.byte_unchecked(p) };
        if !IDENT_CONT[c as usize] || c == b'$' {
            return p;
        }
        p += 1;
    }
}

/// The first byte from `p` that a string body stops at: `"` and `$`, and in
/// a single-line body also a backslash, CR, or LF; or `end`.
#[inline(always)]
fn string_stop(src: Input, p: usize, end: usize, triple: bool) -> usize {
    if triple {
        return scan::find3(src.bytes(), p, end, b'"', b'$', b'"');
    }
    let mut p = p;
    while p < end {
        // SAFETY: `p` is below `end`, so 16 bytes from it stay inside the
        // slack.
        let w = unsafe { src.vec_unchecked(p) };
        let quote = w.eq(V::splat(b'"')).or(w.eq(V::splat(b'\\')));
        let line = w.eq(V::splat(b'\n')).or(w.eq(V::splat(b'\r')));
        let k = quote.or(line.or(w.eq(V::splat(b'$')))).first();
        if k < 16 {
            return (p + k).min(end);
        }
        p += 16;
    }
    p.min(end)
}

/// A `$` at `p` in a string body whose bytes from `seg` are not yet
/// emitted: `${` opens an interpolation unless `nested`, `$name` is a
/// variable, and any other `$` is string text. Returns the position after
/// it and the start of the body's unemitted bytes, or `None` after emitting
/// `${` (`$stringDollarAt` with dialect 0).
#[inline(always)]
fn string_dollar_at(
    src: Input,
    out: &mut Recs,
    seg: usize,
    p: usize,
    nested: bool,
) -> (usize, Option<usize>) {
    // SAFETY: the `$` at `p` is an input byte.
    let c2 = unsafe { src.byte_unchecked(p + 1) };
    if c2 == b'{' && !nested {
        out.emit(tok::STRING, seg, p);
        out.tok(tok::PUNCTUATION_SPECIAL, p + 2);
        return (p + 2, None);
    }
    if is_ident_start(c2) && c2 != b'$' {
        out.emit(tok::STRING, seg, p);
        let e = template_name_end(src, p + 1);
        out.tok(tok::VARIABLE, e);
        return (e, Some(e));
    }
    (p + 1, Some(seg))
}

/// Scan a `"` (or, when `triple`, `"""`) string body from `p`, with the
/// string's bytes from `seg` not yet emitted: plain runs, escapes, and
/// `$name` templates. Returns the end and whether a `${` that opens an
/// interpolation ended the scan; otherwise the body ends past its closing
/// quote, at a raw line break of a single-line string, or at the end.
/// Inside an interpolation (`nested`), `${` stays text
/// (`$kotlinStringBody`, `$stringEscapeAt`).
#[inline(never)]
fn string_body(
    src: Input,
    out: &mut Recs,
    mut p: usize,
    end: usize,
    triple: bool,
    nested: bool,
    mut seg: usize,
) -> (usize, bool) {
    loop {
        p = string_stop(src, p, end, triple);
        if p >= end {
            break;
        }
        // SAFETY: `p` is below `end`, so `p + 2` is at most one past the
        // input end.
        let c = unsafe { src.byte_unchecked(p) };
        if c == b'"' {
            // SAFETY: as above.
            if !triple
                || unsafe { src.byte_unchecked(p + 1) == b'"' && src.byte_unchecked(p + 2) == b'"' }
            {
                p += if triple { 3 } else { 1 };
                break;
            }
            p += 1;
            continue;
        }
        // a raw line break ends a single-line string, unconsumed
        if c == b'\n' || c == b'\r' {
            break;
        }
        if c == b'\\' {
            out.emit(tok::STRING, seg, p);
            p = escape_end(src, p, end);
            out.tok(tok::STRING_ESCAPE, p);
            seg = p;
            continue;
        }
        // `$`: a template opener when a brace or a name follows
        let (q, s) = string_dollar_at(src, out, seg, p, nested);
        p = q;
        match s {
            Some(s) => seg = s,
            None => return (p, true),
        }
    }
    out.emit(tok::STRING, seg, p);
    (p, false)
}

/// Whether the modifier word ending at `rhs` modifies something: another
/// word follows on the line, and it is not `in`, `is`, or `as`
/// (`$kotlinModifies`).
#[inline(never)]
fn modifies(src: Input, rhs: usize, end: usize) -> bool {
    let p = skip_space_at(src, rhs);
    // SAFETY: the spaces stop at or before the NUL, so `p + 1` lies at most
    // one past the input end.
    let w = unsafe { [src.byte_unchecked(p), src.byte_unchecked(p + 1)] };
    if !is_ident_start(w[0]) {
        return false;
    }
    // SAFETY: `p + 2` is below `end`.
    if p + 2 < end && is_ident_continue(unsafe { src.byte_unchecked(p + 2) }) {
        return true;
    }
    !(w == *b"in" || w == *b"is" || w == *b"as")
}

/// Lex the Kotlin input of `len` bytes at `base` (`$hlKotlin`).
fn highlight(inst: &mut Instance, base: usize, len: usize) {
    // SAFETY: `base..base + len + SLACK` lies inside lexer memory, which
    // stays in place while this lexer runs: it calls no translated code.
    let src = unsafe { Input::new(inst, base, len) };
    let end = len;
    let mut out = Recs::load(inst);

    // `$lexEmitLeadingContinuation`
    let mut ptr = scan::utf8_span_end(src.bytes(), 0, end);
    out.gap(0, ptr);
    // Leading whitespace; every later gap follows a token's record.
    let first = whitespace_end(src, ptr);
    out.gap(ptr, first);
    ptr = first;

    // the pending declaration head: 1 = `fun`, 2 = a type keyword
    let mut expect = 0u32;
    // the `<…>` depth of the pending head's type parameters
    let mut fn_angle = 0u32;
    // right after `.`, `::`, or `?.`
    let mut member = false;
    // brace depth inside a `${…}` interpolation, 0 outside one
    let mut interp = 0u32;
    // the interpolated string is a `"""` one
    let mut interp_triple = false;

    // Call the out-of-line helper `f(src, out, args…)` on a copy of `out`,
    // then take the copy back, so `out` itself never leaves registers.
    macro_rules! with_copy {
        ($f:ident($($a:expr),*)) => {{
            let mut copy = out;
            let r = $f(src, &mut copy, $($a),*);
            out = copy;
            r
        }};
    }
    // The string body from `ptr` (`$kotlinStringBody` at the loop top):
    // a `${` that opens an interpolation leaves its expression to the loop.
    macro_rules! string_body {
        ($triple:expr) => {{
            let triple: bool = $triple;
            let (p, opened) = with_copy!(string_body(ptr, end, triple, interp != 0, ptr));
            ptr = p;
            if opened {
                interp_triple = triple;
                interp = 1;
            }
        }};
    }
    // The `(`, `)`, `[`, or `]` token, and `{` or `}` outside an
    // interpolation.
    macro_rules! bracket {
        () => {{
            ptr += 1;
            out.tok(tok::PUNCTUATION_BRACKET, ptr);
            member = false;
            // a bracket ends any pending declaration head
            expect = 0;
            fn_angle = 0;
        }};
    }
    // The `,` or `;` token.
    macro_rules! delimiter {
        ($semicolon:expr) => {{
            ptr += 1;
            out.tok(tok::PUNCTUATION_DELIMITER, ptr);
            member = false;
            // a comma separates type parameters of a pending head; anywhere
            // else it and `;` end the head
            if fn_angle == 0 || $semicolon {
                expect = 0;
                fn_angle = 0;
            }
        }};
    }
    // The `:` or `::` token.
    macro_rules! colon {
        ($c2:expr) => {{
            if $c2 == b':' {
                ptr += 2;
                out.tok(tok::OPERATOR, ptr);
                member = true;
            } else {
                ptr += 1;
                out.tok(tok::PUNCTUATION_DELIMITER, ptr);
                member = false;
            }
        }};
    }
    // The `.` or `..` token, when no digit follows.
    macro_rules! dot {
        ($c2:expr) => {{
            let c2: u8 = $c2;
            if c2 == b'.' {
                ptr += 2;
                out.tok(tok::OPERATOR, ptr);
                member = false;
            } else {
                ptr += 1;
                out.tok(tok::PUNCTUATION_DELIMITER, ptr);
                member = true;
            }
        }};
    }

    // Every token stops at or before the NUL after the input, so `ptr`
    // stays at most `end` and reads a few bytes past it stay inside the
    // slack.
    loop {
        // SAFETY: `ptr` is at most `end` (see above).
        let mut c = unsafe { src.byte_unchecked(ptr) };
        // SAFETY: as above.
        if c == b' ' && !is_space(unsafe { src.byte_unchecked(ptr + 1) }) {
            ptr += 1;
            out.extend(ptr);
            // SAFETY: `ptr` is at most `end`.
            c = unsafe { src.byte_unchecked(ptr) };
        } else if is_space(c) {
            ptr = whitespace_end(src, ptr + 1);
            out.extend(ptr);
            // SAFETY: `ptr` is at most `end`.
            c = unsafe { src.byte_unchecked(ptr) };
        }
        let lhs = ptr;
        let class = CLASS[c as usize];

        // Names, the most common tokens, skip the jump table.
        if class == class::IDENT {
            let rhs = ident_end(src, ptr + 1);
            ptr = rhs;
            let mut kind = word_value(src, lhs, rhs);
            // a modifier is a soft keyword: a name unless a word follows
            if kind > 1023 && !modifies(src, rhs, end) {
                kind = -1;
            }
            let hl;
            if kind >= 0 {
                hl = (kind & 255) as u32;
                if kind & 0x300 != 0 {
                    expect = (kind as u32 >> 8) & 3;
                    fn_angle = 0;
                }
            } else {
                // SAFETY: the spaces after the name stop at or before the
                // NUL.
                let next = unsafe { src.byte_unchecked(skip_space_at(src, rhs)) };
                if expect != 0 {
                    if fn_angle != 0 {
                        // a type parameter of the pending head, or one of
                        // its bounds; the head still expects its name
                        hl = tok::TYPE;
                    } else if expect == 1 && matches!(next, b'.' | b'<' | b'?') {
                        // `fun Receiver.name` or `fun List<T>.name`: the
                        // receiver type; the head still expects its name
                        hl = tok::TYPE;
                    } else {
                        hl = if expect == 1 {
                            tok::FUNCTION_DEFINITION
                        } else {
                            tok::TYPE
                        };
                        expect = 0;
                    }
                } else if next == b'(' || (next == b'{' && (member || !is_upper(c))) {
                    // `f(` calls, and so does a trailing lambda:
                    // `items.forEach {`, `launch {` - but a capitalized
                    // `Name {` is a type
                    hl = if member {
                        tok::FUNCTION_METHOD
                    } else {
                        tok::FUNCTION
                    };
                } else if member {
                    hl = tok::PROPERTY;
                } else if (is_upper(c) || c == b'_') && is_const_case(src, lhs, rhs) {
                    // (only `[A-Z_]` can start a constant name)
                    hl = tok::CONSTANT;
                } else if is_upper(c) {
                    hl = tok::TYPE;
                } else {
                    hl = tok::VARIABLE;
                }
            }
            out.tok(hl, rhs);
            member = false;
            // `(`, `)`, `.`, `,`, `;`, or `:` right after a name: its rule
            // runs here, without the gap and dispatch steps
            // SAFETY: the name stopped at or before the NUL.
            match unsafe { src.byte_unchecked(ptr) } {
                b'(' | b')' => bracket!(),
                b'.' => {
                    // SAFETY: `ptr` is below `end`.
                    let c2 = unsafe { src.byte_unchecked(ptr + 1) };
                    if !is_digit(c2) {
                        dot!(c2);
                    }
                }
                _ => {}
            }
            continue;
        }

        // SAFETY: `ptr` is at most `end`.
        let c2 = unsafe { src.byte_unchecked(ptr + 1) };
        match class {
            class::BRACKET => bracket!(),
            class::BRACE => {
                if interp != 0 {
                    if c == b'{' {
                        interp += 1;
                    } else {
                        interp -= 1;
                        if interp == 0 {
                            // the brace matching `${` returns to the string
                            // body
                            ptr += 1;
                            out.tok(tok::PUNCTUATION_SPECIAL, ptr);
                            member = false;
                            expect = 0;
                            fn_angle = 0;
                            string_body!(interp_triple);
                            continue;
                        }
                    }
                }
                bracket!();
            }
            class::DELIMITER => delimiter!(c == b';'),
            class::DOT if !is_digit(c2) => dot!(c2),
            class::DOT | class::DIGIT => {
                ptr = number_end(src, ptr);
                out.tok(tok::NUMBER, ptr);
                member = false;
            }
            class::DQUOTE => {
                // the opener is emitted at once, then the body
                // SAFETY: `ptr` is below `end`.
                let triple = c2 == b'"' && unsafe { src.byte_unchecked(ptr + 2) } == b'"';
                ptr += if triple { 3 } else { 1 };
                out.tok(tok::STRING, ptr);
                member = false;
                string_body!(triple);
            }
            class::SQUOTE => {
                // a one-line literal without escapes is one token
                let close = scan::string_special(src.bytes(), ptr + 1, end, c);
                // SAFETY: the scan stops at most at `end`.
                if unsafe { src.byte_unchecked(close) } == c {
                    ptr = close + 1;
                    out.tok(tok::STRING, ptr);
                } else {
                    ptr = with_copy!(string_rest(lhs, close, end));
                }
            }
            class::SLASH if c2 == b'/' => {
                // SAFETY: `ptr` is below `end`.
                let doc = unsafe { src.byte_unchecked(ptr + 2) } == b'/';
                ptr = scan::line_end(src.bytes(), ptr + 2, end);
                out.tok(if doc { tok::COMMENT_DOC } else { tok::COMMENT }, ptr);
            }
            class::SLASH if c2 == b'*' => {
                // SAFETY: `ptr` is below `end`.
                let doc = unsafe { src.byte_unchecked(ptr + 2) } == b'*';
                ptr = nested_comment_end(src, ptr, end);
                out.tok(if doc { tok::COMMENT_DOC } else { tok::COMMENT }, ptr);
            }
            class::AT => {
                ptr = ident_end(src, ptr + 1);
                out.tok(tok::ATTRIBUTE, ptr);
            }
            class::COLON => colon!(c2),
            class::QUESTION if c2 == b'.' => {
                ptr += 2;
                out.tok(tok::OPERATOR, ptr);
                member = true;
            }
            class::OP | class::SLASH | class::QUESTION => {
                // a run of operator bytes, ended by a comment opener
                loop {
                    // SAFETY: the NUL after the input is no operator byte,
                    // so `ptr` stays at most `end`.
                    let b = unsafe { src.byte_unchecked(ptr) };
                    if !OPS[b as usize] {
                        break;
                    }
                    // SAFETY: as above, `ptr` is below `end`.
                    if b == b'/' && matches!(unsafe { src.byte_unchecked(ptr + 1) }, b'/' | b'*') {
                        break;
                    }
                    ptr += 1;
                }
                out.tok(tok::OPERATOR, ptr);
                member = false;
                // a pending declaration head rides its `<`/`>` type
                // parameters
                if expect != 0 {
                    for &b in &src.bytes()[lhs..ptr] {
                        if b == b'<' {
                            fn_angle = fn_angle.wrapping_add(1);
                        }
                        if b == b'>' && fn_angle > 0 {
                            fn_angle -= 1;
                        }
                    }
                }
            }
            class::NUL if ptr >= end => break,
            _ => {
                ptr += 1;
                out.tok(tok::NONE, ptr);
                member = false;
                expect = 0;
                fn_angle = 0;
            }
        }
    }
    out.store(inst);
}
