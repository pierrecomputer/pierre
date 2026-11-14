//! WAT sources: src/langs/pascal.wat src/common.wat src/scan.wat
//!
//! Native Pascal highlighter. One pass over the input: each token is
//! scanned and colored in the same step, with the same rules, in the same
//! order, as the translated `$hlPascal`. The records equal the translated
//! lexer's records.

use super::Lexer;
use super::input::Input;
use super::recs::Recs;
use super::scan;
use super::tables::byteset;
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
fn lower_key(src: Input, lhs: usize, rhs: usize) -> Option<(u64, u64)> {
    let n = rhs - lhs;
    if n > WORD_MAX {
        return None;
    }
    // SAFETY: `lhs` is a name's start, before the input end.
    if WORD_LENGTHS[unsafe { src.byte_unchecked(lhs) } as usize] >> n & 1 == 0 {
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
fn whitespace_end(src: Input, mut p: usize) -> usize {
    loop {
        // SAFETY: `p` starts at or before the input end, and the NUL there
        // ends the run, so `p` never passes it; 8 bytes from there stay inside
        // the slack.
        let c = unsafe { src.byte_unchecked(p) };
        if c == b' ' {
            // Skip spaces 8 bytes at a time.
            // SAFETY: as above.
            let w = unsafe { src.word_unchecked(p) };
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
fn name_run_end(src: Input, mut p: usize) -> usize {
    // Most names are short: test a few bytes one by one first.
    for _ in 0..8 {
        // SAFETY: `p` starts at or before the input end, and the NUL there
        // ends the run, so `p` never passes it; 16 bytes from there stay
        // inside the slack.
        if !NAME_CONT[unsafe { src.byte_unchecked(p) } as usize] {
            return p;
        }
        p += 1;
    }
    loop {
        // SAFETY: as above.
        let v = unsafe { src.vec_unchecked(p) };
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
fn skip_space_at(src: Input, mut p: usize) -> usize {
    // SAFETY: `p` starts at or before the input end, and the NUL there ends
    // the run.
    while unsafe { src.byte_unchecked(p) } == b' ' || unsafe { src.byte_unchecked(p) } == b'\t' {
        p += 1;
    }
    p
}

/// The end of the number at `p`: radix digits, separators, exponents, and
/// suffixes, with `.` only before a digit (`$lexScanNumber`,
/// `$lexScanNumberBody`).
fn number_end(src: Input, mut p: usize) -> usize {
    let hex = src.byte(p) == b'0' && src.byte(p + 1) | 0x20 == b'x';
    let mut prev = 0u8;
    loop {
        // SAFETY: `p` starts at or before the input end, and the NUL there
        // ends the number, so every read is at most one byte past it.
        let c = unsafe { src.byte_unchecked(p) };
        if IDENT_CONT[c as usize] {
            prev = c;
            p += 1;
            continue;
        }
        if c == b'.' {
            // SAFETY: as above.
            let next = unsafe { src.byte_unchecked(p + 1) };
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
fn is_const_case(src: Input, lhs: usize, rhs: usize) -> bool {
    if rhs - lhs < 2 {
        return false;
    }
    let mut upper = false;
    for p in lhs..rhs {
        // SAFETY: `p` is inside the name, before the input end.
        let c = unsafe { src.byte_unchecked(p) };
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
fn is_type_name(src: Input, lhs: usize, rhs: usize) -> bool {
    rhs - lhs >= 2 && TYPE_PREFIX[src.byte(lhs) as usize] && is_upper(src.byte(lhs + 1))
}

/// The first `n` bytes at `p` as a little-endian integer, for comparing
/// short words. Reads 8 bytes, which the input slack allows.
#[inline(always)]
fn word_at(src: Input, p: usize, n: u32) -> u64 {
    // SAFETY: every caller passes a position at or before the input end,
    // so the 8 bytes stay inside the slack.
    let w = unsafe { src.word_unchecked(p) };
    w & (u64::MAX >> (64 - 8 * n))
}

/// The end of a `{ ... }` region (`paren` false; its body starts at `p`)
/// or a `(* ... *)` region: through its closer, or `end` (`$pasBraced`).
#[inline(never)]
fn braced_end(src: Input, mut p: usize, end: usize, paren: bool) -> usize {
    if paren {
        loop {
            p = scan::find3(src.bytes(), p, end, b'*', b'*', b'*');
            if p >= end {
                return end;
            }
            p += 1;
            if src.byte(p) == b')' {
                return p + 1;
            }
        }
    }
    let p = scan::find3(src.bytes(), p, end, b'}', b'}', b'}');
    if p < end { p + 1 } else { end }
}

/// The quoted string whose `'` is at `p`: a doubled quote escapes itself,
/// and the literal ends at the quote or the line break. Returns the end
/// (`$pasString`).
#[inline(never)]
fn string(src: Input, mut recs: Recs, p: usize, end: usize) -> (Recs, usize) {
    let mut seg = p;
    let mut ptr = p + 1;
    loop {
        let p = scan::find3(src.bytes(), ptr, end, b'\'', b'\n', b'\r');
        ptr = p;
        if p >= end || src.byte(p) != b'\'' {
            break;
        }
        ptr = p + 1;
        if src.byte(ptr) != b'\'' {
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
    // SAFETY: `base..base + len + SLACK` lies inside lexer memory, which
    // nothing moves while this lexer runs (it calls no translated code).
    let src = unsafe { Input::new(inst, base, len) };
    let end = len;
    let mut recs = Recs::load(inst);

    // `$lexEmitLeadingContinuation`
    let mut ptr = scan::utf8_span_end(src.bytes(), 0, end);
    recs.gap(0, ptr);
    // Leading whitespace; every later gap follows a token's record.
    let first = whitespace_end(src, ptr);
    recs.gap(ptr, first);
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
            recs.tok(tok::PUNCTUATION_BRACKET, ptr);
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
            recs.tok(tok::PUNCTUATION_DELIMITER, ptr);
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
                recs.tok(tok::OPERATOR, ptr);
            } else {
                ptr += 1;
                recs.tok(tok::PUNCTUATION_DELIMITER, ptr);
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
                recs.tok(tok::OPERATOR, ptr);
            } else {
                ptr += 1;
                recs.tok(tok::PUNCTUATION_DELIMITER, ptr);
                type_ctx = true;
                fn_head = false;
            }
            member = false;
        }};
    }

    // `ptr` never passes the input end: every scan stops at the NUL there.
    loop {
        // SAFETY: `ptr` is at or before the input end (see above).
        let s = unsafe { src.byte_unchecked(ptr) };
        // SAFETY: as above.
        if s == b' ' && !is_space(unsafe { src.byte_unchecked(ptr + 1) }) {
            // one space
            ptr += 1;
            recs.extend(ptr);
        } else if is_space(s) {
            ptr = whitespace_end(src, ptr + 1);
            recs.extend(ptr);
        }
        let lhs = ptr;
        // SAFETY: `ptr` is at or before the input end.
        let c = unsafe { src.byte_unchecked(ptr) };
        // SAFETY: as above.
        let c2 = unsafe { src.byte_unchecked(ptr + 1) };

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
                // SAFETY: the NUL at the input end stops the space run.
                hl = if unsafe { src.byte_unchecked(skip_space_at(src, rhs)) } == b'(' {
                    tok::FUNCTION_METHOD
                } else {
                    tok::PROPERTY
                };
            } else if expect > 1 {
                // module and `uses` names are namespaces
                hl = tok::NAMESPACE;
            } else if expect == 1 {
                // `procedure TForm1.Click(` names the class first
                // SAFETY: names end at or before the input end.
                if unsafe { src.byte_unchecked(rhs) } == b'.' {
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
            // SAFETY: the NUL at the input end stops the space run.
            } else if unsafe { src.byte_unchecked(skip_space_at(src, rhs)) } == b'(' {
                hl = tok::FUNCTION;
            } else if is_const_case(src, lhs, rhs) {
                hl = tok::CONSTANT;
            } else if is_type_name(src, lhs, rhs) {
                hl = tok::TYPE;
            } else {
                hl = tok::VARIABLE;
            }
            recs.tok(hl, rhs);
            member = false;
            // A bracket, delimiter, `.`, or `:` right after the name:
            // its rules run here, without the gap and dispatch steps.
            // SAFETY: names end at or before the input end, so these reads are
            // at most one byte past it.
            let n = unsafe { src.byte_unchecked(ptr) };
            match CLASS[n as usize] {
                class::OPEN_PAREN if unsafe { src.byte_unchecked(ptr + 1) } != b'*' => bracket!(n),
                class::BRACKET => bracket!(n),
                class::DELIMITER => delimiter!(n),
                class::DOT if !is_digit(unsafe { src.byte_unchecked(ptr + 1) }) => {
                    dot!(src.byte(ptr + 1))
                }
                class::COLON => colon!(unsafe { src.byte_unchecked(ptr + 1) }),
                _ => {}
            }
            continue;
        }
        match class {
            class::SLASH if c2 == b'/' => {
                // `$lexLineComment`, `$scanToLineEnd`
                ptr = scan::line_end(src.bytes(), ptr + 2, end);
                recs.tok(tok::COMMENT, ptr);
            }
            class::BRACE => {
                let hl = if c2 == b'$' {
                    tok::PREPROC
                } else {
                    tok::COMMENT
                };
                ptr = braced_end(src, ptr + 1, end, false);
                recs.tok(hl, ptr);
            }
            class::OPEN_PAREN if c2 == b'*' => {
                let hl = if src.byte(ptr + 2) == b'$' {
                    tok::PREPROC
                } else {
                    tok::COMMENT
                };
                ptr = braced_end(src, ptr + 2, end, true);
                recs.tok(hl, ptr);
            }
            class::QUOTE => {
                (recs, ptr) = string(src, recs, ptr, end);
                member = false;
            }
            class::HASH if is_digit(c2) || c2 == b'$' => {
                // `#13`, `#$0A` character codes
                ptr = name_run_end(src, ptr + 2);
                recs.tok(tok::STRING_SPECIAL, ptr);
            }
            class::DOLLAR if is_hex(c2) => {
                // `$FF` hex
                ptr = name_run_end(src, ptr + 1);
                recs.tok(tok::NUMBER, ptr);
                member = false;
            }
            class::RADIX if is_digit(c2) => {
                // `%1010` binary, `&17` octal
                ptr = name_run_end(src, ptr + 1);
                recs.tok(tok::NUMBER, ptr);
                member = false;
            }
            class::DIGIT => {
                ptr = number_end(src, ptr);
                recs.tok(tok::NUMBER, ptr);
                member = false;
            }
            class::DOT if is_digit(c2) => {
                ptr = number_end(src, ptr);
                recs.tok(tok::NUMBER, ptr);
                member = false;
            }
            class::OPEN_PAREN | class::BRACKET => bracket!(c),
            class::DELIMITER => delimiter!(c),
            class::DOT => dot!(c2),
            class::COLON => colon!(c2),
            class::OP | class::SLASH => {
                // a comment opener ends the run
                while OPS[src.byte(ptr) as usize]
                    && !(src.byte(ptr) == b'/' && src.byte(ptr + 1) == b'/')
                {
                    ptr += 1;
                }
                recs.tok(tok::OPERATOR, ptr);
                if c == b'=' {
                    type_ctx = false;
                }
                member = false;
            }
            class::NUL if ptr >= end => break,
            _ => {
                ptr = scan::utf8_span_end(src.bytes(), ptr + 1, end);
                recs.tok(tok::NONE, ptr);
                member = false;
            }
        }
    }
    recs.store(inst);
}
