//! WAT sources: src/langs/terraform.wat src/langs/dockerfile.wat src/common.wat src/scan.wat
//!
//! Native Terraform (HCL) lexer. One pass over the input: comments, quoted
//! templates with their `${ }` interpolations and `%{ }` directives (the
//! expression inside is lexed as code), heredocs, numbers, punctuation,
//! operators, and names, which are colored by keyword group, by position
//! (a block type opening a line, an attribute before `=`, a member after
//! `.`), or by what follows (a call). The records equal the translated
//! `terraform` lexer's records.

use super::Lexer;
use super::input::Input;
use super::recs::Recs;
use super::scan;
use crate::generated::Instance;
use crate::simd::V;
use crate::token_ids as tok;
use crate::wat_tables::TF_WORDS;

/// The lexer for each language this module handles.
pub(crate) fn lexer(name: &str) -> Option<Lexer> {
    match name {
        "terraform" => Some(highlight),
        _ => None,
    }
}

/// The byte at `p`, or 0 at or past `end` (`$tfByte`, `$dockerByte`).
#[inline(always)]
fn byte(src: Input<'_>, end: usize, p: usize) -> u8 {
    // SAFETY: `p` is below the input end.
    if p < end {
        unsafe { src.byte_unchecked(p) }
    } else {
        0
    }
}

/// Whether `c` is ASCII whitespace (`$lexIsSpace`).
#[inline(always)]
const fn is_space(c: u8) -> bool {
    c == 32 || c.wrapping_sub(9) <= 4
}

/// Whether `c` is an ASCII digit (`$lexIsDigit`).
#[inline(always)]
const fn is_digit(c: u8) -> bool {
    c.wrapping_sub(b'0') <= 9
}

/// Whether `c` starts an identifier: a letter, `_`, `$`, or any byte from
/// 128 (`$lexIsIdentStart`).
#[inline(always)]
const fn is_ident_start(c: u8) -> bool {
    c >= 0x80 || (c | 32).wrapping_sub(b'a') <= 25 || c == b'_' || c == b'$'
}

/// Whether `c` continues an identifier (`$lexIsIdentContinue`).
#[inline(always)]
const fn is_ident_continue(c: u8) -> bool {
    is_ident_start(c) || is_digit(c)
}

/// Name bytes: letters, digits, `_`, `-`, and bytes from 128
/// (`$scanIdentRun` with `-`).
static NAME: [bool; 256] = {
    let mut t = [false; 256];
    let mut c = 0;
    while c < 256 {
        t[c] = (is_ident_continue(c as u8) && c != b'$' as usize) || c == b'-' as usize;
        c += 1;
    }
    t
};

/// Bytes that start a name: letters, `_`, and bytes from 128
/// (`$lexIsIdentStart` without `$`).
static NAME_START: [bool; 256] = {
    let mut t = [false; 256];
    let mut c = 0;
    while c < 256 {
        t[c] = is_ident_start(c as u8) && c != b'$' as usize;
        c += 1;
    }
    t
};

/// Kinds of the single-byte punctuation tokens.
const K_BRACKET: u8 = 1;
const K_DELIMITER: u8 = 2;
const K_EQUALS: u8 = 3;

/// The punctuation kind of every byte, 0 for bytes the other rules take.
static PUNCT: [u8; 256] = {
    let mut t = [0u8; 256];
    let b = b"()[]{}";
    let mut i = 0;
    while i < b.len() {
        t[b[i] as usize] = K_BRACKET;
        i += 1;
    }
    t[b',' as usize] = K_DELIMITER;
    t[b';' as usize] = K_DELIMITER;
    t[b':' as usize] = K_DELIMITER;
    t[b'=' as usize] = K_EQUALS;
    t
};

/// The operator bytes (`$tfIsOp`).
static OPERATOR: [bool; 256] = {
    let mut t = [false; 256];
    let b = b"!%&*+-/<=>?|~";
    let mut i = 0;
    while i < b.len() {
        t[b[i] as usize] = true;
        i += 1;
    }
    t
};

