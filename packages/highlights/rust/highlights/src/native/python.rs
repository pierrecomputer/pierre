//! WAT sources: src/langs/python.wat src/common.wat src/scan.wat src/sig.wat
//!
//! Native Python highlighter. One pass over the input: each token is
//! scanned and colored in the same step, with the same rules, in the same
//! order, as the translated `$hlPython`. The records equal the translated
//! lexer's records.

use super::Lexer;
use super::input::Input;
use super::recs::Recs;
use super::scan;
use super::tables::byteset;
use crate::generated::Instance;
use crate::simd::V;
use crate::token_ids as tok;
use crate::wat_tables::PY_WORDS;

/// The lexer for `name`, if this module handles it.
pub(crate) fn lexer(name: &str) -> Option<Lexer> {
    match name {
        "python" => Some(highlight),
        _ => None,
    }
}

/// `$pyWords` and `raise`, which `$pyWordHl` matches outside the table
/// with the same result as a table entry: a perfect hash on a word's bytes.
/// A word of up to 16 bytes is two little-endian integers, `lo` (bytes 0-7)
/// and `hi` (bytes 8-15), zero past its end; identifiers hold no NUL, so
/// equal integers mean equal words.
struct Words {
    keys: [(u64, u64); WORD_SLOTS],
    /// The word's `keyword-table.value`.
    values: [u16; WORD_SLOTS],
    mul: u64,
}

const WORD_SLOTS: usize = 512;

/// The longest word.
const WORD_MAX: usize = 16;

/// The slot of the word whose first 8 bytes are `lo`. No two words share
/// a slot, so a name is a word only when its integers equal the slot's.
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

/// For each first byte, a bit per length of the words in [`WORDS`]. A name
/// whose bit is clear is no word.
static WORD_LENGTHS: [u32; 256] = {
    let mut t = [0u32; 256];
    let mut i = 0;
    while i < PY_WORDS.len() {
        let w = PY_WORDS[i].word;
        t[w[0] as usize] |= 1 << w.len();
        i += 1;
    }
    t[b'r' as usize] |= 1 << b"raise".len();
    t
};

/// The words, placed by searching for a multiplier that gives each its own
/// slot.
static WORDS: Words = {
    let mut mul: u64 = 0x2545_f491_4f6c_dd1d;
    let mut attempt = 0;
    'search: loop {
        assert!(attempt < 20_000, "no collision-free hash: use more slots");
        let mut keys = [(0u64, 0u64); WORD_SLOTS];
        let mut values = [0u16; WORD_SLOTS];
        let mut i = 0;
        while i <= PY_WORDS.len() {
            // `raise` follows the table's words.
            let (w, value) = if i < PY_WORDS.len() {
                (PY_WORDS[i].word, PY_WORDS[i].value)
            } else {
                (b"raise".as_slice(), tok::KEYWORD_CONTROL as i32)
            };
            assert!(w.len() <= WORD_MAX && value > 0 && value < 0x10000);
            let (lo, hi) = word_key(w);
            let s = word_slot(lo, mul);
            if keys[s].0 != 0 {
                mul = mul.wrapping_add(0x6a09_e667_f3bc_c909) | 1;
                attempt += 1;
                continue 'search;
            }
            keys[s] = (lo, hi);
            values[s] = value as u16;
            i += 1;
        }
        break Words { keys, values, mul };
    }
};

/// Operator bytes (`$pyIsOp`).
const OPS: [bool; 256] = byteset(b"!%&*+-/<=>@^|~");

/// Byte classes for the main dispatch.
mod class {
    /// An identifier start that is not a string prefix.
    pub const IDENT: u8 = 0;
    /// `r`, `u`, `b`, `f`, `t` in either case: a string prefix or a name.
    pub const PREFIX: u8 = 1;
    /// Anything else: one byte colored `none`.
    pub const OTHER: u8 = 2;
    pub const DIGIT: u8 = 3;
    pub const QUOTE: u8 = 4;
    pub const HASH: u8 = 5;
    pub const AT: u8 = 6;
    pub const DOT: u8 = 7;
    pub const COMMA: u8 = 8;
    pub const SEMICOLON: u8 = 9;
    pub const COLON: u8 = 10;
    pub const OPEN_PAREN: u8 = 11;
    pub const CLOSE_PAREN: u8 = 12;
    /// `[` or `{`.
    pub const OPEN_BRACKET: u8 = 13;
    /// `]` or `}`.
    pub const CLOSE_BRACKET: u8 = 14;
    /// An operator byte other than `@` (`$pyIsOp`).
    pub const OP: u8 = 15;
    /// NUL: the end of the input, or one byte colored `none` inside it.
    pub const NUL: u8 = 16;
}

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

