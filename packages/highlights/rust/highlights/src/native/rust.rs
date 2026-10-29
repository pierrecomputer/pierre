//! WAT sources: src/langs/rust.wat src/common.wat src/scan.wat src/sig.wat
//!
//! Native Rust highlighter. One pass over the input: each token is scanned
//! and colored in the same step, with the same rules, in the same order, as
//! the translated `$hlRust`. The records equal the translated lexer's
//! records.

use super::Lexer;
use super::input::Input;
use super::recs::Recs;
use super::scan;
use super::tables::byteset;
use crate::generated::Instance;
use crate::simd::V;
use crate::token_ids as tok;
use crate::wat_tables::RUST_WORDS;

/// The lexer for `name`, if this module handles it.
pub(crate) fn lexer(name: &str) -> Option<Lexer> {
    match name {
        "rust" => Some(highlight),
        _ => None,
    }
}

/// `$rustWords` and `where`, which `$rustWordHl` matches outside the table
/// with the same result as a table entry: a perfect hash on a word's bytes.
/// Every word is at most 8 bytes, so a word is one little-endian integer,
/// zero past its end; identifiers hold no NUL, so equal integers mean
/// equal words.
struct Words {
    keys: [u64; WORD_SLOTS],
    /// The word's `keyword-table.value`.
    values: [u16; WORD_SLOTS],
    mul: u64,
}

const WORD_SLOTS: usize = 256;

/// The longest word.
const WORD_MAX: usize = 8;

/// The slot of the word whose bytes are `w`. No two words share a slot, so
/// a name is a word only when its integer equals the slot's.
#[inline(always)]
const fn word_slot(w: u64, mul: u64) -> usize {
    (w.wrapping_mul(mul) >> (64 - WORD_SLOTS.trailing_zeros())) as usize
}

/// For each first byte, a bit per length of the words in [`WORDS`]. A name
/// whose bit is clear is no word.
static WORD_LENGTHS: [u16; 256] = {
    let mut t = [0u16; 256];
    let mut i = 0;
    while i < RUST_WORDS.len() {
        let w = RUST_WORDS[i].word;
        t[w[0] as usize] |= 1 << w.len();
        i += 1;
    }
    t[b'w' as usize] |= 1 << b"where".len();
    t
};

/// The words, placed by searching for a multiplier that gives each its own
/// slot.
static WORDS: Words = {
    let mut mul: u64 = 0x2545_f491_4f6c_dd1d;
    let mut attempt = 0;
    'search: loop {
        assert!(attempt < 20_000, "no collision-free hash: use more slots");
        let mut keys = [0u64; WORD_SLOTS];
        let mut values = [0u16; WORD_SLOTS];
        let mut i = 0;
        while i <= RUST_WORDS.len() {
            // `where` follows the table's words.
            let (w, value) = if i < RUST_WORDS.len() {
                (RUST_WORDS[i].word, RUST_WORDS[i].value)
            } else {
                (b"where".as_slice(), tok::KEYWORD as i32)
            };
            assert!(w.len() <= WORD_MAX && value >= 0 && value < 0x10000);
            let k = word(w);
            let s = word_slot(k, mul);
            if keys[s] != 0 {
                mul = mul.wrapping_add(0x6a09_e667_f3bc_c909) | 1;
                attempt += 1;
                continue 'search;
            }
            keys[s] = k;
            values[s] = value as u16;
            i += 1;
        }
        break Words { keys, values, mul };
    }
};

/// Operator bytes (`$rustIsOp`).
const OPS: [bool; 256] = byteset(b"!%&*+-/<=>^|");

