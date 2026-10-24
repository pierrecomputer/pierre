//! WAT sources: src/langs/sql.wat src/common.wat src/scan.wat
//!
//! Native SQL lexer. One pass over the input: comments in their dialect
//! forms, quoted strings and identifiers, PostgreSQL dollar-quoted strings,
//! numbers, keywords and builtin types (case-insensitive), function calls
//! (a name glued to `(`, except a table's column list), parameters and
//! T-SQL temp tables, brackets, delimiters, and operators. The records
//! equal the translated `sql` lexer's records.

use super::Lexer;
use super::scan;
use crate::Rec;
use crate::generated::Instance;
use crate::simd::V;
use crate::token_ids as tok;

/// The lexer for each language this module handles.
pub(crate) fn lexer(name: &str) -> Option<Lexer> {
    match name {
        "sql" => Some(highlight),
        _ => None,
    }
}

/// The byte at `p`.
#[inline(always)]
fn at(src: &[u8], p: usize) -> u8 {
    debug_assert!(p < src.len());
    // SAFETY: every position read lies at most 16 bytes past the input
    // end, inside the input slack `src` covers.
    unsafe { *src.get_unchecked(p) }
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

/// The 8-byte little-endian load at `p`.
#[inline(always)]
fn load64(src: &[u8], p: usize) -> u64 {
    debug_assert!(p + 8 <= src.len());
    // SAFETY: every 8-byte load starts at most 8 bytes past the input end,
    // inside the slack.
    unsafe { src.as_ptr().add(p).cast::<u64>().read_unaligned() }.to_le()
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
/// after the input ends every run by the input end.
#[inline(always)]
fn space_end(src: &[u8], mut p: usize) -> usize {
    while is_space(at(src, p)) {
        p += 1;
    }
    p
}

/// The end of the identifier run from `p` (`$lexScanIdent`,
/// `$scanIdentRun` with `$`). The NUL after the input ends every run.
#[inline(always)]
fn ident_end(src: &[u8], mut p: usize) -> usize {
    while IDENT[at(src, p) as usize] {
        p += 1;
    }
    p
}

/// Identifier bytes as a table (`$lexIsIdentContinue`).
static IDENT: [bool; 256] = {
    let mut t = [false; 256];
    let mut c = 0;
    while c < 256 {
        t[c] = is_ident_continue(c as u8);
        c += 1;
    }
    t
};

/// A number from `p`, at its first digit or dot (`$lexScanNumber`,
/// `$lexScanNumberBody`).
#[inline(always)]
fn scan_number(src: &[u8], end: usize, mut p: usize) -> usize {
    let hex = p + 1 < end && at(src, p) == b'0' && at(src, p + 1) | 32 == b'x';
    let mut prev = 0u8;
    while p < end {
        let c = at(src, p);
        if IDENT[c as usize] {
            prev = c;
            p += 1;
            continue;
        }
        if c == b'.' {
            let next = if p + 1 < end { at(src, p + 1) } else { 0 };
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

/// The little-endian integer of `w`.
const fn word(w: &[u8]) -> u64 {
    let mut x = 0u64;
    let mut i = 0;
    while i < w.len() {
        x |= (w[i] as u64) << (8 * i);
        i += 1;
    }
    x
}

/// The words `$sqlWordHl` colors, with their colors.
const WORDS: [(&str, u32); 66] = [
    ("all", tok::KEYWORD),
    ("as", tok::KEYWORD),
    ("asc", tok::KEYWORD),
    ("and", tok::KEYWORD_OPERATOR),
    ("by", tok::KEYWORD),
    ("between", tok::KEYWORD_OPERATOR),
    ("bigint", tok::TYPE_BUILTIN),
    ("blob", tok::TYPE_BUILTIN),
    ("boolean", tok::TYPE_BUILTIN),
    ("create", tok::KEYWORD),
    ("case", tok::KEYWORD_CONTROL),
    ("char", tok::TYPE_BUILTIN),
    ("default", tok::KEYWORD),
    ("delete", tok::KEYWORD),
    ("desc", tok::KEYWORD),
    ("distinct", tok::KEYWORD),
    ("date", tok::TYPE_BUILTIN),
    ("decimal", tok::TYPE_BUILTIN),
    ("double", tok::TYPE_BUILTIN),
    ("end", tok::KEYWORD),
    ("exists", tok::KEYWORD_OPERATOR),
    ("else", tok::KEYWORD_CONTROL),
    ("foreign", tok::KEYWORD),
    ("from", tok::KEYWORD),
    ("full", tok::KEYWORD),
    ("false", tok::BOOLEAN),
    ("group", tok::KEYWORD),
    ("having", tok::KEYWORD),
    ("inner", tok::KEYWORD),
    ("insert", tok::KEYWORD),
    ("into", tok::KEYWORD),
    ("in", tok::KEYWORD_OPERATOR),
    ("is", tok::KEYWORD_OPERATOR),
    ("integer", tok::TYPE_BUILTIN),
    ("join", tok::KEYWORD),
    ("json", tok::TYPE_BUILTIN),
    ("jsonb", tok::TYPE_BUILTIN),
    ("left", tok::KEYWORD),
    ("limit", tok::KEYWORD),
    ("like", tok::KEYWORD_OPERATOR),
    ("not", tok::KEYWORD_OPERATOR),
    ("nchar", tok::TYPE_BUILTIN),
    ("null", tok::CONSTANT_BUILTIN),
    ("on", tok::KEYWORD),
    ("order", tok::KEYWORD),
    ("outer", tok::KEYWORD),
    ("or", tok::KEYWORD_OPERATOR),
    ("primary", tok::KEYWORD),
    ("right", tok::KEYWORD),
    ("real", tok::TYPE_BUILTIN),
    ("select", tok::KEYWORD),
    ("set", tok::KEYWORD),
    ("table", tok::KEYWORD),
    ("to", tok::KEYWORD),
    ("then", tok::KEYWORD_CONTROL),
    ("text", tok::TYPE_BUILTIN),
    ("true", tok::BOOLEAN),
    ("union", tok::KEYWORD),
    ("update", tok::KEYWORD),
    ("using", tok::KEYWORD),
    ("uuid", tok::TYPE_BUILTIN),
    ("values", tok::KEYWORD),
    ("varchar", tok::TYPE_BUILTIN),
    ("where", tok::KEYWORD),
    ("with", tok::KEYWORD),
    ("when", tok::KEYWORD_CONTROL),
];

/// Slots of the word hash.
const WORD_SLOTS: usize = 256;

/// The word hash slot of the folded word `w`.
#[inline(always)]
const fn word_slot(w: u64, mul: u64) -> usize {
    (w.wrapping_mul(mul) >> (64 - WORD_SLOTS.trailing_zeros())) as usize
}

/// [`WORDS`] as a collision-free hash on their folded integers: each slot
/// holds a word's integer and color, or 0 and the variable color.
struct WordTable {
    keys: [u64; WORD_SLOTS],
    colors: [u8; WORD_SLOTS],
    mul: u64,
}

static WORD_TABLE: WordTable = {
    let mut mul: u64 = 0x9e37_79b9_7f4a_7c15;
    let mut attempt = 0;
    'search: loop {
        assert!(attempt < 100_000, "no collision-free word hash");
        let mut keys = [0u64; WORD_SLOTS];
        let mut colors = [tok::VARIABLE as u8; WORD_SLOTS];
        let mut i = 0;
        while i < WORDS.len() {
            let w = word(WORDS[i].0.as_bytes());
            let s = word_slot(w, mul);
            if keys[s] != 0 {
                mul = mul.wrapping_add(0x6a09_e667_f3bc_c909) | 1;
                attempt += 1;
                continue 'search;
            }
            keys[s] = w;
            colors[s] = WORDS[i].1 as u8;
            i += 1;
        }
        break 'search WordTable { keys, colors, mul };
    }
};

/// The color of the name `[lhs, rhs)`: a keyword, operator word, control
/// word, builtin type, boolean, or `null`, compared case-insensitively by
/// ORing 0x20 into its bytes; anything else is a variable (`$sqlWordHl`).
#[inline(always)]
fn word_hl(src: &[u8], lhs: usize, rhs: usize) -> u32 {
    let n = rhs - lhs;
    if n.wrapping_sub(2) > 6 {
        return tok::VARIABLE;
    }
    let w = (load64(src, lhs) | 0x2020_2020_2020_2020) & (u64::MAX >> ((8 - n) * 8));
    let t = &WORD_TABLE;
    let s = word_slot(w, t.mul);
    if t.keys[s] == w {
        t.colors[s] as u32
    } else {
        tok::VARIABLE
    }
}

/// A PostgreSQL dollar-quoted string at the `$` at `lhs`: `$tag$` up to
/// the same tag again, or the end. Returns its end, or `None` when no tag
/// opens here (`$sqlDollarString`).
fn dollar_string(src: &[u8], end: usize, lhs: usize) -> Option<usize> {
    let mut p = lhs + 1;
    if p >= end {
        return None;
    }
    if at(src, p) != b'$' && !is_ident_start(at(src, p)) {
        return None;
    }
    while p < end && at(src, p) != b'$' {
        if !is_ident_continue(at(src, p)) {
            return None;
        }
        p += 1;
    }
    if p >= end || at(src, p) != b'$' {
        return None;
    }
    let delimiter = p + 1;
    let n = delimiter - lhs;
    let tag = &src[lhs..delimiter];
    let mut p = delimiter;
    loop {
        let candidate = if p >= end {
            end
        } else {
            scan::find3(src, p, end, b'$', b'$', b'$')
        };
        // A tag that no longer fits before the end cannot fit at any
        // later candidate either.
        if candidate + n > end {
            return Some(end);
        }
        if &src[candidate..candidate + n] == tag {
            return Some(candidate + n);
        }
        p = candidate + 1;
    }
}

/// Whether the name at `lhs` follows `INTO` or `TABLE`, through blanks and
/// one `schema.` qualifier, on its line (`$sqlTableBefore`).
#[cold]
#[inline(never)]
fn table_before(src: &[u8], lhs: usize) -> bool {
    let mut p = lhs;
    if p > 0 && at(src, p - 1) == b'.' {
        p -= 1;
        while p > 0 && is_ident_continue(at(src, p - 1)) {
            p -= 1;
        }
    }
    while p > 0 && (at(src, p - 1) == b' ' || at(src, p - 1) == b'\t') {
        p -= 1;
    }
    let w = p;
    while p > 0 && is_ident_continue(at(src, p - 1)) {
        p -= 1;
    }
    let n = w - p;
    let x = load64(src, p);
    (n == 4 && (x as u32 | 0x2020_2020) == word(b"into") as u32)
        || (n == 5 && (x | 0x20_2020_2020) & 0xff_ffff_ffff == word(b"table"))
}

/// A string or quoted identifier at `lhs` with quote `q`, up to the next
/// `q` (included) or the end; a doubled quote closes and reopens it, and
/// the two halves merge. Returns its end (`$lexRawString`, multi-line).
#[inline(always)]
fn raw_string(src: &[u8], end: usize, lhs: usize, q: u8) -> usize {
    let p = lhs + 1;
    if p >= end {
        return p;
    }
    let p = scan::find3(src, p, end, q, q, q);
    if p < end { p + 1 } else { p }
}

/// Bytes that start a name and no rule before the name rule: letters,
/// `_`, and bytes from 128.
static WORD_START: [bool; 256] = {
    let mut t = [false; 256];
    let mut c = 0;
    while c < 256 {
        t[c] = is_ident_start(c as u8) && c != b'$' as usize;
        c += 1;
    }
    t
};

/// Kinds of the single-byte tokens and strings that [`KIND`] sorts out
/// before the other rules.
const K_BRACKET: u8 = 1;
const K_DELIMITER: u8 = 2;
const K_QUOTE: u8 = 3;

/// The kind of every byte, 0 for bytes the other rules take.
static KIND: [u8; 256] = {
    let mut t = [0u8; 256];
    t[b'(' as usize] = K_BRACKET;
    t[b')' as usize] = K_BRACKET;
    t[b'[' as usize] = K_BRACKET;
    t[b']' as usize] = K_BRACKET;
    t[b',' as usize] = K_DELIMITER;
    t[b';' as usize] = K_DELIMITER;
    t[b'"' as usize] = K_QUOTE;
    t[b'\'' as usize] = K_QUOTE;
    t[b'`' as usize] = K_QUOTE;
    t
};

/// The operator bytes: `<`, `=`, `>`, `+`, `,`, `-`, `.`, and
/// `!%&*/^|~`.
static OPERATOR: [bool; 256] = {
    let mut t = [false; 256];
    let mut c = 0;
    while c < 256 {
        let b = c as u8;
        t[c] = b.wrapping_sub(b'<') <= 2
            || b.wrapping_sub(b'+') <= 3
            || matches!(b, b'!' | b'%' | b'&' | b'*' | b'/' | b'^' | b'|' | b'~');
        c += 1;
    }
    t
};

/// Byte classes as two nibble tables: byte `b` is in a class when
/// `CLASS_HI[b >> 4] & CLASS_LO[b & 15]` has one of its bits. Whitespace: 1
/// for TAB to CR, 2 for a space; identifier bytes: 4 for digits, 8 for
/// `A`-`O` and `a`-`o`, 16 for `P`-`Z` and `p`-`z`, 32 for `_`, 64 for `$`,
/// 128 for bytes from 128.
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
        if l == 4 {
            m |= 64;
        }
        t[l] = m;
        l += 1;
    }
    t
};
const SPACE_BITS: u8 = 1 | 2;
const IDENT_BITS: u8 = !SPACE_BITS;

/// The non-whitespace and non-identifier masks of the 64 bytes from `b`,
/// one bit per byte. `b + 64` must lie inside the input slack.
#[inline(always)]
fn block_masks(src: &[u8], b: usize) -> (u64, u64) {
    debug_assert!(b + 64 <= src.len());
    let hi_t = V::from_array(&CLASS_HI);
    let lo_t = V::from_array(&CLASS_LO);
    let mut space = [V::zero(); 4];
    let mut ident = [V::zero(); 4];
    for i in 0..4 {
        // SAFETY: the caller keeps the 64 bytes from `b` inside the slack.
        let v = unsafe { V::load(src.as_ptr().add(b + 16 * i)) };
        let class = hi_t
            .lookup(v.shr::<4>())
            .and(lo_t.lookup(v.and(V::splat(15))));
        space[i] = class.test(V::splat(SPACE_BITS));
        ident[i] = class.test(V::splat(IDENT_BITS));
    }
    (
        !V::bits64(space[0], space[1], space[2], space[3]),
        !V::bits64(ident[0], ident[1], ident[2], ident[3]),
    )
}

/// Bit masks of two adjacent 64-byte blocks of the input, the second
/// starting at `mid`: for each byte, whether it is not whitespace, and
/// whether it is not an identifier byte. A scan over the window is a shift
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
    fn at(src: &[u8], end: usize, blk: usize) -> Self {
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
    fn sync(&mut self, src: &[u8], end: usize, p: usize) {
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
    fn space_end(&mut self, src: &[u8], end: usize, p: usize) -> usize {
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

    /// The end of the identifier run from `p`, which lies in the first
    /// block (`$lexScanIdent`).
    #[inline(always)]
    fn ident_end(&self, src: &[u8], p: usize) -> usize {
        // As in `space_end`.
        let m = self.other0 >> (p.wrapping_sub(self.mid) & 63);
        if m != 0 {
            return p + m.trailing_zeros() as usize;
        }
        core::hint::cold_path();
        if self.other1 != 0 {
            return self.mid + self.other1.trailing_zeros() as usize;
        }
        ident_end(src, self.mid + 64)
    }
}

/// Lex the input at `base` (`$hlSql`).
fn highlight(inst: &mut Instance, base: usize, len: usize) {
    let mem_ptr = inst.mem.bytes().as_ptr();
    // SAFETY: `base..base + len + 96` lies inside lexer memory, and this
    // lexer calls no translated function that could reallocate it.
    let src: &[u8] = unsafe { core::slice::from_raw_parts(mem_ptr.add(base), len + 96) };
    let v = &mut inst.ext.recs;
    let rp = v.as_mut_ptr();
    // SAFETY: the length and capacity bound the vector's allocation.
    let mut out = unsafe {
        Out {
            cur: rp.add(v.len()),
            limit: rp.add(v.capacity()),
            last: v.last().map_or(u32::MAX, |r| r.token),
        }
    };
    // `$lexEmitLeadingContinuation`, then the leading whitespace: both are
    // gaps, so with no record yet they make one plain record.
    let p = space_end(src, scan::utf8_span_end(src, 0, len));
    if p > 0 {
        if out.cur == rp {
            out.tok(tok::NONE, p);
        } else {
            // SAFETY: a record exists.
            unsafe { out.extend(p) };
        }
    }
    let out = lex(src, len, out, p);
    // SAFETY: the records before `out.cur` are written, within capacity.
    unsafe { v.set_len(out.cur.offset_from(rp) as usize) };
}

/// The lexer loop, from the first token (`$hlSql`). Each pass lexes one
/// token at `p` and then the whitespace after it.
fn lex(src: &[u8], end: usize, mut out: Out, mut p: usize) -> Out {
    let mut win = Window::at(src, end, p & !63);
    while p < end {
        let lhs = p;
        let c = at(src, p);
        // The NUL after the input reads as the WAT's 0 past the end.
        let next = at(src, p + 1);
        'done: {
            // A name: letters, `_`, and bytes from 128 start no earlier
            // rule, so they take the name rule below at once.
            if WORD_START[c as usize] {
                p = win.ident_end(src, p);
                let mut hl = word_hl(src, lhs, p);
                let c = at(src, p);
                if hl == tok::VARIABLE && c == b'(' && p < end && !table_before(src, lhs) {
                    hl = tok::FUNCTION;
                }
                out.tok(hl, p);
                // A delimiter often follows at once: its rule below, taken
                // here (a `.` before a digit starts a number instead). The
                // NUL after the input is none of them.
                if c == b',' || c == b';' || (c == b'.' && !is_digit(at(src, p + 1))) {
                    p += 1;
                    out.tok(tok::PUNCTUATION_DELIMITER, p);
                }
                break 'done;
            }
            // Brackets, delimiters other than `.`, and quotes start no
            // earlier rule either.
            let k = KIND[c as usize];
            if k != 0 {
                if k == K_BRACKET {
                    p += 1;
                    out.tok(tok::PUNCTUATION_BRACKET, p);
                } else if k == K_DELIMITER {
                    p += 1;
                    out.tok(tok::PUNCTUATION_DELIMITER, p);
                } else {
                    // SQL has no backslash escapes: a doubled quote closes
                    // and reopens the string, and the halves merge.
                    p = raw_string(src, end, lhs, c);
                    out.tok(tok::STRING, p);
                }
                break 'done;
            }
            // `#` is MySQL's line comment only where no other dialect gives
            // it a meaning: PostgreSQL's `#>`, `#>>`, and `#-` are JSON
            // operators, and a `#` or `##` glued to a name is a T-SQL temp
            // table.
            let mut temp = false;
            if c == b'#' {
                if next == b'>' || next == b'-' {
                    p += 2;
                    if next == b'>' && p < end && at(src, p) == b'>' {
                        p += 1;
                    }
                    out.tok(tok::OPERATOR, p);
                    break 'done;
                }
                let q = p + if next == b'#' { 2 } else { 1 };
                temp = q < end && is_ident_start(at(src, q));
            }
            if (c == b'-' && next == b'-') || (c == b'#' && !temp) {
                // `$lexLineComment`.
                p = scan::line_end(src, (p + if c == b'-' { 2 } else { 1 }).min(end), end);
                out.tok(tok::COMMENT, p);
                break 'done;
            }
            if c == b'/' && next == b'*' {
                // `$lexBlockComment`.
                p = scan::block_comment_end(src, p + 2, end);
                out.tok(tok::COMMENT, p);
                break 'done;
            }
            // The kind table above takes quotes, brackets, `,`, and `;`;
            // their rules stay here in the WAT's order (dropping them
            // measured slower).
            if c == b'"' || c == b'\'' || c == b'`' {
                p = raw_string(src, end, lhs, c);
                out.tok(tok::STRING, p);
                break 'done;
            }
            if c == b'$'
                && let Some(e) = dollar_string(src, end, lhs)
            {
                p = e;
                out.tok(tok::STRING, p);
                break 'done;
            }
            if is_digit(c) || (c == b'.' && is_digit(next)) {
                p = scan_number(src, end, p);
                out.tok(tok::NUMBER, p);
                break 'done;
            }
            // A name is a call only with its `(` glued on, except right
            // after INTO or TABLE, where it is the table and its column
            // list. Temp table names skip the keywords.
            if is_ident_start(c) || temp {
                let mut hl = tok::VARIABLE;
                if temp {
                    p = ident_end(src, p + if next == b'#' { 2 } else { 1 });
                } else {
                    p = win.ident_end(src, p);
                    hl = word_hl(src, lhs, p);
                }
                if hl == tok::VARIABLE && p < end && at(src, p) == b'(' && !table_before(src, lhs) {
                    hl = tok::FUNCTION;
                }
                out.tok(hl, p);
                break 'done;
            }
            if c == b'?' || c == b'$' || c == b':' || c == b'@' {
                p = ident_end(src, p + 1);
                out.tok(tok::VARIABLE_SPECIAL, p);
                break 'done;
            }
            if c == b'(' || c == b')' || c == b'[' || c == b']' {
                p += 1;
                out.tok(tok::PUNCTUATION_BRACKET, p);
                break 'done;
            }
            if c == b',' || c == b';' || c == b'.' {
                p += 1;
                out.tok(tok::PUNCTUATION_DELIMITER, p);
                break 'done;
            }
            if OPERATOR[c as usize] {
                p += 1;
                if p < end && (at(src, p) == b'=' || at(src, p) == c) {
                    p += 1;
                }
                out.tok(tok::OPERATOR, p);
                break 'done;
            }
            p += 1;
            out.tok(tok::NONE, p);
        }

        // The whitespace after the token extends its record (a no-op when
        // there is none).
        win.sync(src, end, p);
        p = win.space_end(src, end, p);
        // SAFETY: the token emitted a record.
        unsafe { out.extend(p) };
    }
    out
}
