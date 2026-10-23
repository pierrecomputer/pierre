//! WAT sources: src/langs/dockerfile.wat src/common.wat src/scan.wat
//!
//! Native Dockerfile lexer. A Dockerfile is line-oriented: the first word
//! of each logical line is the instruction, which sets how the rest of the
//! line is colored (shell commands after `RUN`, the `AS` of `FROM`, the
//! wrapped instruction of `HEALTHCHECK`/`ONBUILD`). A `\` before the line
//! break joins the next line, and `<<EOF` heredocs take the lines after
//! their opener. The records equal the translated `dockerfile` lexer's
//! records.

#[cfg(target_arch = "aarch64")]
use core::arch::aarch64::*;

use super::Lexer;
use super::scan;
use super::tables::{KeywordTable, byteset};
use crate::Rec;
use crate::generated::Instance;
use crate::token_ids as tok;
use crate::wat_tables::DOCKERFILE_WORDS;

/// The lexer for `name`, if this module handles it.
pub(crate) fn lexer(name: &str) -> Option<Lexer> {
    match name {
        "dockerfile" => Some(highlight),
        _ => None,
    }
}

/// `$dockerfileWords`.
static WORDS: KeywordTable<512> = KeywordTable::new(DOCKERFILE_WORDS);

/// The longest word in [`WORDS`]; a longer name is no word.
const WORD_MAX: usize = 16;

/// Shell operator bytes (`$dockerIsShellOp`).
static SHELL_OP: [bool; 256] = byteset(b"&;<=>|");

/// Whitespace kinds for the gap scan: 1 a blank, 2 a line break, 0 not
/// whitespace (`$lexIsSpace`).
static SPACE: [u8; 256] = {
    let mut t = [0u8; 256];
    t[b' ' as usize] = 1;
    t[0x09] = 1;
    t[0x0b] = 1;
    t[0x0c] = 1;
    t[b'\n' as usize] = 2;
    t[b'\r' as usize] = 2;
    t
};

/// Identifier bytes with `$` (`$lexScanIdent`).
static IDENT_DOLLAR: [bool; 256] = ident_run_table(b'$');

/// Identifier bytes with `-` (`$scanIdentRun` with `-`).
static IDENT_DASH: [bool; 256] = ident_run_table(b'-');

/// Identifier bytes (`$scanIdentRun` with `_`).
static IDENT_RUN: [bool; 256] = ident_run_table(b'_');

/// Bytes that end a word: all but `[A-Za-z0-9_-]` and bytes from 0x80
/// (`$scanIdentRun` with `-`).
const WORD_STOP: [bool; 256] = {
    let run = ident_run_table(b'-');
    let mut t = [false; 256];
    let mut c = 0;
    while c < 256 {
        t[c] = !run[c];
        c += 1;
    }
    t
};
const WORD_STOP_NIB: ([u8; 16], [u8; 16]) = nibbles(&WORD_STOP);

/// Bytes that start a token of the final rule of `$hlDockerfile` (one
/// byte colored `none`) after a line's first token, whatever the state:
/// no earlier rule can match them.
const PLAIN_START: [bool; 256] = {
    let mut t = byteset(b"!#%()*+./:?@^`{}~\x7f");
    let mut c = 1;
    while c < 0x20 {
        t[c] = !is_space(c as u8);
        c += 1;
    }
    t
};

/// [`PLAIN_START`] and the digits: a digit right after another token, with
/// no gap, is plain too.
const PLAIN_RUN: [bool; 256] = {
    let mut t = PLAIN_START;
    let mut c = b'0';
    while c <= b'9' {
        t[c as usize] = true;
        c += 1;
    }
    t
};

/// Bytes that continue a run of words and plain bytes (see the run rule in
/// [`highlight`]): word starts and [`PLAIN_RUN`] bytes. (A `-` that opens
/// no option continues it too.)
static RUN: [bool; 256] = {
    let mut t = PLAIN_RUN;
    let mut c = 0;
    while c < 256 {
        let b = c as u8;
        t[c] |= is_ident_start(b) && b != b'$';
        c += 1;
    }
    t
};

