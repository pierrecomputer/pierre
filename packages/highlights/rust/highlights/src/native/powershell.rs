//! WAT sources: src/langs/powershell.wat src/common.wat src/scan.wat
//!
//! Native PowerShell highlighter. One pass over the input with the same
//! rules, in the same order, as the translated `$hlPowershell`; the records
//! equal the translated lexer's records.

use super::Lexer;
use super::input::Input;
use super::recs::Recs;
use super::scan;
use super::tables::byteset;
use crate::generated::Instance;
use crate::simd::V;
use crate::token_ids as tok;
use crate::wat_tables::POWERSHELL_WORDS;

/// The lexer for `name`, if this module handles it.
pub(crate) fn lexer(name: &str) -> Option<Lexer> {
    match name {
        "powershell" => Some(highlight),
        _ => None,
    }
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

/// The end of the whitespace run from `p` (`$scanWhitespace`). The NUL
/// after the input ends every run.
#[inline(always)]
fn whitespace_end(src: Input<'_>, mut p: usize) -> usize {
    // Most gaps are short: test a few bytes one by one first.
    for _ in 0..4 {
        // SAFETY: `p` lies at or before the NUL after the input, which
        // ends the run.
        if !is_space(unsafe { src.byte_unchecked(p) }) {
            return p;
        }
        p += 1;
    }
    loop {
        // Skip spaces 8 bytes at a time, then step over one other
        // whitespace byte (TAB to CR) and go on.
        // SAFETY: `p` lies at or before the NUL after the input, so the
        // 8-byte read stays inside the slack.
        let w = unsafe { src.word_unchecked(p) };
        let x = w ^ 0x2020_2020_2020_2020;
        let other =
            (((x & 0x7f7f_7f7f_7f7f_7f7f) + 0x7f7f_7f7f_7f7f_7f7f) | x) & 0x8080_8080_8080_8080;
        if other == 0 {
            p += 8;
            continue;
        }
        p += (other.trailing_zeros() / 8) as usize;
        // SAFETY: `p` lies inside the word just read.
        if !is_space(unsafe { src.byte_unchecked(p) }) {
            return p;
        }
        p += 1;
    }
}

/// The end of the whitespace run from `p` (`$scanWhitespace`), and
/// whether it holds a line break (`$lexGapHasBreak`). The NUL after the
/// input ends every run.
#[inline(always)]
fn whitespace_break_end(src: Input<'_>, mut p: usize) -> (usize, bool) {
    let mut brk = false;
    loop {
        // SAFETY: `p` lies at or before the NUL after the input, which
        // ends the run.
        let c = unsafe { src.byte_unchecked(p) };
        if !is_space(c) {
            return (p, brk);
        }
        brk |= c == b'\n' || c == b'\r';
        p += 1;
    }
}

/// Skip spaces and tabs from `p` on the current line (`$lexSkipSpaceAt`).
#[inline(always)]
fn skip_space_at(src: Input<'_>, mut p: usize) -> usize {
    // SAFETY: `p` lies at or before the NUL after the input, which ends
    // the run.
    while unsafe { src.byte_unchecked(p) } == b' ' || unsafe { src.byte_unchecked(p) } == b'\t' {
        p += 1;
    }
    p
}

/// The end of the number at `p` (`$lexScanNumber`, `$lexScanNumberBody`).
fn number_end(src: Input<'_>, mut p: usize) -> usize {
    // SAFETY: `p` starts at or before the input end, and the NUL there
    // ends the number, so every read is at most one byte past it.
    let hex = unsafe { src.byte_unchecked(p) } == b'0'
        && unsafe { src.byte_unchecked(p + 1) } | 0x20 == b'x';
    let mut prev = 0u8;
    loop {
        // SAFETY: as above.
        let c = unsafe { src.byte_unchecked(p) };
        if is_ident_continue(c) {
            prev = c;
            p += 1;
            continue;
        }
        if c == b'.' {
            // SAFETY: as above.
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

/// `$powershellWords` (lowercase words) as a perfect hash: a word of up
/// to 24 bytes is three little-endian integers (bytes 0-7, 8-15, 16-23),
/// zero past its end; words hold no NUL, so equal integers mean equal
/// words. A hash of the integers picks an index slot, which names the
/// entry to compare against.
struct Words {
    /// Entry number plus one for each hash slot, or 0 for no word.
    index: [u8; WORD_SLOTS],
    keys: [(u64, u64, u64); 128],
    groups: [u8; 128],
    mul: u64,
}

const WORD_SLOTS: usize = 2048;

/// The longest word.
const WORD_MAX: usize = 24;

/// The index slot of a word's integers.
#[inline(always)]
const fn word_slot(lo: u64, hi: u64, mul: u64) -> usize {
    ((lo ^ hi.rotate_left(29)).wrapping_mul(mul) >> (64 - WORD_SLOTS.trailing_zeros())) as usize
}

/// The integers of the word `w`.
const fn word_key(w: &[u8]) -> (u64, u64, u64) {
    let mut k = [0u64; 3];
    let mut i = 0;
    while i < w.len() {
        k[i / 8] |= (w[i] as u64) << (8 * (i % 8));
        i += 1;
    }
    (k[0], k[1], k[2])
}

/// For each first byte, a bit per length of the words in [`WORDS`]. A name
/// whose lowercased bit is clear is no word.
static WORD_LENGTHS: [u32; 256] = {
    let mut t = [0u32; 256];
    let mut i = 0;
    while i < POWERSHELL_WORDS.len() {
        let w = POWERSHELL_WORDS[i].word;
        assert!(w.len() <= WORD_MAX);
        t[w[0] as usize] |= 1 << w.len();
        i += 1;
    }
    t
};

/// The words, placed by searching for a multiplier that gives each its own
/// slot.
static WORDS: Words = {
    assert!(POWERSHELL_WORDS.len() < 128);
    let mut keys = [(0u64, 0u64, 0u64); 128];
    let mut groups = [0u8; 128];
    let mut i = 0;
    while i < POWERSHELL_WORDS.len() {
        keys[i] = word_key(POWERSHELL_WORDS[i].word);
        groups[i] = POWERSHELL_WORDS[i].group;
        i += 1;
    }
    let mut mul: u64 = 0x2545_f491_4f6c_dd1d;
    let mut attempt = 0;
    'search: loop {
        assert!(attempt < 20_000, "no collision-free hash: use more slots");
        let mut index = [0u8; WORD_SLOTS];
        let mut i = 0;
        while i < POWERSHELL_WORDS.len() {
            let s = word_slot(keys[i].0, keys[i].1, mul);
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
            groups,
            mul,
        };
    }
};

/// `w` with ASCII uppercase letters lowered, 8 bytes at a time.
#[inline(always)]
const fn lower8(w: u64) -> u64 {
    const ONES: u64 = 0x0101_0101_0101_0101;
    let low7 = w & (0x7f * ONES);
    // the high bit of each byte: set from `A` up, and from past `Z` up
    let ge_a = low7.wrapping_add((0x80 - b'A' as u64) * ONES);
    let gt_z = low7.wrapping_add((0x7f - b'Z' as u64) * ONES);
    let upper = (ge_a ^ gt_z) & !w & (0x80 * ONES);
    w | upper >> 2
}

/// The first `n` bytes at `p`, lowercased, as a little-endian integer; 0
/// for `n` 0, and all 8 for `n` over 8.
#[inline(always)]
fn lower_at(src: Input<'_>, p: usize, n: usize) -> u64 {
    if n == 0 {
        return 0;
    }
    // SAFETY: `p` lies at or before the input end, so `p + 8` lies inside
    // the slack.
    let w = unsafe { src.word_unchecked(p) };
    let w = lower8(w);
    if n >= 8 {
        w
    } else {
        w & (u64::MAX >> (64 - 8 * n))
    }
}

/// The `$powershellWords` group of `[lhs, rhs)` compared
/// case-insensitively, or 0 (`$psWordGroup`, `$lexLowerCopy`).
#[inline(always)]
fn word_group(src: Input<'_>, lhs: usize, rhs: usize) -> u32 {
    let n = rhs - lhs;
    // SAFETY: `lhs` is a word's start, before the input end.
    let first = lower8(unsafe { src.byte_unchecked(lhs) } as u64) as usize;
    if n > WORD_MAX || WORD_LENGTHS[first] >> n & 1 == 0 {
        return 0;
    }
    let lo = lower_at(src, lhs, n);
    let hi = lower_at(src, lhs + 8, n.saturating_sub(8));
    let at_entry = WORDS.index[word_slot(lo, hi, WORDS.mul)];
    if at_entry == 0 {
        return 0;
    }
    let e = at_entry as usize - 1;
    let hi2 = lower_at(src, lhs + 16, n.saturating_sub(16));
    if WORDS.keys[e] == (lo, hi, hi2) {
        WORDS.groups[e] as u32
    } else {
        0
    }
}

/// Word bytes: identifier bytes without `$`, and `-` (`$scanIdentRun` with
/// `-`).
static WORD: [bool; 256] = {
    let mut t = [false; 256];
    let mut c = 0;
    while c < 256 {
        let b = c as u8;
        t[c] = (is_ident_continue(b) && b != b'$') || b == b'-';
        c += 1;
    }
    t
};

/// Name bytes: identifier bytes without `$` (`$scanIdentRun` with `_`).
static NAME: [bool; 256] = {
    let mut t = [false; 256];
    let mut c = 0;
    while c < 256 {
        let b = c as u8;
        t[c] = is_ident_continue(b) && b != b'$';
        c += 1;
    }
    t
};

/// Type path bytes: identifier bytes without `$`, and `.`
/// (`$scanIdentRun` with `.`).
static TYPE_PATH: [bool; 256] = {
    let mut t = [false; 256];
    let mut c = 0;
    while c < 256 {
        let b = c as u8;
        t[c] = (is_ident_continue(b) && b != b'$') || b == b'.';
        c += 1;
    }
    t
};

/// The end of the run of `table` bytes from `p` (`$scanIdentRun`). The
/// NUL after the input ends every run.
#[inline(always)]
fn run_end(src: Input<'_>, mut p: usize, table: &[bool; 256]) -> usize {
    // SAFETY: `p` lies at or before the NUL after the input, which ends
    // the run.
    while table[unsafe { src.byte_unchecked(p) } as usize] {
        p += 1;
    }
    p
}

/// The end of the run of [`NAME`] bytes, or with `dash` of [`WORD`]
/// bytes, from `p`: a few bytes one by one, then 16 at a time
/// (`$scanIdentRun` with `_` or `-`). The NUL after the input ends every
/// run.
#[inline(always)]
fn name_end(src: Input<'_>, mut p: usize, dash: bool) -> usize {
    let table = if dash { &WORD } else { &NAME };
    // Most names are short: test a few bytes one by one first.
    for _ in 0..8 {
        // SAFETY: `p` lies at or before the NUL after the input, which
        // ends the run.
        if !table[unsafe { src.byte_unchecked(p) } as usize] {
            return p;
        }
        p += 1;
    }
    loop {
        // SAFETY: each load starts at or before the NUL after the input,
        // so it stays inside the slack.
        let v = unsafe { src.vec_unchecked(p) };
        let alpha = v.or(V::splat(0x20)).sub(V::splat(b'a')).le(V::splat(25));
        let digit = v.sub(V::splat(b'0')).le(V::splat(9));
        let under = v.eq(V::splat(b'_'));
        let extra = if dash {
            v.eq(V::splat(b'-'))
        } else {
            V::zero()
        };
        let ok = alpha.or(digit).or(under.or(extra).or(v.high()));
        let k = ok.not().first();
        if k < 16 {
            return p + k;
        }
        p += 16;
    }
}

/// End of the variable whose `$` (or `@`) sits at `p`: the name, then any
/// `scope:name` tail such as `$env:PATH` (`$psVarEnd`).
#[inline(always)]
fn var_end(src: Input<'_>, p: usize) -> usize {
    let mut e = p + 1;
    loop {
        e = name_end(src, e, false);
        // SAFETY: the NUL at the input end stops the name, so `e + 1` is at
        // most one byte past it.
        if unsafe { src.byte_unchecked(e) } != b':' {
            return e;
        }
        // SAFETY: as above.
        let c = unsafe { src.byte_unchecked(e + 1) };
        if !(is_ident_start(c) && c != b'$') {
            return e;
        }
        e += 1;
    }
}

/// Whether the bare word ending at `p` is a key: blanks on the same line,
/// then `=` that isn't `==` (`$psIsKey`).
#[inline(always)]
fn is_key(src: Input<'_>, p: usize) -> bool {
    let p = skip_space_at(src, p);
    // SAFETY: the NUL at the input end stops the run, so `p + 1` is at most
    // one byte past it.
    unsafe { src.byte_unchecked(p) == b'=' && src.byte_unchecked(p + 1) != b'=' }
}

/// Scan a string body of `kind` (1 `"`, 2 `'`, 3 `@"`, 4 `@'`) from `p`
/// with the bytes since `seg` unemitted; returns the end and the status: 1
/// past the closer, 2 past a `$(` that opens a subexpression, 0 at the end
/// (`$psStringBody`, `$psVarEnd`).
fn string_body(
    src: Input<'_>,
    end: usize,
    mut out: Recs,
    mut p: usize,
    mut seg: usize,
    kind: u32,
) -> (usize, Recs, u32) {
    let q = if kind & 1 == 0 { b'\'' } else { b'"' };
    let expand = kind & 1 != 0;
    let mut status = 0;
    loop {
        let x = if expand {
            scan::find3(src.bytes(), p, end, q, b'`', b'$')
        } else {
            scan::find3(src.bytes(), p, end, q, q, q)
        };
        if x >= end {
            p = end;
            break;
        }
        // SAFETY: `x` is before the input end (tested above), so reads up to
        // `x + 1` stay at or before it.
        let c = unsafe { src.byte_unchecked(x) };
        if c == q {
            if kind >= 3 {
                // `"@` closes a here-string only at the start of a line
                // SAFETY: as above.
                if unsafe { src.byte_unchecked(x + 1) } == b'@'
                    && x + 1 < end
                    && (x == 0 || src.byte(x - 1) == b'\n' || src.byte(x - 1) == b'\r')
                {
                    p = x + 2;
                    status = 1;
                    break;
                }
                p = x + 1;
                continue;
            }
            // a doubled quote escapes itself
            // SAFETY: as above.
            if unsafe { src.byte_unchecked(x + 1) } == q && x + 1 < end {
                out.emit(tok::STRING, seg, x);
                p = x + 2;
                out.tok(tok::STRING_ESCAPE, p);
                seg = p;
                continue;
            }
            p = x + 1;
            status = 1;
            break;
        }
        if c == b'`' {
            out.emit(tok::STRING, seg, x);
            let mut e = scan::utf8_span_end(src.bytes(), x + 2, end);
            // a backtick before CRLF continues the line like one before LF
            if e == x + 2 && src.byte(x + 1) == b'\r' && src.byte(e) == b'\n' && e < end {
                e += 1;
            }
            out.emit(tok::STRING_ESCAPE, x, e);
            p = e;
            seg = e;
            continue;
        }
        // `$`
        // SAFETY: as above.
        let c2 = if x + 1 < end {
            unsafe { src.byte_unchecked(x + 1) }
        } else {
            0
        };
        if c2 == b'(' {
            out.emit(tok::STRING, seg, x);
            p = x + 2;
            out.tok(tok::PUNCTUATION_SPECIAL, p);
            return (p, out, 2);
        }
        if c2 == b'{' {
            let mut e = scan::find3(src.bytes(), x + 2, end, b'}', b'\n', b'\r');
            if e < end && src.byte(e) == b'}' {
                e += 1;
            }
            out.emit(tok::STRING, seg, x);
            out.emit(tok::VARIABLE, x, e);
            p = e;
            seg = e;
            continue;
        }
        if is_ident_start(c2) && c2 != b'$' {
            let e = var_end(src, x);
            out.emit(tok::STRING, seg, x);
            out.emit(tok::VARIABLE, x, e);
            p = e;
            seg = e;
            continue;
        }
        if c2 == b'$' || c2 == b'?' || c2 == b'^' {
            out.emit(tok::STRING, seg, x);
            p = x + 2;
            out.tok(tok::VARIABLE_SPECIAL, p);
            seg = p;
            continue;
        }
        p = x + 1;
    }
    out.emit(tok::STRING, seg, p);
    (p, out, status)
}

/// Operator bytes (`$psIsOp`).
const OPS: [bool; 256] = byteset(b"!%&*+-/<=>?|");

/// Byte classes for the main dispatch.
mod class {
    /// A letter, `_`, or any byte from 0x80: a word.
    pub const IDENT: u8 = 0;
    /// Anything else: one character colored `none`.
    pub const OTHER: u8 = 1;
    pub const DIGIT: u8 = 2;
    pub const HASH: u8 = 3;
    pub const LT: u8 = 4;
    /// `"` or `'`.
    pub const QUOTE: u8 = 5;
    pub const AT: u8 = 6;
    pub const DOLLAR: u8 = 7;
    pub const OPEN_SQUARE: u8 = 8;
    pub const DASH: u8 = 9;
    pub const BACKTICK: u8 = 10;
    pub const DOT: u8 = 11;
    /// `(`, `)`, `]`, `{`, `}`.
    pub const BRACKET: u8 = 12;
    /// `,` or `;`.
    pub const DELIM: u8 = 13;
    pub const COLON: u8 = 14;
    /// Another operator byte (`$psIsOp`).
    pub const OP: u8 = 15;
    /// NUL: the end of the input, or one byte colored `none` inside it.
    pub const NUL: u8 = 16;
}

/// The [`class`] of each byte.
static CLASS: [u8; 256] = {
    let mut t = [class::OTHER; 256];
    let mut c = 1;
    t[0] = class::NUL;
    while c < 256 {
        let b = c as u8;
        t[c] = if is_ident_start(b) && b != b'$' {
            class::IDENT
        } else if is_digit(b) {
            class::DIGIT
        } else {
            match b {
                b'#' => class::HASH,
                b'<' => class::LT,
                b'"' | b'\'' => class::QUOTE,
                b'@' => class::AT,
                b'$' => class::DOLLAR,
                b'[' => class::OPEN_SQUARE,
                b'-' => class::DASH,
                b'`' => class::BACKTICK,
                b'.' => class::DOT,
                b'(' | b')' | b']' | b'{' | b'}' => class::BRACKET,
                b',' | b';' => class::DELIM,
                b':' => class::COLON,
                _ if OPS[c] => class::OP,
                _ => class::OTHER,
            }
        };
        c += 1;
    }
    t
};

/// Lex the PowerShell input of `len` bytes at `base` (`$hlPowershell`).
fn highlight(inst: &mut Instance, base: usize, len: usize) {
    // SAFETY: `base..base + len + SLACK` lies inside lexer memory, and this
    // lexer calls no translated function that could move it.
    let src = unsafe { Input::new(inst, base, len) };
    let out = lex(src, len, Recs::load(inst));
    out.store(inst);
}

/// The lexer loop (`$hlPowershell` with no streaming), with its inline
/// rules: line breaks in gaps (`$lexGapHasBreak`), comments
/// (`$lexLineComment`), operators (`$psIsOp`), and bounded lookahead
/// (`$psByte`, which the NUL after the input stands in for).
fn lex(src: Input<'_>, end: usize, mut out: Recs) -> Recs {
    // `$lexEmitLeadingContinuation`, then the leading whitespace: the state
    // is already that of a statement start, so only the record changes.
    let lead = scan::utf8_span_end(src.bytes(), 0, end);
    out.gap(0, lead);
    let mut p = whitespace_end(src, lead);
    out.gap(lead, p);

    // where a bare word is a command name
    let mut cmd_pos = true;
    // 1 after `function`, 2 after `class` or a class name's `:`, 3 after a
    // class name; lasts one token
    let mut expect: u32 = 0;
    // after `.` or `::`
    let mut member = false;
    // the open string body (0 for none) and the body suspended by a `$(`
    // subexpression, whose parens `interp` counts
    let mut str_kind: u32 = 0;
    let mut seg = 0usize;
    let mut interp: u32 = 0;
    let mut interp_kind: u32 = 0;

    'next: loop {
        // Scan the open string body from `p` (the top-of-loop rule for
        // `$strKind`).
        macro_rules! body {
            () => {{
                let status;
                (p, out, status) = string_body(src, end, out, p, seg, str_kind);
                seg = p;
                if status == 2 {
                    // `$(` opened a subexpression: code until the matching
                    // `)`
                    interp_kind = str_kind;
                    interp = 1;
                    str_kind = 0;
                    cmd_pos = true;
                } else if status == 1 {
                    str_kind = 0;
                }
                continue 'next;
            }};
        }

        if str_kind != 0 {
            core::hint::cold_path();
            if p >= end {
                break;
            }
            body!();
        }

        // The gap before the next token.
        // SAFETY: every rule stops at or before the input end, so `p + 1`
        // lies inside the slack.
        let c = unsafe { src.byte_unchecked(p) };
        if c == b' ' && !is_space(unsafe { src.byte_unchecked(p + 1) }) {
            p += 1;
            out.extend(p);
        } else if is_space(c) {
            let brk;
            (p, brk) = whitespace_break_end(src, p + 1);
            out.extend(p);
            // a line break starts a statement
            if c == b'\n' || c == b'\r' || brk {
                cmd_pos = true;
                member = false;
            }
        }
        let lhs = p;
        // SAFETY: `p` lies at or before the input end, so `p + 1` lies
        // inside the slack.
        let c = unsafe { src.byte_unchecked(p) };
        let c2 = unsafe { src.byte_unchecked(p + 1) };
        // `function`/`class` name only the next token
        let want = expect;
        expect = 0;

        // Emit `[lhs, p)` as `hl` (`$tok`).
        macro_rules! tok {
            ($hl:expr) => {{
                out.tok($hl, p);
                continue 'next;
            }};
        }
        // A value or name token ends a member access and a command
        // position (`$valueTok`).
        macro_rules! value {
            ($hl:expr) => {{
                member = false;
                cmd_pos = false;
                tok!($hl)
            }};
        }
        // A string opener: the body is scanned at the top of the loop,
        // which comes right after; the opener and the body's first bytes
        // share a color, so the body's first token starts at the opener.
        macro_rules! string {
            ($kind:expr) => {{
                member = false;
                cmd_pos = false;
                str_kind = $kind;
                seg = lhs;
                body!();
            }};
        }

        match CLASS[c as usize] {
            class::IDENT => {
                // the word: a name, and when a `-` follows it, the rest of
                // a `Verb-Noun` name
                p = name_end(src, p + 1, false);
                // SAFETY (each read of `p` or `rhs` in this rule): a name
                // ends at or before the input end.
                let dash = unsafe { src.byte_unchecked(p) } == b'-';
                if dash {
                    p = name_end(src, p, true);
                }
                let rhs = p;
                // a name awaited by `function` or `class`; 3 (a `:` may
                // follow the class name) names nothing itself
                let mut g = if want < 3 { want } else { 0 };
                if is_key(src, rhs) {
                    // a hashtable, splat, or DSC key
                    value!(tok::PROPERTY)
                }
                let hl;
                if dash {
                    // a `Verb-Noun` cmdlet name
                    hl = if g == 1 {
                        tok::FUNCTION_DEFINITION
                    } else {
                        tok::FUNCTION
                    };
                } else if member {
                    hl = if unsafe { src.byte_unchecked(rhs) } == b'(' {
                        tok::FUNCTION_METHOD
                    } else {
                        tok::PROPERTY
                    };
                } else if g != 0 {
                    hl = if g == 1 {
                        tok::FUNCTION_DEFINITION
                    } else {
                        tok::TYPE
                    };
                    // `class C : Base` - a `:` next names the base type
                    if g == 2 {
                        expect = 3;
                    }
                } else {
                    g = word_group(src, lhs, rhs);
                    let mut h = match g {
                        1 => tok::KEYWORD_CONTROL,
                        2 => {
                            expect = 1;
                            tok::KEYWORD_DECLARATION
                        }
                        3 => {
                            expect = 2;
                            tok::KEYWORD_DECLARATION
                        }
                        4 => tok::KEYWORD_DECLARATION,
                        5 => tok::KEYWORD_IMPORT,
                        // `in` is the only dash operator that also stands
                        // bare
                        6 if rhs - lhs == 2 => tok::KEYWORD_OPERATOR,
                        _ => tok::NONE,
                    };
                    if h == tok::NONE && (cmd_pos || unsafe { src.byte_unchecked(rhs) } == b'(') {
                        h = tok::FUNCTION;
                    }
                    hl = h;
                }
                value!(hl)
            }
            class::DOLLAR => {
                member = false;
                cmd_pos = false;
                if c2 == b'(' {
                    p += 2;
                    out.tok(tok::PUNCTUATION_SPECIAL, p);
                    if interp != 0 {
                        interp += 1;
                    }
                    cmd_pos = true;
                    continue 'next;
                }
                if c2 == b'{' {
                    p = scan::find3(src.bytes(), p + 2, end, b'}', b'\n', b'\r');
                    if p < end && src.byte(p) == b'}' {
                        p += 1;
                    }
                    tok!(tok::VARIABLE)
                }
                if c2 == b'$' || c2 == b'?' || c2 == b'^' {
                    p += 2;
                    tok!(tok::VARIABLE_SPECIAL)
                }
                if is_ident_start(c2) {
                    p = var_end(src, p);
                    let g = word_group(src, lhs + 1, p);
                    let hl = if g == 9 || (c2 == b'_' && p - lhs == 2) {
                        tok::VARIABLE_SPECIAL
                    } else if g == 8 {
                        tok::CONSTANT_BUILTIN
                    } else if g == 7 {
                        tok::BOOLEAN
                    } else {
                        tok::VARIABLE
                    };
                    tok!(hl)
                }
                p += 1;
                tok!(tok::NONE)
            }
            class::QUOTE => {
                // A literal without escapes, expansions, or a doubled quote
                // is one token.
                let close = if c == b'"' {
                    scan::find3(src.bytes(), p + 1, end, c, b'`', b'$')
                } else {
                    scan::find3(src.bytes(), p + 1, end, c, c, c)
                };
                // SAFETY: the scan stops at or before the input end.
                if unsafe { src.byte_unchecked(close) } == c
                    && close < end
                    && unsafe { src.byte_unchecked(close + 1) } != c
                {
                    p = close + 1;
                    value!(tok::STRING)
                }
                p += 1;
                string!(if c == b'"' { 1 } else { 2 })
            }
            class::HASH => {
                // `$lexLineComment`
                p = scan::line_end(src.bytes(), p + 1, end);
                out.tok(tok::COMMENT, p);
                continue 'next;
            }
            class::LT if c2 == b'#' => {
                // a `<# ... #>` block comment
                let mut q = p + 2;
                let mut closed = false;
                loop {
                    q = scan::find3(src.bytes(), q, end, b'#', b'#', b'#');
                    if q >= end {
                        break;
                    }
                    // SAFETY: `q` is before the input end (tested above).
                    if unsafe { src.byte_unchecked(q + 1) } == b'>' && q + 1 < end {
                        closed = true;
                        break;
                    }
                    q += 1;
                }
                p = if closed { q + 2 } else { end };
                out.tok(tok::COMMENT, p);
                continue 'next;
            }
            class::AT if c2 == b'"' || c2 == b'\'' => {
                p += 2;
                string!(if c2 == b'"' { 3 } else { 4 })
            }
            class::AT if c2 == b'(' || c2 == b'{' => {
                // `@(...)` arrays, `@{...}` hashtables
                p += 1;
                cmd_pos = false;
                tok!(tok::PUNCTUATION_SPECIAL)
            }
            class::AT if is_ident_start(c2) && c2 != b'$' => {
                // `@args` splatting
                p = var_end(src, p);
                cmd_pos = false;
                tok!(tok::VARIABLE)
            }
            class::OPEN_SQUARE if is_ident_start(c2) && c2 != b'$' => {
                // `[type]` literals and `[Attribute(...)]`
                p += 1;
                out.tok(tok::PUNCTUATION_BRACKET, p);
                p = run_end(src, p, &TYPE_PATH);
                // SAFETY: the NUL at the input end stops the run.
                if unsafe { src.byte_unchecked(p) } == b'(' {
                    // the attribute's arguments are values, not commands
                    out.tok(tok::ATTRIBUTE, p);
                    p += 1;
                    out.tok(tok::PUNCTUATION_BRACKET, p);
                } else {
                    out.tok(tok::TYPE, p);
                }
                member = false;
                cmd_pos = false;
                continue 'next;
            }
            class::DASH if (c2 | 32).wrapping_sub(b'a') <= 25 => {
                // `-eq` operators and `-Name` parameters
                p = name_end(src, p + 1, false);
                let g = word_group(src, lhs + 1, p);
                cmd_pos = false;
                tok!(if g == 6 || (p - lhs == 2 && c2 | 32 == b'f') {
                    tok::KEYWORD_OPERATOR
                } else {
                    tok::VARIABLE_PARAMETER
                })
            }
            class::BACKTICK => {
                // a backtick escapes the next byte, or joins the next line
                p = scan::utf8_span_end(src.bytes(), p + 2, end);
                if c2 == b'\r' && src.byte(p) == b'\n' && p < end {
                    p += 1;
                }
                tok!(tok::STRING_ESCAPE)
            }
            class::DIGIT => {
                p = number_end(src, p);
                value!(tok::NUMBER)
            }
            class::DOT if is_digit(c2) => {
                p = number_end(src, p);
                value!(tok::NUMBER)
            }
            class::BRACKET | class::OPEN_SQUARE => {
                p += 1;
                if interp != 0 {
                    if c == b'(' {
                        interp += 1;
                    }
                    if c == b')' {
                        interp -= 1;
                        if interp == 0 {
                            // the paren matching `$(` returns to the string
                            // body
                            out.tok(tok::PUNCTUATION_SPECIAL, p);
                            str_kind = interp_kind;
                            interp_kind = 0;
                            seg = p;
                            member = false;
                            continue 'next;
                        }
                    }
                }
                out.tok(tok::PUNCTUATION_BRACKET, p);
                member = false;
                cmd_pos = c == b'(' || c == b'{';
                continue 'next;
            }
            class::DELIM => {
                p += 1;
                out.tok(tok::PUNCTUATION_DELIMITER, p);
                member = false;
                cmd_pos = c == b';';
                continue 'next;
            }
            class::COLON if c2 == b':' => {
                p += 2;
                out.tok(tok::OPERATOR, p);
                member = true;
                continue 'next;
            }
            class::DOT => {
                if c2 == b'.' {
                    p += 2;
                    out.tok(tok::OPERATOR, p);
                    member = false;
                } else {
                    p += 1;
                    out.tok(tok::PUNCTUATION_DELIMITER, p);
                    member = is_ident_start(c2) && c2 != b'$';
                }
                cmd_pos = false;
                continue 'next;
            }
            class::NUL if p >= end => break,
            class::OP | class::LT | class::DASH => {
                // SAFETY: the NUL at the input end stops the run.
                while OPS[unsafe { src.byte_unchecked(p) } as usize] {
                    p += 1;
                }
                out.tok(tok::OPERATOR, p);
                member = false;
                // a pipeline, a call operator, and an assignment start a
                // command
                cmd_pos = c == b'|' || c == b'&' || c == b'=';
                continue 'next;
            }
            _ => {
                p = scan::utf8_span_end(src.bytes(), p + 1, end);
                // the `:` after a class name: the base type follows
                if c == b':' && want == 3 {
                    expect = 2;
                }
                value!(tok::NONE)
            }
        }
    }
    out
}