/// Byte classes for the main dispatch.
mod class {
    /// An identifier start other than `r`, `b`, `c`.
    pub const IDENT: u8 = 0;
    /// `r`: a raw string prefix or a name.
    pub const R: u8 = 1;
    /// `b` or `c`: a byte or C string prefix or a name.
    pub const BC: u8 = 2;
    pub const DIGIT: u8 = 3;
    pub const SLASH: u8 = 4;
    pub const DQUOTE: u8 = 5;
    pub const SQUOTE: u8 = 6;
    pub const HASH: u8 = 7;
    pub const OPEN_PAREN: u8 = 8;
    pub const CLOSE_PAREN: u8 = 9;
    /// `[` or `{`.
    pub const OPEN_BRACKET: u8 = 10;
    /// `]` or `}`.
    pub const CLOSE_BRACKET: u8 = 11;
    /// `,` or `;`.
    pub const DELIMITER: u8 = 12;
    pub const COLON: u8 = 13;
    pub const DOT: u8 = 14;
    /// An operator byte other than `/` (`$rustIsOp`).
    pub const OP: u8 = 15;
    /// Anything else: one byte colored `none`.
    pub const OTHER: u8 = 16;
    /// NUL: the end of the input, or one byte colored `none` inside it.
    pub const NUL: u8 = 17;
}