/// `$tfWords` as a collision-free hash on a word's first 8 bytes and
/// length: each slot holds the word's bytes 0-7 and 8-15 (zero past its
/// end), its length, and its 1-based group.
#[derive(Clone, Copy)]
struct Entry {
    lo: u64,
    hi: u64,
    /// The word's length in the low byte, its group above it.
    len_group: u32,
}

struct Words {
    entries: [Entry; WORD_SLOTS],
    /// For each first byte, a bit per length of the words starting with it.
    lengths: [u16; 256],
    mul: u64,
}

const WORD_SLOTS: usize = 128;

/// The integers of the word `w`: bytes 0-7 and 8-15, zero past its end.
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

/// The slot of a word with first 8 bytes `lo` and length `n`.
#[inline(always)]
const fn word_slot(lo: u64, n: usize, mul: u64) -> usize {
    ((lo ^ (n as u64) << 59).wrapping_mul(mul) >> (64 - WORD_SLOTS.trailing_zeros())) as usize
}

static WORDS: Words = {
    let mut mul: u64 = 0x9e37_79b9_7f4a_7c15;
    let mut attempt = 0;
    'search: loop {
        assert!(attempt < 100_000, "no collision-free word hash");
        let mut w = Words {
            entries: [Entry {
                lo: 0,
                hi: 0,
                len_group: 0,
            }; WORD_SLOTS],
            lengths: [0; 256],
            mul,
        };
        let mut i = 0;
        while i < TF_WORDS.len() {
            let k = &TF_WORDS[i];
            assert!(k.word.len() >= 2 && k.word.len() <= 15);
            let (lo, hi) = word_key(k.word);
            let s = word_slot(lo, k.word.len(), mul);
            if w.entries[s].len_group != 0 {
                mul = mul.wrapping_add(0x6a09_e667_f3bc_c909) | 1;
                attempt += 1;
                continue 'search;
            }
            w.entries[s] = Entry {
                lo,
                hi,
                len_group: (k.group as u32) << 8 | k.word.len() as u32,
            };
            w.lengths[k.word[0] as usize] |= 1 << k.word.len();
            i += 1;
        }
        break 'search w;
    }
};

/// The 1-based group of the word `[lhs, rhs)`, or 0 for none
/// (`keyword-table.get $tfWords`).
#[inline(always)]
fn word_group(src: Input<'_>, lhs: usize, rhs: usize) -> u32 {
    let n = rhs - lhs;
    let w = &WORDS;
    // SAFETY: `lhs` is below the input end, so the 16 bytes from it lie
    // inside the slack.
    if n > 15 || w.lengths[unsafe { src.byte_unchecked(lhs) } as usize] >> n & 1 == 0 {
        return 0;
    }
    // SAFETY: as above.
    let (lo, hi) = unsafe { (src.word_unchecked(lhs), src.word_unchecked(lhs + 8)) };
    let lo = if n >= 8 {
        lo
    } else {
        lo & ((1u64 << (8 * n)) - 1)
    };
    let hi = if n > 8 {
        hi & (u64::MAX >> (8 * (16 - n)))
    } else {
        0
    };
    let e = &w.entries[word_slot(lo, n, w.mul)];
    if e.lo == lo && e.hi == hi && e.len_group & 255 == n as u32 {
        e.len_group >> 8
    } else {
        0
    }
}

/// The end of the whitespace run from `p` (`$scanWhitespace`). The NUL
/// after the input ends every run by the input end.
#[inline(always)]
fn space_end(src: Input<'_>, mut p: usize) -> usize {
    // SAFETY: the NUL at the input end stops the run.
    while is_space(unsafe { src.byte_unchecked(p) }) {
        p += 1;
    }
    p
}

