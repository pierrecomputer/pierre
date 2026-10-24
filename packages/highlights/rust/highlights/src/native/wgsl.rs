//! WAT sources: src/langs/wgsl.wat src/common.wat src/scan.wat
//!
//! Native WGSL lexer. One pass over the input: each token is scanned and
//! colored in the same step, with the same rules, in the same order, as the
//! translated `$hlWgsl`. The records equal the translated lexer's records.
//!
//! The WAT tests its rules in one chain. Most rules match one first byte,
//! so this lexer dispatches on a byte class and, for each class, tests only
//! the rules that can match it, in the WAT's order.

use super::Lexer;
use super::scan;
use super::tables::byteset;
use crate::Rec;
use crate::generated::Instance;
use crate::simd::V;
use crate::token_ids as tok;
use crate::wat_tables::WGSL_WORDS;

/// The lexer for `name`, if this module handles it.
pub(crate) fn lexer(name: &str) -> Option<Lexer> {
    match name {
        "wgsl" => Some(highlight),
        _ => None,
    }
}

/// `$wgslWords` as a perfect hash on a word's bytes. A word of up to 24
/// bytes is three little-endian integers (bytes 0-7, 8-15, 16-23), zero
/// past its end; identifiers hold no NUL, so equal integers mean equal
/// words.
struct Words {
    /// Entry number plus one for each hash slot, or 0 for no word.
    index: [u8; WORD_SLOTS],
    /// Each entry's integers; 256 entries, so an index byte needs no
    /// bounds check.
    keys: [[u64; 3]; 256],
    /// The word's `keyword-table.value`: its token, with the next-name
    /// capture above it.
    values: [u16; 256],
    mul: u64,
}

const WORD_SLOTS: usize = 4096;

/// The longest word.
const WORD_MAX: usize = 24;

/// The slot of the word with integers `k`.
#[inline(always)]
const fn word_slot(k: [u64; 3], mul: u64) -> usize {
    let h = k[0] ^ k[1].rotate_left(29) ^ k[2].rotate_left(13);
    (h.wrapping_mul(mul) >> (64 - WORD_SLOTS.trailing_zeros())) as usize
}

/// The integers of the word `w`.
const fn word_key(w: &[u8]) -> [u64; 3] {
    let mut k = [0u64; 3];
    let mut i = 0;
    while i < w.len() {
        k[i / 8] |= (w[i] as u64) << (8 * (i % 8));
        i += 1;
    }
    k
}

/// For each first byte, a bit per length of the words in [`WORDS`]. A name
/// whose bit is clear is no word.
static WORD_LENGTHS: [u32; 256] = {
    let mut t = [0u32; 256];
    let mut i = 0;
    while i < WGSL_WORDS.len() {
        let w = WGSL_WORDS[i].word;
        t[w[0] as usize] |= 1 << w.len();
        i += 1;
    }
    t
};

/// The words, placed by searching for a multiplier that gives each its own
/// slot.
static WORDS: Words = {
    assert!(WGSL_WORDS.len() < 256);
    let mut keys = [[0u64; 3]; 256];
    let mut values = [0u16; 256];
    let mut i = 0;
    while i < WGSL_WORDS.len() {
        let w = WGSL_WORDS[i].word;
        let value = WGSL_WORDS[i].value;
        assert!(w.len() <= WORD_MAX && value > 0 && value < 0x10000);
        keys[i] = word_key(w);
        values[i] = value as u16;
        i += 1;
    }
    let mut mul: u64 = 0x2545_f491_4f6c_dd1d;
    let mut attempt = 0;
    'search: loop {
        assert!(attempt < 20_000, "no collision-free hash: use more slots");
        let mut index = [0u8; WORD_SLOTS];
        let mut i = 0;
        while i < WGSL_WORDS.len() {
            let s = word_slot(keys[i], mul);
            if index[s] != 0 {
                mul = mul.wrapping_add(0x6a09_e667_f3bc_c909) | 1;
                attempt += 1;
                continue 'search;
            }
            index[s] = i as u8 + 1;
            i += 1;
        }
        break Words {
            index,
            keys,
            values,
            mul,
        };
    }
};

