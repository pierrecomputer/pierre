//! WAT sources: src/langs/csharp.wat src/common.wat src/scan.wat
//!
//! Native C# lexer. One pass over the input: each token is scanned and
//! colored in the same step, with the same rules, in the same order, as the
//! translated `$hlCsharp`. The records equal the translated lexer's records.
//!
//! The WAT tests its rules in one long chain. Each rule matches its own
//! first bytes, so this lexer dispatches on the first byte's class and, for
//! each class, tests only the rules that can match it, in the WAT's order.
//! An open string - a literal's body, or the format text after `:` in an
//! interpolation - is scanned as soon as it opens; the WAT scans it at the
//! top of its loop, which comes to the same thing.

#[cfg(target_arch = "aarch64")]
use core::arch::aarch64::*;

use super::Lexer;
use super::scan;
use super::tables::byteset;
use crate::Rec;
use crate::generated::Instance;
use crate::token_ids as tok;
use crate::wat_tables::CS_WORDS;

/// The lexer for `name`, if this module handles it.
pub(crate) fn lexer(name: &str) -> Option<Lexer> {
    match name {
        "csharp" => Some(highlight),
        _ => None,
    }
}

/// `$csWords` and the word `$csWordHl` matches outside the table, `where`,
/// with the same result as a table entry, as a perfect hash on a word's
/// bytes. A word of up to 16 bytes is two little-endian integers, `lo`
/// (bytes 0-7) and `hi` (bytes 8-15), zero past its end; identifiers hold
/// no NUL, so equal integers mean equal words. Each word has its own slot,
/// found from `lo` alone.
struct Words {
    keys: [(u64, u64); WORD_SLOTS],
    /// The word's `keyword-table.value`: its token in the low byte, the
    /// next-name capture in bits 8-9 (1 = type, 2 = namespace), and in bits
    /// 10-13 a contextual word: 1024 a query clause, 2048 `from`, 4096 an
    /// accessor, 8192 a declaration head.
    values: [i32; WORD_SLOTS],
    /// For each first byte, a bit per length of the words starting with it.
    lengths: [u32; 256],
    mul: u64,
}

const WORD_SLOTS: usize = 1024;

/// The longest word.
const WORD_MAX: usize = 12;

/// The word `$csWordHl` matches outside the table.
const EXTRA_WORDS: [(&[u8], i32); 1] = [(b"where", tok::KEYWORD_DECLARATION as i32)];

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
    let n = CS_WORDS.len() + EXTRA_WORDS.len();
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
    if i < CS_WORDS.len() {
        (CS_WORDS[i].word, CS_WORDS[i].value)
    } else {
        EXTRA_WORDS[i - CS_WORDS.len()]
    }
}

/// The value of the word `[lhs, rhs)`, or -1 when it is none
/// (`$csWordHl`).
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

/// Operator bytes (`$csIsOp`).
static OPS: [bool; 256] = byteset(b"!%&*+-/<=>?^|~");

/// Operator bytes that double: `&&`, `++`, `--`, `<<`, `>>`, `??`, `||`.
static DOUBLES: [bool; 256] = byteset(b"&+-<>?|");

/// Byte classes for the main dispatch.
mod class {
    /// An identifier start: a letter, `_`, or any byte from 0x80.
    pub const IDENT: u8 = 0;
    /// Anything else: one byte colored `none`.
    pub const OTHER: u8 = 1;
    pub const DIGIT: u8 = 2;
    pub const SLASH: u8 = 3;
    pub const HASH: u8 = 4;
    pub const DQUOTE: u8 = 5;
    pub const SQUOTE: u8 = 6;
    pub const AT: u8 = 7;
    /// `(`, `)`, `[`, `]`, `{`, or `}`.
    pub const BRACKET: u8 = 8;
    /// `,` or `;`.
    pub const DELIMITER: u8 = 9;
    pub const COLON: u8 = 10;
    pub const DOT: u8 = 11;
    /// `?` or `-`: `?.` and `->` are member access, else operators.
    pub const ARROW: u8 = 12;
    /// Any other operator byte (`$csIsOp`).
    pub const OP: u8 = 13;
    /// NUL: the end of the input, or one byte colored `none` inside it.
    pub const NUL: u8 = 14;
    /// `$`: opens an interpolated string, or starts a name.
    pub const DOLLAR: u8 = 15;
}