/// The token classes of the first byte after a line's first token: a word
/// (identifier start but `$`), a run of plain bytes, or anything else.
mod class {
    pub const WORD: u8 = 1;
    pub const PLAIN: u8 = 2;
    pub const OTHER: u8 = 0;
}

/// The [`class`] of each byte.
static CLASS: [u8; 256] = {
    let mut t = [class::OTHER; 256];
    let mut c = 0;
    while c < 256 {
        let b = c as u8;
        if is_ident_start(b) && b != b'$' {
            t[c] = class::WORD;
        } else if PLAIN_START[c] {
            t[c] = class::PLAIN;
        }
        c += 1;
    }
    t
};

/// `[A-Za-z0-9_]`, bytes from 0x80, and `x` (`$scanIdentRun`).
const fn ident_run_table(x: u8) -> [bool; 256] {
    let mut t = [false; 256];
    let mut c = 0;
    while c < 256 {
        let b = c as u8;
        t[c] = b >= 0x80 || (b | 32).wrapping_sub(b'a') <= 25 || is_digit(b) || b == b'_' || b == x;
        c += 1;
    }
    t
}

/// The instruction kinds of `$hlDockerfile`'s `$inst`.
const FROM: u32 = 1;
const SHELL: u32 = 2;
const OTHER: u32 = 3;
const WRAPPER: u32 = 4;

/// The byte at `i`. Callers read at most 16 bytes past the input end, which
/// the 96-byte input slack covers. The byte at the input end is NUL, so at
/// any position up to the end this is also `$dockerByte`, which reads 0 at
/// and past the end; every `$dockerByte` position here lies at or before
/// the end.
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

/// The end of the run of `table` bytes from `p` (`$scanIdentRun`). The
/// NUL after the input ends every run.
#[inline(always)]
fn ident_run(src: &[u8], mut p: usize, table: &[bool; 256]) -> usize {
    while table[at(src, p) as usize] {
        p += 1;
    }
    p
}

/// Skip spaces and tabs from `p` on the current line (`$lexSkipSpaceAt`).
/// The NUL after the input stops it.
#[inline(always)]
fn skip_space_at(src: &[u8], mut p: usize) -> usize {
    while at(src, p) == b' ' || at(src, p) == b'\t' {
        p += 1;
    }
    p
}

/// A byte set as two nibble tables: byte `b` is in the set when
/// `hi[b >> 4] & lo[b & 15]` is nonzero. Each bit stands for a group of
/// high nibbles that admit the same low nibbles; building fails when the
/// set needs more than eight groups.
const fn nibbles(set: &[bool; 256]) -> ([u8; 16], [u8; 16]) {
    let mut rows = [0u16; 16];
    let mut h = 0;
    while h < 16 {
        let mut l = 0;
        while l < 16 {
            if set[h * 16 + l] {
                rows[h] |= 1 << l;
            }
            l += 1;
        }
        h += 1;
    }
    let mut hi = [0u8; 16];
    let mut lo = [0u8; 16];
    let mut groups = [0u16; 8];
    let mut n = 0;
    h = 0;
    while h < 16 {
        if rows[h] != 0 {
            let mut g = 0;
            while g < n && groups[g] != rows[h] {
                g += 1;
            }
            if g == n {
                assert!(n < 8, "too many nibble groups");
                groups[n] = rows[h];
                n += 1;
            }
            hi[h] = 1 << g;
            let mut l = 0;
            while l < 16 {
                if rows[h] >> l & 1 != 0 {
                    lo[l] |= 1 << g;
                }
                l += 1;
            }
        }
        h += 1;
    }
    (hi, lo)
}

