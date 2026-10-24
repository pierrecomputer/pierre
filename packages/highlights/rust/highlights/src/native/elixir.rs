//! WAT sources: src/langs/elixir.wat src/common.wat src/scan.wat
//!
//! Native Elixir lexer. One pass over the input: each token is scanned and
//! colored in the same step, with the same rules, in the same order, as the
//! translated `$hlElixir`. The records equal the translated lexer's
//! records.
//!
//! The WAT tests its rules in one chain. Each rule matches one first byte,
//! so this lexer dispatches on the first byte and, for each byte, tests
//! only the rules that can match it, in the WAT's order. Literal bodies
//! (strings, charlists, heredocs, sigils, quoted atoms) run in
//! [`literal_body`], which returns at a `#{` that opens an interpolation;
//! the main loop lexes the interpolation and resumes the body at its
//! closing `}`.

use super::Lexer;
use super::scan;
use super::tables::byteset;
use crate::Rec;
use crate::generated::Instance;
use crate::simd::V;
use crate::token_ids as tok;
use crate::wat_tables::EX_WORDS;

/// The lexer for `name`, if this module handles it.
pub(crate) fn lexer(name: &str) -> Option<Lexer> {
    match name {
        "elixir" => Some(highlight),
        _ => None,
    }
}

/// `$exWords` and `receive`, which `$exWordHl` matches outside the table,
/// as a perfect hash on a word's bytes, holding each word's group
/// (`keyword-table.get`; `receive` has [`RECEIVE`]). A word of up to 16 bytes is two
/// little-endian integers, `lo` (bytes 0-7) and `hi` (bytes 8-15), zero
/// past its end; names hold no NUL, so equal integers mean equal words.
struct Words {
    keys: [(u64, u64); WORD_SLOTS],
    groups: [u8; WORD_SLOTS],
    mul: u64,
}

const WORD_SLOTS: usize = 512;

/// The group [`WORDS`] gives `receive`, which is no `$exWords` word.
const RECEIVE: u8 = 10;

/// The longest word.
const WORD_MAX: usize = 16;

/// The slot of the word with integers `lo` and `hi`. No two words share a
/// slot, so a name is a word only when its integers equal the slot's.
#[inline(always)]
const fn word_slot(lo: u64, hi: u64, mul: u64) -> usize {
    ((lo ^ hi.rotate_left(29)).wrapping_mul(mul) >> (64 - WORD_SLOTS.trailing_zeros())) as usize
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
    while i < EX_WORDS.len() {
        let w = EX_WORDS[i].word;
        t[w[0] as usize] |= 1 << w.len();
        i += 1;
    }
    t[b'r' as usize] |= 1 << b"receive".len();
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
        let mut groups = [0u8; WORD_SLOTS];
        let mut i = 0;
        while i <= EX_WORDS.len() {
            // `receive` follows the table's words
            let (w, group) = if i < EX_WORDS.len() {
                (EX_WORDS[i].word, EX_WORDS[i].group)
            } else {
                (b"receive".as_slice(), RECEIVE)
            };
            assert!(w.len() <= WORD_MAX && group > 0);
            let (lo, hi) = word_key(w);
            let s = word_slot(lo, hi, mul);
            if keys[s].0 != 0 {
                mul = mul.wrapping_add(0x6a09_e667_f3bc_c909) | 1;
                attempt += 1;
                continue 'search;
            }
            keys[s] = (lo, hi);
            groups[s] = group;
            i += 1;
        }
        break Words { keys, groups, mul };
    }
};

/// The first `n` bytes at `p` as a little-endian integer, for comparing
/// short words. Reads 8 bytes, which the input slack allows.
#[inline(always)]
fn word_at(src: &[u8], p: usize, n: usize) -> u64 {
    debug_assert!(p + 8 <= src.len());
    // SAFETY: `p` lies before the input end, so `p + 8` lies inside the
    // slack.
    let w = unsafe { src.as_ptr().add(p).cast::<u64>().read_unaligned() };
    w & (u64::MAX >> (64 - 8 * n))
}

