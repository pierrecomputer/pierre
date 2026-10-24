//! WAT sources: src/langs/batch.wat src/common.wat src/scan.wat
//!
//! Native Batch highlighter. One pass over the input with the same rules,
//! in the same order, as the translated `$hlBatch`; the records equal the
//! translated lexer's records.

use super::Lexer;
use super::scan;
use super::tables::byteset;
use crate::Rec;
use crate::generated::Instance;
use crate::simd::V;
use crate::token_ids as tok;
use crate::wat_tables::BATCH_WORDS;

/// The lexer for `name`, if this module handles it.
pub(crate) fn lexer(name: &str) -> Option<Lexer> {
    match name {
        "batch" => Some(highlight),
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

/// The byte at `p`. Every caller reads at most 16 bytes past the input
/// end, which the 96-byte input slack covers. The byte at the input end is
/// NUL, which matches none of the bytes a lookahead tests, so a lookahead
/// one byte past a token needs no bounds check.
#[inline(always)]
fn at(src: &[u8], p: usize) -> u8 {
    debug_assert!(p < src.len());
    // SAFETY: `p` lies inside the input or its slack (see above).
    unsafe { *src.get_unchecked(p) }
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
    /// The first record.
    start: *mut Rec,
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

    /// A token `[lhs, rhs)`, skipped when empty (`$emitTok`).
    #[inline(always)]
    fn span(&mut self, hl: u32, lhs: usize, rhs: usize) {
        if lhs < rhs {
            self.tok(hl, rhs);
        }
    }

    /// Whitespace `[lhs, rhs)` extends the last record (`$emitGap`).
    #[inline(always)]
    fn gap(&mut self, lhs: usize, rhs: usize) {
        if lhs < rhs {
            if self.cur == self.start {
                self.tok(tok::NONE, rhs);
            } else {
                // SAFETY: a record precedes `cur`.
                unsafe { (*self.cur.sub(1)).end = rhs as u32 };
            }
        }
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
    // SAFETY: each 16-byte load starts at or before the NUL after the
    // input, inside the slack.
    unsafe {
        loop {
            let v = V::load(src.as_ptr().add(p));
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

/// Skip spaces and tabs from `p` on the current line (`$lexSkipSpaceAt`).
#[inline(always)]
fn skip_space_at(src: &[u8], mut p: usize) -> usize {
    while at(src, p) == b' ' || at(src, p) == b'\t' {
        p += 1;
    }
    p
}

/// The end of the number at `p` (`$lexScanNumber`, `$lexScanNumberBody`).
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

/// The end of the escape at backslash `p` (`$lexEscapeEnd`).
#[inline(always)]
fn escape_end(src: &[u8], end: usize, p: usize) -> usize {
    let mut e = scan::utf8_span_end(src, p + 2, end);
    if e == p + 2 && at(src, p + 1) == b'\r' && e < end && at(src, e) == b'\n' {
        e += 1;
    }
    e
}

/// `$batchWords` (lowercase words) as a perfect hash on a word's bytes: a
/// word of up to 16 bytes is two little-endian integers, `lo` (bytes 0-7)
/// and `hi` (bytes 8-15), zero past its end; words hold no NUL, so equal
/// integers mean equal words.
struct Words {
    keys: [(u64, u64); WORD_SLOTS],
    /// The word's `keyword-table.value`.
    values: [u8; WORD_SLOTS],
    mul: u64,
}

const WORD_SLOTS: usize = 512;

/// The longest word.
const WORD_MAX: usize = 16;

/// The slot of the word whose integers are `lo` and `hi`.
#[inline(always)]
const fn word_slot(lo: u64, hi: u64, mul: u64) -> usize {
    ((lo ^ hi.rotate_left(29)).wrapping_mul(mul) >> (64 - WORD_SLOTS.trailing_zeros())) as usize
}

/// The integers of the word `w`.
const fn word_key(w: &[u8]) -> (u64, u64) {
    let mut k = [0u64; 2];
    let mut i = 0;
    while i < w.len() {
        k[i / 8] |= (w[i] as u64) << (8 * (i % 8));
        i += 1;
    }
    (k[0], k[1])
}

/// For each first byte, a bit per length of the words in [`WORDS`]. A name
/// whose lowercased bit is clear is no word.
static WORD_LENGTHS: [u32; 256] = {
    let mut t = [0u32; 256];
    let mut i = 0;
    while i < BATCH_WORDS.len() {
        let w = BATCH_WORDS[i].word;
        assert!(w.len() <= WORD_MAX);
        t[w[0] as usize] |= 1 << w.len();
        i += 1;
    }
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
        let mut values = [0u8; WORD_SLOTS];
        let mut i = 0;
        while i < BATCH_WORDS.len() {
            let (lo, hi) = word_key(BATCH_WORDS[i].word);
            let s = word_slot(lo, hi, mul);
            if keys[s].0 != 0 {
                mul = mul.wrapping_add(0x6a09_e667_f3bc_c909) | 1;
                attempt += 1;
                continue 'search;
            }
            let v = BATCH_WORDS[i].value;
            assert!(v > 0 && v < 256);
            keys[s] = (lo, hi);
            values[s] = v as u8;
            i += 1;
        }
        break Words { keys, values, mul };
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
fn lower_at(src: &[u8], p: usize, n: usize) -> u64 {
    if n == 0 {
        return 0;
    }
    debug_assert!(p + 8 <= src.len());
    // SAFETY: `p` lies at or before the input end, so `p + 8` lies inside
    // the slack.
    let w = unsafe { src.as_ptr().add(p).cast::<u64>().read_unaligned() };
    let w = lower8(u64::from_le(w));
    if n >= 8 {
        w
    } else {
        w & (u64::MAX >> (64 - 8 * n))
    }
}

/// The `$batchWords` value of `[lhs, rhs)` compared case-insensitively, or
/// -1 (`keyword-table.value` on `$lexLowerCopy`'s copy).
#[inline(always)]
fn word_value(src: &[u8], lhs: usize, rhs: usize) -> i32 {
    let n = rhs - lhs;
    let first = lower8(at(src, lhs) as u64) as usize;
    if n > WORD_MAX || WORD_LENGTHS[first] >> n & 1 == 0 {
        return -1;
    }
    let lo = lower_at(src, lhs, n);
    let hi = lower_at(src, lhs + 8, n.saturating_sub(8));
    let s = word_slot(lo, hi, WORDS.mul);
    if WORDS.keys[s] == (lo, hi) {
        WORDS.values[s] as i32
    } else {
        -1
    }
}

/// Whether `c` is an ASCII letter.
#[inline(always)]
const fn is_letter(c: u8) -> bool {
    (c | 32).wrapping_sub(b'a') <= 25
}

/// Modifier letters of `%~`.
const MODIFIERS: [bool; 256] = byteset(b"fdpnxsatz");

/// The byte at `p`, or 0 at or past `end` (`$batchByte`).
#[inline(always)]
fn byte(src: &[u8], end: usize, p: usize) -> u8 {
    if p < end { src[p] } else { 0 }
}

/// The end of the `%` or `!` expansion at `lhs`, or `lhs` when none opens
/// there; `variables` holds the FOR names seen so far
/// (`$batchVariableEnd`).
fn variable_end(src: &[u8], end: usize, lhs: usize, variables: u64) -> usize {
    let mark = src[lhs];
    let mut p = lhs + 1;
    if mark == b'%' {
        let c = byte(src, end, p);
        if is_digit(c) || c == b'*' {
            return p + 1;
        }
        if c == b'%' || c == b'~' {
            let mut for_var = false;
            if c == b'%' {
                for_var = true;
                p += 1;
            }
            let mut variable_end = 0usize;
            if byte(src, end, p) == b'~' {
                p += 1;
                loop {
                    let c = byte(src, end, p);
                    // A search-path modifier ends at `:`, followed by one
                    // variable.
                    if c == b'$' {
                        variable_end = 0;
                        p += 1;
                        while is_ident_continue(byte(src, end, p)) {
                            p += 1;
                        }
                        if byte(src, end, p) == b':' {
                            p += 1;
                            if is_ident_continue(byte(src, end, p)) {
                                p = scan::utf8_span_end(src, p + 1, end);
                            }
                        }
                        break;
                    }
                    if !(is_digit(c) || is_letter(c)) {
                        break;
                    }
                    p += 1;
                    if is_digit(c) {
                        break;
                    }
                    // Prefer the last known name in a modifier run: %%~ff
                    // is the full-path modifier followed by the variable f.
                    if for_var && variables & 1u64.wrapping_shl(c.wrapping_sub(b'A') as u32) != 0 {
                        variable_end = p;
                    }
                    if !MODIFIERS[(c | 32) as usize] {
                        break;
                    }
                }
            } else if is_ident_continue(byte(src, end, p)) {
                p = scan::utf8_span_end(src, p + 1, end);
            }
            return if variable_end != 0 { variable_end } else { p };
        }
    }
    while p < end {
        let c = src[p];
        if c == b'\n' || c == b'\r' {
            break;
        }
        if c == mark {
            return p + 1;
        }
        p += 1;
    }
    lhs
}

/// The first `"`, `%`, `!`, CR, or LF from `p`, or `end`.
#[inline(always)]
fn quoted_stop(src: &[u8], mut p: usize, end: usize) -> usize {
    // SAFETY: each 16-byte load starts before `end`, inside the input or
    // its slack.
    unsafe {
        while p < end {
            let v = V::load(src.as_ptr().add(p));
            let hit = v.eq(V::splat(b'"')).or(v.eq(V::splat(b'%'))).or(v
                .eq(V::splat(b'!'))
                .or(v.eq(V::splat(b'\n')).or(v.eq(V::splat(b'\r')))));
            let k = hit.first();
            if k < 16 {
                return (p + k).min(end);
            }
            p += 16;
        }
        p.min(end)
    }
}

/// Operator bytes.
const OPS: [bool; 256] = byteset(b"@&|<>=+-*/%!");
/// Delimiter bytes.
const DELIMS: [bool; 256] = byteset(b":;,");
/// Bytes that end an argument list.
const ARG_ENDS: [bool; 256] = byteset(b"&|()");

/// Byte classes for the main dispatch.
mod class {
    /// A letter, `_`, `$`, or any byte from 0x80: a word.
    pub const IDENT: u8 = 0;
    /// Anything else: one character.
    pub const OTHER: u8 = 1;
    pub const DIGIT: u8 = 2;
    /// CR or LF.
    pub const BREAK: u8 = 3;
    pub const QUOTE: u8 = 4;
    /// `%` or `!`.
    pub const EXPAND: u8 = 5;
    /// Space or TAB through FF.
    pub const SPACE: u8 = 6;
    pub const CARET: u8 = 7;
    pub const COLON: u8 = 8;
    /// NUL: the end of the input, or one byte inside it.
    pub const NUL: u8 = 9;
}

/// The [`class`] of each byte.
static CLASS: [u8; 256] = {
    let mut t = [class::OTHER; 256];
    let mut c = 1;
    t[0] = class::NUL;
    while c < 256 {
        let b = c as u8;
        t[c] = if is_ident_start(b) {
            class::IDENT
        } else if is_digit(b) {
            class::DIGIT
        } else {
            match b {
                b'\n' | b'\r' => class::BREAK,
                b'"' => class::QUOTE,
                b'%' | b'!' => class::EXPAND,
                b'^' => class::CARET,
                b':' => class::COLON,
                _ if is_space(b) => class::SPACE,
                _ => class::OTHER,
            }
        };
        c += 1;
    }
    t
};

/// Lex the Batch input of `len` bytes at `base` (`$hlBatch`).
fn highlight(inst: &mut Instance, base: usize, len: usize) {
    let mem_ptr = inst.mem.bytes().as_ptr();
    // SAFETY: `base..base + len + 96` lies inside lexer memory, and this
    // lexer calls no translated function that could reallocate it.
    let src: &[u8] = unsafe { core::slice::from_raw_parts(mem_ptr.add(base), len + 96) };
    let v = &mut inst.ext.recs;
    let rp = v.as_mut_ptr();
    // SAFETY: the length and capacity bound the vector's allocation.
    let out = unsafe {
        Out {
            cur: rp.add(v.len()),
            start: rp,
            limit: rp.add(v.capacity()),
            last: v.last().map_or(u32::MAX, |r| r.token),
        }
    };
    let out = lex(src, len, out);
    // SAFETY: the records before `out.cur` are written, within capacity.
    unsafe { v.set_len(out.cur.offset_from(rp) as usize) };
}

/// The lexer loop (`$hlBatch`), with comments (`$lexLineComment`) and
/// bounded lookahead (`$batchByte`) inline.
fn lex(src: &[u8], end: usize, mut out: Out) -> Out {
    // `$lexEmitLeadingContinuation`
    let mut p = scan::utf8_span_end(src, 0, end);
    out.gap(0, p);

    // past a command name: `:` is no label, `rem` no comment
    let mut argument = false;
    // inside `"..."`
    let mut quote = false;
    // the next word is a label (after `goto`, or `call :`)
    let mut label = false;
    // case-sensitive FOR names seen in unmodified %%A references
    let mut variables = 0u64;

    'next: loop {
        let lhs = p;
        let c = at(src, p);
        // The rest of a quoted run up to a quote, an expansion, or a line
        // break.
        macro_rules! quoted {
            () => {{
                p = quoted_stop(src, p + 1, end);
                p = scan::utf8_span_end(src, p, end);
                out.tok(tok::STRING, p);
                continue;
            }};
        }
        // Words from `$lhs` (the word rule), one space or one punctuation
        // character apart, run in this loop.
        macro_rules! words {
            ($lhs:expr) => {{
                // Words one space apart run in this loop.
                let mut lhs: usize = $lhs;
                loop {
                    p = ident_end(src, p + 1);
                    let n = p - lhs;
                    // (`$lexLowerCopy` leaves words over 31 bytes empty; no
                    // word is that long)
                    let mut hl = word_value(src, lhs, p);
                    if hl == tok::COMMENT as i32 && !argument {
                        // `rem`
                        p = scan::line_end(src, p, end);
                        out.tok(tok::COMMENT, p);
                        continue 'next;
                    }
                    if hl < 0 || hl == tok::COMMENT as i32 {
                        hl = tok::VARIABLE as i32;
                    }
                    if label {
                        hl = tok::LABEL as i32;
                    }
                    // a four-letter word, or 0: `goto`, `call`, and `else`
                    // compare whole
                    let w = if n == 4 { lower_at(src, lhs, 4) } else { 0 };
                    label = w == word(b"goto");
                    argument = true;
                    if hl == tok::KEYWORD_CONTROL as i32
                        && ((n == 2 && lower_at(src, lhs, 2) == word(b"do"))
                            || w == word(b"call")
                            || w == word(b"else"))
                    {
                        argument = false;
                    }
                    // CALL's :label is one argument, unlike a line-start label.
                    if w == word(b"call") && at(src, skip_space_at(src, p)) == b':' {
                        label = true;
                        argument = true;
                    }
                    out.tok(hl as u32, p);
                    let n = at(src, p);
                    if n == b' ' {
                        // one space (more join the same gap), then maybe
                        // another word
                        p += 1;
                        out.gap(p - 1, p);
                        if CLASS[at(src, p) as usize] == class::IDENT {
                            lhs = p;
                            continue;
                        }
                        continue 'next;
                    }
                    if CLASS[n as usize] == class::OTHER || (n == b':' && argument && !label) {
                        // one punctuation character (`set NAME=value`,
                        // `C:\dir\name`), then maybe a word
                        p = scan::utf8_span_end(src, p + 1, end);
                        let hl = if DELIMS[n as usize] {
                            tok::PUNCTUATION_DELIMITER
                        } else if OPS[n as usize] {
                            tok::OPERATOR
                        } else if n == b'(' || n == b')' {
                            tok::PUNCTUATION_BRACKET
                        } else {
                            tok::NONE
                        };
                        if ARG_ENDS[n as usize] {
                            argument = false;
                        }
                        out.tok(hl, p);
                        if CLASS[at(src, p) as usize] == class::IDENT {
                            lhs = p;
                            continue;
                        }
                    }
                    break;
                }
            }};
        }
        match CLASS[c as usize] {
            class::NUL if p >= end => break,
            class::BREAK => {
                p += 1;
                out.gap(lhs, p);
                argument = false;
                quote = false;
                label = false;
                // then maybe a word, whose rule runs here
                if CLASS[at(src, p) as usize] == class::IDENT {
                    words!(p)
                }
            }
            class::QUOTE => {
                p += 1;
                out.tok(tok::STRING, p);
                quote = !quote;
                argument = true;
            }
            class::EXPAND => {
                let q = variable_end(src, end, lhs, variables);
                if q > lhs {
                    if q - lhs == 3 && c == b'%' && at(src, lhs + 1) == b'%' {
                        let n = at(src, lhs + 2);
                        if is_letter(n) {
                            variables |= 1u64.wrapping_shl(n.wrapping_sub(b'A') as u32);
                        }
                    }
                    p = q;
                    out.tok(tok::VARIABLE_SPECIAL, p);
                    continue;
                }
                if quote {
                    quoted!()
                }
                p = scan::utf8_span_end(src, p + 1, end);
                out.tok(tok::OPERATOR, p);
            }
            _ if quote => quoted!(),
            class::SPACE => {
                p = skip_space_at(src, lhs);
                if p == lhs {
                    p += 1;
                }
                out.gap(lhs, p);
                // then maybe a word, whose rule runs here
                if CLASS[at(src, p) as usize] == class::IDENT {
                    words!(p)
                }
            }
            class::CARET => {
                p = escape_end(src, end, lhs);
                out.span(tok::STRING_ESCAPE, lhs, p);
            }
            class::COLON if !argument => {
                p = scan::line_end(src, p + 1, end);
                let hl = if byte(src, end, lhs + 1) == b':' {
                    tok::COMMENT
                } else {
                    tok::LABEL
                };
                out.tok(hl, p);
            }
            class::IDENT | class::COLON if c != b':' || label => words!(lhs),
            class::DIGIT => {
                p = number_end(src, p);
                out.tok(tok::NUMBER, p);
            }
            _ => {
                p = scan::utf8_span_end(src, p + 1, end);
                let hl = if DELIMS[c as usize] {
                    tok::PUNCTUATION_DELIMITER
                } else if OPS[c as usize] {
                    tok::OPERATOR
                } else if c == b'(' || c == b')' {
                    tok::PUNCTUATION_BRACKET
                } else {
                    tok::NONE
                };
                if ARG_ENDS[c as usize] {
                    argument = false;
                }
                out.tok(hl, p);
                // then maybe a word, whose rule runs here
                if CLASS[at(src, p) as usize] == class::IDENT {
                    words!(p)
                }
            }
        }
    }
    out
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