/// The [`class`] of each byte.
static CLASS: [u8; 256] = {
    let mut t = [class::OTHER; 256];
    let mut c = 1;
    t[0] = class::NUL;
    while c < 256 {
        let b = c as u8;
        t[c] = if is_ident_start(b) {
            match b | 32 {
                b'r' | b'u' | b'b' | b'f' | b't' if b < 0x80 => class::PREFIX,
                _ => class::IDENT,
            }
        } else if is_digit(b) {
            class::DIGIT
        } else {
            match b {
                b'"' | b'\'' => class::QUOTE,
                b'#' => class::HASH,
                b'@' => class::AT,
                b'.' => class::DOT,
                b',' => class::COMMA,
                b';' => class::SEMICOLON,
                b':' => class::COLON,
                b'(' => class::OPEN_PAREN,
                b')' => class::CLOSE_PAREN,
                b'[' | b'{' => class::OPEN_BRACKET,
                b']' | b'}' => class::CLOSE_BRACKET,
                _ if OPS[c] => class::OP,
                _ => class::OTHER,
            }
        };
        c += 1;
    }
    t
};

/// Bytes that start a `match`/`case` subject or pattern besides names and
/// digits (`$pySoftKeyword`).
static SOFT_SUBJECT: [bool; 256] = byteset(b"\"'(*-[{");

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

/// The end of the whitespace run from `p` (`$scanWhitespace`). The NUL
/// after the input ends every run.
#[inline(always)]
fn whitespace_end(src: Input, mut p: usize) -> usize {
    loop {
        // Skip spaces 8 bytes at a time, then step over one other
        // whitespace byte (TAB to CR) and go on.
        // SAFETY: `p` is at most the input length (the NUL after the input ends every run), so the
        // 8 bytes lie inside the slack.
        let w = unsafe { src.word_unchecked(p) };
        let x = w ^ 0x2020_2020_2020_2020;
        let other =
            (((x & 0x7f7f_7f7f_7f7f_7f7f) + 0x7f7f_7f7f_7f7f_7f7f) | x) & 0x8080_8080_8080_8080;
        if other == 0 {
            p += 8;
            continue;
        }
        p += (other.trailing_zeros() / 8) as usize;
        // SAFETY: `p` is at most the input length.
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
        // SAFETY: `p` is at most the input length: the NUL after the input ends every run.
        if !IDENT_CONT[unsafe { src.byte_unchecked(p) } as usize] {
            return p;
        }
        p += 1;
    }
    loop {
        // SAFETY: `p` is at most the input length, so the 16 bytes lie inside the slack.
        let v = unsafe { src.vec_unchecked(p) };
        let alpha = v.or(V::splat(0x20)).sub(V::splat(b'a')).le(V::splat(25));
        let digit = v.sub(V::splat(b'0')).le(V::splat(9));
        let extra = v.eq(V::splat(b'_')).or(v.eq(V::splat(b'$')));
        let ok = alpha.or(digit).or(extra.or(v.high()));
        let stop = ok.not().lanes();
        if stop.any() {
            return p + stop.first();
        }
        p += 16;
    }
}

/// Skip spaces and tabs from `p` on the current line (`$lexSkipSpaceAt`).
#[inline(always)]
fn skip_space_at(src: Input, mut p: usize) -> usize {
    // SAFETY: `p` is at most the input length: the NUL after the input ends the run.
    while unsafe { src.byte_unchecked(p) } == b' ' || unsafe { src.byte_unchecked(p) } == b'\t' {
        p += 1;
    }
    p
}

