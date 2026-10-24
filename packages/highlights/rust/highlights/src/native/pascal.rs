//! WAT sources: src/langs/pascal.wat src/common.wat src/scan.wat
//!
//! Native Pascal highlighter. One pass over the input: each token is
//! scanned and colored in the same step, with the same rules, in the same
//! order, as the translated `$hlPascal`. The records equal the translated
//! lexer's records.

use super::Lexer;
use super::recs::Recs;
use super::scan;
use super::tables::byteset;
use crate::Rec;
use crate::generated::Instance;
use crate::simd::V;
use crate::token_ids as tok;
use crate::wat_tables::PASCAL_WORDS;

/// The lexer for `name`, if this module handles it.
pub(crate) fn lexer(name: &str) -> Option<Lexer> {
    match name {
        "pascal" => Some(highlight),
        _ => None,
    }
}

/// `$pascalWords` and `result` (which `$pasWordHl` matches outside the
/// table), all lowercase, as a perfect hash on a word's bytes: an index of
/// entry numbers and the entries' keys and values. A word of up to 16 bytes
/// is two little-endian integers, `lo` (bytes 0-7) and `hi` (bytes 8-15),
/// zero past its end; identifiers hold no NUL, so equal integers mean equal
/// words.
struct Words {
    /// Entry number plus one for each hash slot, or 0 for no word.
    index: [u8; WORD_SLOTS],
    keys: [(u64, u64); 256],
    /// The word's `keyword-table.value`.
    values: [u16; 256],
    mul: u64,
}

const WORD_SLOTS: usize = 4096;

/// The longest word.
const WORD_MAX: usize = 16;

/// The words `$pasWordHl` matches outside the table, with their values.
const EXTRA_WORDS: [(&[u8], u32); 1] = [(b"result", tok::VARIABLE_SPECIAL)];

/// Entry `i` of [`PASCAL_WORDS`] followed by [`EXTRA_WORDS`].
const fn word_entry(i: usize) -> (&'static [u8], i32) {
    if i < PASCAL_WORDS.len() {
        (PASCAL_WORDS[i].word, PASCAL_WORDS[i].value)
    } else {
        let (w, v) = EXTRA_WORDS[i - PASCAL_WORDS.len()];
        (w, v as i32)
    }
}

/// The slot of the word whose integers are `lo` and `hi`.
#[inline(always)]
const fn word_slot(lo: u64, hi: u64, mul: u64) -> usize {
    (lo.wrapping_add(hi.rotate_left(29)).wrapping_mul(mul) >> (64 - WORD_SLOTS.trailing_zeros()))
        as usize
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
    let count = PASCAL_WORDS.len() + EXTRA_WORDS.len();
    assert!(count < 256);
    let mut keys = [(0u64, 0u64); 256];
    let mut values = [0u16; 256];
    let mut i = 0;
    while i < count {
        let (w, value) = word_entry(i);
        assert!(w.len() <= WORD_MAX && value >= 0 && value < 0x10000);
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
        while i < count {
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
            values,
            mul,
        };
    }
};

/// For each first byte (either case), a bit per length of the words in
/// [`WORDS`]. A name whose bit is clear is no word.
static WORD_LENGTHS: [u32; 256] = {
    let mut t = [0u32; 256];
    let mut i = 0;
    while i < PASCAL_WORDS.len() + EXTRA_WORDS.len() {
        let w = word_entry(i).0;
        t[w[0] as usize] |= 1 << w.len();
        if w[0].is_ascii_lowercase() {
            t[w[0].to_ascii_uppercase() as usize] |= 1 << w.len();
        }
        i += 1;
    }
    t
};

/// `w` with its ASCII uppercase letters lowered (`$lexLowerCopy`).
#[inline(always)]
const fn lower(w: u64) -> u64 {
    let t = w & 0x7f7f_7f7f_7f7f_7f7f;
    let ge_a = t + 0x3f3f_3f3f_3f3f_3f3f; // t >= 'A' sets the high bit
    let ge_z1 = t + 0x2525_2525_2525_2525; // t > 'Z' sets the high bit
    let upper = ge_a & !ge_z1 & !w & 0x8080_8080_8080_8080;
    w | upper >> 2
}

