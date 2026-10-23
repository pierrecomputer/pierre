//! WAT sources: src/langs/solidity.wat src/common.wat src/scan.wat
//!
//! Native Solidity lexer. One pass over the input: each token is scanned
//! and colored in the same step, with the same rules, in the same order, as
//! the translated `$hlSolidity`. The records equal the translated lexer's
//! records.
//!
//! The WAT tests its rules in one long chain. Each rule matches its own
//! first bytes, so this lexer dispatches on the first byte's class and, for
//! each class, tests only the rules that can match it, in the WAT's order.

#[cfg(target_arch = "aarch64")]
use core::arch::aarch64::*;

use super::Lexer;
use super::scan;
use crate::Rec;
use crate::generated::Instance;
use crate::token_ids as tok;
use crate::wat_tables::SOLIDITY_WORDS;

/// The lexer for `name`, if this module handles it.
pub(crate) fn lexer(name: &str) -> Option<Lexer> {
    match name {
        "solidity" => Some(highlight),
        _ => None,
    }
}

/// `$solidityWords` and the two words `$hlSolidity` matches outside the
/// table, `constant` and `require`, with the same result as table entries,
/// as a perfect hash on a word's bytes. A word of up to 16 bytes is two
/// little-endian integers, `lo` (bytes 0-7) and `hi` (bytes 8-15), zero
/// past its end; identifiers hold no NUL, so equal integers mean equal
/// words. Each word has its own slot.
struct Words {
    keys: [(u64, u64); WORD_SLOTS],
    /// The word's `keyword-table.value`: its token in the low byte, the
    /// next-name capture in the high byte (1 = function, 2 = type).
    values: [i32; WORD_SLOTS],
    /// For each first byte, a bit per length of the words starting with it.
    lengths: [u32; 256],
    mul: u64,
}

const WORD_SLOTS: usize = 1024;

/// The longest word.
const WORD_MAX: usize = 15;

/// The words `$hlSolidity` matches outside the table.
const EXTRA_WORDS: [(&[u8], i32); 2] = [
    (b"constant", tok::KEYWORD as i32),
    (b"require", tok::FUNCTION as i32),
];

/// The slot of the word whose integers are `lo` and `hi`. Some words share
/// their first 8 bytes (`calldata`, `calldataload`, `calldatacopy`), so
/// `hi` counts too.
#[inline(always)]
const fn word_slot(lo: u64, hi: u64, mul: u64) -> usize {
    let h = lo ^ hi.rotate_left(29);
    (h.wrapping_mul(mul) >> (64 - WORD_SLOTS.trailing_zeros())) as usize
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
    let n = SOLIDITY_WORDS.len() + EXTRA_WORDS.len();
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
            let s = word_slot(lo, hi, mul);
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
    if i < SOLIDITY_WORDS.len() {
        (SOLIDITY_WORDS[i].word, SOLIDITY_WORDS[i].value)
    } else {
        EXTRA_WORDS[i - SOLIDITY_WORDS.len()]
    }
}

/// The value of the word `[lhs, rhs)`, or -1 when it is none
/// (`keyword-table.value $solidityWords` and the words `$hlSolidity` matches outside it).
#[inline(always)]
fn word_value(src: &[u8], lhs: usize, rhs: usize) -> i32 {
    let n = rhs - lhs;
    if n > WORD_MAX || WORDS.lengths[at(src, lhs) as usize] >> n & 1 == 0 {
        return -1;
    }
    // SAFETY: `lhs` lies inside the input, so 16 bytes from it lie inside
    // the slack.
    let (lo, hi) = unsafe {
        let p = src.as_ptr().add(lhs);
        (
            p.cast::<u64>().read_unaligned(),
            p.add(8).cast::<u64>().read_unaligned(),
        )
    };
    let lo = u64::from_le(lo) & if n >= 8 { u64::MAX } else { (1 << (8 * n)) - 1 };
    // (`n` is at most 15, so the shift stays below 64)
    let hi = u64::from_le(hi) & ((1 << (8 * n.saturating_sub(8))) - 1);
    let s = word_slot(lo, hi, WORDS.mul);
    if WORDS.keys[s] == (lo, hi) {
        WORDS.values[s]
    } else {
        -1
    }
}