/// The first byte from `p` in the set of the nibble tables `nib` (see
/// [`nibbles`]), 16 bytes per step. The caller makes sure a set byte lies
/// within 16 bytes past the input end, or stops the scan itself.
#[inline(always)]
fn find_set(src: &[u8], mut p: usize, nib: &([u8; 16], [u8; 16]), set: &[bool; 256]) -> usize {
    #[cfg(target_arch = "aarch64")]
    // SAFETY: each 16-byte load starts at or before a set byte that lies
    // at most 16 bytes past the input end, inside the slack.
    unsafe {
        let _ = set;
        let hi_t = vld1q_u8(nib.0.as_ptr());
        let lo_t = vld1q_u8(nib.1.as_ptr());
        loop {
            let v = vld1q_u8(src.as_ptr().add(p));
            let hi = vqtbl1q_u8(hi_t, vshrq_n_u8::<4>(v));
            let lo = vqtbl1q_u8(lo_t, vandq_u8(v, vdupq_n_u8(15)));
            let k = scan::first_lane(vtstq_u8(hi, lo));
            if k < 16 {
                return p + k;
            }
            p += 16;
        }
    }
    #[cfg(not(target_arch = "aarch64"))]
    {
        let _ = nib;
        while !set[at(src, p) as usize] {
            p += 1;
        }
        p
    }
}

/// The table group of the word `[lhs, rhs)`, compared case-insensitively
/// (`$dockerWordGroup`, `$lexLowerCopy`).
#[inline(always)]
fn word_group(src: &[u8], lhs: usize, rhs: usize) -> u32 {
    let n = rhs - lhs;
    if n > WORD_MAX {
        return 0;
    }
    // Lowercase `A-Z` in the name's first 16 bytes, 8 at a time: a byte
    // is uppercase when its low 7 bits are at least `A`, not above `Z`,
    // and its top bit is clear.
    let lower = |w: u64| {
        let h = w & 0x7f7f_7f7f_7f7f_7f7f;
        let ge_a = h + 0x3f3f_3f3f_3f3f_3f3f;
        let gt_z = h + 0x2525_2525_2525_2525;
        let upper = ge_a & !gt_z & !w & 0x8080_8080_8080_8080;
        w | upper >> 2
    };
    // SAFETY: `lhs` lies at or before the input end, so 16 bytes from it
    // lie inside the slack.
    let (lo, hi) = unsafe {
        let p = src.as_ptr().add(lhs);
        (
            p.cast::<u64>().read_unaligned(),
            p.add(8).cast::<u64>().read_unaligned(),
        )
    };
    let mut buf = [0u8; 32];
    buf[..8].copy_from_slice(&lower(u64::from_le(lo)).to_le_bytes());
    buf[8..16].copy_from_slice(&lower(u64::from_le(hi)).to_le_bytes());
    WORDS.group(&buf, 0, n)
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

    /// `[lhs, rhs)` as `hl` when it is non-empty (`$emitTok`).
    #[inline(always)]
    fn emit(&mut self, hl: u32, lhs: usize, rhs: usize) {
        if lhs < rhs {
            self.tok(hl, rhs);
        }
    }

    /// Whitespace `[lhs, rhs)` extends the last record (`$emitGap`). Every
    /// gap after the input's leading whitespace follows a token's record.
    #[inline(always)]
    fn gap(&mut self, lhs: usize, rhs: usize) {
        if lhs < rhs {
            // SAFETY: the record before `cur` is written (see above).
            unsafe { (*self.cur.sub(1)).end = rhs as u32 };
        }
    }
}

/// The end of the escape at backslash `p` (`$lexEscapeEnd`).
#[inline(always)]
fn escape_end(src: &[u8], p: usize, end: usize) -> usize {
    let mut e = scan::utf8_span_end(src, p + 2, end);
    if e == p + 2 && at(src, p + 1) == b'\r' && e < end && at(src, e) == b'\n' {
        e += 1;
    }
    e
}