/// The group of the name `[lhs, rhs)` in [`WORDS`], or 0 when it is no
/// word (`keyword-table.get $exWords`, plus `receive`).
#[inline(always)]
fn word_group(src: &[u8], lhs: usize, rhs: usize) -> u32 {
    let n = rhs - lhs;
    if n > WORD_MAX || WORD_LENGTHS[at(src, lhs) as usize] >> n & 1 == 0 {
        return 0;
    }
    let (lo, hi) = if n <= 8 {
        (word_at(src, lhs, n), 0)
    } else {
        (word_at(src, lhs, 8), word_at(src, lhs + 8, n - 8))
    };
    let s = word_slot(lo, hi, WORDS.mul);
    if WORDS.keys[s] == (lo, hi) {
        WORDS.groups[s] as u32
    } else {
        0
    }
}

/// Each group's token, with bit 8 for a definition whose next name is a
/// function and bit 9 for one whose next name is a module (`$exWordHl`).
static GROUP_HL: [u32; 11] = [
    0,
    tok::KEYWORD_CONTROL,
    tok::KEYWORD_DECLARATION | 256,
    tok::KEYWORD_DECLARATION | 512,
    tok::KEYWORD_DECLARATION,
    tok::KEYWORD_IMPORT,
    tok::KEYWORD_OPERATOR,
    tok::BOOLEAN,
    tok::CONSTANT_BUILTIN,
    tok::VARIABLE_SPECIAL,
    // `receive`
    tok::KEYWORD_CONTROL,
];

/// The token for the bare word `[lhs, rhs)`, with the definition bits of
/// [`GROUP_HL`], or -1 for an ordinary identifier (`$exWordHl`).
#[inline(always)]
fn word_hl(src: &[u8], lhs: usize, rhs: usize) -> i32 {
    let g = word_group(src, lhs, rhs);
    if g != 0 {
        return GROUP_HL[g as usize] as i32;
    }
    // the `__MODULE__` family
    if at(src, lhs) == b'_'
        && rhs - lhs >= 5
        && at(src, lhs + 1) == b'_'
        && at(src, rhs - 2) == b'_'
        && at(src, rhs - 1) == b'_'
    {
        return tok::VARIABLE_SPECIAL as i32;
    }
    -1
}

/// Operator bytes (`$exIsOp`).
static OP: [bool; 256] = byteset(b"!&*+-/<=>?\\^|~");

/// Bytes that continue an operator run: operators, `.`, and `:`.
static OP_RUN: [bool; 256] = byteset(b"!&*+-/<=>?\\^|~.:");

/// Byte classes for the main dispatch.
mod class {
    /// Anything else: one byte colored `none`.
    pub const OTHER: u8 = 0;
    /// An identifier start: a letter, `_`, `$`, or a byte from 0x80.
    pub const IDENT: u8 = 1;
    pub const DIGIT: u8 = 2;
    pub const DOT: u8 = 3;
    pub const HASH: u8 = 4;
    /// `"` or `'`.
    pub const QUOTE: u8 = 5;
    pub const TILDE: u8 = 6;
    pub const COLON: u8 = 7;
    pub const AT: u8 = 8;
    pub const QUESTION: u8 = 9;
    /// `(`, `)`, `[`, `]`, `{`, or `}`.
    pub const BRACKET: u8 = 10;
    /// `,` or `;`.
    pub const DELIMITER: u8 = 11;
    pub const PERCENT: u8 = 12;
    pub const AMPERSAND: u8 = 13;
    /// Any other operator byte.
    pub const OP: u8 = 14;
    /// NUL: the end of the input, or one byte colored `none` inside it.
    pub const NUL: u8 = 15;
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
                b'.' => class::DOT,
                b'#' => class::HASH,
                b'"' | b'\'' => class::QUOTE,
                b'~' => class::TILDE,
                b':' => class::COLON,
                b'@' => class::AT,
                b'?' => class::QUESTION,
                b'(' | b')' | b'[' | b']' | b'{' | b'}' => class::BRACKET,
                b',' | b';' => class::DELIMITER,
                b'%' => class::PERCENT,
                b'&' => class::AMPERSAND,
                _ if OP[c] => class::OP,
                _ => class::OTHER,
            }
        };
        c += 1;
    }
    t
};