/// The end of the name run from `p` (`$scanIdentRun` with `-`). The NUL
/// after the input ends every run by the input end.
#[inline(always)]
fn name_end(src: Input<'_>, mut p: usize) -> usize {
    // SAFETY: the NUL at the input end stops the run.
    while NAME[unsafe { src.byte_unchecked(p) } as usize] {
        p += 1;
    }
    p
}

/// The end of the identifier run from `p` (`$lexScanIdent`). The NUL after
/// the input ends every run by the input end.
#[inline(always)]
fn ident_end(src: Input<'_>, mut p: usize) -> usize {
    // SAFETY: the NUL at the input end stops the run.
    while is_ident_continue(unsafe { src.byte_unchecked(p) }) {
        p += 1;
    }
    p
}

/// The end of the spaces and TABs from `p`, bounded by `end`
/// (`$lexSkipSpaceAt`).
#[inline(always)]
fn skip_blanks(src: Input<'_>, end: usize, mut p: usize) -> usize {
    // SAFETY: `p` is below the input end.
    while p < end
        && (unsafe { src.byte_unchecked(p) } == b' ' || unsafe { src.byte_unchecked(p) } == b'\t')
    {
        p += 1;
    }
    p
}

/// The end of the escape at the backslash at `p` (`$lexEscapeEnd`).
#[inline(always)]
fn escape_end(src: Input<'_>, end: usize, p: usize) -> usize {
    let mut e = scan::utf8_span_end(src.bytes(), p + 2, end);
    if e == p + 2 && src.byte(p + 1) == 13 && e < end && src.byte(e) == 10 {
        e += 1;
    }
    e
}