/// The word `[lhs, rhs)` lowercased as its two integers, or `None` when it
/// is too long to be a word.
#[inline(always)]
fn lower_key(src: &[u8], lhs: usize, rhs: usize) -> Option<(u64, u64)> {
    let n = rhs - lhs;
    if n > WORD_MAX {
        return None;
    }
    if WORD_LENGTHS[at(src, lhs) as usize] >> n & 1 == 0 {
        // no word: a key that no entry has
        return Some((0, 0));
    }
    Some(if n <= 8 {
        (lower(word_at(src, lhs, n as u32)), 0)
    } else {
        (
            lower(word_at(src, lhs, 8)),
            lower(word_at(src, lhs + 8, n as u32 - 8)),
        )
    })
}

/// The value of the lowercased word `key`, or -1 (`$pasWordHl`: the table
/// on a lowercased copy, then `result`).
#[inline(always)]
fn word_value(key: (u64, u64)) -> i32 {
    if key.0 == 0 {
        return -1;
    }
    let e = WORDS.index[word_slot(key.0, key.1, WORDS.mul)];
    if e != 0 && WORDS.keys[e as usize - 1] == key {
        WORDS.values[e as usize - 1] as i32
    } else {
        -1
    }
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

/// Operator bytes (`$pasIsOp`).
static OPS: [bool; 256] = byteset(b"*+-/<=>@^");

/// Byte classes for the main dispatch.
mod class {
    /// An identifier start other than `$`.
    pub const IDENT: u8 = 0;
    pub const DIGIT: u8 = 1;
    pub const SLASH: u8 = 2;
    pub const BRACE: u8 = 3;
    pub const OPEN_PAREN: u8 = 4;
    pub const QUOTE: u8 = 5;
    pub const HASH: u8 = 6;
    pub const DOLLAR: u8 = 7;
    /// `%` or `&`.
    pub const RADIX: u8 = 8;
    pub const DOT: u8 = 9;
    /// `)`, `[`, `]`.
    pub const BRACKET: u8 = 10;
    /// `,` or `;`.
    pub const DELIMITER: u8 = 11;
    pub const COLON: u8 = 12;
    /// An operator byte other than `/` (`$pasIsOp`).
    pub const OP: u8 = 13;
    /// Anything else: one character colored `none`.
    pub const OTHER: u8 = 14;
    /// NUL: the end of the input, or one byte colored `none` inside it.
    pub const NUL: u8 = 15;
}

/// The [`class`] of each byte.
static CLASS: [u8; 256] = {
    let mut t = [class::OTHER; 256];
    t[0] = class::NUL;
    let mut c = 1;
    while c < 256 {
        let b = c as u8;
        t[c] = if is_ident_start(b) && b != b'$' {
            class::IDENT
        } else if is_digit(b) {
            class::DIGIT
        } else {
            match b {
                b'/' => class::SLASH,
                b'{' => class::BRACE,
                b'(' => class::OPEN_PAREN,
                b'\'' => class::QUOTE,
                b'#' => class::HASH,
                b'$' => class::DOLLAR,
                b'%' | b'&' => class::RADIX,
                b'.' => class::DOT,
                b')' | b'[' | b']' => class::BRACKET,
                b',' | b';' => class::DELIMITER,
                b':' => class::COLON,
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
        t[c] = is_ident_start(c as u8) || is_digit(c as u8);
        c += 1;
    }
    t
};

/// Name bytes without `$`: `[A-Za-z0-9_]` and bytes from 0x80
/// (`$scanIdentRun` with `_`).
static NAME_CONT: [bool; 256] = {
    let mut t = IDENT_CONT;
    t[b'$' as usize] = false;
    t
};

/// Delphi type-name prefixes (`$pasIsTypeName`).
static TYPE_PREFIX: [bool; 256] = byteset(b"EIPT");

/// The byte at `i`. Every caller reads at most 16 bytes past the input
/// end, which the 96-byte input slack covers. The byte at the input end is
/// NUL, which matches none of the bytes a lookahead tests, so a lookahead
/// one byte past a token needs no bounds check (`$pasByte` returns 0 at
/// and past the end).
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

/// Whether `c` is ASCII whitespace: space or TAB through CR (`$lexIsSpace`).
#[inline(always)]
const fn is_space(c: u8) -> bool {
    c == b' ' || c.wrapping_sub(9) <= 4
}

/// Whether `c` is an ASCII uppercase letter.
#[inline(always)]
const fn is_upper(c: u8) -> bool {
    c.wrapping_sub(b'A') <= 25
}

/// The end of the whitespace run from `p` (`$scanWhitespace`). The NUL
/// after the input ends every run.
#[inline(always)]
fn whitespace_end(src: &[u8], mut p: usize) -> usize {
    loop {
        let c = at(src, p);
        if c == b' ' {
            // Skip spaces 8 bytes at a time.
            // SAFETY: `p` lies before the NUL after the input, so the
            // 8-byte read stays inside the slack.
            let w = unsafe { src.as_ptr().add(p).cast::<u64>().read_unaligned() };
            let x = w ^ 0x2020_2020_2020_2020;
            let other =
                (((x & 0x7f7f_7f7f_7f7f_7f7f) + 0x7f7f_7f7f_7f7f_7f7f) | x) & 0x8080_8080_8080_8080;
            p += if other == 0 {
                8
            } else {
                (other.trailing_zeros() / 8) as usize
            };
        } else if c.wrapping_sub(9) <= 4 {
            // TAB through CR, one at a time
            p += 1;
        } else {
            return p;
        }
    }
}

/// The end of the name run from `p`: `[A-Za-z0-9_]` and bytes from 0x80
/// (`$scanIdentRun` with `_`). The NUL after the input ends every run.
#[inline(always)]
fn name_run_end(src: &[u8], mut p: usize) -> usize {
    // Most names are short: test a few bytes one by one first.
    for _ in 0..8 {
        if !NAME_CONT[at(src, p) as usize] {
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
        let under = v.eq(V::splat(b'_'));
        let ok = alpha.or(digit).or(under.or(v.high()));
        let k = ok.not().first();
        if k < 16 {
            return p + k;
        }
        p += 16;
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
            let next = at(src, p + 1);
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

/// Whether the name `[lhs, rhs)` follows the Delphi type convention: `T`,
/// `I`, `E`, or `P` before an uppercase letter (`$pasIsTypeName`).
#[inline(always)]
fn is_type_name(src: &[u8], lhs: usize, rhs: usize) -> bool {
    rhs - lhs >= 2 && TYPE_PREFIX[at(src, lhs) as usize] && is_upper(at(src, lhs + 1))
}

/// The first `n` bytes at `p` as a little-endian integer, for comparing
/// short words. Reads 8 bytes, which the input slack allows.
#[inline(always)]
fn word_at(src: &[u8], p: usize, n: u32) -> u64 {
    debug_assert!(p + 8 <= src.len());
    // SAFETY: `p` lies before the input end, so `p + 8` lies inside the
    // slack.
    let w = unsafe { src.as_ptr().add(p).cast::<u64>().read_unaligned() };
    w & (u64::MAX >> (64 - 8 * n))
}

/// The end of a `{ ... }` region (`paren` false; its body starts at `p`)
/// or a `(* ... *)` region: through its closer, or `end` (`$pasBraced`).
#[inline(never)]
fn braced_end(src: &[u8], mut p: usize, end: usize, paren: bool) -> usize {
    if paren {
        loop {
            p = scan::find3(src, p, end, b'*', b'*', b'*');
            if p >= end {
                return end;
            }
            p += 1;
            if at(src, p) == b')' {
                return p + 1;
            }
        }
    }
    let p = scan::find3(src, p, end, b'}', b'}', b'}');
    if p < end { p + 1 } else { end }
}

/// The quoted string whose `'` is at `p`: a doubled quote escapes itself,
/// and the literal ends at the quote or the line break. Returns the end
/// (`$pasString`).
#[inline(never)]
fn string(src: &[u8], mut recs: Recs, p: usize, end: usize) -> (Recs, usize) {
    let mut seg = p;
    let mut ptr = p + 1;
    loop {
        let p = scan::find3(src, ptr, end, b'\'', b'\n', b'\r');
        ptr = p;
        if p >= end || at(src, p) != b'\'' {
            break;
        }
        ptr = p + 1;
        if at(src, ptr) != b'\'' {
            break;
        }
        if seg < p {
            recs.tok(tok::STRING, p);
        }
        ptr = p + 2;
        recs.tok(tok::STRING_ESCAPE, ptr);
        seg = ptr;
    }
    if seg < ptr {
        recs.tok(tok::STRING, ptr);
    }
    (recs, ptr)
}

/// Lex the Pascal input of `len` bytes at `base` (`$hlPascal`).
fn highlight(inst: &mut Instance, base: usize, len: usize) {
    let mem_ptr = inst.mem.bytes().as_ptr();
    // SAFETY: `base..base + len + 96` lies inside lexer memory, which is not
    // reallocated while this lexer runs.
    let src: &[u8] = unsafe { core::slice::from_raw_parts(mem_ptr.add(base), len + 96) };
    let end = len;

    // Records are written through `cur`, which moves along
    // `inst.ext.recs`'s buffer from `rp` to at most `limit`; `last` is the
    // last record's token, or `u32::MAX`.
    let mut rp = inst.ext.recs.as_mut_ptr();
    // SAFETY: `len` records are written.
    let mut cur = unsafe { rp.add(inst.ext.recs.len()) };
    // SAFETY: one past the allocation.
    let mut limit = unsafe { rp.add(inst.ext.recs.capacity()) };
    let mut last = inst.ext.recs.last().map_or(u32::MAX, |r| r.token);
    // Append a non-empty token ending at `end`, merging it into the last
    // record when the token matches (`$emitTok`). Running out of room
    // means a lexer bug, which traps.
    macro_rules! emit {
        ($hl:expr, $end:expr $(,)?) => {{
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
    // Whitespace up to `rhs` extends the last record, which exists.
    macro_rules! extend {
        ($rhs:expr) => {{
            debug_assert!(cur > rp);
            // SAFETY: a record precedes every gap after the first token.
            unsafe { (*cur.sub(1)).end = $rhs as u32 };
        }};
    }
    // Run an out-of-line helper that writes its records through `Recs`.
    macro_rules! with_recs {
        (|$recs:ident| $call:expr) => {{
            // SAFETY: the records before `cur` are written.
            unsafe { inst.ext.recs.set_len(cur.offset_from(rp) as usize) };
            let $recs = Recs::load(inst);
            let ($recs, p) = $call;
            $recs.store(inst);
            rp = inst.ext.recs.as_mut_ptr();
            // SAFETY: `len` records are written.
            cur = unsafe { rp.add(inst.ext.recs.len()) };
            // SAFETY: one past the allocation.
            limit = unsafe { rp.add(inst.ext.recs.capacity()) };
            last = inst.ext.recs.last().map_or(u32::MAX, |r| r.token);
            p
        }};
    }

    // `$lexEmitLeadingContinuation`
    let mut ptr = scan::utf8_span_end(src, 0, end);
    gap!(0, ptr);
    // Leading whitespace; every later gap follows a token's record.
    let first = whitespace_end(src, ptr);
    gap!(ptr, first);
    ptr = first;

    // the pending capture: 1 after a routine keyword, 2 after a module
    // keyword, 3 over the unit names of a `uses` clause
    let mut expect = 0u32;
    // after a routine name until its `(`
    let mut fn_head = false;
    // open parentheses
    let mut paren = 0u32;
    // the depth of a parameter list, where bare names are parameters
    let mut param_depth = 0u32;
    // after `:` or `of`: names are types
    let mut type_ctx = false;
    // inside a property declaration
    let mut prop_ctx = false;
    // the next name is a property's name
    let mut prop_name = false;
    // after `.`
    let mut member = false;

    // The bracket `c` at `ptr`.
    macro_rules! bracket {
        ($c:expr) => {{
            let c: u8 = $c;
            ptr += 1;
            emit!(tok::PUNCTUATION_BRACKET, ptr);
            if c == b'(' {
                paren = paren.wrapping_add(1);
                if fn_head {
                    param_depth = paren;
                    fn_head = false;
                }
                if expect != 3 {
                    expect = 0;
                }
            }
            if c == b')' {
                if paren == param_depth {
                    param_depth = 0;
                }
                paren = paren.saturating_sub(1);
                type_ctx = false;
            }
            member = false;
        }};
    }
    // The `,` or `;` at `ptr`.
    macro_rules! delimiter {
        ($c:expr) => {{
            let c: u8 = $c;
            ptr += 1;
            emit!(tok::PUNCTUATION_DELIMITER, ptr);
            member = false;
            type_ctx = false;
            if c == b';' {
                expect = 0;
                fn_head = false;
                prop_ctx = false;
                prop_name = false;
            }
        }};
    }
    // The `.` at `ptr`, followed by `c2`.
    macro_rules! dot {
        ($c2:expr) => {{
            let c2: u8 = $c2;
            // `..` ranges; `.` selects a member
            if c2 == b'.' {
                ptr += 2;
                emit!(tok::OPERATOR, ptr);
            } else {
                ptr += 1;
                emit!(tok::PUNCTUATION_DELIMITER, ptr);
                member = expect == 0;
            }
        }};
    }
    // The `:` at `ptr`, followed by `c2`.
    macro_rules! colon {
        ($c2:expr) => {{
            let c2: u8 = $c2;
            // `:=` assigns; a lone `:` opens the type of a declaration
            if c2 == b'=' {
                ptr += 2;
                emit!(tok::OPERATOR, ptr);
            } else {
                ptr += 1;
                emit!(tok::PUNCTUATION_DELIMITER, ptr);
                type_ctx = true;
                fn_head = false;
            }
            member = false;
        }};
    }

    loop {
        let s = at(src, ptr);
        if s == b' ' && !is_space(at(src, ptr + 1)) {
            // one space
            ptr += 1;
            extend!(ptr);
        } else if is_space(s) {
            ptr = whitespace_end(src, ptr + 1);
            extend!(ptr);
        }
        let lhs = ptr;
        let c = at(src, ptr);
        let c2 = at(src, ptr + 1);

        let class = CLASS[c as usize];
        // Names, the most common tokens, skip the jump table.
        if class == class::IDENT {
            let rhs = name_run_end(src, ptr + 1);
            ptr = rhs;
            let key = lower_key(src, lhs, rhs);
            let mut kind = match key {
                Some(key) if !member => word_value(key),
                _ => -1,
            };
            // a property directive is an ordinary name outside a
            // property
            if kind >= 0 && kind & 4096 != 0 && !prop_ctx {
                kind = -1;
            }
            let hl;
            if kind >= 0 {
                hl = (kind & 255) as u32;
                if (kind >> 8) & 15 != 0 {
                    expect = ((kind >> 8) & 15) as u32;
                }
                fn_head = false;
                // `of` opens a type; `property` opens a declaration; a
                // block keyword ends both
                let lo = key.map_or(0, |k| k.0);
                type_ctx = rhs - lhs == 2 && lo == word(b"of");
                if rhs - lhs == 8 && lo == word(b"property") {
                    prop_ctx = true;
                    prop_name = true;
                }
                if hl == tok::KEYWORD && kind & 4096 == 0 {
                    prop_ctx = false;
                    expect = 0;
                }
            } else if member {
                hl = if at(src, skip_space_at(src, rhs)) == b'(' {
                    tok::FUNCTION_METHOD
                } else {
                    tok::PROPERTY
                };
            } else if expect > 1 {
                // module and `uses` names are namespaces
                hl = tok::NAMESPACE;
            } else if expect == 1 {
                // `procedure TForm1.Click(` names the class first
                if at(src, rhs) == b'.' {
                    hl = tok::TYPE;
                } else {
                    hl = tok::FUNCTION_DEFINITION;
                    expect = 0;
                    fn_head = true;
                }
            } else if type_ctx {
                hl = tok::TYPE;
            } else if param_depth != 0 && paren == param_depth {
                hl = tok::VARIABLE_PARAMETER;
            } else if prop_name {
                hl = tok::PROPERTY;
                prop_name = false;
            } else if at(src, skip_space_at(src, rhs)) == b'(' {
                hl = tok::FUNCTION;
            } else if is_const_case(src, lhs, rhs) {
                hl = tok::CONSTANT;
            } else if is_type_name(src, lhs, rhs) {
                hl = tok::TYPE;
            } else {
                hl = tok::VARIABLE;
            }
            emit!(hl, rhs);
            member = false;
            // A bracket, delimiter, `.`, or `:` right after the name:
            // its rules run here, without the gap and dispatch steps.
            let n = at(src, ptr);
            match CLASS[n as usize] {
                class::OPEN_PAREN if at(src, ptr + 1) != b'*' => bracket!(n),
                class::BRACKET => bracket!(n),
                class::DELIMITER => delimiter!(n),
                class::DOT if !is_digit(at(src, ptr + 1)) => dot!(at(src, ptr + 1)),
                class::COLON => colon!(at(src, ptr + 1)),
                _ => {}
            }
            continue;
        }
        match class {
            class::SLASH if c2 == b'/' => {
                // `$lexLineComment`, `$scanToLineEnd`
                ptr = scan::line_end(src, ptr + 2, end);
                emit!(tok::COMMENT, ptr);
            }
            class::BRACE => {
                let hl = if c2 == b'$' {
                    tok::PREPROC
                } else {
                    tok::COMMENT
                };
                ptr = braced_end(src, ptr + 1, end, false);
                emit!(hl, ptr);
            }
            class::OPEN_PAREN if c2 == b'*' => {
                let hl = if at(src, ptr + 2) == b'$' {
                    tok::PREPROC
                } else {
                    tok::COMMENT
                };
                ptr = braced_end(src, ptr + 2, end, true);
                emit!(hl, ptr);
            }
            class::QUOTE => {
                ptr = with_recs!(|recs| string(src, recs, ptr, end));
                member = false;
            }
            class::HASH if is_digit(c2) || c2 == b'$' => {
                // `#13`, `#$0A` character codes
                ptr = name_run_end(src, ptr + 2);
                emit!(tok::STRING_SPECIAL, ptr);
            }
            class::DOLLAR if is_hex(c2) => {
                // `$FF` hex
                ptr = name_run_end(src, ptr + 1);
                emit!(tok::NUMBER, ptr);
                member = false;
            }
            class::RADIX if is_digit(c2) => {
                // `%1010` binary, `&17` octal
                ptr = name_run_end(src, ptr + 1);
                emit!(tok::NUMBER, ptr);
                member = false;
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
            class::OPEN_PAREN | class::BRACKET => bracket!(c),
            class::DELIMITER => delimiter!(c),
            class::DOT => dot!(c2),
            class::COLON => colon!(c2),
            class::OP | class::SLASH => {
                // a comment opener ends the run
                while OPS[at(src, ptr) as usize]
                    && !(at(src, ptr) == b'/' && at(src, ptr + 1) == b'/')
                {
                    ptr += 1;
                }
                emit!(tok::OPERATOR, ptr);
                if c == b'=' {
                    type_ctx = false;
                }
                member = false;
            }
            class::NUL if ptr >= end => break,
            _ => {
                ptr = scan::utf8_span_end(src, ptr + 1, end);
                emit!(tok::NONE, ptr);
                member = false;
            }
        }
    }
    // SAFETY: the records before `cur` are written.
    unsafe { inst.ext.recs.set_len(cur.offset_from(rp) as usize) };
}