/// The [`class`] of each byte.
static CLASS: [u8; 256] = {
    let mut t = [class::OTHER; 256];
    let mut c = 0;
    while c < 256 {
        let b = c as u8;
        t[c] = if b == b'$' {
            class::DOLLAR
        } else if is_ident_start(b) {
            class::IDENT
        } else if is_digit(b) {
            class::DIGIT
        } else {
            match b {
                0 => class::NUL,
                b'/' => class::SLASH,
                b'#' => class::HASH,
                b'"' => class::DQUOTE,
                b'\'' => class::SQUOTE,
                b'@' => class::AT,
                b'(' | b')' | b'[' | b']' | b'{' | b'}' => class::BRACKET,
                b',' | b';' => class::DELIMITER,
                b':' => class::COLON,
                b'.' => class::DOT,
                b'?' | b'-' => class::ARROW,
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

/// Whether the operator `[lhs, rhs)` is made only of `<`, `>`, and `?`
/// (`$lexIsTypeGlue`).
#[inline(always)]
fn is_type_glue(src: &[u8], lhs: usize, rhs: usize) -> bool {
    (lhs..rhs).all(|p| matches!(at(src, p), b'<' | b'>' | b'?'))
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

/// The first byte from `p` that is one of `set`, or `end`.
#[inline(always)]
fn find_any(src: &[u8], mut p: usize, end: usize, set: [u8; 6]) -> usize {
    while p < end {
        #[cfg(target_arch = "aarch64")]
        // SAFETY: `p` lies before the input end, so 16 bytes from it lie
        // inside the slack.
        let k = unsafe {
            let w = vld1q_u8(src.as_ptr().add(p));
            let hit = vorrq_u8(
                vorrq_u8(
                    vorrq_u8(
                        vceqq_u8(w, vdupq_n_u8(set[0])),
                        vceqq_u8(w, vdupq_n_u8(set[1])),
                    ),
                    vorrq_u8(
                        vceqq_u8(w, vdupq_n_u8(set[2])),
                        vceqq_u8(w, vdupq_n_u8(set[3])),
                    ),
                ),
                vorrq_u8(
                    vceqq_u8(w, vdupq_n_u8(set[4])),
                    vceqq_u8(w, vdupq_n_u8(set[5])),
                ),
            );
            scan::first_lane(hit)
        };
        #[cfg(not(target_arch = "aarch64"))]
        let k = (0..16)
            .find(|&i| set.contains(&at(src, p + i)))
            .unwrap_or(16);
        if k < 16 {
            return (p + k).min(end);
        }
        p += 16;
    }
    p.min(end)
}

/// String kinds (`$strKind & 255`).
const REGULAR: u32 = 1;
const VERBATIM: u32 = 2;
const RAW: u32 = 3;
/// The format text after `:` in an interpolation of a regular literal;
/// `VERBATIM + 3` and `RAW + 3` are those of the other kinds.
const FORMAT: u32 = 4;

/// The end of a string body scan (`$csStringBody`'s status).
#[derive(Clone, Copy, PartialEq, Eq)]
enum Status {
    /// At the end, or a regular literal's raw line break.
    Open,
    /// Past the closing quote, or the `}` that ends format text.
    Closed,
    /// Past a `{` that opens an interpolation.
    Interp,
}

/// Scan a string from `p` whose bytes from `p` on are not yet emitted.
/// `kind` is [`REGULAR`], [`VERBATIM`], or [`RAW`], or their format text
/// ([`FORMAT`] and up) ending at `}`. `interp` enables `{` interpolation
/// and literal `{{`/`}}` pairs, except inside an interpolation (`nested`).
/// Emits the body, escapes, and openers as `punctuation.special`
/// (`$csStringBody`).
#[inline(never)]
fn string_body(
    src: &[u8],
    out: &mut Out,
    mut p: usize,
    end: usize,
    kind: u32,
    interp: bool,
    nested: bool,
) -> (usize, Status) {
    let mut seg = p;
    let interp = interp && !nested;
    let escapes = kind == REGULAR || kind == FORMAT;
    // every byte before the next stop byte is plain body
    let q = if kind >= FORMAT { b'}' } else { b'"' };
    let (e, n) = if escapes { (b'\\', b'\n') } else { (q, q) };
    let r = if escapes { b'\r' } else { q };
    let (b0, b1) = if interp && kind < FORMAT {
        (b'{', b'}')
    } else {
        (q, q)
    };
    let set = [q, e, n, r, b0, b1];
    loop {
        p = find_any(src, p, end, set);
        if p >= end {
            break;
        }
        let c = at(src, p);
        if kind >= FORMAT && c == b'}' {
            out.tok_from(tok::STRING, seg, p);
            p += 1;
            out.tok(tok::PUNCTUATION_SPECIAL, p);
            return (p, Status::Closed);
        }
        if c == b'"' {
            if kind == VERBATIM && at(src, p + 1) == b'"' {
                // a doubled quote is a verbatim escape
                p += 2;
                continue;
            }
            if kind == RAW && !(at(src, p + 1) == b'"' && at(src, p + 2) == b'"') {
                p += 1;
                continue;
            }
            p += if kind == RAW { 3 } else { 1 };
            out.tok_from(tok::STRING, seg, p);
            return (p, Status::Closed);
        }
        // a raw line break ends a regular literal, unconsumed
        if c == b'\n' || c == b'\r' {
            break;
        }
        if c == b'\\' {
            out.tok_from(tok::STRING, seg, p);
            p = escape_end(src, p, end);
            out.tok(tok::STRING_ESCAPE, p);
            seg = p;
            continue;
        }
        // a brace: doubled ones are literal, a lone `{` opens an
        // interpolation, and a stray `}` is left as body
        if at(src, p + 1) == c {
            p += 2;
            continue;
        }
        if c == b'{' {
            out.tok_from(tok::STRING, seg, p);
            p += 1;
            out.tok(tok::PUNCTUATION_SPECIAL, p);
            return (p, Status::Interp);
        }
        p += 1;
    }
    out.tok_from(tok::STRING, seg, p);
    (p, Status::Open)
}

/// The string literal prefix at `p`: bit 0 for `$`, bit 1 for `@`, in
/// either order, the prefix length in bits 4-5, and bit 8 set for any
/// literal; zero when no quote follows (`$csStringPrefix`).
#[inline(always)]
fn string_prefix(src: &[u8], p: usize) -> u32 {
    let mut flags = 0;
    let mut n = 0;
    while n < 2 {
        match at(src, p + n) {
            b'$' => flags |= 1,
            b'@' => flags |= 2,
            _ => break,
        }
        n += 1;
    }
    if at(src, p + n) != b'"' {
        return 0;
    }
    256 | flags | (n as u32) << 4
}

/// A contextual word's kind when it is a keyword where it stands, else -1
/// so it lexes as the name it is. `p` is the next non-blank byte on the
/// line, `query` whether a query is open, and `head` whether this is a
/// member position (`$csContextual`).
#[inline(never)]
fn contextual(src: &[u8], end: usize, kind: i32, p: usize, query: bool, head: bool) -> i32 {
    let c = at(src, p);
    if kind & 1024 != 0 {
        return if query { kind } else { -1 };
    }
    if kind & 2048 != 0 {
        return if is_ident_start(c) { kind } else { -1 };
    }
    if kind & 4096 != 0 {
        if head
            && (matches!(c, 0 | b';' | b'{' | b'\n' | b'\r')
                || (c == b'=' && at(src, p + 1) == b'>'))
        {
            return kind;
        }
        return -1;
    }
    if !is_ident_start(c) {
        return -1;
    }
    if !(p + 2 < end && is_ident_continue(at(src, p + 2))) {
        let w = [c, at(src, p + 1)];
        if w == *b"in" || w == *b"is" || w == *b"as" {
            return -1;
        }
    }
    // (a NUL at the input end stops `with` short of it)
    let with = [c, at(src, p + 1), at(src, p + 2), at(src, p + 3)] == *b"with"
        && !(p + 4 < end && is_ident_continue(at(src, p + 4)));
    if with { -1 } else { kind }
}

/// Whether the whitespace `[p, stop)` holds a CR or LF (`$lexGapHasBreak`).
#[inline(always)]
fn gap_has_break(src: &[u8], p: usize, stop: usize) -> bool {
    (p..stop).any(|i| matches!(at(src, i), b'\n' | b'\r'))
}

/// Lex the C# input of `len` bytes at `base` (`$hlCsharp`).
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
    // Leading whitespace; every later gap follows a token's record. The
    // line-head state already holds at the input start.
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

    // the pending next-name capture: 1 = type, 2 = namespace, 3 = the
    // namespaces of `using static` up to its type
    let mut expect = 0u32;
    // right after `.`, `?.`, `->`, or `::`
    let mut member = false;
    // right after a type, through the glue of a generic, nullable, or array
    // type
    let mut after_type = false;
    // inside a `[…]` opened at a line start
    let mut attr = false;
    // no token yet on this line
    let mut line_head = true;
    // bit 0: a member or accessor may follow; the bits above count the
    // braces of an open query from 1
    let mut ctx = 0u32;
    // bit 0 of `ctx` before the current token
    let mut was_head;
    // the open string (`$strKind`): its kind, and bit 8 for interpolation
    let mut str_kind: u32;
    // brace depth inside an interpolation, 0 outside one
    let mut interp = 0u32;
    // the string an interpolation returns to
    let mut interp_kind = 0u32;
    // parentheses and brackets open inside an interpolation
    let mut interp_depth = 0u32;

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
    // Scan the open string from `ptr` until it closes, opens an
    // interpolation, or reaches the end (the `$strKind` step at the top of
    // `$hlCsharp`'s loop).
    macro_rules! open_string {
        () => {{
            while str_kind != 0 && ptr < end {
                let kind = str_kind & 255;
                let (p, status) =
                    with_copy!(string_body(ptr, end, kind, str_kind >> 8 != 0, interp != 0));
                ptr = p;
                if (FORMAT..256).contains(&str_kind) {
                    if status == Status::Closed {
                        str_kind = interp_kind;
                        interp = 0;
                        interp_kind = 0;
                    }
                    if str_kind == FORMAT && status == Status::Open {
                        str_kind = 0;
                        interp = 0;
                    }
                } else if status == Status::Interp {
                    // `{` opened an interpolation: code until the matching
                    // `}`
                    interp_kind = str_kind;
                    interp = 1;
                    interp_depth = 0;
                    str_kind = 0;
                } else if status == Status::Closed || kind == REGULAR {
                    // (an open verbatim or raw body ends only at the end)
                    str_kind = 0;
                }
            }
        }};
    }
    // The start of every token but comments and directives: the line head
    // and the member position pass to this token.
    macro_rules! token_start {
        () => {{
            line_head = false;
            was_head = ctx & 1 != 0;
            ctx &= !1;
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
            if c == b'\n' || c == b'\r' || gap_has_break(src, gap + 1, ptr) {
                line_head = true;
                attr = false;
            }
            // SAFETY: as above.
            unsafe { out.extend(ptr) };
            c = at(src, ptr);
        }
        let lhs = ptr;
        let class = CLASS[c as usize];
        let c2 = at(src, ptr + 1);

        // Names, the most common tokens, skip the dispatch.
        if class != class::IDENT {
            let mut name = false;
            match class {
                class::SLASH if c2 == b'/' => {
                    let doc = at(src, ptr + 2) == b'/';
                    ptr = scan::line_end(src, ptr + 2, end);
                    out.tok(if doc { tok::COMMENT_DOC } else { tok::COMMENT }, ptr);
                    continue;
                }
                class::SLASH if c2 == b'*' => {
                    let doc = at(src, ptr + 2) == b'*' && at(src, ptr + 3) != b'/';
                    ptr = scan::block_comment_end(src, ptr + 2, end);
                    out.tok(if doc { tok::COMMENT_DOC } else { tok::COMMENT }, ptr);
                    continue;
                }
                class::HASH if line_head => {
                    // a preprocessor directive owns its line
                    ptr = scan::line_end(src, ptr + 1, end);
                    out.tok(tok::PREPROC, ptr);
                    line_head = false;
                    continue;
                }
                class::NUL if ptr >= end => break,
                class::DOLLAR | class::DQUOTE | class::AT => {
                    token_start!();
                    // a string opener with its `$`/`@` prefixes and `"""` is
                    // emitted at once, then its body
                    let kind = string_prefix(src, ptr);
                    if kind != 0 {
                        ptr += (kind >> 4 & 3) as usize;
                        if at(src, ptr + 1) == b'"' && at(src, ptr + 2) == b'"' {
                            str_kind = RAW;
                            ptr += 3;
                        } else {
                            str_kind = if kind & 2 != 0 { VERBATIM } else { REGULAR };
                            ptr += 1;
                        }
                        str_kind |= (kind & 1) << 8;
                        out.tok(tok::STRING, ptr);
                        member = false;
                        after_type = false;
                        open_string!();
                    } else if class == class::DOLLAR {
                        // a `$` that opens no string starts a name
                        name = true;
                    } else if class == class::AT && is_ident_start(c2) {
                        // a verbatim identifier `@class` is a plain name
                        ptr = ident_end(src, ptr + 1);
                        out.tok(tok::VARIABLE, ptr);
                        member = false;
                        after_type = false;
                    } else {
                        ptr += 1;
                        out.tok(tok::NONE, ptr);
                        member = false;
                        after_type = false;
                    }
                }
                class::SQUOTE => {
                    token_start!();
                    // a one-line literal without escapes is one token
                    let close = scan::string_special(src, ptr + 1, end, c);
                    if at(src, close) == c {
                        ptr = close + 1;
                        out.tok(tok::STRING, ptr);
                    } else {
                        ptr = with_copy!(string_rest(lhs, close, end));
                    }
                    member = false;
                    after_type = false;
                }
                class::DOT | class::DIGIT if class == class::DIGIT || is_digit(c2) => {
                    token_start!();
                    ptr = number_end(src, ptr);
                    out.tok(tok::NUMBER, ptr);
                    member = false;
                    after_type = false;
                }
                class::BRACKET => {
                    // (whether the bracket starts its line)
                    let at_head = line_head;
                    token_start!();
                    // a bracket opening a line starts an attribute list
                    if c == b'[' {
                        attr = at_head;
                    }
                    if c == b']' {
                        attr = false;
                    }
                    // `{`, `}`, and an attribute's `]` start a member position;
                    // a block's end also ends any query in it
                    ctx |= matches!(c, b'{' | b'}' | b']') as u32;
                    if ctx >= 2 {
                        if c == b'{' {
                            ctx = ctx.wrapping_add(2);
                        }
                        if c == b'}' {
                            ctx = ctx.wrapping_sub(2);
                        }
                    }
                    ptr += 1;
                    if interp != 0 {
                        if c == b'(' || c == b'[' {
                            interp_depth = interp_depth.wrapping_add(1);
                        }
                        if interp_depth != 0 && (c == b')' || c == b']') {
                            interp_depth -= 1;
                        }
                        if c == b'{' {
                            interp = interp.wrapping_add(1);
                        }
                        if c == b'}' {
                            interp -= 1;
                            if interp == 0 {
                                // the brace matching `{` returns to the string
                                // body
                                out.tok(tok::PUNCTUATION_SPECIAL, ptr);
                                str_kind = interp_kind;
                                interp_kind = 0;
                                member = false;
                                expect = 0;
                                after_type = false;
                                open_string!();
                                continue;
                            }
                        }
                    }
                    out.tok(tok::PUNCTUATION_BRACKET, ptr);
                    member = false;
                    // array brackets keep a type pending; the others end it
                    // along with any declaration head
                    if c != b'[' && c != b']' {
                        after_type = false;
                        expect = 0;
                    }
                }
                class::DELIMITER => {
                    token_start!();
                    ptr += 1;
                    out.tok(tok::PUNCTUATION_DELIMITER, ptr);
                    member = false;
                    expect = 0;
                    if c == b';' {
                        after_type = false;
                        if ctx < 4 {
                            ctx = 1;
                        }
                    }
                }
                class::COLON => {
                    token_start!();
                    // `:` at an interpolation's top level opens its format text
                    let format = interp == 1 && interp_depth == 0 && c2 != b':';
                    ptr += if c2 == b':' { 2 } else { 1 };
                    out.tok(tok::PUNCTUATION_DELIMITER, ptr);
                    member = c2 == b':';
                    after_type = false;
                    // a stale capture never crosses `:` onto the name after it
                    expect = 0;
                    if format {
                        str_kind = (interp_kind & 255) + 3;
                        open_string!();
                    }
                }
                // member access: `.`, `?.`, and `->`; `..` is a range
                class::DOT => {
                    token_start!();
                    if c2 == b'.' {
                        ptr += 2;
                        out.tok(tok::OPERATOR, ptr);
                        member = false;
                        after_type = false;
                    } else {
                        ptr += 1;
                        out.tok(tok::PUNCTUATION_DELIMITER, ptr);
                        member = true;
                    }
                }
                class::ARROW if c2 == if c == b'?' { b'.' } else { b'>' } => {
                    token_start!();
                    ptr += 2;
                    out.tok(tok::OPERATOR, ptr);
                    member = true;
                }
                class::OP | class::SLASH | class::ARROW => {
                    token_start!();
                    ptr += 1;
                    if c == b'=' && c2 == b'>' {
                        ptr += 1;
                    } else if c2 == b'=' || (c == c2 && DOUBLES[c as usize]) {
                        ptr += 1;
                        if (c == b'>' || c == b'?') && matches!(at(src, ptr), b'>' | b'=') {
                            ptr += 1;
                            if c == b'>' && at(src, ptr) == b'=' {
                                ptr += 1;
                            }
                        }
                        if c == b'<' && at(src, ptr) == b'=' {
                            ptr += 1;
                        }
                    }
                    out.tok(tok::OPERATOR, ptr);
                    member = false;
                    // the angles of a generic - `>>` closes two - and a nullable
                    // `?` keep the type pending; any other operator ends it, and
                    // so does a spaced one
                    if !is_type_glue(src, lhs, ptr) || gap != lhs {
                        after_type = false;
                    }
                }
                _ => {
                    token_start!();
                    ptr += 1;
                    out.tok(tok::NONE, ptr);
                    member = false;
                    after_type = false;
                }
            }
            if !name {
                continue;
            }
        } else {
            token_start!();
        }

        let rhs = ident_end(src, ptr + 1);
        ptr = rhs;
        let p = skip_space_at(src, rhs);
        // a member name is never a keyword: `x.select`, `this.value`
        let mut kind = if member {
            -1
        } else {
            word_value(src, lhs, rhs)
        };
        if kind > 1023 {
            kind = contextual(src, end, kind, p, ctx & !1 != 0, was_head);
        }
        let hl;
        if kind >= 0 {
            hl = (kind & 255) as u32;
            if kind & 2048 != 0 && ctx < 2 {
                ctx |= 2;
            }
            // a keyword either arms the next-name capture or ends it;
            // `using static` turns `using`'s namespace into capture 3
            if expect == 2 && rhs - lhs == 6 && src[lhs..rhs] == *b"static" {
                expect = 3;
            } else {
                expect = (kind as u32 >> 8) & 3;
            }
            // a modifier keeps a member position: `private set;`
            if kind == tok::KEYWORD_DECLARATION as i32 {
                ctx |= was_head as u32;
            }
            after_type = hl == tok::TYPE_BUILTIN;
        } else if attr {
            // `[Obsolete]`, `[return: NotNull]`: names are attributes,
            // their arguments ordinary code
            hl = if is_upper(c) {
                tok::ATTRIBUTE
            } else {
                tok::VARIABLE
            };
            after_type = false;
        } else if expect != 0 {
            let dotted = at(src, p) == b'.';
            hl = if expect == 1 || (expect == 3 && !dotted) {
                tok::TYPE
            } else {
                tok::NAMESPACE
            };
            after_type = expect == 1;
            // a dotted namespace keeps its capture: `Demo.App`
            if expect == 1 || !dotted {
                expect = 0;
            }
        } else if member {
            // `List.Empty` is a nested type or static member,
            // `obj.field` a field, `obj.Call(` a method
            if at(src, p) == b'(' {
                hl = tok::FUNCTION_METHOD;
                after_type = false;
            } else {
                after_type = is_upper(c);
                hl = if after_type { tok::TYPE } else { tok::PROPERTY };
            }
        } else if at(src, p) == b'(' {
            // after a type, `Name(` declares a method; elsewhere it is
            // a call
            hl = if after_type {
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
        out.tok(hl, rhs);
        member = false;
    }
    out.store(inst);
}
