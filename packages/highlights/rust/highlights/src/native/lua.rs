//! WAT sources: src/langs/lua.wat src/common.wat src/scan.wat
//!
//! Native Lua highlighter. One pass over the input with the same rules, in
//! the same order, as the translated `$hlLua`; the records equal the
//! translated lexer's records.

#[cfg(target_arch = "aarch64")]
use core::arch::aarch64::*;

use super::Lexer;
use super::scan;
use crate::Rec;
use crate::generated::Instance;
use crate::token_ids as tok;
use crate::wat_tables::LUA_WORDS;

/// The lexer for `name`, if this module handles it.
pub(crate) fn lexer(name: &str) -> Option<Lexer> {
    match name {
        "lua" => Some(highlight),
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

/// Whether `c` is an uppercase ASCII letter.
#[inline(always)]
const fn is_upper(c: u8) -> bool {
    c.wrapping_sub(b'A') <= 25
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

    /// Whitespace up to `end` extends the last record, which exists.
    #[inline(always)]
    fn extend(&mut self, end: usize) {
        debug_assert!(self.cur > self.start);
        // SAFETY: a record precedes every gap after the first token.
        unsafe { (*self.cur.sub(1)).end = end as u32 };
    }
}

/// The end of the whitespace run from `p` (`$scanWhitespace`). The NUL
/// after the input ends every run.
#[inline(always)]
fn whitespace_end(src: &[u8], mut p: usize) -> usize {
    // Most gaps are short: test a few bytes one by one first.
    for _ in 0..4 {
        if !is_space(at(src, p)) {
            return p;
        }
        p += 1;
    }
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

/// The end of the whitespace run from `p` (`$scanWhitespace`), and
/// whether it holds a line break (`$lexGapHasBreak`). The NUL after the
/// input ends every run.
#[inline(always)]
fn whitespace_break_end(src: &[u8], mut p: usize) -> (usize, bool) {
    let mut brk = false;
    loop {
        let c = at(src, p);
        if !is_space(c) {
            return (p, brk);
        }
        brk |= c == b'\n' || c == b'\r';
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

/// SCREAMING_CASE: at least two bytes, one uppercase letter, and only
/// `[A-Z0-9_]` (`$lexIsConstCase`).
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

/// `$luaWords` as a perfect hash on a word's bytes: every word is at most
/// 8 bytes, read as one little-endian integer, zero past its end; words
/// hold no NUL, so equal integers mean equal words.
struct Words {
    keys: [u64; WORD_SLOTS],
    /// The word's `keyword-table.value`.
    values: [u16; WORD_SLOTS],
    mul: u64,
}

const WORD_SLOTS: usize = 64;

/// The slot of the word whose integer is `lo`.
#[inline(always)]
const fn word_slot(lo: u64, mul: u64) -> usize {
    (lo.wrapping_mul(mul) >> (64 - WORD_SLOTS.trailing_zeros())) as usize
}

/// The integer of the word `w`.
const fn word_key(w: &[u8]) -> u64 {
    let mut lo = 0u64;
    let mut i = 0;
    while i < w.len() {
        lo |= (w[i] as u64) << (8 * i);
        i += 1;
    }
    lo
}

/// For each first byte, a bit per length of the words in [`WORDS`]. A name
/// whose bit is clear is no word.
static WORD_LENGTHS: [u16; 256] = {
    let mut t = [0u16; 256];
    let mut i = 0;
    while i < LUA_WORDS.len() {
        let w = LUA_WORDS[i].word;
        assert!(w.len() <= 8);
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
        let mut keys = [0u64; WORD_SLOTS];
        let mut values = [0u16; WORD_SLOTS];
        let mut i = 0;
        while i < LUA_WORDS.len() {
            let lo = word_key(LUA_WORDS[i].word);
            let s = word_slot(lo, mul);
            if keys[s] != 0 {
                mul = mul.wrapping_add(0x6a09_e667_f3bc_c909) | 1;
                attempt += 1;
                continue 'search;
            }
            let v = LUA_WORDS[i].value;
            assert!(v >= 0 && v < 0x10000);
            keys[s] = lo;
            values[s] = v as u16;
            i += 1;
        }
        break Words { keys, values, mul };
    }
};

/// The `$luaWords` value of the word `[lhs, rhs)`, or -1
/// (`keyword-table.value`).
#[inline(always)]
fn word_value(src: &[u8], lhs: usize, rhs: usize) -> i32 {
    let n = rhs - lhs;
    if n > 8 || WORD_LENGTHS[at(src, lhs) as usize] >> n & 1 == 0 {
        return -1;
    }
    debug_assert!(lhs + 8 <= src.len());
    // SAFETY: `lhs` lies before the input end, so `lhs + 8` lies inside
    // the slack.
    let w = unsafe { src.as_ptr().add(lhs).cast::<u64>().read_unaligned() };
    let lo = u64::from_le(w) & (u64::MAX >> (64 - 8 * n));
    let s = word_slot(lo, WORDS.mul);
    if WORDS.keys[s] == lo {
        WORDS.values[s] as i32
    } else {
        -1
    }
}

/// Whether `c` is an ASCII hex digit (`$lexIsHex`).
#[inline(always)]
const fn is_hex(c: u8) -> bool {
    is_digit(c) || (c | 32).wrapping_sub(b'a') <= 5
}

/// The end of the number at `lhs`, with hexadecimal float fractions
/// (`$lexScanHexNumber` with no exponent required).
fn hex_number_end(src: &[u8], end: usize, lhs: usize) -> usize {
    let p = number_end(src, lhs);
    if !(at(src, lhs) == b'0' && at(src, lhs + 1) | 32 == b'x') || p >= end {
        return p;
    }
    let next = at(src, p + 1);
    if !(at(src, p) == b'.' && (is_hex(next) || next | 32 == b'p')) {
        return p;
    }
    if next | 32 == b'p' {
        let mut q = p + 1;
        while q < end && (is_hex(src[q]) || src[q] == b'_') {
            q += 1;
        }
        if q >= end || src[q] | 32 != b'p' {
            return p;
        }
        q += 1;
        if q < end && (src[q] == b'+' || src[q] == b'-') {
            q += 1;
        }
        if q >= end || !is_digit(src[q]) {
            return p;
        }
    }
    number_body_end(src, p + 1, true)
}

/// The end of a number's body from `p` (`$lexScanNumberBody`). The NUL
/// after the input ends it.
fn number_body_end(src: &[u8], mut p: usize, hex: bool) -> usize {
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

/// A one-line quoted string from the `quote` at `lhs`, with escapes colored
/// apart; a raw line break ends it unconsumed (`$lexString`,
/// `$lexStringBody`).
#[inline(never)]
fn string(src: &[u8], end: usize, mut out: Out, lhs: usize, quote: u8) -> (usize, Out) {
    let mut p = lhs + 1;
    let mut seg = lhs;
    loop {
        p = scan::string_special(src, p, end, quote);
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
        out.span(tok::STRING, seg, p);
        let e = escape_end(src, end, p);
        out.span(tok::STRING_ESCAPE, p, e);
        p = e;
        seg = p;
    }
    out.span(tok::STRING, seg, p);
    (p, out)
}

/// A long bracket `[[...]]`, `[==[...]==]` after a `prefix`-byte prefix at
/// `lhs`, colored `hl`; `None` when no long bracket opens there
/// (`$luaLong`).
#[cold]
#[inline(never)]
fn long(
    src: &[u8],
    end: usize,
    mut out: Out,
    lhs: usize,
    prefix: usize,
    hl: u32,
) -> Option<(usize, Out)> {
    let bracket = lhs + prefix;
    if bracket >= end || src[bracket] != b'[' {
        return None;
    }
    let mut p = bracket + 1;
    let mut eq = 0usize;
    while p < end && src[p] == b'=' {
        eq += 1;
        p += 1;
    }
    if p >= end || src[p] != b'[' {
        return None;
    }
    let mut q = p + 1;
    loop {
        q = scan::find3(src, q, end, b']', b']', b']');
        if q >= end {
            break;
        }
        let mut r = q + 1;
        let mut i = 0;
        while i < eq && r < end && src[r] == b'=' {
            i += 1;
            r += 1;
        }
        if i == eq && r < end && src[r] == b']' {
            q = r + 1;
            break;
        }
        q += 1;
    }
    out.span(hl, lhs, q);
    Some((q, out))
}

/// Byte classes for the main dispatch.
mod class {
    /// A letter, `_`, `$`, or any byte from 0x80: a name.
    pub const IDENT: u8 = 0;
    /// Anything else: one byte colored `operator`.
    pub const OTHER: u8 = 1;
    pub const DIGIT: u8 = 2;
    pub const DASH: u8 = 3;
    pub const HASH: u8 = 4;
    /// `"` or `'`.
    pub const QUOTE: u8 = 5;
    pub const OPEN_SQUARE: u8 = 6;
    pub const DOT: u8 = 7;
    pub const COLON: u8 = 8;
    /// `(`, `)`, `]`, `{`, `}`.
    pub const BRACKET: u8 = 9;
    /// `,` or `;`.
    pub const DELIM: u8 = 10;
    /// NUL: the end of the input, or one byte colored `operator` inside it.
    pub const NUL: u8 = 11;
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
                b'-' => class::DASH,
                b'#' => class::HASH,
                b'"' | b'\'' => class::QUOTE,
                b'[' => class::OPEN_SQUARE,
                b'.' => class::DOT,
                b':' => class::COLON,
                b'(' | b')' | b']' | b'{' | b'}' => class::BRACKET,
                b',' | b';' => class::DELIM,
                _ => class::OTHER,
            }
        };
        c += 1;
    }
    t
};

/// Lex the Lua input of `len` bytes at `base` (`$hlLua`).
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

/// The lexer loop (`$hlLua`), with comments (`$lexLineComment`) inline.
fn lex(src: &[u8], end: usize, mut out: Out) -> Out {
    // `$lexEmitLeadingContinuation`, then the leading whitespace.
    let lead = scan::utf8_span_end(src, 0, end);
    out.gap(0, lead);
    let mut p = whitespace_end(src, lead);
    out.gap(lead, p);

    // after `function`: the next name is a definition
    let mut decl = false;
    // after `.` or `:`: the next name is a member
    let mut member = false;

    'next: loop {
        // The gap before the next token. Lua keeps no line state.
        let c = at(src, p);
        if c == b' ' && !is_space(at(src, p + 1)) {
            p += 1;
            out.extend(p);
        } else if is_space(c) {
            p = whitespace_break_end(src, p + 1).0;
            out.extend(p);
        }
        let lhs = p;
        let c = at(src, p);
        let c2 = at(src, p + 1);

        match CLASS[c as usize] {
            class::IDENT => {
                // A chain of names joined by `.` or `:` (`vim.opt.tabstop`)
                // runs in this loop.
                let mut lhs = lhs;
                let mut c = c;
                loop {
                    p = ident_end(src, p + 1);
                    let group = word_value(src, lhs, p);
                    let mut hl = if group < 0 {
                        tok::VARIABLE
                    } else {
                        (group & 255) as u32
                    };
                    if decl {
                        hl = tok::FUNCTION_DEFINITION;
                        decl = false;
                    } else if member {
                        let q = skip_space_at(src, p);
                        hl = if at(src, q) == b'(' {
                            tok::FUNCTION_METHOD
                        } else {
                            tok::PROPERTY
                        };
                        member = false;
                    } else if hl == tok::VARIABLE && at(src, skip_space_at(src, p)) == b'(' {
                        hl = tok::FUNCTION;
                    }
                    // `function` opens a definition; the token test keeps a
                    // `function` captured as a definition from opening another
                    if hl == tok::KEYWORD_DECLARATION && group > 255 {
                        decl = true;
                    }
                    if hl == tok::VARIABLE
                        && (is_upper(c) || c == b'_')
                        && is_const_case(src, lhs, p)
                    {
                        // (only `[A-Z_]` can start a constant name)
                        hl = tok::CONSTANT;
                    }
                    out.tok(hl, p);
                    // `.`, `:`, `(`, `)`, or `,` right after a name: its rule
                    // runs here, without the gap and dispatch steps
                    let n = at(src, p);
                    let n2 = at(src, p + 1);
                    if (n == b'.' || n == b':') && n2 != n && !(n == b'.' && is_digit(n2)) {
                        p += 1;
                        out.tok(tok::PUNCTUATION_DELIMITER, p);
                        member = true;
                        decl = false;
                        if CLASS[n2 as usize] == class::IDENT {
                            lhs = p;
                            c = n2;
                            continue;
                        }
                    } else if n == b' ' && n2 == b'=' && at(src, p + 2) == b' ' {
                        // ` = `: the operator between one-space gaps, then
                        // maybe another name
                        out.extend(p + 1);
                        out.tok(tok::OPERATOR, p + 2);
                        p += 3;
                        out.extend(p);
                        decl = false;
                        member = false;
                        let n3 = at(src, p);
                        if CLASS[n3 as usize] == class::IDENT {
                            lhs = p;
                            c = n3;
                            continue;
                        }
                    } else if n == b' ' && CLASS[n2 as usize] == class::IDENT {
                        // one space, then another name
                        p += 1;
                        out.extend(p);
                        lhs = p;
                        c = n2;
                        continue;
                    } else if n == b'(' || n == b')' {
                        p += 1;
                        out.tok(tok::PUNCTUATION_BRACKET, p);
                        decl = false;
                        member = false;
                        // then maybe a name
                        if n == b'(' && CLASS[n2 as usize] == class::IDENT {
                            lhs = p;
                            c = n2;
                            continue;
                        }
                    } else if n == b',' {
                        p += 1;
                        out.tok(tok::PUNCTUATION_DELIMITER, p);
                        decl = false;
                        member = false;
                        // one space, then another name
                        let n3 = at(src, p + 1);
                        if n2 == b' ' && CLASS[n3 as usize] == class::IDENT {
                            p += 1;
                            out.extend(p);
                            lhs = p;
                            c = n3;
                            continue;
                        }
                    }
                    break;
                }
            }
            class::DASH if c2 == b'-' => {
                if at(src, p + 2) == b'['
                    && let Some((q, o)) = long(src, end, out, lhs, 2, tok::COMMENT)
                {
                    (p, out) = (q, o);
                    continue 'next;
                }
                // `--` comments; `---` doc comments
                let hl = if at(src, p + 2) == b'-' && p + 2 < end {
                    tok::COMMENT_DOC
                } else {
                    tok::COMMENT
                };
                p = scan::line_end(src, (p + 2).min(end), end);
                out.tok(hl, p);
            }
            class::HASH if c2 == b'!' => {
                // a `#!` shebang line
                p = scan::line_end(src, (p + 2).min(end), end);
                out.tok(tok::COMMENT, p);
            }
            class::QUOTE => {
                // A one-line literal without escapes is one token.
                let close = scan::string_special(src, p + 1, end, c);
                if at(src, close) == c && close < end {
                    p = close + 1;
                    out.tok(tok::STRING, p);
                    // `,` or `)` right after a literal: its rule runs here
                    let n = at(src, p);
                    if n == b',' {
                        p += 1;
                        out.tok(tok::PUNCTUATION_DELIMITER, p);
                    } else if n == b')' {
                        p += 1;
                        out.tok(tok::PUNCTUATION_BRACKET, p);
                    }
                } else {
                    (p, out) = string(src, end, out, lhs, c);
                }
                decl = false;
                member = false;
            }
            class::OPEN_SQUARE => {
                if (c2 == b'[' || c2 == b'=')
                    && let Some((q, o)) = long(src, end, out, lhs, 0, tok::STRING)
                {
                    (p, out) = (q, o);
                    decl = false;
                    member = false;
                    continue 'next;
                }
                p += 1;
                out.tok(tok::PUNCTUATION_BRACKET, p);
                decl = false;
                member = false;
            }
            class::DIGIT => {
                p = hex_number_end(src, end, p);
                out.tok(tok::NUMBER, p);
                decl = false;
                member = false;
            }
            class::DOT if is_digit(c2) => {
                p = hex_number_end(src, end, p);
                out.tok(tok::NUMBER, p);
                decl = false;
                member = false;
            }
            class::DOT | class::COLON => {
                p += 1;
                if c2 == c {
                    p += 1;
                    if c == b'.' && at(src, p) == b'.' {
                        p += 1;
                    }
                    out.tok(
                        if c == b'.' {
                            tok::OPERATOR
                        } else {
                            tok::PUNCTUATION_DELIMITER
                        },
                        p,
                    );
                    member = false;
                } else {
                    out.tok(tok::PUNCTUATION_DELIMITER, p);
                    member = true;
                }
                decl = false;
            }
            class::BRACKET => {
                p += 1;
                out.tok(tok::PUNCTUATION_BRACKET, p);
                decl = false;
                member = false;
            }
            class::DELIM => {
                p += 1;
                out.tok(tok::PUNCTUATION_DELIMITER, p);
                decl = false;
                member = false;
            }
            class::NUL if p >= end => break,
            _ => {
                p += 1;
                out.tok(tok::OPERATOR, p);
                decl = false;
                member = false;
            }
        }
    }
    out
}