/// Coarse byte kinds for the loop top: whitespace, a name start, or
/// anything else. The name test reads this table rather than [`CLASS`] so
/// it stays a branch of its own before the class dispatch.
mod kind {
    pub const OTHER: u8 = 0;
    /// ASCII whitespace (`$lexIsSpace`).
    pub const SPACE: u8 = 1;
    /// [`super::class::IDENT`].
    pub const NAME: u8 = 2;
}

/// The [`kind`] of each byte.
static KIND: [u8; 256] = {
    let mut t = [kind::OTHER; 256];
    let mut c = 0;
    while c < 256 {
        t[c] = if is_space(c as u8) {
            kind::SPACE
        } else if CLASS[c] == class::IDENT {
            kind::NAME
        } else {
            kind::OTHER
        };
        c += 1;
    }
    t
};

/// Identifier bytes (`$lexIsIdentContinue`): `[A-Za-z0-9_$]` and bytes
/// from 0x80, the bytes of `$lexScanIdent`.
static IDENT_CONT: [bool; 256] = {
    let mut t = [false; 256];
    let mut c = 0;
    while c < 256 {
        let b = c as u8;
        t[c] = is_ident_start(b) || is_digit(b);
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

/// Whether `c` is ASCII whitespace: space or TAB through CR (`$lexIsSpace`).
#[inline(always)]
const fn is_space(c: u8) -> bool {
    c == b' ' || c.wrapping_sub(9) <= 4
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
/// 0x80 (`$lexScanIdent`). The NUL after the input ends every run.
#[inline(always)]
fn ident_end(src: &[u8], mut p: usize) -> usize {
    // Most names are short: test a few bytes one by one first.
    for _ in 0..8 {
        if !IDENT_CONT[at(src, p) as usize] {
            return p;
        }
        p += 1;
    }
    // SAFETY: each 16-byte load starts at or before the NUL after the
    // input, inside the slack.
    unsafe {
        loop {
            let v = V::load(src.as_ptr().add(p));
            let alpha = v.or(V::splat(0x20)).sub(V::splat(b'a')).le(V::splat(25));
            let digit = v.sub(V::splat(b'0')).le(V::splat(9));
            let extra = v.eq(V::splat(b'_')).or(v.eq(V::splat(b'$')));
            let high = v.high();
            let ok = alpha.or(digit).or(extra.or(high));
            let k = ok.not().first();
            if k < 16 {
                return p + k;
            }
            p += 16;
        }
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

/// The end of the number at `p`: radix digits, separators, exponents, and
/// suffixes, with `.` only before a digit (`$lexScanNumber`,
/// `$lexScanNumberBody`).
#[inline(always)]
fn number_end(src: &[u8], mut p: usize) -> usize {
    let hex = at(src, p) == b'0' && at(src, p + 1) | 0x20 == b'x';
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

/// The closer of the sigil opener `open` (`$exCloser`).
#[inline(always)]
fn closer(open: u8) -> u8 {
    match open {
        b'(' => b')',
        b'[' => b']',
        b'{' => b'}',
        b'<' => b'>',
        _ => open,
    }
}

/// Whether the word at `p` can be a bare argument: a name that is not a
/// keyword, such as the `do` of a block (`$exArgWord`).
#[inline(always)]
fn is_arg_word(src: &[u8], p: usize) -> bool {
    let mut e = p;
    while IDENT_CONT[at(src, e) as usize] {
        e += 1;
    }
    let g = word_group(src, p, e);
    g == 0 || g == RECEIVE as u32
}

/// A literal body's description (`$lit` of `$exLiteralBody`): its closer
/// in bits 0-7, the opener that nests in bits 8-15 (zero when none), and
/// flags above: bit 0 escapes and `#{}` interpolation, bit 1 sigil modifier
/// letters, bit 2 documentation color, bit 3 a tripled closer, bit 4 one
/// line, bit 5 regex color, bit 6 backslash escapes only the delimiters,
/// bit 7 quoted-atom color.
mod lit {
    pub const ESCAPES: u32 = 1 << 16;
    pub const MODIFIERS: u32 = 2 << 16;
    pub const DOC: u32 = 4 << 16;
    pub const TRIPLE: u32 = 8 << 16;
    pub const ONE_LINE: u32 = 16 << 16;
    pub const REGEX: u32 = 32 << 16;
    pub const DELIMITER_ESCAPES: u32 = 64 << 16;
    pub const ATOM: u32 = 128 << 16;
}

/// What ended a literal body.
mod status {
    /// The input ended, or a one-line body reached a line break.
    pub const OPEN: u32 = 0;
    /// The closer.
    pub const CLOSED: u32 = 1;
    /// A `#{` that opens an interpolation.
    pub const INTERPOLATION: u32 = 2;
}

/// The first position from `p` holding one of the bytes in `set`, or `end`
/// (the `$scanFindSpecial` and `$lexFindEither` searches of
/// `$exLiteralBody`, merged: the body stops at whichever comes first).
#[inline(always)]
fn find_special(src: &[u8], mut p: usize, end: usize, set: [u8; 6]) -> usize {
    while p < end {
        // SAFETY: `p < end`, so the 16-byte load ends inside the slack.
        let k = unsafe {
            let w = V::load(src.as_ptr().add(p));
            let a = w.eq(V::splat(set[0])).or(w.eq(V::splat(set[1])));
            let b = w.eq(V::splat(set[2])).or(w.eq(V::splat(set[3])));
            let c = w.eq(V::splat(set[4])).or(w.eq(V::splat(set[5])));
            a.or(b).or(c).first()
        };
        if k < 16 {
            return (p + k).min(end);
        }
        p += 16;
    }
    end
}

/// The record writer the main loop hands to [`literal_body`]: the next
/// record slot, one past the buffer's room, and the last record's token
/// (`u32::MAX` when there is none). It moves by value, so its fields stay
/// in registers.
#[derive(Clone, Copy)]
struct Out {
    cur: *mut Rec,
    limit: *mut Rec,
    last: u32,
}

impl Out {
    /// Append a non-empty token ending at `end`, merging it into the last
    /// record when the token matches (`$emitTok`). The buffer has room for
    /// one record per input byte and every record covers at least one, so
    /// running out of room means a lexer bug, which traps.
    #[inline(always)]
    fn tok(&mut self, hl: u32, end: usize) {
        // SAFETY: `cur` stays below `limit`; a merge rewrites the last
        // record, which exists whenever `last` names a token.
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
}

/// Scan and emit a literal body described by `desc` (see [`lit`]) from
/// `ptr`, where the bytes since `ptr` are unemitted and `depth` nested
/// openers are already open. Inside an interpolation (`nested`) a nested
/// literal keeps `#{` plain. Returns the end, its [`status`], and the
/// nesting depth still open (`$exLiteralBody`).
#[inline(never)]
fn literal_body(
    src: &[u8],
    mut out: Out,
    mut ptr: usize,
    end: usize,
    desc: u32,
    mut depth: u32,
    nested: bool,
) -> (Out, usize, u32, u32) {
    let close = desc as u8;
    let open = (desc >> 8) as u8;
    let hl = if desc & lit::REGEX != 0 {
        tok::STRING_REGEX
    } else if desc & lit::DOC != 0 {
        tok::COMMENT_DOC
    } else if desc & lit::ATOM != 0 {
        tok::STRING_SPECIAL_SYMBOL
    } else {
        tok::STRING
    };
    let escapes = desc & lit::ESCAPES != 0;
    let one_line = desc & lit::ONE_LINE != 0;
    let triple = desc & lit::TRIPLE != 0;
    // the closer, the nesting opener, `#` for interpolation, `\`, and
    // line breaks for a one-line body; a disabled entry repeats the closer
    let set = [
        close,
        if open != 0 { open } else { close },
        if escapes { b'#' } else { close },
        if desc & (lit::ESCAPES | lit::DELIMITER_ESCAPES) != 0 {
            b'\\'
        } else {
            close
        },
        if one_line { b'\n' } else { close },
        if one_line { b'\r' } else { close },
    ];
    let mut seg = ptr;
    let mut status = status::OPEN;
    loop {
        ptr = find_special(src, ptr, end, set);
        if ptr >= end {
            break;
        }
        let c = at(src, ptr);
        if c == close {
            if depth != 0 {
                depth -= 1;
                ptr += 1;
                continue;
            }
            // a heredoc closes only on three closers
            if triple && !(at(src, ptr + 1) == close && at(src, ptr + 2) == close) {
                ptr += 1;
                continue;
            }
            ptr += if triple { 3 } else { 1 };
            // a sigil carries its modifier letters
            if desc & lit::MODIFIERS != 0 {
                ptr = ident_end(src, ptr);
            }
            status = status::CLOSED;
            break;
        }
        if open != 0 && c == open {
            depth += 1;
            ptr += 1;
            continue;
        }
        if c == b'\n' || c == b'\r' {
            break;
        }
        if c == b'\\' {
            // an uppercase sigil keeps `\` literal, but it still hides a
            // delimiter that follows it
            if !escapes {
                let e = at(src, ptr + 1);
                ptr += if e == close || (open != 0 && e == open) {
                    2
                } else {
                    1
                };
                continue;
            }
            if seg < ptr {
                out.tok(hl, ptr);
            }
            let e = escape_end(src, ptr, end);
            out.tok(tok::STRING_ESCAPE, e);
            ptr = e;
            seg = ptr;
            continue;
        }
        // `#`: an interpolation when `{` follows
        if at(src, ptr + 1) == b'{' && !nested {
            if seg < ptr {
                out.tok(hl, ptr);
            }
            ptr += 2;
            out.tok(tok::PUNCTUATION_SPECIAL, ptr);
            return (out, ptr, status::INTERPOLATION, depth);
        }
        ptr += 1;
    }
    if seg < ptr {
        out.tok(hl, ptr);
    }
    (out, ptr, status, depth)
}

/// Lex the Elixir input of `len` bytes at `base` (`$hlElixir`).
fn highlight(inst: &mut Instance, base: usize, len: usize) {
    let mem_ptr = inst.mem.bytes().as_ptr();
    // SAFETY: `base..base + len + 96` lies inside lexer memory, which is not
    // reallocated while this lexer runs.
    let src: &[u8] = unsafe { core::slice::from_raw_parts(mem_ptr.add(base), len + 96) };
    let end = len;

    // Records are written through `cur`, which moves along
    // `inst.ext.recs`'s buffer from `rp` to at most `limit`; `last` is the
    // last record's token, or `u32::MAX`.
    let rp = inst.ext.recs.as_mut_ptr();
    // SAFETY: `len` records are written.
    let mut cur = unsafe { rp.add(inst.ext.recs.len()) };
    // SAFETY: one past the allocation.
    let limit = unsafe { rp.add(inst.ext.recs.capacity()) };
    let mut last = inst.ext.recs.last().map_or(u32::MAX, |r| r.token);
    // Append a non-empty token ending at `end`, merging it into the last
    // record when the token matches (`$emitTok`). Running out of room
    // means a lexer bug, which traps.
    macro_rules! emit {
        ($hl:expr, $end:expr) => {{
            let hl: u32 = $hl;
            // SAFETY: `cur` stays within `rp..limit`; a merge rewrites the
            // last record.
            unsafe {
                cur = cur.sub((last == hl) as usize);
                if cur == limit {
                    crate::rt::trap();
                }
                cur.write(Rec {
                    end: $end as u32,
                    token: hl,
                });
                cur = cur.add(1);
            }
            last = hl;
        }};
    }
    // Whitespace `[lhs, rhs)` extends the last record (`$emitGap`).
    macro_rules! gap {
        ($lhs:expr, $rhs:expr) => {{
            let (lhs, rhs): (usize, usize) = ($lhs, $rhs);
            if lhs < rhs {
                if cur == rp {
                    emit!(tok::NONE, rhs);
                } else {
                    // SAFETY: the record before `cur` is written.
                    unsafe { (*cur.sub(1)).end = rhs as u32 };
                }
            }
        }};
    }

    // `$lexEmitLeadingContinuation`
    let mut ptr = scan::utf8_span_end(src, 0, end);
    gap!(0, ptr);
    // Leading whitespace; every later gap follows a token's record.
    let first = whitespace_end(src, ptr);
    gap!(ptr, first);
    ptr = first;
    // Whitespace up to `rhs` extends the last record, which exists.
    macro_rules! extend {
        ($rhs:expr) => {{
            debug_assert!(cur > rp);
            // SAFETY: a record precedes every gap after the first token.
            unsafe { (*cur.sub(1)).end = $rhs as u32 };
        }};
    }

    // the brace depth inside a `#{` interpolation
    let mut interp = 0u32;
    // the literal and nesting depth an interpolation suspended
    let mut i_lit = 0u32;
    let mut i_depth = 0u32;
    // 1 after `def`, 2 after `defmodule`
    let mut decl = 0u32;
    // after `.`
    let mut member = false;
    // after `@doc`, `@moduledoc`, or `@typedoc`, whose string is
    // documentation
    let mut doc_attr = false;

    // The literal body `desc` from `ptr`, which runs right after its opener
    // or the `}` that ends an interpolation: it ends at its closer, at a
    // `#{`, at the line break of a one-line body, or at the input end
    // (where nothing follows).
    macro_rules! literal {
        ($desc:expr, $depth:expr) => {{
            let desc: u32 = $desc;
            let out = Out { cur, limit, last };
            let (out, p, st, depth) = literal_body(src, out, ptr, end, desc, $depth, interp != 0);
            cur = out.cur;
            last = out.last;
            ptr = p;
            if st == status::INTERPOLATION {
                i_lit = desc;
                i_depth = depth;
                interp = 1;
            }
        }};
    }

    loop {
        let mut c = at(src, ptr);
        let mut byte_kind = KIND[c as usize];
        if byte_kind == kind::SPACE {
            if c == b' ' && KIND[at(src, ptr + 1) as usize] != kind::SPACE {
                ptr += 1;
            } else {
                ptr = whitespace_end(src, ptr + 1);
            }
            extend!(ptr);
            c = at(src, ptr);
            byte_kind = KIND[c as usize];
        }
        let lhs = ptr;
        // Names, the most common tokens, skip the jump table.
        if byte_kind == kind::NAME {
            let mut rhs = ident_end(src, ptr + 1);
            if at(src, rhs) == b'?' || at(src, rhs) == b'!' {
                rhs += 1;
            }
            ptr = rhs;
            // `key:` in a keyword list is an atom
            if at(src, rhs) == b':' && at(src, rhs + 1) != b':' && !member {
                ptr = rhs + 1;
                emit!(tok::STRING_SPECIAL_SYMBOL, ptr);
                decl = 0;
                continue;
            }
            let kind = if member { -1 } else { word_hl(src, lhs, rhs) };
            let hl;
            if kind >= 0 {
                hl = (kind & 255) as u32;
                decl = (kind >> 8) as u32;
            } else if decl == 0 && !member && c.wrapping_sub(b'A') > 25 {
                // `foo(` and `foo arg` are calls; `_x` and the rest are
                // variables
                let p = skip_space_at(src, rhs);
                let d = at(src, p);
                hl = if at(src, rhs) == b'('
                    || (p > rhs
                        && (d == b'"'
                            || d == b'\''
                            || (d == b':' && is_ident_start(at(src, p + 1)))
                            || d == b'@'
                            || (is_ident_start(d) && is_arg_word(src, p))))
                {
                    tok::FUNCTION
                } else {
                    tok::VARIABLE
                };
            } else if decl != 0 {
                hl = if decl == 1 {
                    tok::FUNCTION_DEFINITION
                } else {
                    tok::TYPE
                };
                // `defmodule Foo.Bar` keeps the head open through the dots
                if !(decl == 2 && at(src, rhs) == b'.') {
                    decl = 0;
                }
            } else if c.wrapping_sub(b'A') <= 25 {
                hl = tok::TYPE;
            } else {
                // (`member` is set)
                hl = if at(src, skip_space_at(src, rhs)) == b'(' {
                    tok::FUNCTION_METHOD
                } else {
                    tok::PROPERTY
                };
            }
            emit!(hl, rhs);
            member = false;
            // `(`, `)`, `,`, or `.` right after a name: its rule runs here,
            // without the gap and dispatch steps
            let next = at(src, ptr);
            if next == b'(' || next == b')' {
                // (only braces count toward an interpolation's end)
                ptr += 1;
                emit!(tok::PUNCTUATION_BRACKET, ptr);
                decl = 0;
            } else if next == b',' {
                ptr += 1;
                emit!(tok::PUNCTUATION_DELIMITER, ptr);
                decl = 0;
            } else if next == b'.' && at(src, ptr + 1) != b'.' && !is_digit(at(src, ptr + 1)) {
                ptr += 1;
                emit!(tok::PUNCTUATION_DELIMITER, ptr);
                member = true;
            }
            continue;
        }
        let c2 = at(src, ptr + 1);
        // An operator run from `lhs`: operators, `.`, and `:`.
        macro_rules! op_run {
            () => {{
                ptr = lhs + 1;
                while OP_RUN[at(src, ptr) as usize] {
                    ptr += 1;
                }
                emit!(tok::OPERATOR, ptr);
                member = false;
            }};
        }
        match CLASS[c as usize] {
            class::HASH => {
                // `$lexLineComment`
                ptr = scan::line_end(src, ptr + 1, end);
                emit!(tok::COMMENT, ptr);
            }
            class::QUOTE => {
                // strings, charlists, and their heredocs; a heredoc after
                // `@doc` is documentation
                let c3 = at(src, ptr + 2);
                let hl = if doc_attr {
                    tok::COMMENT_DOC
                } else {
                    tok::STRING
                };
                let mut desc = if c2 == c && c3 == c {
                    ptr += 3;
                    lit::ESCAPES | lit::TRIPLE
                } else {
                    ptr += 1;
                    lit::ESCAPES | lit::ONE_LINE
                };
                desc |= c as u32 | if doc_attr { lit::DOC } else { 0 };
                member = false;
                doc_attr = false;
                if desc & lit::ONE_LINE != 0 {
                    // A one-line literal without escapes, interpolation, or
                    // a line break is one token.
                    let close = find_special(src, ptr, end, [c, b'\\', b'#', b'\n', b'\r', c]);
                    if close < end && at(src, close) == c {
                        ptr = close + 1;
                        emit!(hl, ptr);
                        continue;
                    }
                }
                emit!(hl, ptr);
                literal!(desc, 0);
            }
            class::TILDE
                if (c2 | 32).wrapping_sub(b'a') <= 25 && {
                    let c3 = at(src, ptr + 2);
                    c3 > 32 && c3 < 128 && !IDENT_CONT[c3 as usize]
                } =>
            {
                // sigils: `~r/.../`, `~s(...)`, `~w[...]`, `~H"""..."""`; a
                // lowercase letter interpolates, an uppercase one does not
                let mut open = at(src, ptr + 2);
                let close = closer(open);
                if close == open {
                    open = 0;
                }
                let mut flags = lit::MODIFIERS
                    | if c2.wrapping_sub(b'a') <= 25 {
                        lit::ESCAPES
                    } else {
                        lit::DELIMITER_ESCAPES
                    };
                if c2 | 32 == b'r' {
                    flags |= lit::REGEX;
                }
                ptr += 3;
                if open == 0
                    && (close == b'"' || close == b'\'')
                    && at(src, ptr) == close
                    && at(src, ptr + 1) == close
                {
                    flags |= lit::TRIPLE;
                    ptr += 2;
                }
                emit!(
                    if flags & lit::REGEX != 0 {
                        tok::STRING_REGEX
                    } else {
                        tok::STRING
                    },
                    ptr
                );
                member = false;
                literal!(close as u32 | (open as u32) << 8 | flags, 0);
            }
            class::COLON if c2 != b':' && (c2 == b'"' || c2 == b'\'') => {
                // a quoted atom is a one-line literal body in the atom
                // color, so it keeps escapes and `#{}` interpolation
                ptr += 2;
                emit!(tok::STRING_SPECIAL_SYMBOL, ptr);
                member = false;
                literal!(c2 as u32 | lit::ESCAPES | lit::ONE_LINE | lit::ATOM, 0);
            }
            class::COLON if c2 != b':' && is_ident_start(c2) => {
                // `:name`
                ptr = ident_end(src, ptr + 1);
                if at(src, ptr) == b'?' || at(src, ptr) == b'!' {
                    ptr += 1;
                }
                emit!(tok::STRING_SPECIAL_SYMBOL, ptr);
                member = false;
            }
            class::COLON if c2 != b':' && OP[c2 as usize] => {
                // `:+`
                ptr += 1;
                while OP[at(src, ptr) as usize] {
                    ptr += 1;
                }
                emit!(tok::STRING_SPECIAL_SYMBOL, ptr);
                member = false;
            }
            class::AT if is_ident_start(c2) => {
                // `@attr` module attributes; `@doc` and friends document
                // the next string
                ptr = ident_end(src, ptr + 1);
                doc_attr = ptr - lhs >= 4
                    && at(src, ptr - 3) == b'd'
                    && at(src, ptr - 2) == b'o'
                    && at(src, ptr - 1) == b'c';
                emit!(tok::ATTRIBUTE, ptr);
                member = false;
            }
            class::QUESTION if c2 > 32 => {
                // `?c` character codes: `?a`, `?é`, and escapes such as
                // `?\n`; a plain character must not run into a name, and an
                // escape never takes a line break
                let p = if c2 == b'\\' {
                    (at(src, ptr + 2) > 13).then(|| escape_end(src, lhs + 1, end))
                } else {
                    let p = scan::utf8_span_end(src, ptr + 2, end);
                    (!IDENT_CONT[at(src, p) as usize]).then_some(p)
                };
                if let Some(p) = p {
                    ptr = p;
                    emit!(tok::STRING_SPECIAL, ptr);
                    member = false;
                } else {
                    op_run!();
                }
            }
            class::DIGIT => {
                ptr = number_end(src, ptr);
                emit!(tok::NUMBER, ptr);
                member = false;
            }
            class::DOT if is_digit(c2) => {
                ptr = number_end(src, ptr);
                emit!(tok::NUMBER, ptr);
                member = false;
            }
            class::BRACKET => {
                ptr += 1;
                if interp != 0 {
                    if c == b'{' {
                        interp += 1;
                    }
                    if c == b'}' {
                        interp -= 1;
                        if interp == 0 {
                            // the brace matching `#{` returns to the
                            // literal body
                            emit!(tok::PUNCTUATION_SPECIAL, ptr);
                            member = false;
                            decl = 0;
                            literal!(i_lit, i_depth);
                            continue;
                        }
                    }
                }
                emit!(tok::PUNCTUATION_BRACKET, ptr);
                member = false;
                decl = 0;
            }
            class::DELIMITER => {
                ptr += 1;
                emit!(tok::PUNCTUATION_DELIMITER, ptr);
                member = false;
                decl = 0;
            }
            class::DOT if c2 != b'.' => {
                ptr += 1;
                emit!(tok::PUNCTUATION_DELIMITER, ptr);
                member = true;
            }
            class::PERCENT => {
                // `%Struct{}` and `%{}`
                ptr += 1;
                emit!(tok::PUNCTUATION_SPECIAL, ptr);
                member = false;
            }
            class::AMPERSAND if is_digit(c2) => {
                // `&1` captures
                ptr = number_end(src, ptr + 1);
                emit!(tok::VARIABLE_SPECIAL, ptr);
                member = false;
            }
            class::OP
            | class::DOT
            | class::COLON
            | class::TILDE
            | class::QUESTION
            | class::AMPERSAND => op_run!(),
            class::NUL if ptr >= end => break,
            _ => {
                ptr += 1;
                emit!(tok::NONE, ptr);
                member = false;
            }
        }
    }
    // SAFETY: the records before `cur` are written.
    unsafe { inst.ext.recs.set_len(cur.offset_from(rp) as usize) };
}
