//! WAT sources: src/langs/java.wat src/common.wat src/scan.wat
//!
//! Native Java lexer. One pass over the input: each token is scanned and
//! colored in the same step, with the same rules, in the same order, as the
//! translated `$hlJava`. The records equal the translated lexer's records.
//!
//! The WAT tests its rules in one long chain. Each rule matches its own
//! first bytes, so this lexer dispatches on the first byte's class and, for
//! each class, tests only the rules that can match it, in the WAT's order.

#[cfg(target_arch = "aarch64")]
use core::arch::aarch64::*;

use super::Lexer;
use super::scan;
use super::tables::byteset;
use crate::Rec;
use crate::generated::Instance;
use crate::token_ids as tok;
use crate::wat_tables::JAVA_WORDS;

/// The lexer for `name`, if this module handles it.
pub(crate) fn lexer(name: &str) -> Option<Lexer> {
    match name {
        "java" => Some(highlight),
        _ => None,
    }
}

/// `$javaWords` as a perfect hash on a word's bytes. A word of up to 16
/// bytes is two little-endian integers, `lo` (bytes 0-7) and `hi` (bytes
/// 8-15), zero past its end; identifiers hold no NUL, so equal integers
/// mean equal words. Each word has its own slot, found from `lo` alone.
struct Words {
    keys: [(u64, u64); WORD_SLOTS],
    /// The word's `keyword-table.value`: its token in the low byte, the
    /// next-name capture in bits 8-9 (1 = type, 2 = namespace), and bit 10
    /// for the contextual `record`.
    values: [i32; WORD_SLOTS],
    /// For each first byte, a bit per length of the words starting with it.
    lengths: [u32; 256],
    mul: u64,
}

const WORD_SLOTS: usize = 256;

/// The longest word.
const WORD_MAX: usize = 12;

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
    let mut lengths = [0u32; 256];
    let mut i = 0;
    while i < JAVA_WORDS.len() {
        let w = JAVA_WORDS[i].word;
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
        while i < JAVA_WORDS.len() {
            let (lo, hi) = word_key(JAVA_WORDS[i].word);
            let s = word_slot(lo, mul);
            if keys[s].0 != 0 {
                mul = mul.wrapping_add(0x6a09_e667_f3bc_c909) | 1;
                attempt += 1;
                continue 'search;
            }
            keys[s] = (lo, hi);
            values[s] = JAVA_WORDS[i].value;
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

/// The value of the word `[lhs, rhs)` in `$javaWords`, or -1 when it is
/// none (`$javaWordHl`).
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
    // (`n` is at most 12, so the shift stays below 64)
    let hi = u64::from_le(hi) & ((1 << (8 * n.saturating_sub(8))) - 1);
    let s = word_slot(lo, WORDS.mul);
    if WORDS.keys[s] == (lo, hi) {
        WORDS.values[s]
    } else {
        -1
    }
}

/// Operator bytes that double: `&&`, `++`, `--`, `<<`, `>>`, `||`.
static DOUBLES: [bool; 256] = byteset(b"&+-<>|");

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
    /// `(`, `)`, `{`, or `}`: brackets that end a pending type.
    pub const BRACKET: u8 = 7;
    /// `[` or `]`: array brackets, which keep a type pending.
    pub const SQUARE: u8 = 8;
    pub const COMMA: u8 = 9;
    pub const SEMICOLON: u8 = 10;
    pub const COLON: u8 = 11;
    pub const DOT: u8 = 12;
    /// An operator byte other than `/` (`$javaIsOp`).
    pub const OP: u8 = 13;
    /// NUL: the end of the input, or one byte colored `none` inside it.
    pub const NUL: u8 = 14;
}