/// The end of the number at `p` (`$lexScanNumber`, `$lexScanNumberBody`).
/// The NUL after the input stops it.
fn number_end(src: &[u8], mut p: usize) -> usize {
    let hex = at(src, p) == b'0' && at(src, p + 1) | 0x20 == b'x';
    let mut prev = 0u8;
    loop {
        let c = at(src, p);
        if is_ident_continue(c) {
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

/// The end of the `${...}` or `$name` reference whose `$` sits at `p`,
/// given the byte after it, or `None` when neither opens (`$dockerVar`).
/// A `${` reference ends at the first `}` or line break.
#[inline(always)]
fn var_end(src: &[u8], end: usize, p: usize, c2: u8) -> Option<usize> {
    if c2 == b'{' {
        let mut q = scan::find3(src, p + 2, end, b'}', b'\n', b'\r');
        if at(src, q) == b'}' {
            q += 1;
        }
        return Some(q);
    }
    if !is_ident_start(c2) {
        return None;
    }
    Some(ident_run(src, p + 1, &IDENT_RUN))
}

/// The double-quoted string at `ptr`, with escapes emitted separately; it
/// ends at its quote or the line break. Returns the end (`$lexString`,
/// `$lexStringBody`).
#[inline(never)]
fn string(src: &[u8], end: usize, mut ptr: usize, out: &mut Out) -> usize {
    let mut o = *out;
    let mut seg = ptr;
    ptr += 1;
    loop {
        ptr = scan::string_special(src, ptr, end, b'"');
        if ptr >= end {
            break;
        }
        let c = at(src, ptr);
        if c == b'"' {
            ptr += 1;
            break;
        }
        // a raw line break: unterminated, left unconsumed
        if c != b'\\' {
            break;
        }
        o.emit(tok::STRING, seg, ptr);
        let e = escape_end(src, ptr, end);
        o.emit(tok::STRING_ESCAPE, ptr, e);
        ptr = e;
        seg = ptr;
    }
    o.emit(tok::STRING, seg, ptr);
    *out = o;
    ptr
}

/// The `=value` after an instruction option at `ptr`: plain text up to
/// whitespace, with `$name` and `${name}` references as variables. Returns
/// the end (the option rule of `$hlDockerfile`).
#[inline(never)]
fn option_value(src: &[u8], end: usize, mut ptr: usize, out: &mut Out) -> usize {
    let mut o = *out;
    let mut lhs = ptr;
    ptr += 1;
    while ptr < end {
        let c = at(src, ptr);
        if is_space(c) {
            break;
        }
        if c == b'$' {
            let p = ptr;
            if let Some(q) = var_end(src, end, ptr, at(src, ptr + 1)) {
                ptr = q;
                o.emit(tok::NONE, lhs, p);
                o.emit(tok::VARIABLE, p, ptr);
                lhs = ptr;
                continue;
            }
        }
        ptr += 1;
    }
    o.emit(tok::NONE, lhs, ptr);
    *out = o;
    ptr
}

/// A pending heredoc's body after its opener's line: skip the blanks left
/// on that line and, at its line break, emit the break as a gap from `gap`
/// and the body through the line holding the `n`-byte delimiter at
/// `delim` as one string; `strip` permits leading blanks on that line.
/// Returns the new position and whether the body was emitted; without a
/// body the position is after the blanks (`$dockerHeredoc`,
/// `$lineDelimiterEnds`).
#[inline(never)]
#[allow(clippy::too_many_arguments)]
fn heredoc(
    src: &[u8],
    end: usize,
    ptr: usize,
    gap: usize,
    delim: usize,
    n: usize,
    strip: bool,
    o: &mut Out,
) -> (usize, bool) {
    let mut ptr = skip_space_at(src, ptr);
    if ptr >= end {
        return (ptr, false);
    }
    let b = at(src, ptr);
    if b != b'\n' && b != b'\r' {
        return (ptr, false);
    }
    ptr += 1;
    if b == b'\r' && at(src, ptr) == b'\n' {
        ptr += 1;
    }
    o.gap(gap, ptr);
    let body = ptr;
    loop {
        if ptr >= end {
            break;
        }
        let mut line = ptr;
        if strip {
            line = skip_space_at(src, line);
        }
        let mut same = line + n <= end && src[line..line + n] == src[delim..delim + n];
        // the delimiter must fill its line, then the line and one break
        // byte join the body
        if same {
            let q = line + n;
            same = q >= end || at(src, q) == b'\n' || at(src, q) == b'\r';
        }
        ptr = scan::line_end(src, ptr, end);
        if ptr < end {
            ptr += 1;
        }
        if same {
            break;
        }
    }
    o.emit(tok::STRING, body, ptr);
    (ptr, true)
}

/// Lex the Dockerfile input of `len` bytes at `base` (`$hlDockerfile`).
fn highlight(inst: &mut Instance, base: usize, len: usize) {
    let mem_ptr = inst.mem.bytes().as_ptr();
    // SAFETY: `base..base + len + 96` lies inside lexer memory, which is not
    // reallocated while this lexer runs.
    let src: &[u8] = unsafe { core::slice::from_raw_parts(mem_ptr.add(base), len + 96) };
    let end = len;
    let v = &mut inst.ext.recs;
    let start = v.as_mut_ptr();
    let mut o = Out {
        // SAFETY: `len` records are written.
        cur: unsafe { start.add(v.len()) },
        // SAFETY: one past the allocation.
        limit: unsafe { start.add(v.capacity()) },
        last: v.last().map_or(u32::MAX, |r| r.token),
    };
    // Call an out-of-line helper that writes records through a copy of the
    // writer, so the loop's writer stays in registers.
    macro_rules! call {
        ($f:ident($($arg:expr),*)) => {{
            let mut t = o;
            let r = $f(src, end, $($arg,)* &mut t);
            o = t;
            r
        }};
    }

    // 1 at a line's first token, 2 at the first token of a line joined by
    // `\`, 0 elsewhere
    let mut line_head = 1u32;
    // the instruction kind (`FROM` ... `WRAPPER`), or 0
    let mut kind = 0u32;
    let mut cmd_head = false;
    // the pending heredoc's delimiter: offset, length (0 for none), and
    // whether its closing line may be indented
    let mut hd_delim = 0usize;
    let mut hd_len = 0usize;
    let mut hd_strip = false;

    // `$lexEmitLeadingContinuation` and the leading whitespace: one gap,
    // which writes the first record when there is none yet. The state is
    // already that of a line start, so only the record changes.
    let mut ptr = scan::utf8_span_end(src, 0, end);
    // the first token's gap: it starts here and ends at `lead_end`
    let lead = ptr;
    while SPACE[at(src, ptr) as usize] != 0 {
        ptr += 1;
    }
    let lead_end = ptr;
    if ptr > 0 {
        if o.cur == start {
            o.tok(tok::NONE, ptr);
        } else {
            o.gap(0, ptr);
        }
    }
    loop {
        let gap = ptr;
        // the pending heredoc body starts after this line's break; an
        // opener on the final line of the input has no body
        if hd_len != 0 {
            let (q, done) = call!(heredoc(ptr, gap, hd_delim, hd_len, hd_strip));
            ptr = q;
            if done {
                hd_len = 0;
                line_head = 1;
                kind = 0;
                cmd_head = false;
                continue;
            }
            if ptr >= end {
                hd_len = 0;
            }
        }

        let mut c = at(src, ptr);
        if c == b' ' && SPACE[at(src, ptr + 1) as usize] == 0 {
            // one space
            ptr += 1;
            c = at(src, ptr);
        } else if SPACE[c as usize] != 0 {
            let mut brk = false;
            loop {
                let k = SPACE[c as usize];
                if k == 0 {
                    break;
                }
                brk |= k == 2;
                ptr += 1;
                c = at(src, ptr);
            }
            // the gap crossed a line break
            if brk {
                // a comment or empty line inside a continuation keeps it
                if line_head != 2 {
                    line_head = 1;
                    kind = 0;
                    cmd_head = false;
                }
                hd_len = 0;
            }
        }
        o.gap(gap, ptr);
        if ptr >= end {
            break;
        }
        let lhs = ptr;
        let c2 = at(src, ptr + 1);

        if line_head != 0 || kind == WRAPPER {
            // comments and parser directives only start a line, or a line
            // joined by `\`
            if line_head != 0 && c == b'#' {
                ptr = scan::line_end(src, ptr + 1, end);
                o.tok(tok::COMMENT, ptr);
                continue;
            }
            // the instruction word, or the one `HEALTHCHECK`/`ONBUILD` wraps
            if (line_head == 1 || kind == WRAPPER) && is_ident_start(c) {
                line_head = 0;
                ptr = ident_run(src, ptr, &IDENT_DOLLAR);
                let g = word_group(src, lhs, ptr);
                if g != 0 && g != 3 {
                    o.tok(tok::KEYWORD, ptr);
                    kind = if g == 1 { SHELL } else { OTHER };
                    if g == 4 {
                        kind = WRAPPER;
                    }
                    if ptr - lhs == 4
                        && u32::from_le_bytes([
                            at(src, lhs),
                            at(src, lhs + 1),
                            at(src, lhs + 2),
                            at(src, lhs + 3),
                        ]) | 0x2020_2020
                            == u32::from_le_bytes(*b"from")
                    {
                        kind = FROM;
                    }
                    cmd_head = kind == SHELL;
                } else {
                    o.emit(tok::NONE, lhs, ptr);
                    // `HEALTHCHECK NONE` wraps nothing
                    if kind == WRAPPER {
                        kind = OTHER;
                    }
                }
                continue;
            }
            line_head = 0;
        }

        // Words and runs of plain bytes, the most common tokens, skip the
        // rule chain: no earlier rule matches their first byte.
        if CLASS[c as usize] != class::OTHER {
            // A run of words and plain bytes with no gap between them, the
            // most common tokens: words take the word rule (an identifier
            // start but `$`), and every other byte is a one-byte `none`
            // token (with any UTF-8 continuation bytes after it), as is a
            // digit right after another token or a `-` that opens no
            // option. No earlier rule matches any of them.
            let mut b = c;
            // the run ends in `none` tokens not yet written, which merge
            // into one record
            let mut none = false;
            loop {
                if !cmd_head && kind != FROM {
                    // every word from here on is `none` too
                    none = true;
                    loop {
                        if CLASS[b as usize] == class::WORD {
                            ptr = find_set(src, ptr + 1, &WORD_STOP_NIB, &WORD_STOP);
                        } else {
                            ptr += 1;
                            while at(src, ptr) & 0xc0 == 0x80 {
                                ptr += 1;
                            }
                        }
                        b = at(src, ptr);
                        if !RUN[b as usize]
                            && (b != b'-'
                                || (at(src, ptr + 1) == b'-' && is_ident_start(at(src, ptr + 2))))
                        {
                            break;
                        }
                    }
                    break;
                }
                if CLASS[b as usize] == class::WORD {
                    // (NUL ends the word, so the scan stops at the input
                    // end)
                    let w = ptr;
                    ptr = find_set(src, ptr + 1, &WORD_STOP_NIB, &WORD_STOP);
                    let hl = if kind == FROM && word_group(src, w, ptr) == 3 {
                        tok::KEYWORD
                    } else if cmd_head {
                        tok::FUNCTION
                    } else {
                        tok::NONE
                    };
                    cmd_head = false;
                    o.tok(hl, ptr);
                } else {
                    // `$utf8SpanEnd`; the NUL at the input end stops it
                    ptr += 1;
                    while at(src, ptr) & 0xc0 == 0x80 {
                        ptr += 1;
                    }
                    o.tok(tok::NONE, ptr);
                }
                b = at(src, ptr);
                if !RUN[b as usize]
                    && (b != b'-' || (at(src, ptr + 1) == b'-' && is_ident_start(at(src, ptr + 2))))
                {
                    break;
                }
            }
            if none {
                o.tok(tok::NONE, ptr);
            }
            continue;
        }

        match c {
            // `\` before the line break continues the logical line;
            // elsewhere it escapes the next byte
            b'\\' => {
                // `$dockerLineJoin`
                let mut p = skip_space_at(src, ptr + 1);
                let mut join = true;
                if p < end {
                    let b = at(src, p);
                    if b != b'\n' && b != b'\r' {
                        join = false;
                    } else {
                        p += 1;
                        if b == b'\r' && at(src, p) == b'\n' {
                            p += 1;
                        }
                    }
                }
                if join {
                    o.tok(tok::PUNCTUATION_SPECIAL, ptr + 1);
                    o.gap(ptr + 1, p);
                    ptr = p;
                    line_head = 2;
                    continue;
                }
                ptr = escape_end(src, ptr, end);
                o.tok(tok::STRING_ESCAPE, ptr);
                continue;
            }
            b'"' => {
                ptr = call!(string(ptr));
                cmd_head = false;
                continue;
            }
            b'\'' => {
                // `$lexRawString`: to the closing quote or the line break
                ptr = scan::find3(src, ptr + 1, end, b'\'', b'\n', b'\r');
                if ptr < end && at(src, ptr) == b'\'' {
                    ptr += 1;
                }
                o.tok(tok::STRING, ptr);
                cmd_head = false;
                continue;
            }
            // `$name` and `${name:-default}` build arguments
            b'$' => {
                if let Some(q) = var_end(src, end, ptr, c2) {
                    ptr = q;
                    o.tok(tok::VARIABLE, ptr);
                    cmd_head = false;
                    continue;
                }
            }
            // `--flag=value` instruction options
            b'-' if c2 == b'-' && is_ident_start(at(src, ptr + 2)) => {
                ptr = ident_run(src, ptr + 2, &IDENT_DASH);
                o.tok(tok::VARIABLE_PARAMETER, ptr);
                // the `=value` belongs to the option, so a shell-form
                // command still starts at the word after it
                if (cmd_head || kind != SHELL) && at(src, ptr) == b'=' {
                    ptr = call!(option_value(ptr));
                }
                continue;
            }
            // `<<EOF`, `<<-EOF`, `<<"EOF"`: a heredoc whose body follows
            // the line
            b'<' if c2 == b'<' && kind != 0 => {
                // (set before the opener is checked, as a pending
                // delimiter on the same line reads it too)
                hd_strip = at(src, ptr + 2) == b'-';
                // `p`: the delimiter word, `rhs`: its start with any quote
                let rhs = ptr + 2 + hd_strip as usize;
                let mut p = rhs;
                let mut quote = at(src, p);
                if quote == b'"' || quote == b'\'' {
                    p += 1;
                } else {
                    quote = 0;
                }
                if is_ident_start(at(src, p)) {
                    o.tok(tok::OPERATOR, rhs);
                    hd_delim = p;
                    ptr = ident_run(src, p, &IDENT_DOLLAR);
                    hd_len = ptr - hd_delim;
                    if quote != 0 && at(src, ptr) == quote {
                        ptr += 1;
                    }
                    o.tok(tok::STRING_SPECIAL, ptr);
                    cmd_head = false;
                    continue;
                }
            }
            _ => {}
        }

        if is_ident_start(c) && c != b'$' {
            ptr = ident_run(src, ptr, &IDENT_DASH);
            let hl = if kind == FROM && word_group(src, lhs, ptr) == 3 {
                tok::KEYWORD
            } else if cmd_head {
                tok::FUNCTION
            } else {
                tok::NONE
            };
            o.tok(hl, ptr);
            cmd_head = false;
            continue;
        }

        // a number stands alone after blanks; digits inside
        // `ubuntu:22.04` stay plain
        if is_digit(c) && (lhs > gap || (lhs == lead_end && lead < lead_end)) {
            ptr = number_end(src, ptr);
            o.tok(tok::NUMBER, ptr);
            cmd_head = false;
            continue;
        }

        if c == b'[' || c == b']' {
            ptr += 1;
            o.tok(tok::PUNCTUATION_BRACKET, ptr);
            continue;
        }
        if c == b',' {
            ptr += 1;
            o.tok(tok::PUNCTUATION_DELIMITER, ptr);
            continue;
        }
        if SHELL_OP[c as usize] {
            while SHELL_OP[at(src, ptr) as usize] {
                ptr += 1;
            }
            o.tok(tok::OPERATOR, ptr);
            // a shell command follows a pipeline or list operator
            if kind == SHELL && (c == b'&' || c == b'|' || c == b';') {
                cmd_head = true;
            }
            continue;
        }

        ptr = scan::utf8_span_end(src, ptr + 1, end);
        o.tok(tok::NONE, ptr);
    }
    // SAFETY: the records before `cur` are written.
    unsafe { inst.ext.recs.set_len(o.cur.offset_from(start) as usize) };
}