/// The [`class`] of each byte.
static CLASS: [u8; 256] = {
    let mut t = [class::OTHER; 256];
    t[0] = class::NUL;
    let mut c = 1;
    while c < 256 {
        let b = c as u8;
        t[c] = if is_ident_start(b) {
            match b {
                b'r' => class::R,
                b'b' | b'c' => class::BC,
                _ => class::IDENT,
            }
        } else if is_digit(b) {
            class::DIGIT
        } else {
            match b {
                b'/' => class::SLASH,
                b'"' => class::DQUOTE,
                b'\'' => class::SQUOTE,
                b'#' => class::HASH,
                b'(' => class::OPEN_PAREN,
                b')' => class::CLOSE_PAREN,
                b'[' | b'{' => class::OPEN_BRACKET,
                b']' | b'}' => class::CLOSE_BRACKET,
                b',' | b';' => class::DELIMITER,
                b':' => class::COLON,
                b'.' => class::DOT,
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

/// Whether `c` is an ASCII uppercase letter.
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
        // SAFETY: `p` starts at or before the input end, and the NUL there
        // ends the run, so `p` never passes it; 8 bytes from there stay
        // inside the slack.
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
        // SAFETY: `p` starts at or before the input end, and the NUL there
        // ends the run, so `p` never passes it; 16 bytes from there stay
        // inside the slack.
        if !IDENT_CONT[unsafe { src.byte_unchecked(p) } as usize] {
            return p;
        }
        p += 1;
    }
    loop {
        // SAFETY: as above.
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
    // SAFETY: `p` starts at or before the input end, and the NUL there ends
    // the run.
    while unsafe { src.byte_unchecked(p) } == b' ' || unsafe { src.byte_unchecked(p) } == b'\t' {
        p += 1;
    }
    p
}

/// The end of the number at `p`: radix digits, separators, exponents, and
/// suffixes, with `.` only before a digit (`$lexScanNumber`,
/// `$lexScanNumberBody`).
fn number_end(src: Input, mut p: usize) -> usize {
    let hex = src.byte(p) == b'0' && src.byte(p + 1) | 0x20 == b'x';
    let mut prev = 0u8;
    loop {
        // SAFETY: `p` starts at or before the input end, and the NUL there
        // ends the number, so every read is at most one byte past it.
        let c = unsafe { src.byte_unchecked(p) };
        if IDENT_CONT[c as usize] {
            prev = c;
            p += 1;
            continue;
        }
        if c == b'.' {
            // SAFETY: as above.
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

/// SCREAMING_CASE: at least two bytes, one uppercase letter, and only
/// `[A-Z0-9_]` (`$lexIsConstCase`).
fn is_const_case(src: Input, lhs: usize, rhs: usize) -> bool {
    if rhs - lhs < 2 {
        return false;
    }
    let mut upper = false;
    for p in lhs..rhs {
        // SAFETY: `p` is inside the name, before the input end.
        let c = unsafe { src.byte_unchecked(p) };
        if is_upper(c) {
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
    // SAFETY: every caller passes a position at or before the input end,
    // so the 8 bytes stay inside the slack.
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

/// The color of the word `[lhs, rhs)` with the expected next name in bits
/// 8 and up (1 = a function, 2 = a type), or -1 for no word
/// (`$rustWordHl`).
#[inline(always)]
fn word_hl(src: Input, lhs: usize, rhs: usize) -> i32 {
    let n = rhs - lhs;
    if n > WORD_MAX || WORD_LENGTHS[src.byte(lhs) as usize] >> n & 1 == 0 {
        return -1;
    }
    let w = word_at(src, lhs, n as u32);
    let s = word_slot(w, WORDS.mul);
    if WORDS.keys[s] == w {
        WORDS.values[s] as i32
    } else {
        -1
    }
}

/// The parameter-list machine's registers (`$sig*` globals in `sig.wat`).
#[derive(Default)]
struct Sig {
    parens: u32,
    mask: u32,
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

    /// Adjust the pending head's angle depth by the `<` and `>` bytes of
    /// the operator `[p, e)`, and cancel the head on any other byte outside
    /// angles (`$sigAngleOps`, `$sigFnAngleDrop`).
    fn angle_ops(&mut self, src: Input, p: usize, e: usize) {
        for i in p..e {
            // SAFETY: `i` is inside the operator, before the input end.
            match unsafe { src.byte_unchecked(i) } {
                b'<' => self.fn_angle = self.fn_angle.wrapping_add(1),
                b'>' => self.fn_angle = self.fn_angle.saturating_sub(1),
                _ => {
                    if self.fn_angle == 0 {
                        self.fn_pend = false;
                    }
                }
            }
        }
    }
}

/// The end of the escape at backslash `p`: one character, kept whole when
/// it is UTF-8, and CRLF as one (`$lexEscapeEnd`).
#[inline(always)]
fn escape_end(src: Input, p: usize, end: usize) -> usize {
    let mut e = scan::utf8_span_end(src.bytes(), p + 2, end);
    if e == p + 2 && src.byte(p + 1) == b'\r' && e < end && src.byte(e) == b'\n' {
        e += 1;
    }
    e
}

/// The one-line quoted literal whose `quote` is at `p`, with escapes as
/// their own tokens; `seg` starts the pending string token. Returns the
/// end (`$lexString`, `$lexStringBody`).
#[inline(never)]
fn string(
    src: Input,
    mut recs: Recs,
    p: usize,
    end: usize,
    quote: u8,
    mut seg: usize,
) -> (Recs, usize) {
    let mut p = p + 1;
    loop {
        p = scan::string_special(src.bytes(), p, end, quote);
        if p >= end {
            break;
        }
        let c = src.byte(p);
        if c == quote {
            p += 1;
            break;
        }
        if c != b'\\' {
            // a raw line break: unterminated, left unconsumed
            break;
        }
        if seg < p {
            recs.tok(tok::STRING, p);
        }
        let e = escape_end(src, p, end);
        recs.tok(tok::STRING_ESCAPE, e);
        p = e;
        seg = p;
    }
    if seg < p {
        recs.tok(tok::STRING, p);
    }
    (recs, p)
}

/// The nesting block comment whose `/*` is at `p`, through its balancing
/// `*/` or to `end`. Returns the end (`$lexNestedBlockComment`,
/// `$lexNestedScan`).
#[inline(never)]
fn nested_comment_end(src: Input, p: usize, end: usize) -> usize {
    let mut p = (p + 2).min(end);
    let mut depth = 1u32;
    loop {
        // the next `/*` or `*/`: hop between `/` and `*` bytes
        p = scan::find3(src.bytes(), p, end, b'/', b'*', b'/');
        if p + 1 >= end {
            return end;
        }
        // SAFETY: `p + 1` is before the input end (tested above).
        let (a, b) = (src.byte(p), unsafe { src.byte_unchecked(p + 1) });
        if a == b'/' && b == b'*' {
            depth += 1;
            p += 2;
        } else if a == b'*' && b == b'/' {
            depth -= 1;
            p += 2;
            if depth == 0 {
                return p;
            }
        } else {
            p += 1;
        }
    }
}

/// The opener of a raw string at `p`, a `prefix`-byte prefix, its hashes,
/// and the quote. Returns the hash count and the opener's end, or `None`
/// when no quote follows the hashes (`$rustRawOpen`).
#[inline(always)]
fn raw_open(src: Input, p: usize, prefix: usize) -> Option<(usize, usize)> {
    let mut q = p + prefix;
    // SAFETY: the prefix lies inside the input, and the NUL after the input
    // stops the `#` run, so `q` never passes the input end.
    while unsafe { src.byte_unchecked(q) } == b'#' {
        q += 1;
    }
    // SAFETY: as above.
    if unsafe { src.byte_unchecked(q) } != b'"' {
        return None;
    }
    Some((q - p - prefix, q + 1))
}

/// The end of a raw string body from `p`: just past its closing quote and
/// `hashes` hashes, or `end` (`$rustRawBody`, `$lexFindByte`).
#[inline(never)]
fn raw_body_end(src: Input, mut p: usize, end: usize, hashes: usize) -> usize {
    loop {
        p = scan::find3(src.bytes(), p, end, b'"', b'"', b'"');
        if p >= end {
            return end;
        }
        let mut q = p + 1;
        let mut seen = 0;
        while seen < hashes && src.byte(q) == b'#' {
            seen += 1;
            q += 1;
        }
        if seen == hashes {
            return q;
        }
        p += 1;
    }
}

/// Lex the Rust input of `len` bytes at `base` (`$hlRust`).
fn highlight(inst: &mut Instance, base: usize, len: usize) {
    // SAFETY: `base..base + len + SLACK` lies inside lexer memory, which
    // nothing moves while this lexer runs (it calls no translated code).
    let src = unsafe { Input::new(inst, base, len) };
    let end = len;
    let mut sig = Sig::default();
    let mut recs = Recs::load(inst);

    // `$lexEmitLeadingContinuation`
    let mut ptr = scan::utf8_span_end(src.bytes(), 0, end);
    recs.gap(0, ptr);
    // Leading whitespace; every later gap follows a token's record.
    let first = whitespace_end(src, ptr);
    recs.gap(ptr, first);
    ptr = first;

    // 1 = after `.` (a field), 2 = after `::` (a path segment)
    let mut member = 0u32;
    // the name after `fn` (1) or a type keyword (2)
    let mut expect = 0u32;
    // after `#` or `#!`: the next name is an attribute
    let mut attr = false;

    // A bracket `c` (`$hlRust`'s bracket rule): the parameter machine sees
    // `(` open the armed fn list and put the next name in parameter
    // position; other brackets inside a marked list obscure its top level.
    macro_rules! bracket {
        ($c:expr) => {{
            let c: u8 = $c;
            if c == b'(' {
                sig.parens = sig.parens.wrapping_add(1);
                if sig.fn_angle == 0 {
                    if sig.fn_pend {
                        sig.mark();
                    }
                    sig.fn_pend = false;
                }
                sig.pattern = true;
            } else {
                sig.pattern = false;
                if c == b')' {
                    if sig.active() {
                        sig.unmark();
                    }
                    if sig.parens > 0 {
                        sig.parens -= 1;
                    }
                } else {
                    if sig.fn_pend && sig.fn_angle == 0 {
                        sig.fn_pend = false;
                    }
                    if sig.active() {
                        if c == b'[' || c == b'{' {
                            sig.obscure = sig.obscure.wrapping_add(1);
                        } else if sig.obscure > 0 {
                            sig.obscure -= 1;
                        }
                    }
                }
            }
            ptr += 1;
            recs.tok(tok::PUNCTUATION_BRACKET, ptr);
            if !attr {
                member = 0;
            }
            expect = 0;
        }};
    }
    // The `,` or `;` delimiter `c`.
    macro_rules! delimiter {
        ($c:expr) => {{
            let c: u8 = $c;
            ptr += 1;
            recs.tok(tok::PUNCTUATION_DELIMITER, ptr);
            member = 0;
            expect = 0;
            // a comma returns to parameter position; a top-level `;`
            // proves the marked list was not a parameter list after all
            sig.pattern = c == b',';
            if c == b';' && sig.active() && sig.obscure == 0 {
                sig.unmark();
            }
        }};
    }
    // `:` or `::`, with `c2` the byte after the first `:`.
    macro_rules! colon {
        ($c2:expr) => {{
            let c2: u8 = $c2;
            ptr += if c2 == b':' { 2 } else { 1 };
            recs.tok(tok::PUNCTUATION_DELIMITER, ptr);
            member = if c2 == b':' { 2 } else { 0 };
            expect = 0;
            sig.pattern = false;
        }};
    }
    // `.`, `..`, or `..=`, with `c2` the byte after the first `.`.
    macro_rules! dot {
        ($c2:expr) => {{
            let c2: u8 = $c2;
            ptr += if c2 == b'.' { 2 } else { 1 };
            // SAFETY: a second `.` is an input byte, so `ptr` is at or before
            // the input end.
            if c2 == b'.' && unsafe { src.byte_unchecked(ptr) } == b'=' {
                ptr += 1;
            }
            recs.tok(
                if c2 == b'.' {
                    tok::OPERATOR
                } else {
                    tok::PUNCTUATION_DELIMITER
                },
                ptr,
            );
            member = (c2 != b'.') as u32;
            expect = 0;
            sig.pattern = false;
        }};
    }

    // `ptr` never passes the input end: every scan stops at the NUL there.
    loop {
        // SAFETY: `ptr` is at or before the input end (see above).
        let s = unsafe { src.byte_unchecked(ptr) };
        // SAFETY: as above.
        if s == b' ' && !is_space(unsafe { src.byte_unchecked(ptr + 1) }) {
            // one space
            ptr += 1;
            recs.extend(ptr);
        } else if is_space(s) {
            ptr = whitespace_end(src, ptr + 1);
            recs.extend(ptr);
        }
        let lhs = ptr;
        let c = src.byte(ptr);
        let class = CLASS[c as usize];

        // Names, the most common tokens, skip the jump table.
        if class <= class::BC {
            if class != class::IDENT {
                // SAFETY: `ptr` is at or before the input end (see the main
                // loop), so this reads at most two bytes past it.
                let c2 = unsafe { src.byte_unchecked(ptr + 1) };
                // a raw string prefix: `r` is one byte, `br` and `cr` two
                let prefix = if class == class::R {
                    1
                } else if c2 == b'r' {
                    2
                } else {
                    0
                };
                if prefix != 0
                    && let Some((hashes, open)) = raw_open(src, ptr, prefix)
                {
                    recs.tok(tok::STRING, open);
                    ptr = open;
                    member = 0;
                    if ptr < end {
                        ptr = raw_body_end(src, ptr, end, hashes);
                        recs.tok(tok::STRING, ptr);
                    }
                    continue;
                }
                if class == class::BC && (c2 == b'"' || c2 == b'\'') {
                    // (the prefix and the literal are one string token)
                    (recs, ptr) = string(src, recs, ptr + 1, end, c2, ptr);
                    member = 0;
                    continue;
                }
            }
            // a pending fn head outside its type parameters expects only
            // the opening paren
            if sig.fn_pend && sig.fn_angle == 0 {
                sig.fn_pend = false;
            }
            let rhs = ident_end(src, ptr + 1);
            ptr = rhs;
            let hl;
            if attr {
                hl = tok::ATTRIBUTE;
                attr = false;
            } else {
                let kind = word_hl(src, lhs, rhs);
                if kind >= 0 {
                    hl = kind as u32 & 255;
                    if kind >> 8 != 0 {
                        expect = (kind >> 8) as u32;
                    }
                } else {
                    let p = skip_space_at(src, rhs);
                    let mut h;
                    if expect != 0 {
                        h = if expect == 1 {
                            tok::FUNCTION_DEFINITION
                        } else {
                            tok::TYPE
                        };
                        if expect == 1 {
                            sig.fn_pend = true;
                            sig.fn_angle = 0;
                        }
                        expect = 0;
                    } else if src.byte(p) == b'!' && src.byte(p + 1) != b'=' {
                        // a macro name ends in `!`
                        h = tok::FUNCTION;
                    } else if src.byte(p) == b'(' {
                        h = if member == 1 {
                            tok::FUNCTION_METHOD
                        } else {
                            tok::FUNCTION
                        };
                    } else if member != 0 {
                        h = if member == 2 && is_upper(c) {
                            if is_const_case(src, lhs, rhs) {
                                tok::CONSTANT
                            } else {
                                tok::TYPE
                            }
                        } else {
                            tok::PROPERTY
                        };
                    } else if sig.active()
                        && sig.pattern
                        && sig.obscure == 0
                        && src.byte(p) == b':'
                        && src.byte(p + 1) != b':'
                    {
                        h = tok::VARIABLE_PARAMETER;
                    } else if (is_upper(c) || c == b'_') && is_const_case(src, lhs, rhs) {
                        // (only `[A-Z_]` can start a constant name)
                        h = tok::CONSTANT;
                    } else if is_upper(c) {
                        h = tok::TYPE;
                    } else {
                        h = tok::VARIABLE;
                    }
                    // a lowercase segment glued to `::` names a module
                    // SAFETY: names end at or before the input end, so these
                    // reads are at most two bytes past it.
                    if unsafe { src.byte_unchecked(rhs) } == b':'
                        && unsafe { src.byte_unchecked(rhs + 1) } == b':'
                        && unsafe { src.byte_unchecked(rhs + 2) } != b'<'
                        && !is_upper(c)
                    {
                        h = tok::NAMESPACE;
                    }
                    hl = h;
                }
            }
            recs.tok(hl, rhs);
            // only a `mut` binding modifier keeps the next name in
            // position
            sig.pattern = sig.pattern && rhs - lhs == 3 && word_at(src, lhs, 3) == word(b"mut");
            member = 0;
            // A bracket, delimiter, `:`, or `.` right after a name: its
            // rule runs here, without the gap and dispatch steps.
            // SAFETY: names end at or before the input end, so these reads are
            // at most one byte past it.
            let n = unsafe { src.byte_unchecked(ptr) };
            match CLASS[n as usize] {
                class::OPEN_PAREN
                | class::CLOSE_PAREN
                | class::OPEN_BRACKET
                | class::CLOSE_BRACKET => bracket!(n),
                class::DELIMITER => delimiter!(n),
                class::COLON => colon!(unsafe { src.byte_unchecked(ptr + 1) }),
                class::DOT => dot!(unsafe { src.byte_unchecked(ptr + 1) }),
                _ => {}
            }
            continue;
        }
        match class {
            // SAFETY: `ptr` is at or before the input end (see the main loop),
            // so this reads at most two bytes past it.
            class::SLASH if matches!(unsafe { src.byte_unchecked(ptr + 1) }, b'/' | b'*') => {
                // SAFETY: as above.
                let c2 = unsafe { src.byte_unchecked(ptr + 1) };
                // `//` (`$lexLineComment`, `$scanToLineEnd`) and nesting
                // `/*` comments; `///`, `//!`, `/**`, and `/*!` are doc
                // comments
                // SAFETY: as above.
                let c3 = unsafe { src.byte_unchecked(ptr + 2) };
                let hl = if c3 == c2 || c3 == b'!' {
                    tok::COMMENT_DOC
                } else {
                    tok::COMMENT
                };
                ptr = if c2 == b'/' {
                    scan::line_end(src.bytes(), (ptr + 2).min(end), end)
                } else {
                    nested_comment_end(src, ptr, end)
                };
                recs.tok(hl, ptr);
                continue;
            }
            class::DQUOTE => {
                (recs, ptr) = string(src, recs, ptr, end, b'"', ptr);
                continue;
            }
            class::SQUOTE => {
                let mut p = ptr + 1;
                while is_ident_continue(src.byte(p)) {
                    p += 1;
                }
                if p > ptr + 1 && src.byte(p) != b'\'' {
                    ptr = p;
                    recs.tok(tok::LABEL, ptr);
                } else {
                    (recs, ptr) = string(src, recs, ptr, end, b'\'', ptr);
                }
                member = 0;
                continue;
            }
            class::HASH
                // SAFETY: `ptr` is at or before the input end (see the main
                // loop), so this reads at most two bytes past it.
                if unsafe { src.byte_unchecked(ptr + 1) } == b'['
                    || (unsafe { src.byte_unchecked(ptr + 1) } == b'!'
                        && unsafe { src.byte_unchecked(ptr + 2) } == b'[') =>
            {
                // SAFETY: as above.
                let c2 = unsafe { src.byte_unchecked(ptr + 1) };
                ptr += if c2 == b'!' { 2 } else { 1 };
                recs.tok(tok::ATTRIBUTE, ptr);
                attr = true;
                continue;
            }
            class::DIGIT => {
                if member == 1 {
                    // a tuple index `pair.0` is just its digits
                    ptr += 1;
                    // SAFETY: the digit run stops at the NUL after the input.
                    while is_digit(unsafe { src.byte_unchecked(ptr) }) {
                        ptr += 1;
                    }
                } else {
                    ptr = number_end(src, ptr);
                }
                recs.tok(tok::NUMBER, ptr);
                member = 0;
                expect = 0;
                continue;
            }
            class::OPEN_PAREN | class::CLOSE_PAREN | class::OPEN_BRACKET | class::CLOSE_BRACKET => {
                bracket!(c);
                continue;
            }
            class::DELIMITER => {
                delimiter!(c);
                continue;
            }
            class::COLON => {
                // SAFETY: `ptr` is at or before the input end (see the main
                // loop), so this reads at most two bytes past it.
                colon!(unsafe { src.byte_unchecked(ptr + 1) });
                continue;
            }
            class::DOT => {
                // SAFETY: `ptr` is at or before the input end (see the main
                // loop), so this reads at most two bytes past it.
                dot!(unsafe { src.byte_unchecked(ptr + 1) });
                continue;
            }
            class::OP | class::SLASH => {
                // SAFETY: `ptr` is at or before the input end (see the main
                // loop), so this reads at most two bytes past it.
                let c2 = unsafe { src.byte_unchecked(ptr + 1) };
                ptr += 1;
                if c2 == b'=' || (c == c2 && matches!(c, b'&' | b'|' | b'<' | b'>')) {
                    ptr += 1;
                    // SAFETY: `ptr` stepped over input bytes only, so it is at
                    // or before the input end.
                    if (c == b'<' || c == b'>') && unsafe { src.byte_unchecked(ptr) } == b'=' {
                        ptr += 1;
                    }
                }
                recs.tok(tok::OPERATOR, ptr);
                member = 0;
                expect = 0;
                // a pending fn head rides `<`/`>` type-parameter operators
                if sig.fn_pend {
                    sig.angle_ops(src, lhs, ptr);
                }
                sig.pattern = false;
                continue;
            }
            class::NUL if ptr >= end => break,
            _ => {
                ptr += 1;
                recs.tok(tok::NONE, ptr);
                member = 0;
                expect = 0;
            }
        }
    }
    recs.store(inst);
}