/// A number from `p`, at its first digit or dot (`$lexScanNumber`,
/// `$lexScanNumberBody`).
#[inline(always)]
fn scan_number(src: Input<'_>, end: usize, mut p: usize) -> usize {
    // SAFETY (every read here): each position is below the input end.
    let hex = p + 1 < end
        && unsafe { src.byte_unchecked(p) } == b'0'
        && unsafe { src.byte_unchecked(p + 1) } | 32 == b'x';
    let mut prev = 0u8;
    while p < end {
        let c = unsafe { src.byte_unchecked(p) };
        if is_ident_continue(c) {
            prev = c;
            p += 1;
            continue;
        }
        if c == b'.' {
            let next = if p + 1 < end {
                unsafe { src.byte_unchecked(p + 1) }
            } else {
                0
            };
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

/// The bytes a quoted template body stops at: the quote, a backslash, a
/// line break, `$`, and `%`.
static TEMPLATE_STOP: [bool; 256] = {
    let mut t = [false; 256];
    t[b'"' as usize] = true;
    t[b'\\' as usize] = true;
    t[10] = true;
    t[13] = true;
    t[b'$' as usize] = true;
    t[b'%' as usize] = true;
    t
};

/// How a quoted template body ended (`$tfStringBody`).
#[derive(Clone, Copy, PartialEq, Eq)]
enum Body {
    /// At the end, or at a raw line break.
    Open,
    /// Past the closing quote.
    Closed,
    /// Past a `${` or `%{` that opens an interpolation or directive.
    Interpolation,
    /// Past an escaped line break that ends exactly at the end.
    Continued,
}

/// A quoted template body from `p`, its bytes since `seg` not yet emitted.
/// `$${` and `%%{` are literal, and so is any `${` or `%{` when `nested`
/// (inside an interpolation). Returns how it ended and where
/// (`$tfStringBody`).
fn string_body(
    src: Input<'_>,
    end: usize,
    out: &mut Recs,
    nested: bool,
    mut seg: usize,
    mut p: usize,
) -> (Body, usize) {
    let mut status = Body::Open;
    loop {
        // SAFETY: `p` is below the input end.
        while p < end && !TEMPLATE_STOP[unsafe { src.byte_unchecked(p) } as usize] {
            p += 1;
        }
        if p >= end {
            break;
        }
        // SAFETY: `p` is below the input end (tested above).
        let c = unsafe { src.byte_unchecked(p) };
        if c == b'"' {
            p += 1;
            status = Body::Closed;
            break;
        }
        if c == 10 || c == 13 {
            break;
        }
        if c == b'\\' {
            out.emit(tok::STRING, seg, p);
            let e = escape_end(src, end, p);
            out.emit(tok::STRING_ESCAPE, p, e);
            p = e;
            seg = p;
            // SAFETY: `p` is the input end, just past the escape, so `p - 1` is
            // inside the input.
            if p == end
                && (unsafe { src.byte_unchecked(p - 1) } == 10
                    || unsafe { src.byte_unchecked(p - 1) } == 13)
            {
                status = Body::Continued;
            }
            continue;
        }
        // `$` or `%`: doubled before a brace it is literal, otherwise a
        // brace opens an interpolation.
        if byte(src, end, p + 1) == c && byte(src, end, p + 2) == b'{' {
            p += 3;
            continue;
        }
        if byte(src, end, p + 1) == b'{' && !nested {
            out.emit(tok::STRING, seg, p);
            p += 2;
            out.tok(tok::PUNCTUATION_SPECIAL, p);
            return (Body::Interpolation, p);
        }
        p += 1;
    }
    out.emit(tok::STRING, seg, p);
    (status, p)
}

/// A heredoc body after its opener line, from `p`: if only blanks and a
/// line break follow, the lines up to one that is exactly the delimiter
/// `src[delim..delim + n]` (after blanks when `strip`) are one string.
/// Returns whether it took a body, and where the cursor is: after the body,
/// or else past the blanks it skipped (`$dockerHeredoc`,
/// `$lineDelimiterEnds`).
#[allow(clippy::too_many_arguments)]
fn heredoc(
    src: Input<'_>,
    end: usize,
    out: &mut Recs,
    gap: usize,
    delim: usize,
    n: usize,
    strip: bool,
    p: usize,
) -> (bool, usize) {
    let mut p = skip_blanks(src, end, p);
    if p >= end {
        return (false, p);
    }
    let c = src.byte(p);
    if c != 10 && c != 13 {
        return (false, p);
    }
    p += 1;
    if c == 13 && byte(src, end, p) == 10 {
        p += 1;
    }
    out.gap(gap, p);
    let body = p;
    while p < end {
        let line = if strip { skip_blanks(src, end, p) } else { p };
        let mut same =
            line + n <= end && src.bytes()[line..line + n] == src.bytes()[delim..delim + n];
        // The delimiter must fill its line.
        if same {
            let q = line + n;
            same = q >= end || src.byte(q) == 10 || src.byte(q) == 13;
        }
        p = scan::line_end(src.bytes(), p, end);
        if p < end {
            p += 1;
        }
        if same {
            break;
        }
    }
    out.emit(tok::STRING, body, p);
    (true, p)
}

/// Byte classes as two nibble tables: byte `b` is in a class when
/// `CLASS_HI[b >> 4] & CLASS_LO[b & 15]` has one of its bits. Whitespace: 1
/// for TAB to CR, 2 for a space; name bytes: 4 for digits, 8 for `A`-`O`
/// and `a`-`o`, 16 for `P`-`Z` and `p`-`z`, 32 for `_`, 64 for `-`, 128 for
/// bytes from 128.
const CLASS_HI: [u8; 16] = [
    1,
    0,
    2 | 64,
    4,
    8,
    16 | 32,
    8,
    16,
    128,
    128,
    128,
    128,
    128,
    128,
    128,
    128,
];
const CLASS_LO: [u8; 16] = {
    let mut t = [0u8; 16];
    let mut l = 0;
    while l < 16 {
        let mut m = 128;
        if l >= 9 && l <= 13 {
            m |= 1;
        }
        if l == 0 {
            m |= 2;
        }
        if l <= 9 {
            m |= 4;
        }
        if l >= 1 {
            m |= 8;
        }
        if l <= 10 {
            m |= 16;
        }
        if l == 15 {
            m |= 32;
        }
        if l == 13 {
            m |= 64;
        }
        t[l] = m;
        l += 1;
    }
    t
};
const SPACE_BITS: u8 = 1 | 2;
const NAME_BITS: u8 = !SPACE_BITS;

/// The non-whitespace and non-name masks of the 64 bytes from `b`,
/// one bit per byte. `b + 64` must lie inside the input slack.
#[inline(always)]
fn block_masks(src: Input<'_>, b: usize) -> (u64, u64) {
    let hi_t = V::from_array(&CLASS_HI);
    let lo_t = V::from_array(&CLASS_LO);
    let mut space = [V::zero(); 4];
    let mut name = [V::zero(); 4];
    for i in 0..4 {
        // SAFETY: every window block starts at or before the input end, so its
        // 64 bytes stay inside the slack.
        let v = unsafe { src.vec_unchecked(b + 16 * i) };
        let class = hi_t
            .lookup(v.shr::<4>())
            .and(lo_t.lookup(v.and(V::splat(15))));
        space[i] = class.test(V::splat(SPACE_BITS));
        name[i] = class.test(V::splat(NAME_BITS));
    }
    (
        !V::bits64(space[0], space[1], space[2], space[3]),
        !V::bits64(name[0], name[1], name[2], name[3]),
    )
}

/// Bit masks of two adjacent 64-byte blocks of the input, the second
/// starting at `mid`: for each byte, whether it is not whitespace, and
/// whether it is not a name byte. A scan over the window is a shift
/// and a bit count, so the next token's start does not wait on a scan of
/// the bytes before it.
#[derive(Clone, Copy)]
struct Window {
    mid: usize,
    text0: u64,
    other0: u64,
    text1: u64,
    other1: u64,
}

impl Window {
    /// The window from block `blk`. The second block's masks are loaded
    /// only when it starts by the input end `end`; past it every scan
    /// stops at the NUL after the input.
    #[inline(always)]
    fn at(src: Input<'_>, end: usize, blk: usize) -> Self {
        let (text0, other0) = block_masks(src, blk);
        let mid = blk + 64;
        let (text1, other1) = if mid <= end {
            block_masks(src, mid)
        } else {
            (u64::MAX, u64::MAX)
        };
        Window {
            mid,
            text0,
            other0,
            text1,
            other1,
        }
    }

    /// Move the window so that `p` lies in its first block.
    #[inline(always)]
    fn sync(&mut self, src: Input<'_>, end: usize, p: usize) {
        if p < self.mid {
            return;
        }
        if p < self.mid + 64 {
            let mid = self.mid + 64;
            let (text1, other1) = if mid <= end {
                block_masks(src, mid)
            } else {
                (u64::MAX, u64::MAX)
            };
            *self = Window {
                mid,
                text0: self.text1,
                other0: self.other1,
                text1,
                other1,
            };
        } else {
            core::hint::cold_path();
            *self = Window::at(src, end, p & !63);
        }
    }

    /// The end of the whitespace run from `p`, which lies in the first
    /// block (`$scanWhitespace`). The window moves so that the end lies in
    /// its first block too.
    #[inline(always)]
    fn space_end(&mut self, src: Input<'_>, end: usize, p: usize) -> usize {
        // `sync` keeps `p` in the first block, whose start is `mid - 64`:
        // its offset there is `(p - mid) & 63`.
        let m = self.text0 >> (p.wrapping_sub(self.mid) & 63);
        if m != 0 {
            return p + m.trailing_zeros() as usize;
        }
        let e = if self.text1 != 0 {
            self.mid + self.text1.trailing_zeros() as usize
        } else {
            core::hint::cold_path();
            space_end(src, self.mid + 64)
        };
        self.sync(src, end, e);
        e
    }

    /// The end of the name run from `p`, which lies in the first block
    /// (`$scanIdentRun` with `-`).
    #[inline(always)]
    fn name_end(&self, src: Input<'_>, p: usize) -> usize {
        // As in `space_end`.
        let m = self.other0 >> (p.wrapping_sub(self.mid) & 63);
        if m != 0 {
            return p + m.trailing_zeros() as usize;
        }
        core::hint::cold_path();
        if self.other1 != 0 {
            return self.mid + self.other1.trailing_zeros() as usize;
        }
        name_end(src, self.mid + 64)
    }
}

/// Lex the input at `base` (`$hlTerraform`).
fn highlight(inst: &mut Instance, base: usize, len: usize) {
    // SAFETY: `base..base + len + SLACK` lies inside lexer memory, and this
    // lexer calls no translated function that could move it.
    let src = unsafe { Input::new(inst, base, len) };
    let mut out = Recs::load(inst);
    // `$lexEmitLeadingContinuation`.
    let p = scan::utf8_span_end(src.bytes(), 0, len);
    out.gap(0, p);
    lex(src, len, out, p).store(inst);
}

/// The lexer loop, from the start of the input (`$hlTerraform` with no
/// state carried from an earlier chunk).
fn lex(src: Input<'_>, end: usize, mut out: Recs, mut p: usize) -> Recs {
    // Until the first token of a line: a name there is a block type
    // unless `=` follows.
    let mut line_head = true;
    // After `.`.
    let mut member = false;
    // A quoted template body is open, its bytes since `seg` unemitted.
    let mut str_open = false;
    let mut seg = 0usize;
    // Braces open inside a `${` or `%{`.
    let mut interp = 0u32;
    // A heredoc opener's delimiter `[hd_delim, hd_delim + hd_len)`, pending
    // until the line break, and whether its closing line may be indented.
    let mut hd_len = 0usize;
    let mut hd_delim = 0usize;
    let mut hd_strip = false;
    let mut win = Window::at(src, end, p & !63);
    loop {
        let gap = p;
        // The pending heredoc body starts after this line's break.
        if hd_len != 0 {
            let took;
            (took, p) = heredoc(src, end, &mut out, gap, hd_delim, hd_len, hd_strip, p);
            if took {
                hd_len = 0;
                line_head = true;
                continue;
            }
        }
        // An open quoted template.
        if str_open {
            if p >= end {
                break;
            }
            let status;
            (status, p) = string_body(src, end, &mut out, interp != 0, seg, p);
            seg = p;
            match status {
                Body::Interpolation => {
                    interp = 1;
                    str_open = false;
                }
                // Closed, or cut by a raw line break.
                Body::Closed | Body::Open => str_open = false,
                // An escaped line break at the end keeps it open.
                Body::Continued => {}
            }
            continue;
        }
        win.sync(src, end, p);
        p = win.space_end(src, end, p);
        if src.bytes()[gap..p].iter().any(|&b| b == 10 || b == 13) {
            line_head = true;
            // A line break without a body drops the pending heredoc.
            hd_len = 0;
        }
        out.gap(gap, p);
        if p >= end {
            break;
        }
        let lhs = p;
        // SAFETY: `p` is below the input end (tested above).
        let c = unsafe { src.byte_unchecked(p) };
        let at_head = line_head;
        line_head = false;

        // `$` is no name byte here: a stray one is plain text. Name starts
        // begin no earlier rule, so this rule goes first.
        if NAME_START[c as usize] {
            p = win.name_end(src, p);
            let rhs = p;
            let q = skip_blanks(src, end, rhs);
            let pc = byte(src, end, q);
            let g = if member { 0 } else { word_group(src, lhs, rhs) };
            let hl = if g == 1 {
                tok::KEYWORD_CONTROL
            } else if g == 2 {
                tok::BOOLEAN
            } else if g == 3 {
                tok::CONSTANT_BUILTIN
            } else if g == 4 && pc != b'=' {
                tok::TYPE_BUILTIN
            } else if g == 5 && pc == b'.' {
                tok::VARIABLE_SPECIAL
            } else if member || (pc == b'=' && byte(src, end, q + 1) != b'=') {
                tok::PROPERTY
            } else if pc == b'(' {
                tok::FUNCTION
            } else if at_head && (pc == b'"' || pc == b'{' || is_ident_start(pc)) {
                // A name opening a line before a label, a brace, or another
                // name is a block type.
                tok::KEYWORD_DECLARATION
            } else {
                tok::VARIABLE
            };
            out.tok(hl, rhs);
            member = false;
            continue;
        }
        // Brackets, `,`, `;`, `:`, and `=` begin no earlier rule either.
        let k = PUNCT[c as usize];
        if k != 0 {
            p += 1;
            member = false;
            if k == K_BRACKET {
                if interp != 0 {
                    if c == b'{' {
                        interp += 1;
                    }
                    if c == b'}' {
                        interp -= 1;
                        if interp == 0 {
                            // The brace matching `${` returns to the
                            // template body.
                            out.tok(tok::PUNCTUATION_SPECIAL, p);
                            str_open = true;
                            seg = p;
                            continue;
                        }
                    }
                }
                out.tok(tok::PUNCTUATION_BRACKET, p);
            } else if k == K_DELIMITER {
                out.tok(tok::PUNCTUATION_DELIMITER, p);
            } else {
                // `=`, `==`, and `=>` (the operator rule below).
                // SAFETY: `p` is at most the input end.
                let c2 = unsafe { src.byte_unchecked(p) };
                if (c2 == b'=' || c2 == b'>') && p < end {
                    p += 1;
                }
                out.tok(tok::OPERATOR, p);
            }
            continue;
        }
        let c2 = byte(src, end, p + 1);
        // Read only by the rules that need it.
        let c3 = || byte(src, end, lhs + 2);

        if c == b'#' || (c == b'/' && c2 == b'/') {
            // `$lexLineComment`.
            p = scan::line_end(src.bytes(), p + 1, end);
            out.tok(tok::COMMENT, p);
            continue;
        }
        if c == b'/' && c2 == b'*' {
            // `$lexBlockComment`.
            p = scan::block_comment_end(src.bytes(), p + 2, end);
            out.tok(tok::COMMENT, p);
            continue;
        }

        // A quoted template opener; its body is lexed at the loop's top.
        if c == b'"' {
            p += 1;
            out.tok(tok::STRING, p);
            str_open = true;
            seg = p;
            member = false;
            continue;
        }

        // `<<EOF` and `<<-EOF`: the opener is a string and the body follows
        // the line break.
        if c == b'<'
            && c2 == b'<'
            && (is_ident_start(c3()) || (c3() == b'-' && is_ident_start(byte(src, end, p + 3))))
        {
            hd_strip = c3() == b'-';
            p += 2 + hd_strip as usize;
            hd_delim = p;
            p = ident_end(src, p);
            hd_len = p - hd_delim;
            out.tok(tok::STRING, p);
            member = false;
            continue;
        }

        if is_digit(c) || (c == b'.' && is_digit(c2)) {
            p = scan_number(src, end, p);
            out.tok(tok::NUMBER, p);
            member = false;
            continue;
        }

        if c == b'.' {
            p += if c2 == b'.' && c3() == b'.' { 3 } else { 1 };
            out.tok(
                if c2 == b'.' {
                    tok::OPERATOR
                } else {
                    tok::PUNCTUATION_DELIMITER
                },
                p,
            );
            member = c2 != b'.';
            continue;
        }

        if OPERATOR[c as usize] {
            p += 1;
            if c2 == b'=' || (c == b'=' && c2 == b'>') || (c == c2 && (c == b'&' || c == b'|')) {
                p += 1;
            }
            out.tok(tok::OPERATOR, p);
            member = false;
            continue;
        }

        p += 1;
        out.tok(tok::NONE, p);
        member = false;
    }
    out
}