/// Byte classes for the main dispatch.
mod class {
    /// An identifier start: a letter, `_`, `$`, or any byte from 0x80.
    pub const IDENT: u8 = 0;
    pub const DIGIT: u8 = 1;
    pub const SLASH: u8 = 2;
    /// `"` or `'`.
    pub const QUOTE: u8 = 3;
    pub const DOT: u8 = 4;
    /// NUL: the end of the input, or one byte colored `none` inside it.
    pub const NUL: u8 = 5;
    /// `(`, `)`, `[`, `]`, `{`, or `}`. This and the classes after it are
    /// always one-character tokens.
    pub const BRACKET: u8 = 6;
    /// `,`, `;`, or `:`.
    pub const DELIMITER: u8 = 7;
    /// An operator byte other than `/`.
    pub const OP: u8 = 8;
    /// Anything else: one character colored `none`.
    pub const OTHER: u8 = 9;
}

/// The [`class`] of each byte.
static CLASS: [u8; 256] = {
    let ops = super::tables::byteset(b"+-*%=!<>&|^~?");
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
                b'"' | b'\'' => class::QUOTE,
                b'(' | b')' | b'[' | b']' | b'{' | b'}' => class::BRACKET,
                b'.' => class::DOT,
                b',' | b';' | b':' => class::DELIMITER,
                _ if ops[c] => class::OP,
                _ => class::OTHER,
            }
        };
        c += 1;
    }
    t
};