/// The end of the number at `p`: radix digits, separators, exponents, and
/// suffixes, with `.` only before a digit (`$lexScanNumber`,
/// `$lexScanNumberBody`).
fn number_end(src: Input, mut p: usize) -> usize {
    // SAFETY: `p` starts a token, below the input length.
    let hex = unsafe { src.byte_unchecked(p) } == b'0'
        && unsafe { src.byte_unchecked(p + 1) } | 0x20 == b'x';
    let mut prev = 0u8;
    loop {
        // SAFETY: `p` is at most the input length: the NUL after the input ends the number.
        let c = unsafe { src.byte_unchecked(p) };
        if IDENT_CONT[c as usize] {
            prev = c;
            p += 1;
            continue;
        }
        if c == b'.' {
            // SAFETY: `p` is below the input length here (a `.` is not the NUL).
            let next = unsafe { src.byte_unchecked(p + 1) };
            if !is_digit(next) {
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

/// The end of the escape at backslash `p`: one character, kept whole when
/// it is UTF-8, and CRLF as one (`$lexEscapeEnd`).
#[inline(always)]
fn escape_end(src: Input, p: usize, end: usize) -> usize {
    let mut e = scan::utf8_span_end(src.bytes(), p + 2, end);
    // SAFETY: the backslash at `p` is below `end`, so `p + 1` is at most
    // `end`; `e` is read only below `end`.
    if e == p + 2
        && unsafe { src.byte_unchecked(p + 1) } == b'\r'
        && e < end
        && unsafe { src.byte_unchecked(e) } == b'\n'
    {
        e += 1;
    }
    e
}

/// The next `{` or `}` from `p`, or `end` (`$lexFindEither`).
#[inline(always)]
fn find_brace(src: Input, p: usize, end: usize) -> usize {
    scan::find3(src.bytes(), p, end, b'{', b'}', b'{')
}

/// SCREAMING_CASE: at least two bytes, one uppercase letter, and only
/// `[A-Z0-9_]` (`$lexIsConstCase`).
fn is_const_case(src: Input, lhs: usize, rhs: usize) -> bool {
    if rhs - lhs < 2 {
        return false;
    }
    let mut upper = false;
    for p in lhs..rhs {
        // SAFETY: `p` is below `rhs`, inside the input.
        let c = unsafe { src.byte_unchecked(p) };
        if c.wrapping_sub(b'A') <= 25 {
            upper = true;
        } else if !(is_digit(c) || c == b'_') {
            return false;
        }
    }
    upper
}

/// The first `n` bytes at `p` as a little-endian integer, for comparing
/// short words. Reads 8 bytes, which the input slack allows.
#[inline(always)]
fn word_at(src: Input, p: usize, n: u32) -> u64 {
    // SAFETY: `p` is below the input length, so the 8 bytes lie inside the slack.
    let w = unsafe { src.word_unchecked(p) };
    w & (u64::MAX >> (64 - 8 * n))
}

/// `s` as a little-endian integer.
const fn word(s: &[u8]) -> u64 {
    let mut w = 0u64;
    let mut i = 0;
    while i < s.len() {
        w |= (s[i] as u64) << (8 * i);
        i += 1;
    }
    w
}

/// The parameter-list machine's registers (`$sig*` globals in `sig.wat`).
#[derive(Default)]
struct Sig {
    parens: u32,
    mask: u32,
    /// [`Sig::active`], kept current as `parens` and `mask` change.
    in_list: bool,
    obscure: u32,
    pattern: bool,
    fn_pend: bool,
    fn_angle: u32,
}

impl Sig {
    /// The innermost open paren is a marked parameter list (`$sigActive`).
    #[inline(always)]
    fn active(&self) -> bool {
        self.parens < 32 && (self.mask >> self.parens) & 1 != 0
    }

    /// Recompute [`Sig::in_list`] after `parens` or `mask` changed.
    #[inline(always)]
    fn refresh(&mut self) {
        self.in_list = self.active();
    }

    /// Mark the innermost paren as a parameter list (`$sigMark`).
    #[inline(always)]
    fn mark(&mut self) {
        if self.parens < 32 {
            self.mask |= 1 << self.parens;
        }
        self.obscure = 0;
        self.pattern = false;
    }

    /// Unmark the innermost paren (`$sigUnmark`).
    #[inline(always)]
    fn unmark(&mut self) {
        if self.parens < 32 {
            self.mask &= !(1 << self.parens);
        }
        self.obscure = 0;
        self.pattern = false;
    }

    /// Clamped decrement of the pending head's bracket depth
    /// (`$sigFnAngleDrop`).
    #[inline(always)]
    fn fn_angle_drop(&mut self, n: u32) {
        self.fn_angle = self.fn_angle.saturating_sub(n);
    }
}

/// The color of the word `[lhs, rhs)` from the keyword table, with the next
/// name's priming in the high byte (1 = `def`, 2 = `class`), or
/// `tok::NONE` (`$pyWordHl`).
#[inline(always)]
fn word_hl(src: Input, lhs: usize, rhs: usize) -> u32 {
    let n = rhs - lhs;
    // SAFETY: `lhs` starts a name, below the input length.
    if n > WORD_MAX || WORD_LENGTHS[unsafe { src.byte_unchecked(lhs) } as usize] >> n & 1 == 0 {
        return tok::NONE;
    }
    let (lo, hi) = if n <= 8 {
        (word_at(src, lhs, n as u32), 0)
    } else {
        (word_at(src, lhs, 8), word_at(src, lhs + 8, n as u32 - 8))
    };
    let s = word_slot(lo, WORDS.mul);
    if WORDS.keys[s] == (lo, hi) {
        WORDS.values[s] as u32
    } else {
        tok::NONE
    }
}

/// Whether the word `[lhs, rhs)` is the soft keyword `match` or `case`
/// followed by a subject or pattern on the same line (`$pySoftKeyword`).
fn soft_keyword(src: Input, lhs: usize, rhs: usize) -> bool {
    let n = rhs - lhs;
    if !((n == 5 && word_at(src, lhs, 5) == word(b"match"))
        || (n == 4 && word_at(src, lhs, 4) == word(b"case")))
    {
        return false;
    }
    // SAFETY: the spaces end at most at the input length.
    let c = unsafe { src.byte_unchecked(skip_space_at(src, rhs)) };
    (is_ident_start(c) && c != b'$') || is_digit(c) || SOFT_SUBJECT[c as usize]
}

/// A string literal's quote byte and what its prefix allows: raw literals
/// keep backslashes as body, format literals surface `{`/`}` fields.
#[derive(Clone, Copy)]
struct Literal {
    quote: u8,
    raw: bool,
    format: bool,
}

/// Scan a string body from `p` and emit it: `seg` starts the pending
/// string token (the prefix and opening quote). Escapes and, in f-strings,
/// replacement-field braces get their own tokens. Returns the end
/// (`$pyStringBody`, with no Godot escapes).
fn string_body(
    src: Input,
    recs: &mut Recs,
    mut p: usize,
    end: usize,
    kind: Literal,
    triple: bool,
    mut seg: usize,
) -> usize {
    let Literal { quote, raw, format } = kind;
    let multiline = triple;
    let mut depth = 0u32;
    let mut stop = 0usize;
    loop {
        if format {
            if p >= stop {
                stop = find_brace(src, p, end);
            }
        } else {
            stop = end;
        }
        if p < stop {
            p = if multiline {
                scan::find3(src.bytes(), p, stop, quote, b'\\', quote)
            } else {
                scan::string_special(src.bytes(), p, stop, quote)
            };
        }
        if p >= end {
            break;
        }
        // SAFETY: `p` is below `end` (tested above).
        let c = unsafe { src.byte_unchecked(p) };
        if c == quote {
            if triple {
                // SAFETY: both reads lie below `end` (tested first).
                if p + 2 < end
                    && unsafe { src.byte_unchecked(p + 1) } == quote
                    && unsafe { src.byte_unchecked(p + 2) } == quote
                {
                    p += 3;
                    break;
                }
            } else {
                p += 1;
                break;
            }
        }
        if !multiline && (c == b'\n' || c == b'\r') {
            break;
        }
        if c == b'\\' {
            let e = escape_end(src, p, end);
            if !raw {
                if seg < p {
                    recs.tok(tok::STRING, p);
                }
                recs.tok(tok::STRING_ESCAPE, e);
                seg = e;
            }
            p = e;
            continue;
        }
        if format && (c == b'{' || c == b'}') {
            // SAFETY: `p + 1` is below `end` (tested first).
            if depth == 0 && p + 1 < end && unsafe { src.byte_unchecked(p + 1) } == c {
                p += 2;
                continue;
            }
            if c == b'{' {
                depth += 1;
            } else {
                depth = depth.saturating_sub(1);
            }
            if seg < p {
                recs.tok(tok::STRING, p);
            }
            p += 1;
            recs.tok(tok::PUNCTUATION_SPECIAL, p);
            seg = p;
            continue;
        }
        p += 1;
    }
    if seg < p {
        recs.tok(tok::STRING, p);
    }
    p
}

/// The string literal at `p` with a `prefix`-byte prefix: one or three
/// `quote`s open it. Returns its end (`$pyString`; the stream checkpoint
/// never applies to a whole-input run).
#[inline(never)]
fn string(
    src: Input,
    recs: &mut Recs,
    p: usize,
    end: usize,
    prefix: usize,
    kind: Literal,
) -> usize {
    let seg = p;
    let mut p = p + prefix;
    let quote = kind.quote;
    // SAFETY: both reads lie below `end` (tested first).
    let triple = p + 2 < end
        && unsafe { src.byte_unchecked(p + 1) } == quote
        && unsafe { src.byte_unchecked(p + 2) } == quote;
    p += if triple { 3 } else { 1 };
    string_body(src, recs, p, end, kind, triple, seg)
}

/// Lex the Python input of `len` bytes at `base` (`$hlPython`).
fn highlight(inst: &mut Instance, base: usize, len: usize) {
    // SAFETY: `base..base + len + SLACK` lies inside lexer memory, and this
    // lexer calls no translated function that could move it.
    let src = unsafe { Input::new(inst, base, len) };
    let end = len;
    let mut sig = Sig::default();
    let mut recs = Recs::load(inst);

    // The string literal at `lhs` (`string`), writing through a copy of
    // the records so the loop's own copy stays in registers.
    macro_rules! string {
        ($lhs:expr, $prefix:expr, $quote:expr, $raw:expr, $format:expr) => {{
            let kind = Literal {
                quote: $quote,
                raw: $raw,
                format: $format,
            };
            let mut r = recs;
            let p = string(src, &mut r, $lhs, end, $prefix, kind);
            recs = r;
            p
        }};
    }

    // `$lexEmitLeadingContinuation`
    let mut ptr = scan::utf8_span_end(src.bytes(), 0, end);
    recs.gap(0, ptr);
    // Leading whitespace. The state is already that of a line start, so
    // only the record changes; every later gap follows a token's record.
    let first = whitespace_end(src, ptr);
    recs.gap(ptr, first);
    ptr = first;
    // 1 = after `def`, 2 = after `class`
    let mut after_decl = 0u32;
    let mut after_dot = false;
    // the previous token can take a `: type` annotation
    let mut annot_name = false;
    // open `[`/`{` nesting: no annotations inside
    let mut brack_depth = 0u32;
    // between `lambda` and the `:` that ends its head
    let mut lambda_pend = false;
    let mut line_head = true;
    let mut type_next = false;
    // `sig.fn_pend && sig.fn_angle == 0`: a pending `def` head that the
    // next token may cancel
    let mut pend_open = false;

    // The `(` token (`$hlPython`'s bracket rule for `(`).
    macro_rules! open_paren {
        () => {{
            // `(` may open the armed `def` list and puts the next name
            // in parameter position
            sig.parens = sig.parens.wrapping_add(1);
            // (`pend_open` is `fn_pend && fn_angle == 0`)
            if pend_open {
                sig.mark();
                sig.fn_pend = false;
                pend_open = false;
            }
            sig.refresh();
            sig.pattern = true;
            ptr += 1;
            recs.tok(tok::PUNCTUATION_BRACKET, ptr);
            annot_name = false;
            after_dot = false;
            line_head = false;
        }};
    }
    // The `)` token.
    macro_rules! close_paren {
        () => {{
            sig.pattern = false;
            if sig.in_list {
                sig.unmark();
            }
            if sig.parens > 0 {
                sig.parens -= 1;
            }
            sig.refresh();
            ptr += 1;
            recs.tok(tok::PUNCTUATION_BRACKET, ptr);
            annot_name = false;
            after_dot = false;
            line_head = false;
        }};
    }
    // The `,` or `;` delimiter.
    macro_rules! comma {
        ($comma:expr) => {{
            ptr += 1;
            recs.tok(tok::PUNCTUATION_DELIMITER, ptr);
            after_dot = false;
            type_next = false;
            annot_name = false;
            line_head = false;
            // a comma returns to parameter position
            sig.pattern = $comma;
        }};
    }
    // The `.` delimiter, when no digit follows.
    macro_rules! dot {
        () => {{
            ptr += 1;
            recs.tok(tok::PUNCTUATION_DELIMITER, ptr);
            // a member access continues an annotated attribute chain
            after_dot = true;
            type_next = false;
            line_head = false;
            sig.pattern = false;
        }};
    }

    loop {
        let gap = ptr;
        // SAFETY: `ptr` is at most the input length: every token ends there or before.
        let mut c = unsafe { src.byte_unchecked(ptr) };
        // SAFETY: `ptr` is at most the input length, so `ptr + 1` lies in the slack.
        if c == b' ' && !is_space(unsafe { src.byte_unchecked(ptr + 1) }) {
            // one space: no line break
            ptr += 1;
            // SAFETY: the first pass starts past the leading whitespace, and
            // every pass writes a record.
            unsafe { recs.extend_unchecked(ptr) };
            // SAFETY: `ptr` is at most the input length.
            c = unsafe { src.byte_unchecked(ptr) };
        } else if is_space(c) {
            ptr = whitespace_end(src, ptr + 1);
            // The gap crossed a line break unless a backslash right before
            // a break that opens the gap continues the statement.
            if c == b'\n' || c == b'\r' {
                // SAFETY: `gap - 1` lies inside the input (`gap > 0`).
                if !(gap > 0 && unsafe { src.byte_unchecked(gap - 1) } == b'\\') {
                    line_head = true;
                    type_next = false;
                }
            } else if ptr - gap > 1 && scan::line_end(src.bytes(), gap + 1, ptr) < ptr {
                line_head = true;
                type_next = false;
            }
            // SAFETY: the first pass starts past the leading whitespace, and
            // every pass writes a record.
            unsafe { recs.extend_unchecked(ptr) };
            // SAFETY: `ptr` ends a whitespace run, at most the input length.
            c = unsafe { src.byte_unchecked(ptr) };
        }
        let lhs = ptr;
        let class = CLASS[c as usize];

        // a pending `def` head survives only its `[...]` type-parameter list
        // and comments on the way to the `(` of its parameter list
        if pend_open && !(c == b'(' || c == b'[' || c == b'#') {
            sig.fn_pend = false;
            pend_open = false;
        }

        // Names, the most common tokens, skip the jump table.
        if class <= class::PREFIX {
            if class == class::PREFIX {
                // two-byte raw prefixes before a quote; f and t forms
                // have format fields
                // SAFETY: `lhs` holds a letter, below the input length, so
                // `lhs + 2` is at most one past it, inside the slack.
                let (c1, c2) =
                    unsafe { (src.byte_unchecked(lhs + 1), src.byte_unchecked(lhs + 2)) };
                if c2 == b'"' || c2 == b'\'' {
                    let p = u16::from_le_bytes([c, c1]) | 0x2020;
                    let br = p == u16::from_le_bytes(*b"br") || p == u16::from_le_bytes(*b"rb");
                    if br
                        || p == u16::from_le_bytes(*b"fr")
                        || p == u16::from_le_bytes(*b"rf")
                        || p == u16::from_le_bytes(*b"tr")
                        || p == u16::from_le_bytes(*b"rt")
                    {
                        ptr = string!(lhs, 2, c2, true, !br);
                        annot_name = false;
                        line_head = false;
                        after_dot = false;
                        continue;
                    }
                }
                // case-insensitive r/u/b/f/t prefixes before a quote
                if c1 == b'"' || c1 == b'\'' {
                    let lc = c | 32;
                    ptr = string!(lhs, 1, c1, lc == b'r', lc == b'f' || lc == b't');
                    annot_name = false;
                    line_head = false;
                    after_dot = false;
                    continue;
                }
            }

            ptr = ident_end(src, ptr + 1);
            // a member name is never a keyword or builtin
            let g = if after_dot { 0 } else { word_hl(src, lhs, ptr) };
            // Annotation position (`annot`): a bare name (no table hit, not
            // a soft keyword) or self/cls that starts its line or is a
            // parameter, or a member that continues such a name
            // (`self.x: int`). Each branch below knows most of that. A
            // `lambda` opens a lambda head; outside a member name it is
            // always a table hit.
            let hl;
            let annot;
            if g == 0 {
                if line_head && soft_keyword(src, lhs, ptr) {
                    hl = tok::KEYWORD_CONTROL;
                    annot = false;
                } else if after_decl != 0 {
                    hl = if after_decl == 2 {
                        tok::TYPE_CLASS
                    } else {
                        tok::FUNCTION_DEFINITION
                    };
                    // a `def` name arms the parameter machine for its `(`
                    if after_decl == 1 {
                        sig.fn_pend = true;
                        sig.fn_angle = 0;
                        pend_open = true;
                    }
                    annot = line_head || (after_dot && annot_name);
                } else if after_dot {
                    let q = skip_space_at(src, ptr);
                    // SAFETY: the spaces end at most at the input length.
                    hl = if unsafe { src.byte_unchecked(q) } == b'(' {
                        tok::FUNCTION_METHOD
                    } else {
                        tok::PROPERTY
                    };
                    annot = line_head || annot_name;
                    if ptr - lhs == 6 && word_at(src, lhs, 6) == word(b"lambda") {
                        lambda_pend = true;
                    }
                } else if sig.in_list && sig.pattern && sig.obscure == 0 {
                    hl = tok::VARIABLE_PARAMETER;
                    annot = true;
                } else if (c.wrapping_sub(b'A') <= 25 || c == b'_') && is_const_case(src, lhs, ptr)
                {
                    // (only `[A-Z_]` can start a constant name)
                    hl = tok::CONSTANT;
                    annot = line_head;
                } else if type_next || c.wrapping_sub(b'A') <= 25 {
                    hl = tok::TYPE;
                    annot = line_head;
                } else {
                    let q = skip_space_at(src, ptr);
                    // SAFETY: the spaces end at most at the input length.
                    hl = if unsafe { src.byte_unchecked(q) } == b'(' {
                        tok::FUNCTION
                    } else {
                        tok::VARIABLE
                    };
                    annot = line_head;
                }
            } else {
                // (a table hit is never a member name)
                hl = g & 255;
                annot = hl == tok::VARIABLE_SPECIAL && line_head;
                if ptr - lhs == 6 && word_at(src, lhs, 6) == word(b"lambda") {
                    lambda_pend = true;
                }
            }
            recs.tok(hl, ptr);
            annot_name = annot;
            after_decl = g >> 8;
            after_dot = false;
            type_next = false;
            line_head = false;
            sig.pattern = false;
            // `(`, `.`, `)`, or `,` right after a name: its rules run here,
            // without the gap and dispatch steps (the pending-head check
            // lets `(` pass and cancels the head for the others)
            // SAFETY: `ptr` ends a name, at most the input length.
            let next = unsafe { src.byte_unchecked(ptr) };
            if next == b'(' {
                open_paren!();
            // SAFETY: `ptr` is below the input length (a `.` is not the NUL).
            } else if next == b'.' && !is_digit(unsafe { src.byte_unchecked(ptr + 1) }) {
                if pend_open {
                    sig.fn_pend = false;
                    pend_open = false;
                }
                dot!();
            } else if next == b')' {
                if pend_open {
                    sig.fn_pend = false;
                    pend_open = false;
                }
                close_paren!();
            } else if next == b',' {
                if pend_open {
                    sig.fn_pend = false;
                    pend_open = false;
                }
                comma!(true);
            }
            continue;
        }
        match class {
            class::OPEN_PAREN => open_paren!(),
            class::CLOSE_PAREN => close_paren!(),
            class::OPEN_BRACKET => {
                // `[` right after a `def` name is a type-parameter list;
                // brackets inside a marked list obscure its top level
                sig.pattern = false;
                if sig.fn_pend {
                    if c == b'[' {
                        sig.fn_angle = sig.fn_angle.wrapping_add(1);
                    } else {
                        sig.fn_pend = false;
                    }
                } else if sig.in_list {
                    sig.obscure = sig.obscure.wrapping_add(1);
                }
                pend_open = false;
                // dict displays, comprehensions, and subscripts use `:` for
                // keys and slices, never for annotations
                brack_depth = brack_depth.wrapping_add(1);
                ptr += 1;
                recs.tok(tok::PUNCTUATION_BRACKET, ptr);
                annot_name = false;
                after_dot = false;
                line_head = false;
            }
            class::CLOSE_BRACKET => {
                sig.pattern = false;
                if sig.fn_pend {
                    if c == b']' {
                        sig.fn_angle_drop(1);
                    } else {
                        sig.fn_pend = false;
                    }
                } else if sig.in_list && sig.obscure > 0 {
                    sig.obscure -= 1;
                }
                pend_open = sig.fn_pend && sig.fn_angle == 0;
                // The WAT tests the depth with a bitwise `i32.and` against a
                // 0/1 flag, so a close bracket lowers only an odd depth.
                if brack_depth & 1 != 0 {
                    brack_depth -= 1;
                }
                ptr += 1;
                recs.tok(tok::PUNCTUATION_BRACKET, ptr);
                annot_name = false;
                after_dot = false;
                line_head = false;
            }
            class::COMMA | class::SEMICOLON => comma!(c == b','),
            // SAFETY: `ptr` is below the input length (a `.` is not the NUL).
            class::DOT if !is_digit(unsafe { src.byte_unchecked(ptr + 1) }) => dot!(),
            class::DOT | class::DIGIT => {
                ptr = number_end(src, ptr);
                recs.tok(tok::NUMBER, ptr);
                annot_name = false;
                line_head = false;
                after_dot = false;
                type_next = false;
            }
            // SAFETY: `ptr` is below the input length (a `:` is not the NUL).
            class::COLON if unsafe { src.byte_unchecked(ptr + 1) } != b'=' => {
                ptr += 1;
                recs.tok(tok::PUNCTUATION_DELIMITER, ptr);
                after_dot = false;
                // `:` arms a type annotation only after a name in annotation
                // position outside brackets and lambda heads
                type_next = annot_name && brack_depth == 0 && !lambda_pend;
                lambda_pend = false;
                annot_name = false;
                line_head = false;
                sig.pattern = false;
            }
            class::HASH => {
                // `$lexLineComment`
                ptr = scan::line_end(src.bytes(), ptr + 1, end);
                recs.tok(tok::COMMENT, ptr);
            }
            class::QUOTE => {
                // A one-line literal without escapes is one token; anything
                // else takes the full rules.
                let close = scan::string_special(src.bytes(), ptr + 1, end, c);
                // SAFETY: `close` is at most the input length.
                if unsafe { src.byte_unchecked(close) } == c && close != ptr + 1 {
                    ptr = close + 1;
                    recs.tok(tok::STRING, ptr);
                } else {
                    ptr = string!(lhs, 0, c, false, false);
                }
                annot_name = false;
                line_head = false;
                after_dot = false;
            }
            class::AT if line_head => {
                ptr += 1;
                // SAFETY: `ptr` is at most the input length: the NUL after the input ends the run.
                while is_ident_continue(unsafe { src.byte_unchecked(ptr) })
                    || unsafe { src.byte_unchecked(ptr) } == b'.'
                {
                    ptr += 1;
                }
                recs.tok(tok::ATTRIBUTE, ptr);
                annot_name = false;
                line_head = false;
            }
            class::OP | class::AT | class::COLON => {
                // SAFETY: `ptr` is below the input length (an operator byte is not the NUL).
                let c2 = unsafe { src.byte_unchecked(ptr + 1) };
                ptr += 1;
                if c2 == b'=' || c == c2 || (c == b'-' && c2 == b'>') {
                    ptr += 1;
                    // SAFETY: `ptr` is at most one past the input length, inside the slack.
                    if unsafe { src.byte_unchecked(ptr) } == b'='
                        || (c == b'/' && unsafe { src.byte_unchecked(ptr) } == b'/')
                    {
                        ptr += 1;
                    }
                }
                recs.tok(tok::OPERATOR, ptr);
                type_next = c == b'-' && c2 == b'>';
                annot_name = false;
                after_dot = false;
                line_head = false;
                // a splat star after `(` or `,` keeps parameter position
                sig.pattern = sig.pattern && c == b'*';
            }
            class::NUL if ptr >= end => break,
            _ => {
                ptr += 1;
                recs.tok(tok::NONE, ptr);
                annot_name = false;
                after_dot = false;
                line_head = false;
            }
        }
    }
    recs.store(inst);
}