/// Operator bytes (`$wgslIsOp`).
const OPS: [bool; 256] = byteset(b"!%&*+-/<=>^|~");

/// Bytes that double into a compound operator (`&&`, `++`, ...).
static DOUBLES: [bool; 256] = byteset(b"&+-<>|");

/// Byte classes for the main dispatch.
mod class {
    /// An identifier start (`$lexIsIdentStart`).
    pub const IDENT: u8 = 0;
    /// Anything else: one plain byte.
    pub const OTHER: u8 = 1;
    pub const DIGIT: u8 = 2;
    pub const AT: u8 = 3;
    pub const SLASH: u8 = 4;
    pub const DOT: u8 = 5;
    /// A bracket, `,`, `;`, or `:`: one byte with its color in
    /// [`PUNCT_HL`](super::PUNCT_HL).
    pub const PUNCT: u8 = 6;
    /// An operator byte other than `/` (`$wgslIsOp`).
    pub const OP: u8 = 7;
    /// ASCII whitespace.
    pub const SPACE: u8 = 8;
    /// NUL: the end of the input, or a plain byte inside it.
    pub const NUL: u8 = 9;
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
        } else if is_space(b) {
            class::SPACE
        } else {
            match b {
                0 => class::NUL,
                b'@' => class::AT,
                b'/' => class::SLASH,
                b'.' => class::DOT,
                b'(' | b')' | b'[' | b']' | b'{' | b'}' | b',' | b';' | b':' => class::PUNCT,
                _ if OPS[c] => class::OP,
                _ => class::OTHER,
            }
        };
        c += 1;
    }
    t
};