/// The color of a one-character token by its byte: a bracket, a
/// delimiter, an operator, or none (`$hlSolidity`'s last rule).
static PUNCT_HL: [u8; 256] = {
    let brackets = super::tables::byteset(b"()[]{}");
    let delimiters = super::tables::byteset(b".,;:");
    let ops = super::tables::byteset(b"+-*/%=!<>&|^~?");
    let mut t = [tok::NONE as u8; 256];
    let mut c = 0;
    while c < 256 {
        if brackets[c] {
            t[c] = tok::PUNCTUATION_BRACKET as u8;
        } else if delimiters[c] {
            t[c] = tok::PUNCTUATION_DELIMITER as u8;
        } else if ops[c] {
            t[c] = tok::OPERATOR as u8;
        }
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

/// The byte at `i`. Every caller reads at most 16 bytes past the input
/// end, which the 96-byte input slack covers. The byte at the input end is
/// NUL, which matches none of the bytes a lookahead tests, so a lookahead
/// one byte past a token needs no bounds check.
#[inline(always)]
fn at(src: &[u8], i: usize) -> u8 {
    debug_assert!(i < src.len());
    // SAFETY: `i` lies inside the input or its slack (see above).
    unsafe { *src.get_unchecked(i) }
}

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

/// Token records written through a moving pointer into `inst.ext.recs`,
/// the way the translated `$emitTok` and `$emitGap` write them: a token
/// extends the last record when its color matches, and whitespace extends
/// the last record whatever its color. The vector has room for one record
/// per input byte and every record covers at least one byte, so running
/// out of room means a lexer bug, which traps.
#[derive(Clone, Copy)]
struct Out {
    cur: *mut Rec,
    limit: *mut Rec,
    /// Token of the last record, or `u32::MAX` when there is none.
    last: u32,
}

impl Out {
    fn load(inst: &mut Instance) -> Self {
        let v = &mut inst.ext.recs;
        let ptr = v.as_mut_ptr();
        Out {
            // SAFETY: `len` records are written; `capacity` is one past
            // the allocation.
            cur: unsafe { ptr.add(v.len()) },
            limit: unsafe { ptr.add(v.capacity()) },
            last: v.last().map_or(u32::MAX, |r| r.token),
        }
    }

    fn store(self, inst: &mut Instance) {
        let v = &mut inst.ext.recs;
        // SAFETY: the records before `cur` are written, within the
        // capacity.
        unsafe { v.set_len(self.cur.offset_from(v.as_ptr()) as usize) };
    }

    /// Append a non-empty token ending at `end` (`$emitTok`).
    #[inline(always)]
    fn tok(&mut self, hl: u32, end: usize) {
        // SAFETY: `cur` stays within the vector's capacity: a merge steps
        // back over the last record, and the trap stops a write at the
        // limit.
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

    /// The token `[lhs, rhs)` when it is not empty (`$emitTok`).
    #[inline(always)]
    fn tok_from(&mut self, hl: u32, lhs: usize, rhs: usize) {
        if lhs < rhs {
            self.tok(hl, rhs);
        }
    }

    /// Whitespace up to `end` extends the last record (`$emitGap`).
    ///
    /// # Safety
    ///
    /// A record must exist.
    #[inline(always)]
    unsafe fn extend(&mut self, end: usize) {
        // SAFETY: the caller guarantees the record before `cur`.
        unsafe { (*self.cur.sub(1)).end = end as u32 };
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
    for _ in 0..12 {
        if !IDENT_CONT[at(src, p) as usize] {
            return p;
        }
        p += 1;
    }
    #[cfg(target_arch = "aarch64")]
    // SAFETY: each 16-byte load starts at or before the NUL after the
    // input, inside the slack.
    unsafe {
        loop {
            let v = vld1q_u8(src.as_ptr().add(p));
            let alpha = vcleq_u8(
                vsubq_u8(vorrq_u8(v, vdupq_n_u8(0x20)), vdupq_n_u8(b'a')),
                vdupq_n_u8(25),
            );
            let digit = vcleq_u8(vsubq_u8(v, vdupq_n_u8(b'0')), vdupq_n_u8(9));
            let extra = vorrq_u8(vceqq_u8(v, vdupq_n_u8(b'_')), vceqq_u8(v, vdupq_n_u8(b'$')));
            let high = vcltzq_s8(vreinterpretq_s8_u8(v));
            let ok = vorrq_u8(vorrq_u8(alpha, digit), vorrq_u8(extra, high));
            let k = scan::first_lane(vmvnq_u8(ok));
            if k < 16 {
                return p + k;
            }
            p += 16;
        }
    }
    #[cfg(not(target_arch = "aarch64"))]
    {
        while is_ident_continue(at(src, p)) {
            p += 1;
        }
        p
    }
}

/// Skip spaces and tabs from `p` on the current line (`$lexSkipSpaceAt`).
#[inline(always)]
fn skip_space_at(src: &[u8], mut p: usize) -> usize {
    while at(src, p) == b' ' || at(src, p) == b'\t' {
        p += 1;
    }
    p
}

/// The end of the escape at backslash `p`: one character, kept whole when
/// it is UTF-8, and CRLF as one (`$lexEscapeEnd`).
#[inline(always)]
fn escape_end(src: &[u8], p: usize, end: usize) -> usize {
    let mut e = scan::utf8_span_end(src, p + 2, end);
    if e == p + 2 && at(src, p + 1) == b'\r' && e < end && at(src, e) == b'\n' {
        e += 1;
    }
    e
}

/// Emit the string bytes `[seg, p)`, then the escape at backslash `p`.
/// Returns the escape's end (`$stringEscapeAt`).
#[inline(always)]
fn string_escape_at(src: &[u8], out: &mut Out, seg: usize, p: usize, end: usize) -> usize {
    out.tok_from(tok::STRING, seg, p);
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
fn string_rest(src: &[u8], out: &mut Out, mut seg: usize, mut p: usize, end: usize) -> usize {
    let quote = at(src, seg);
    loop {
        if p >= end {
            break;
        }
        let c = at(src, p);
        if c == quote {
            p += 1;
            break;
        }
        if c != b'\\' {
            break;
        }
        p = string_escape_at(src, out, seg, p, end);
        seg = p;
        p = scan::string_special(src, p, end, quote);
    }
    out.tok_from(tok::STRING, seg, p);
    p
}

/// The end of the number at `lhs`: radix digits, separators, exponents,
/// and suffixes, with `.` only before a digit (`$lexScanNumber`,
/// `$lexScanNumberBody`).
#[inline(always)]
fn number_end(src: &[u8], lhs: usize) -> usize {
    let hex = at(src, lhs) == b'0' && at(src, lhs + 1) | 32 == b'x';
    let mut p = lhs;
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

/// The quoted literal at `lhs`, with `quote` its opening byte: escapes get
/// their own tokens, and a raw line break ends it unterminated. Returns its
/// end (`$lexString` with `$multiline` 0, `$lexStringBody`).
#[inline(always)]
fn string(src: &[u8], out: &mut Out, lhs: usize, end: usize) -> usize {
    let quote = at(src, lhs);
    // a one-line literal without escapes is one token
    let close = scan::string_special(src, lhs + 1, end, quote);
    if at(src, close) == quote {
        out.tok(tok::STRING, close + 1);
        return close + 1;
    }
    string_rest(src, out, lhs, close, end)
}

/// The first `n` bytes at `p` as a little-endian integer, for comparing
/// short words. Reads 8 bytes, which the input slack allows.
#[inline(always)]
fn word_at(src: &[u8], p: usize, n: u32) -> u64 {
    debug_assert!(p + 8 <= src.len());
    // SAFETY: `p` lies before the input end, so `p + 8` lies inside the
    // slack.
    let w = unsafe { src.as_ptr().add(p).cast::<u64>().read_unaligned() };
    u64::from_le(w) & (u64::MAX >> (64 - 8 * n))
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

/// Whether the name `[lhs, rhs)` is a sized integer or byte type: `int` or
/// `uint` and a width of 8 to 256 in steps of eight, or `bytes` and a size
/// of 1 to 32, without a leading zero (`$hlSolidity`).
#[inline(always)]
fn is_sized_type(src: &[u8], lhs: usize, rhs: usize) -> bool {
    let n = rhs - lhs;
    let digits = if n > 5 && word_at(src, lhs, 5) == word(b"bytes") {
        5
    } else if n > 4 && word_at(src, lhs, 4) == word(b"uint") {
        4
    } else if n > 3 && word_at(src, lhs, 3) == word(b"int") {
        3
    } else {
        return false;
    };
    let mut p = lhs + digits;
    if rhs - p > 3 || at(src, p) == b'0' {
        return false;
    }
    let mut v = 0u32;
    while p < rhs && is_digit(at(src, p)) {
        v = v * 10 + (at(src, p) - b'0') as u32;
        p += 1;
    }
    p == rhs
        && if digits == 5 {
            v <= 32
        } else {
            v <= 256 && v & 7 == 0
        }
}

/// Lex the Solidity input of `len` bytes at `base` (`$hlSolidity`).
fn highlight(inst: &mut Instance, base: usize, len: usize) {
    let mem_ptr = inst.mem.bytes().as_ptr();
    // SAFETY: `base..base + len + 96` lies inside lexer memory, which is not
    // reallocated while this lexer runs: it calls no translated code.
    let src: &[u8] = unsafe { core::slice::from_raw_parts(mem_ptr.add(base), len + 96) };
    let end = len;
    let mut out = Out::load(inst);

    // `$lexEmitLeadingContinuation`
    let mut ptr = scan::utf8_span_end(src, 0, end);
    if ptr > 0 {
        out.tok(tok::NONE, ptr);
    }
    // Leading whitespace; every later gap follows a token's record.
    let first = whitespace_end(src, ptr);
    if first > ptr {
        if ptr == 0 {
            out.tok(tok::NONE, first);
        } else {
            // SAFETY: the leading continuation wrote a record.
            unsafe { out.extend(first) };
        }
    }
    ptr = first;

    // the pending next-name capture: 1 = function, 2 = type; it survives
    // comments and line breaks
    let mut expect = 0u32;
    // right after `.`
    let mut member = false;

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

    loop {
        let mut c = at(src, ptr);
        if c == b' ' && !is_space(at(src, ptr + 1)) {
            ptr += 1;
            // SAFETY: a record precedes every gap after the first token.
            unsafe { out.extend(ptr) };
            c = at(src, ptr);
        } else if is_space(c) {
            ptr = whitespace_end(src, ptr + 1);
            // SAFETY: as above.
            unsafe { out.extend(ptr) };
            c = at(src, ptr);
        }
        let lhs = ptr;
        let class = CLASS[c as usize];

        // Names, the most common tokens, skip the jump table.
        if class == class::IDENT {
            let rhs = ident_end(src, ptr + 1);
            ptr = rhs;
            let n = rhs - lhs;
            // prefixes belong to the following string, including Unicode
            // text
            let q = at(src, rhs);
            if (q == b'"' || q == b'\'')
                && ((n == 3 && word_at(src, lhs, 3) == word(b"hex"))
                    || (n == 7 && word_at(src, lhs, 7) == word(b"unicode")))
            {
                out.tok(tok::STRING, rhs);
                ptr = with_copy!(string(rhs, end));
                continue;
            }
            let hl;
            if member {
                // (a member name is never a keyword or sized type)
                hl = if at(src, skip_space_at(src, rhs)) == b'(' {
                    tok::FUNCTION_METHOD
                } else {
                    tok::PROPERTY
                };
            } else {
                let mut kind = word_value(src, lhs, rhs);
                // sized integer and byte types avoid dozens of keyword
                // entries
                // (no table word is one)
                if kind < 0 && matches!(c, b'i' | b'u' | b'b') && is_sized_type(src, lhs, rhs) {
                    kind = tok::TYPE_BUILTIN as i32;
                }
                if kind >= 0 {
                    hl = (kind & 255) as u32;
                    if kind >> 8 != 0 {
                        expect = kind as u32 >> 8;
                    }
                } else if expect != 0 {
                    hl = if expect == 1 {
                        tok::FUNCTION_DEFINITION
                    } else {
                        tok::TYPE
                    };
                    expect = 0;
                } else if at(src, skip_space_at(src, rhs)) == b'(' {
                    hl = tok::FUNCTION;
                } else if is_upper(c) {
                    hl = tok::TYPE;
                } else {
                    hl = tok::VARIABLE;
                }
            }
            out.tok(hl, rhs);
            member = false;
            // `(` or `)` right after a name: its rule runs here, without the
            // gap and dispatch steps
            if matches!(at(src, ptr), b'(' | b')') {
                ptr += 1;
                if at(src, ptr) & 0xc0 == 0x80 {
                    ptr = scan::utf8_span_end(src, ptr, end);
                }
                out.tok(tok::PUNCTUATION_BRACKET, ptr);
                expect = 0;
                // and the `;` after a `)`: `f(x);`
                if at(src, ptr) == b';' && at(src, ptr - 1) == b')' {
                    ptr += 1;
                    if at(src, ptr) & 0xc0 == 0x80 {
                        ptr = scan::utf8_span_end(src, ptr, end);
                    }
                    out.tok(tok::PUNCTUATION_DELIMITER, ptr);
                }
            }
            continue;
        }

        // One-character tokens skip the jump table too.
        if class >= class::BRACKET {
            ptr += 1;
            if at(src, ptr) & 0xc0 == 0x80 {
                ptr = scan::utf8_span_end(src, ptr, end);
            }
            if class == class::BRACKET {
                expect = 0;
            }
            member = false;
            out.tok(PUNCT_HL[c as usize] as u32, ptr);
            continue;
        }
        let c2 = at(src, ptr + 1);
        match class {
            class::SLASH if c2 == b'/' => {
                let doc = at(src, ptr + 2) == b'/';
                ptr = scan::line_end(src, ptr + 2, end);
                out.tok(if doc { tok::COMMENT_DOC } else { tok::COMMENT }, ptr);
            }
            class::SLASH if c2 == b'*' => {
                let doc = at(src, ptr + 2) == b'*';
                ptr = scan::block_comment_end(src, ptr + 2, end);
                out.tok(if doc { tok::COMMENT_DOC } else { tok::COMMENT }, ptr);
            }
            class::QUOTE => ptr = with_copy!(string(ptr, end)),
            class::DOT | class::DIGIT if class == class::DIGIT || is_digit(c2) => {
                // (a lone digit - `0`, `1` - ends at once)
                ptr = if class == class::DIGIT && !IDENT_CONT[c2 as usize] && c2 != b'.' {
                    ptr + 1
                } else {
                    number_end(src, ptr)
                };
                out.tok(tok::NUMBER, ptr);
            }
            class::NUL if ptr >= end => break,
            _ => {
                // one character: a bracket, delimiter, operator, or other
                // (with the UTF-8 continuation bytes after it; the NUL at the
                // end is none)
                ptr += 1;
                if at(src, ptr) & 0xc0 == 0x80 {
                    ptr = scan::utf8_span_end(src, ptr, end);
                }
                if class == class::BRACKET {
                    expect = 0;
                }
                member = c == b'.';
                out.tok(PUNCT_HL[c as usize] as u32, ptr);
            }
        }
    }
    out.store(inst);
}