/// The [`class`] of each byte.
static CLASS: [u8; 256] = {
    let ops = byteset(b"!%&*+-<=>?^|~");
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
                b'(' | b')' | b'{' | b'}' => class::BRACKET,
                b'[' | b']' => class::SQUARE,
                b',' => class::COMMA,
                b';' => class::SEMICOLON,
                b':' => class::COLON,
                b'.' => class::DOT,
                _ if ops[c] => class::OP,
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
    for _ in 0..8 {
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

/// SCREAMING_CASE: at least two bytes, one uppercase letter, and only
/// `[A-Z0-9_]` (`$lexIsConstCase`).
#[inline(always)]
fn is_const_case(src: &[u8], lhs: usize, rhs: usize) -> bool {
    if rhs - lhs < 2 {
        return false;
    }
    let mut upper = false;
    for p in lhs..rhs {
        let c = at(src, p);
        if is_upper(c) {
            upper = true;
        } else if !(is_digit(c) || c == b'_') {
            return false;
        }
    }
    upper
}

/// Whether the operator `[lhs, rhs)` is made only of `<`, `>`, and `?`
/// (`$lexIsTypeGlue`).
#[inline(always)]
fn is_type_glue(src: &[u8], lhs: usize, rhs: usize) -> bool {
    (lhs..rhs).all(|p| matches!(at(src, p), b'<' | b'>' | b'?'))
}

/// The end of the number body from `p`: radix digits, separators,
/// exponents, and suffixes, with `.` only before a digit
/// (`$lexScanNumberBody`).
#[inline(always)]
fn number_body_end(src: &[u8], mut p: usize, hex: bool) -> usize {
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

/// The end of the number at `lhs`, with hexadecimal floats requiring an
/// exponent (`$lexScanHexNumber` with `$requireExponent` 1,
/// `$lexScanNumber`).
#[inline(always)]
fn number_end(src: &[u8], lhs: usize) -> usize {
    let hex = at(src, lhs) == b'0' && at(src, lhs + 1) | 32 == b'x';
    let ptr = number_body_end(src, lhs, hex);
    if hex && at(src, ptr) == b'.' {
        core::hint::cold_path();
        return hex_fraction_end(src, ptr);
    }
    ptr
}

/// The end of a hexadecimal number whose run stopped at the `.` at `ptr`:
/// the fraction counts only with a binary exponent (`$lexScanHexNumber`).
#[cold]
#[inline(never)]
fn hex_fraction_end(src: &[u8], ptr: usize) -> usize {
    let next = at(src, ptr + 1);
    if !(is_hex(next) || next | 32 == b'p') {
        return ptr;
    }
    let mut p = ptr + 1;
    while is_hex(at(src, p)) || at(src, p) == b'_' {
        p += 1;
    }
    if at(src, p) | 32 != b'p' {
        return ptr;
    }
    p += 1;
    if at(src, p) == b'+' || at(src, p) == b'-' {
        p += 1;
    }
    if !is_digit(at(src, p)) {
        return ptr;
    }
    number_body_end(src, ptr + 1, true)
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

/// A text block body from `p` through the closing `"""`, or to the end;
/// escapes get their own tokens (`$javaTextBlockBody`). Returns its end.
#[inline(never)]
fn text_block_body(src: &[u8], out: &mut Out, mut p: usize, end: usize) -> usize {
    let mut seg = p;
    loop {
        p = scan::find3(src, p, end, b'"', b'\\', b'"');
        if p >= end {
            break;
        }
        if at(src, p) == b'"' {
            if at(src, p + 1) == b'"' && at(src, p + 2) == b'"' {
                p += 3;
                out.tok(tok::STRING, p);
                return p;
            }
            p += 1;
            continue;
        }
        p = string_escape_at(src, out, seg, p, end);
        seg = p;
    }
    out.tok_from(tok::STRING, seg, p);
    p
}

/// Lex the Java input of `len` bytes at `base` (`$hlJava`).
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

    // the pending next-name capture: 1 = type, 2 = namespace
    let mut expect = 0u32;
    // right after `.` or `::`
    let mut member = false;
    // right after a type, through the glue of a generic or array type
    let mut after_type = false;

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

    // The `(`, `)`, `{`, or `}` token.
    macro_rules! bracket {
        () => {{
            ptr += 1;
            out.tok(tok::PUNCTUATION_BRACKET, ptr);
            member = false;
            after_type = false;
            expect = 0;
        }};
    }
    // The operator at `ptr`, whose first two bytes are `c` and `c2`;
    // `spaced` when whitespace precedes it.
    macro_rules! op {
        ($c:expr, $c2:expr, $spaced:expr) => {{
            let (c, c2, spaced): (u8, u8, bool) = ($c, $c2, $spaced);
            let lhs = ptr;
            ptr += 1;
            if c == b'-' && c2 == b'>' {
                ptr += 1;
            } else if c2 == b'=' || (c == c2 && DOUBLES[c as usize]) {
                // two bytes in, so the third is `c3`
                let c3 = at(src, ptr + 1);
                ptr += 1;
                if c == b'>' && (c3 == b'>' || c3 == b'=') {
                    ptr += 1;
                    if at(src, ptr) == b'=' {
                        ptr += 1;
                    }
                }
                if c == b'<' && c3 == b'=' {
                    ptr += 1;
                }
            }
            out.tok(tok::OPERATOR, ptr);
            member = false;
            // the angles of a generic - `>>` closes two - and a nullable
            // `?` keep the type pending; any other operator ends it, and
            // so do a spaced one and a `>` directly before a name: the
            // explicit type arguments of `Collections.<T>emptyList()`
            if !is_type_glue(src, lhs, ptr) || spaced || (c == b'>' && is_ident_start(at(src, ptr)))
            {
                after_type = false;
            }
        }};
    }
    // The `,` or `;` token.
    macro_rules! delimiter {
        ($semicolon:expr) => {{
            ptr += 1;
            out.tok(tok::PUNCTUATION_DELIMITER, ptr);
            member = false;
            expect = 0;
            // a comma separates the type arguments of a pending type
            if $semicolon {
                after_type = false;
            }
        }};
    }
    // The `.` or `...` token, when no digit follows.
    macro_rules! dot {
        ($c2:expr) => {{
            let c2: u8 = $c2;
            if c2 == b'.' {
                ptr += if at(src, ptr + 2) == b'.' { 3 } else { 1 };
                out.tok(tok::OPERATOR, ptr);
                member = false;
                after_type = false;
            } else {
                ptr += 1;
                out.tok(tok::PUNCTUATION_DELIMITER, ptr);
                member = true;
            }
        }};
    }

    loop {
        let gap = ptr;
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
            let mut kind = word_value(src, lhs, rhs);
            // `record` heads a declaration only before a name - `record
            // Point(` - so `record : records` and `record.key()` keep it a
            // variable that arms no type capture
            if kind > 1023 {
                let p = skip_space_at(src, rhs);
                kind = if !member && p > rhs && is_ident_start(at(src, p)) {
                    kind & 1023
                } else {
                    -1
                };
            }
            let hl;
            if kind >= 0 {
                hl = (kind & 255) as u32;
                // a bare keyword either arms the next-name capture or ends
                // it; `Foo.class` names no type
                if !member {
                    expect = (kind as u32) >> 8;
                }
                after_type = hl == tok::TYPE_BUILTIN;
            } else {
                let p = skip_space_at(src, rhs);
                if expect != 0 {
                    hl = if expect == 1 {
                        tok::TYPE
                    } else {
                        tok::NAMESPACE
                    };
                    after_type = expect == 1;
                    // a dotted package keeps its capture: `demo.app`
                    if expect == 1 || at(src, p) != b'.' {
                        expect = 0;
                    }
                } else if member {
                    // `Map.Entry` is a nested type, `obj.field` a field,
                    // `obj.call(` a method
                    if at(src, p) == b'(' {
                        hl = tok::FUNCTION_METHOD;
                        after_type = false;
                    } else {
                        after_type = is_upper(c);
                        hl = if after_type { tok::TYPE } else { tok::PROPERTY };
                    }
                } else if at(src, p) == b'(' {
                    // `Foo(` is a constructor; a lowercase name after a
                    // type is the method being declared
                    hl = if is_upper(c) {
                        tok::TYPE
                    } else if after_type {
                        tok::FUNCTION_DEFINITION
                    } else {
                        tok::FUNCTION
                    };
                    after_type = false;
                } else if (is_upper(c) || c == b'_') && is_const_case(src, lhs, rhs) {
                    // (only `[A-Z_]` can start a constant name)
                    hl = tok::CONSTANT;
                    after_type = false;
                } else {
                    after_type = is_upper(c);
                    hl = if after_type { tok::TYPE } else { tok::VARIABLE };
                }
            }
            out.tok(hl, rhs);
            member = false;
            // `(`, `)`, `.`, `,`, or `;` right after a name: its rule runs
            // here, without the gap and dispatch steps
            let next = at(src, ptr);
            match next {
                b'(' | b')' => bracket!(),
                b'.' => {
                    let c2 = at(src, ptr + 1);
                    if !is_digit(c2) {
                        dot!(c2);
                    }
                }
                b',' => delimiter!(false),
                b';' => delimiter!(true),
                b'<' | b'>' => op!(next, at(src, ptr + 1), false),
                _ => {}
            }
            continue;
        }

        // Brackets, the next most common tokens, skip the jump table too.
        if class == class::BRACKET {
            bracket!();
            continue;
        }
        let c2 = at(src, ptr + 1);
        match class {
            class::SQUARE => {
                // array brackets keep a type pending - `int[] read(`
                ptr += 1;
                out.tok(tok::PUNCTUATION_BRACKET, ptr);
                member = false;
            }
            class::SEMICOLON => delimiter!(true),
            class::COMMA => delimiter!(false),
            class::DOT if !is_digit(c2) => dot!(c2),
            class::DOT | class::DIGIT => {
                ptr = number_end(src, ptr);
                out.tok(tok::NUMBER, ptr);
                member = false;
                after_type = false;
            }
            class::DQUOTE | class::SQUOTE => {
                if c2 == b'"' && c == b'"' && at(src, ptr + 2) == b'"' {
                    // a text block opener is emitted at once, then its body
                    ptr += 3;
                    out.tok(tok::STRING, ptr);
                    ptr = with_copy!(text_block_body(ptr, end));
                } else {
                    // a one-line literal without escapes is one token
                    let close = scan::string_special(src, ptr + 1, end, c);
                    if at(src, close) == c {
                        ptr = close + 1;
                        out.tok(tok::STRING, ptr);
                    } else {
                        ptr = with_copy!(string_rest(lhs, close, end));
                    }
                }
                member = false;
                after_type = false;
            }
            class::SLASH if c2 == b'/' => {
                let doc = at(src, ptr + 2) == b'/';
                ptr = scan::line_end(src, ptr + 2, end);
                out.tok(if doc { tok::COMMENT_DOC } else { tok::COMMENT }, ptr);
            }
            class::SLASH if c2 == b'*' => {
                // `/**` opens Javadoc, but `/**/` is an empty plain comment
                let doc = at(src, ptr + 2) == b'*' && at(src, ptr + 3) != b'/';
                ptr = scan::block_comment_end(src, ptr + 2, end);
                out.tok(if doc { tok::COMMENT_DOC } else { tok::COMMENT }, ptr);
            }
            class::COLON => {
                ptr += if c2 == b':' { 2 } else { 1 };
                out.tok(tok::PUNCTUATION_DELIMITER, ptr);
                // `Type::method` references a member
                member = c2 == b':';
                after_type = false;
                // a stale capture never crosses `:` onto the name after it
                expect = 0;
            }
            class::AT if is_ident_start(c2) => {
                // annotations, including `@interface`
                ptr = ident_end(src, ptr + 1);
                out.tok(tok::ATTRIBUTE, ptr);
                member = false;
            }
            class::OP | class::SLASH => op!(c, c2, gap != lhs),
            class::NUL if ptr >= end => break,
            _ => {
                ptr += 1;
                out.tok(tok::NONE, ptr);
                member = false;
                after_type = false;
            }
        }
    }
    out.store(inst);
}