/// The color of each [`class::PUNCT`] byte.
static PUNCT_HL: [u8; 256] = {
    let mut t = [0u8; 256];
    let mut c = 0;
    while c < 256 {
        t[c] = match c as u8 {
            b',' | b';' | b':' => tok::PUNCTUATION_DELIMITER as u8,
            b'(' | b')' | b'[' | b']' | b'{' | b'}' => tok::PUNCTUATION_BRACKET as u8,
            _ => 0,
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
/// The byte at `i`. Every caller reads inside the input or its 96-byte
/// slack. The byte at the input end is NUL, which matches none of the
/// bytes a lookahead tests, so a one-byte lookahead past a token needs no
/// bounds check.
#[inline(always)]
fn at(src: &[u8], i: usize) -> u8 {
    debug_assert!(i < src.len());
    // SAFETY: `i` lies inside the input or its slack (see above).
    unsafe { *src.get_unchecked(i) }
}

/// Whether `c` is ASCII whitespace: space or TAB through CR (`$lexIsSpace`).
#[inline(always)]
const fn is_space(c: u8) -> bool {
    c == b' ' || c.wrapping_sub(9) <= 4
}

/// Whether `c` is an ASCII digit (`$lexIsDigit`).
#[inline(always)]
const fn is_digit(c: u8) -> bool {
    c.wrapping_sub(b'0') <= 9
}

/// Whether `c` is an ASCII hex digit (`$lexIsHex`).
#[inline(always)]
const fn is_hex(c: u8) -> bool {
    is_digit(c) || (c | 32).wrapping_sub(b'a') <= 5
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

/// Token records written straight into `inst.ext.recs` the way `$emitTok`
/// and `$emitGap` write them: a token extends the last record when its
/// color matches, and whitespace extends the last record whatever its
/// color. The vector has room for one record per input byte and every
/// record covers at least one byte, so running out of room means a lexer
/// bug, which traps. Helpers off the hot path take it by value and return
/// it, so its fields stay in registers in the main loop.
struct Out {
    base: *mut Rec,
    cur: *mut Rec,
    limit: *mut Rec,
    /// Token of the last record, or `u32::MAX` when there is none.
    last: u32,
}

impl Out {
    fn load(inst: &mut Instance) -> Self {
        let v = &mut inst.ext.recs;
        let base = v.as_mut_ptr();
        Out {
            base,
            // SAFETY: `len` records are written, within the allocation.
            cur: unsafe { base.add(v.len()) },
            // SAFETY: one past the allocation.
            limit: unsafe { base.add(v.capacity()) },
            last: v.last().map_or(u32::MAX, |r| r.token),
        }
    }

    fn store(self, inst: &mut Instance) {
        // SAFETY: the records before `cur` are written, within the
        // capacity.
        unsafe {
            inst.ext
                .recs
                .set_len(self.cur.offset_from(self.base) as usize)
        };
    }

    /// Append a non-empty token ending at `end` (`$emitTok`).
    #[inline(always)]
    fn tok(&mut self, hl: u32, end: usize) {
        // SAFETY: `cur` stays within `base..limit`; a merge rewrites the
        // last record, which exists when `last` matches.
        unsafe {
            self.cur = self.cur.sub((self.last == hl) as usize);
            if self.cur == self.limit {
                crate::rt::trap();
            }
            self.cur.write(Rec {
                end: end as u32,
                token: hl,
            });
            self.cur = self.cur.add(1);
        }
        self.last = hl;
    }

    /// Whitespace `[lhs, rhs)` (`$emitGap`).
    #[inline(always)]
    fn gap(&mut self, lhs: usize, rhs: usize) {
        if lhs < rhs {
            if self.cur == self.base {
                self.tok(tok::NONE, rhs);
            } else {
                self.extend(rhs);
            }
        }
    }

    /// Whitespace up to `rhs` after a record: it extends that record.
    #[inline(always)]
    fn extend(&mut self, rhs: usize) {
        debug_assert!(self.cur > self.base);
        // SAFETY: a record precedes `cur`.
        unsafe { (*self.cur.sub(1)).end = rhs as u32 };
    }
}

/// The end of the whitespace run from `p` (`$scanWhitespace`). The NUL
/// after the input ends every run.
#[inline(always)]
fn whitespace_end(src: &[u8], mut p: usize) -> usize {
    loop {
        // Skip spaces 8 bytes at a time, then step over one other
        // whitespace byte (TAB to CR) and go on.
        // SAFETY: `p` lies at or before the NUL after the input, so the
        // 8-byte read stays inside the slack.
        let w = unsafe { src.as_ptr().add(p).cast::<u64>().read_unaligned() };
        let x = w ^ 0x2020_2020_2020_2020;
        let other =
            (((x & 0x7f7f_7f7f_7f7f_7f7f) + 0x7f7f_7f7f_7f7f_7f7f) | x) & 0x8080_8080_8080_8080;
        if other == 0 {
            p += 8;
            continue;
        }
        p += (other.trailing_zeros() / 8) as usize;
        if !is_space(at(src, p)) {
            return p;
        }
        p += 1;
    }
}

/// The end of the identifier run from `p`: `[A-Za-z0-9_$]` and bytes from
/// 0x80 (`$lexScanIdent`, `$scanIdentRun`). The NUL after the input ends
/// every run.
#[inline(always)]
fn ident_end(src: &[u8], mut p: usize) -> usize {
    // Most names are short: test a few bytes one by one first.
    for _ in 0..8 {
        if !IDENT_CONT[at(src, p) as usize] {
            return p;
        }
        p += 1;
    }
    loop {
        // SAFETY: each 16-byte load starts at or before the NUL after the
        // input, inside the slack.
        let v = unsafe { V::load(src.as_ptr().add(p)) };
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
/// The NUL after the input ends every run.
#[inline(always)]
fn skip_space_at(src: &[u8], mut p: usize) -> usize {
    while at(src, p) == b' ' || at(src, p) == b'\t' {
        p += 1;
    }
    p
}

/// SCREAMING_CASE: at least two bytes, one uppercase letter, and only
/// `[A-Z0-9_]` (`$lexIsConstCase`).
fn is_const_case(src: &[u8], lhs: usize, rhs: usize) -> bool {
    if rhs - lhs < 2 {
        return false;
    }
    let mut upper = false;
    for p in lhs..rhs {
        let c = at(src, p);
        if c.wrapping_sub(b'A') <= 25 {
            upper = true;
        } else if !(is_digit(c) || c == b'_') {
            return false;
        }
    }
    upper
}

/// The first `n` bytes at `p` as a little-endian integer. Reads 8 bytes,
/// which the input slack allows.
#[inline(always)]
fn word_at(src: &[u8], p: usize, n: u32) -> u64 {
    debug_assert!(p + 8 <= src.len());
    // SAFETY: `p` lies at or before the input end, so `p + 8` lies inside
    // the slack.
    let w = unsafe { src.as_ptr().add(p).cast::<u64>().read_unaligned() };
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

/// The number at `p`: radix digits, separators, exponents, and suffixes,
/// with `.` only before a digit (`$lexScanNumber`, `$lexScanNumberBody`).
/// The NUL after the input ends every number.
#[inline(always)]
fn number_body(src: &[u8], mut p: usize, hex: bool) -> usize {
    let mut prev = 0u8;
    loop {
        let c = at(src, p);
        if IDENT_CONT[c as usize] {
            prev = c;
            p += 1;
            continue;
        }
        if c == b'.' {
            if !is_digit(at(src, p + 1)) {
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

/// The end of the number at `lhs`, with hexadecimal floats whose fraction
/// may start with an a-f digit or be empty (`$lexScanHexNumber` with no
/// required exponent).
#[inline(always)]
fn hex_number_end(src: &[u8], lhs: usize) -> usize {
    let hex = at(src, lhs) == b'0' && at(src, lhs + 1) | 0x20 == b'x';
    let p = number_body(src, lhs, hex);
    if hex && at(src, p) == b'.' {
        hex_fraction(src, p)
    } else {
        p
    }
}

/// The rest of a hexadecimal number from its `.` at `p`: the fraction and
/// exponent when they form a hexadecimal float, or `p` (the tail of
/// `$lexScanHexNumber`).
#[cold]
#[inline(never)]
fn hex_fraction(src: &[u8], p: usize) -> usize {
    let next = at(src, p + 1);
    if !(is_hex(next) || next | 32 == b'p') {
        return p;
    }
    if next | 32 == b'p' {
        let mut q = p + 1;
        while is_hex(at(src, q)) || at(src, q) == b'_' {
            q += 1;
        }
        if at(src, q) | 32 != b'p' {
            return p;
        }
        q += 1;
        if at(src, q) == b'+' || at(src, q) == b'-' {
            q += 1;
        }
        if !is_digit(at(src, q)) {
            return p;
        }
    }
    number_body(src, p + 1, true)
}

/// The `$wgslWords` value of the name `[lhs, rhs)`, or -1.
#[inline(always)]
fn word_value(src: &[u8], lhs: usize, rhs: usize) -> i32 {
    let n = rhs - lhs;
    if n > WORD_MAX || WORD_LENGTHS[at(src, lhs) as usize] >> n & 1 == 0 {
        return -1;
    }
    let k = [
        word_at(src, lhs, n.min(8) as u32),
        if n > 8 {
            word_at(src, lhs + 8, (n - 8).min(8) as u32)
        } else {
            0
        },
        if n > 16 {
            word_at(src, lhs + 16, (n - 16) as u32)
        } else {
            0
        },
    ];
    let e = WORDS.index[word_slot(k, WORDS.mul)] as usize;
    let key = &WORDS.keys[e.wrapping_sub(1) & 255];
    if e != 0 && (key[0] ^ k[0]) | (key[1] ^ k[1]) | (key[2] ^ k[2]) == 0 {
        WORDS.values[e - 1] as i32
    } else {
        -1
    }
}

/// `type.builtin` for the built-in type families the table cannot hold:
/// `vec2`..`vec4` with an optional `f`/`i`/`u`/`h` suffix, `mat2x2`..
/// `mat4x4` with an optional `f`/`h` suffix, and every `texture_` type;
/// otherwise `tok::NONE` (`$wgslTypeHl`). The wide loads stay inside the
/// input slack.
#[inline(always)]
fn type_hl(src: &[u8], lhs: usize, rhs: usize) -> u32 {
    let mut len = rhs - lhs;
    // (each family starts with `t`, `v`, or `m`)
    if len < 4 || !matches!(at(src, lhs), b't' | b'v' | b'm') {
        return tok::NONE;
    }
    if len >= 9 && word_at(src, lhs, 8) == word(b"texture_") {
        return tok::TYPE_BUILTIN;
    }
    let w = word_at(src, lhs, 3);
    let c = at(src, rhs - 1);
    // an element suffix letter is dropped before the digit check
    let mut rhs = rhs;
    if c == b'f' || c == b'h' || (w == word(b"vec") && (c == b'i' || c == b'u')) {
        rhs -= 1;
        len -= 1;
    }
    if at(src, rhs - 1).wrapping_sub(b'2') > 2 {
        return tok::NONE;
    }
    if len == 4 && w == word(b"vec") {
        return tok::TYPE_BUILTIN;
    }
    if len == 6
        && w == word(b"mat")
        && at(src, lhs + 3).wrapping_sub(b'2') <= 2
        && at(src, lhs + 4) == b'x'
    {
        return tok::TYPE_BUILTIN;
    }
    tok::NONE
}

/// The word value of the name `[lhs, rhs)`: its token in the low byte and
/// its next-name capture above (1 = function, 2 = type), or -1 for an
/// ordinary name (`$wgslWordHl`).
#[inline(always)]
fn word_hl(src: &[u8], lhs: usize, rhs: usize) -> i32 {
    let g = word_value(src, lhs, rhs);
    if g < 0 {
        let g = type_hl(src, lhs, rhs);
        return if g != tok::NONE { g as i32 } else { -1 };
    }
    g
}

/// The position just past the comment opened by the `/*` before `p`, with
/// nested `/*` ... `*/` pairs balanced, or `end` (`$lexNestedScan` for
/// `/*` and `*/` from depth 1). A pair counts only when both its bytes lie
/// before `end`; the NUL at `end` matches neither pair.
#[inline(always)]
fn nested_comment_end(src: &[u8], mut p: usize, end: usize) -> usize {
    let mut depth = 1u32;
    loop {
        // the earliest `/*` or `*/` at or after `p`
        loop {
            if p >= end {
                return end;
            }
            // SAFETY: each load starts before `end` and reads 17 bytes,
            // inside the input slack.
            let (a, b) = unsafe {
                (
                    V::load(src.as_ptr().add(p)),
                    V::load(src.as_ptr().add(p + 1)),
                )
            };
            let open = a.eq(V::splat(b'/')).and(b.eq(V::splat(b'*')));
            let close = a.eq(V::splat(b'*')).and(b.eq(V::splat(b'/')));
            let k = open.or(close).first();
            if k < 16 {
                p += k;
                break;
            }
            p += 16;
        }
        if p + 1 >= end {
            return end;
        }
        if at(src, p) == b'/' {
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

/// The end of the operator at `p`, whose first byte is `c` (`$hlWgsl`'s
/// `$wgslIsOp` rule).
#[inline(always)]
fn operator_end(src: &[u8], p: usize, c: u8) -> usize {
    let c2 = at(src, p + 1);
    let mut p = p + 1;
    if c == b'-' && c2 == b'>' {
        p += 1;
    } else if c2 == b'=' || (c == c2 && DOUBLES[c as usize]) {
        p += 1;
        if (c == b'<' || c == b'>') && at(src, p) == b'=' {
            p += 1;
        }
    }
    p
}

/// Lex the WGSL input of `len` bytes at `base` (`$hlWgsl`).
fn highlight(inst: &mut Instance, base: usize, len: usize) {
    let mem_ptr = inst.mem.bytes().as_ptr();
    // SAFETY: `base..base + len + 96` lies inside lexer memory, which is not
    // reallocated while this lexer runs.
    let src: &[u8] = unsafe { core::slice::from_raw_parts(mem_ptr.add(base), len + 96) };
    let end = len;
    let mut out = Out::load(inst);

    // `$lexEmitLeadingContinuation`
    let mut ptr = scan::utf8_span_end(src, 0, end);
    out.gap(0, ptr);
    // the pending next-name capture: 1 = function, 2 = type
    let mut expect = 0u32;
    // after `.`
    let mut member = false;
    // Leading whitespace; every later gap follows a token's record.
    let first = whitespace_end(src, ptr);
    out.gap(ptr, first);
    ptr = first;

    loop {
        let mut c = at(src, ptr);
        let mut class = CLASS[c as usize];
        if class == class::SPACE {
            // whitespace gaps
            let next = at(src, ptr + 1);
            let next_class = CLASS[next as usize];
            if c == b' ' && next_class != class::SPACE {
                // one space
                ptr += 1;
                c = next;
                class = next_class;
            } else {
                ptr = whitespace_end(src, ptr + 1);
                c = at(src, ptr);
                class = CLASS[c as usize];
            }
            out.extend(ptr);
        }
        let lhs = ptr;
        match class {
            class::IDENT => {
                ptr = ident_end(src, ptr + 1);
                let rhs = ptr;
                let kind = word_hl(src, lhs, rhs);
                let hl;
                if kind >= 0 {
                    hl = kind as u32 & 255;
                    expect = kind as u32 >> 8;
                } else if expect != 0 {
                    hl = if expect == 1 {
                        tok::FUNCTION_DEFINITION
                    } else {
                        tok::TYPE
                    };
                    expect = 0;
                } else if at(src, skip_space_at(src, rhs)) == b'(' {
                    // `Foo(` constructs a struct; `.length(` calls a method
                    hl = if member {
                        tok::FUNCTION_METHOD
                    } else if c.wrapping_sub(b'A') <= 25 {
                        tok::TYPE
                    } else {
                        tok::FUNCTION
                    };
                } else if member {
                    hl = tok::PROPERTY;
                } else if (c.wrapping_sub(b'A') <= 25 || c == b'_') && is_const_case(src, lhs, rhs)
                {
                    // (only `[A-Z_]` can start a constant name)
                    hl = tok::CONSTANT;
                } else if c.wrapping_sub(b'A') <= 25 {
                    hl = tok::TYPE;
                } else {
                    hl = tok::VARIABLE;
                }
                out.tok(hl, rhs);
                member = false;
                // a bracket or delimiter right after a name: its rule runs
                // here, without the gap and dispatch steps
                let next = at(src, rhs);
                if CLASS[next as usize] == class::PUNCT {
                    ptr += 1;
                    out.tok(PUNCT_HL[next as usize] as u32, ptr);
                    expect = 0;
                }
            }
            class::SLASH if at(src, ptr + 1) == b'/' => {
                let c3 = at(src, ptr + 2);
                ptr = scan::line_end(src, ptr + 2, end);
                let hl = if c3 == b'/' || c3 == b'!' {
                    tok::COMMENT_DOC
                } else {
                    tok::COMMENT
                };
                out.tok(hl, ptr);
            }
            class::SLASH if at(src, ptr + 1) == b'*' => {
                // WGSL block comments nest
                let c3 = at(src, ptr + 2);
                let hl = if c3 == b'*' || c3 == b'!' {
                    tok::COMMENT_DOC
                } else {
                    tok::COMMENT
                };
                ptr = nested_comment_end(src, ptr + 2, end);
                out.tok(hl, ptr);
            }
            class::AT if is_ident_start(at(src, ptr + 1)) => {
                // `@vertex`, `@location(0)`: the attribute name; its
                // arguments are code
                ptr = ident_end(src, ptr + 1);
                out.tok(tok::ATTRIBUTE, ptr);
                member = false;
            }
            class::DIGIT => {
                ptr = hex_number_end(src, ptr);
                out.tok(tok::NUMBER, ptr);
                member = false;
            }
            class::DOT if is_digit(at(src, ptr + 1)) => {
                ptr = hex_number_end(src, ptr);
                out.tok(tok::NUMBER, ptr);
                member = false;
            }
            class::PUNCT => {
                ptr += 1;
                out.tok(PUNCT_HL[c as usize] as u32, ptr);
                member = false;
                expect = 0;
            }
            class::DOT => {
                ptr += 1;
                out.tok(tok::PUNCTUATION_DELIMITER, ptr);
                member = true;
            }
            class::OP | class::SLASH => {
                ptr = operator_end(src, ptr, c);
                out.tok(tok::OPERATOR, ptr);
                member = false;
            }
            class::NUL if ptr >= end => break,
            _ => {
                ptr += 1;
                out.tok(tok::NONE, ptr);
                member = false;
            }
        }
    }
    out.store(inst);
}
