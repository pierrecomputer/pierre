//! WAT sources: src/langs/swift.wat src/common.wat src/scan.wat src/sig.wat
//!
//! Native Swift lexer. One pass over the input: each token is scanned and
//! colored in the same step, with the same rules, in the same order, as the
//! translated `$hlSwift`. The records equal the translated lexer's records.
//!
//! The WAT tests its rules in one long chain. Each rule matches its own
//! first bytes, so this lexer dispatches on the first byte's class and, for
//! each class, tests only the rules that can match it, in the WAT's order.
//! A string's body is scanned right after its opener, and again right after
//! the `)` that closes one of its `\(…)` interpolations; the WAT scans it at
//! the top of its loop, which comes to the same thing.

use super::Lexer;
use super::input::Input;
use super::recs::Recs;
use super::scan;
use super::tables::byteset;
use crate::generated::Instance;
use crate::simd::V;
use crate::token_ids as tok;
use crate::wat_tables::SWIFT_WORDS;

/// The lexer for `name`, if this module handles it.
pub(crate) fn lexer(name: &str) -> Option<Lexer> {
    match name {
        "swift" => Some(highlight),
        _ => None,
    }
}

/// `$swiftWords` and the word `$swiftWordHl` matches outside the table,
/// `where`, with the same result as a table entry, as a perfect hash on a
/// word's bytes. A word of up to 16 bytes is two little-endian integers,
/// `lo` (bytes 0-7) and `hi` (bytes 8-15), zero past its end; identifiers
/// hold no NUL, so equal integers mean equal words. Each word has its own
/// slot, found from `lo` alone.
struct Words {
    keys: [(u64, u64); WORD_SLOTS],
    /// The word's `keyword-table.value`: its token in the low byte, the
    /// next-name capture in bits 8-9 (1 = function, 2 = type), bit 10 for a
    /// word whose condition runs to the next `{`, and bit 11 for a soft
    /// modifier.
    values: [i32; WORD_SLOTS],
    /// For each first byte, a bit per length of the words starting with it.
    lengths: [u32; 256],
    mul: u64,
}

const WORD_SLOTS: usize = 1024;

/// The longest word.
const WORD_MAX: usize = 12;

/// The word `$swiftWordHl` matches outside the table.
const EXTRA_WORDS: [(&[u8], i32); 1] = [(b"where", tok::KEYWORD as i32)];

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
    let n = SWIFT_WORDS.len() + EXTRA_WORDS.len();
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
    if i < SWIFT_WORDS.len() {
        (SWIFT_WORDS[i].word, SWIFT_WORDS[i].value)
    } else {
        EXTRA_WORDS[i - SWIFT_WORDS.len()]
    }
}

/// The value of the word `[lhs, rhs)`, or -1 when it is none
/// (`$swiftWordHl`).
#[inline(always)]
fn word_value(src: Input, lhs: usize, rhs: usize) -> i32 {
    let n = rhs - lhs;
    // SAFETY: `lhs` lies inside the input, so 16 bytes from it lie inside
    // the slack.
    if n > WORD_MAX || WORDS.lengths[unsafe { src.byte_unchecked(lhs) } as usize] >> n & 1 == 0 {
        return -1;
    }
    // SAFETY: as above.
    let lo =
        unsafe { src.word_unchecked(lhs) } & if n >= 8 { u64::MAX } else { (1 << (8 * n)) - 1 };
    // (`n` is at most 12, so the shift stays below 64)
    // SAFETY: as above.
    let hi = unsafe { src.word_unchecked(lhs + 8) } & ((1 << (8 * n.saturating_sub(8))) - 1);
    let s = word_slot(lo, WORDS.mul);
    if WORDS.keys[s] == (lo, hi) {
        WORDS.values[s]
    } else {
        -1
    }
}

/// Operator bytes (`$swiftIsOp`).
static OPS: [bool; 256] = byteset(b"!%&*+-/<=>?^|~");

/// Byte classes for the main dispatch.
mod class {
    /// An identifier start: a letter, `_`, `$`, or any byte from 0x80.
    pub const IDENT: u8 = 0;
    /// Anything else: one byte colored `none`.
    pub const OTHER: u8 = 1;
    pub const DIGIT: u8 = 2;
    pub const SLASH: u8 = 3;
    pub const HASH: u8 = 4;
    pub const DQUOTE: u8 = 5;
    pub const AT: u8 = 6;
    /// `(`, `)`, `[`, `]`, `{`, or `}`.
    pub const BRACKET: u8 = 7;
    /// `,`, `;`, or `:`.
    pub const DELIMITER: u8 = 8;
    pub const DOT: u8 = 9;
    /// An operator byte other than `/` (`$swiftIsOp`).
    pub const OP: u8 = 10;
    /// NUL: the end of the input, or one byte colored `none` inside it.
    pub const NUL: u8 = 11;
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
                b'/' => class::SLASH,
                b'#' => class::HASH,
                b'"' => class::DQUOTE,
                b'@' => class::AT,
                b'(' | b')' | b'[' | b']' | b'{' | b'}' => class::BRACKET,
                b',' | b';' | b':' => class::DELIMITER,
                b'.' => class::DOT,
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

/// The end of the whitespace run from `p` (`$scanWhitespace`). The NUL
/// after the input ends every run.
#[inline(always)]
fn whitespace_end(src: Input, mut p: usize) -> usize {
    loop {
        // Skip spaces 8 bytes at a time, then step over one other
        // whitespace byte (TAB to CR) and go on.
        // SAFETY: `p` lies at or before the NUL after the input, which
        // ends every run, so 8 bytes from it lie inside the slack.
        let w = unsafe { src.word_unchecked(p) };
        let x = w ^ 0x2020_2020_2020_2020;
        let other =
            (((x & 0x7f7f_7f7f_7f7f_7f7f) + 0x7f7f_7f7f_7f7f_7f7f) | x) & 0x8080_8080_8080_8080;
        if other == 0 {
            p += 8;
            continue;
        }
        p += (other.trailing_zeros() / 8) as usize;
        // SAFETY: as above.
        if !is_space(unsafe { src.byte_unchecked(p) }) {
            return p;
        }
        p += 1;
    }
}

/// The end of the identifier run from `p`: `[A-Za-z0-9_$]` and bytes from
/// 0x80 (`$lexScanIdent`, `$scanIdentRun`). The NUL after the input ends
/// every run.
#[inline(always)]
fn ident_end(src: Input, mut p: usize) -> usize {
    // Most names are short: test a few bytes one by one first.
    for _ in 0..8 {
        // SAFETY: `p` starts at or before the NUL after the input, and the
        // NUL ends the run, so `p` never passes it.
        if !IDENT_CONT[unsafe { src.byte_unchecked(p) } as usize] {
            return p;
        }
        p += 1;
    }
    loop {
        // SAFETY: as above, `p` lies at or before the NUL, so 16 bytes
        // from it lie inside the slack.
        let v = unsafe { src.vec_unchecked(p) };
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

/// Skip spaces and tabs from `p` on the current line (`$lexSkipSpaceAt`).
#[inline(always)]
fn skip_space_at(src: Input, mut p: usize) -> usize {
    // SAFETY: `p` starts at or before the NUL after the input, which ends
    // the run, so `p` never passes it.
    while unsafe { src.byte_unchecked(p) } == b' ' || unsafe { src.byte_unchecked(p) } == b'\t' {
        p += 1;
    }
    p
}

/// SCREAMING_CASE: at least two bytes, one uppercase letter, and only
/// `[A-Z0-9_]` (`$lexIsConstCase`).
#[inline(always)]
fn is_const_case(src: Input, lhs: usize, rhs: usize) -> bool {
    if rhs - lhs < 2 {
        return false;
    }
    let mut upper = false;
    for p in lhs..rhs {
        // SAFETY: the name `[lhs, rhs)` lies inside the input.
        let c = unsafe { src.byte_unchecked(p) };
        if is_upper(c) {
            upper = true;
        } else if !(is_digit(c) || c == b'_') {
            return false;
        }
    }
    upper
}

/// The end of the number body from `p`: radix digits, separators,
/// exponents, and suffixes, with `.` only before a digit
/// (`$lexScanNumberBody`).
#[inline(always)]
fn number_body_end(src: Input, mut p: usize, hex: bool) -> usize {
    let mut prev = 0u8;
    loop {
        // SAFETY: `p` starts inside the input and the NUL after it ends the
        // number, so `p` never passes the NUL.
        let c = unsafe { src.byte_unchecked(p) };
        if IDENT_CONT[c as usize] {
            prev = c;
            p += 1;
            continue;
        }
        if c == b'.' {
            // SAFETY: `p` is below `end`.
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

/// The end of the number at `lhs`, with hexadecimal floats requiring an
/// exponent (`$lexScanHexNumber` with `$requireExponent` 1,
/// `$lexScanNumber`).
#[inline(always)]
fn number_end(src: Input, lhs: usize) -> usize {
    // SAFETY: `lhs` lies inside the input, and the number ends at or
    // before the NUL after it.
    let hex =
        unsafe { src.byte_unchecked(lhs) == b'0' && src.byte_unchecked(lhs + 1) | 32 == b'x' };
    let ptr = number_body_end(src, lhs, hex);
    // SAFETY: as above.
    if hex && unsafe { src.byte_unchecked(ptr) } == b'.' {
        core::hint::cold_path();
        return hex_fraction_end(src, ptr);
    }
    ptr
}

/// The end of a hexadecimal number whose run stopped at the `.` at `ptr`:
/// the fraction counts only with a binary exponent (`$lexScanHexNumber`).
#[cold]
#[inline(never)]
fn hex_fraction_end(src: Input, ptr: usize) -> usize {
    let next = src.byte(ptr + 1);
    if !(is_hex(next) || next | 32 == b'p') {
        return ptr;
    }
    let mut p = ptr + 1;
    while is_hex(src.byte(p)) || src.byte(p) == b'_' {
        p += 1;
    }
    if src.byte(p) | 32 != b'p' {
        return ptr;
    }
    p += 1;
    if src.byte(p) == b'+' || src.byte(p) == b'-' {
        p += 1;
    }
    if !is_digit(src.byte(p)) {
        return ptr;
    }
    number_body_end(src, ptr + 1, true)
}

/// The end of the escape at backslash `p`: one character, kept whole when
/// it is UTF-8, and CRLF as one (`$lexEscapeEnd`).
#[inline(always)]
fn escape_end(src: Input, p: usize, end: usize) -> usize {
    let mut e = scan::utf8_span_end(src.bytes(), p + 2, end);
    // SAFETY: the backslash at `p` lies inside the input, and `e` is below
    // `end` when read.
    if e == p + 2
        && unsafe { src.byte_unchecked(p + 1) } == b'\r'
        && e < end
        && unsafe { src.byte_unchecked(e) } == b'\n'
    {
        e += 1;
    }
    e
}

/// The end of the nested block comment whose `/*` is at `lhs`: through the
/// `*/` that balances it, or the end. Pairs are found left to right, each
/// consuming both its bytes (`$lexNestedBlockComment`, `$lexNestedScan`).
#[inline(never)]
fn nested_comment_end(src: Input, lhs: usize, end: usize) -> usize {
    let mut p = lhs + 2;
    let mut depth = 1u32;
    loop {
        // the earliest `/*` or `*/` at or after `p`
        loop {
            p = scan::find3(src.bytes(), p, end, b'/', b'*', b'*');
            // SAFETY: `p + 1` is below `end` when read.
            if p + 1 >= end
                || matches!(
                    unsafe { (src.byte_unchecked(p), src.byte_unchecked(p + 1)) },
                    (b'/', b'*') | (b'*', b'/')
                )
            {
                break;
            }
            p += 1;
        }
        if p + 1 >= end {
            return end;
        }
        // SAFETY: `p` is below `end`.
        if unsafe { src.byte_unchecked(p) } == b'/' {
            depth += 1;
            p += 2;
            continue;
        }
        depth -= 1;
        p += 2;
        if depth == 0 {
            return p;
        }
    }
}

/// The run of `#` bytes from `p`: its end.
#[inline(always)]
fn hashes_end(src: Input, mut p: usize) -> usize {
    // SAFETY: the NUL at the input end stops the run.
    while unsafe { src.byte_unchecked(p) } == b'#' {
        p += 1;
    }
    p
}

/// Whether `#…#"` starts at `p`: hashes, then a quote (`$swiftRawStart`).
#[inline(always)]
fn raw_start(src: Input, p: usize) -> bool {
    src.byte(hashes_end(src, p)) == b'"'
}

/// `n` `#` bytes at `q`, or fewer when the run is shorter: the end of the
/// ones present, and whether all `n` are.
#[inline(always)]
fn hashes_match(src: Input, q: usize, n: usize) -> (usize, bool) {
    let mut seen = 0;
    let mut q = q;
    // SAFETY: `q` starts at or before the NUL after the input, which stops
    // the run.
    while seen < n && unsafe { src.byte_unchecked(q) } == b'#' {
        seen += 1;
        q += 1;
    }
    (q, seen == n)
}

/// The hash-delimited or triple-quoted string at `lhs`: its opener (the
/// hashes and the quote or quotes), then its body through the closing
/// quote or quotes and as many hashes, or to the end, as one string token.
/// An escape uses the same hash count as the delimiter, so its quote
/// cannot close the body. Returns the end (`$swiftHashOpen`,
/// `$swiftHashBody`, `$lexFindEither`).
#[inline(never)]
fn hash_string(src: Input, out: &mut Recs, lhs: usize, end: usize) -> usize {
    let mut p = hashes_end(src, lhs);
    let hashes = p - lhs;
    // (the byte at `p` is a quote)
    // SAFETY: the quote at `p` lies inside the input, so the two bytes
    // after it lie inside the slack.
    let triple = unsafe { src.byte_unchecked(p + 1) == b'"' && src.byte_unchecked(p + 2) == b'"' };
    p += if triple { 3 } else { 1 };
    loop {
        p = scan::find3(src.bytes(), p, end, b'"', b'\\', b'"');
        if p >= end {
            break;
        }
        // SAFETY: `p` is below `end`.
        if unsafe { src.byte_unchecked(p) } == b'\\' {
            p += 1;
            let (q, all) = hashes_match(src, p, hashes);
            if all {
                p = scan::utf8_span_end(src.bytes(), q + 1, end);
            }
            continue;
        }
        // SAFETY: `p` is below `end`, so the two bytes after it lie inside
        // the slack.
        if !triple
            || unsafe { src.byte_unchecked(p + 1) == b'"' && src.byte_unchecked(p + 2) == b'"' }
        {
            let (q, all) = hashes_match(src, p + if triple { 3 } else { 1 }, hashes);
            if all {
                p = q;
                break;
            }
        }
        p += 1;
    }
    out.tok(tok::STRING, p);
    p
}

/// A `"` string body from `p`, with its bytes from `seg` (the opening
/// quote, or the `)` of an interpolation) not yet emitted: escapes get
/// their own tokens, and outside an interpolation (`nested` false) `\(`
/// opens one. Returns the end and whether an interpolation opened; else the
/// body ends past its closing quote, at a raw line break, or at the end
/// (`$hlSwift`'s `$stringMode` step, `$stringEscapeAt`).
#[inline(never)]
fn string_body(
    src: Input,
    out: &mut Recs,
    mut p: usize,
    end: usize,
    mut seg: usize,
    nested: bool,
) -> (usize, bool) {
    loop {
        p = scan::string_special(src.bytes(), p, end, b'"');
        if p >= end {
            break;
        }
        // SAFETY: `p` is below `end`.
        let c = unsafe { src.byte_unchecked(p) };
        if c == b'"' {
            p += 1;
            break;
        }
        if c == b'\n' || c == b'\r' {
            break;
        }
        // SAFETY: `p` is below `end`.
        if !nested && unsafe { src.byte_unchecked(p + 1) } == b'(' {
            out.emit(tok::STRING, seg, p);
            p += 2;
            out.tok(tok::PUNCTUATION_SPECIAL, p);
            return (p, true);
        }
        out.emit(tok::STRING, seg, p);
        p = escape_end(src, p, end);
        out.tok(tok::STRING_ESCAPE, p);
        seg = p;
    }
    out.emit(tok::STRING, seg, p);
    (p, false)
}

/// Whether a word starts after the blanks at `p` on the same line
/// (`$swiftWordFollows`).
#[inline(always)]
fn word_follows(src: Input, p: usize) -> bool {
    // SAFETY: `p` is at most `end`, and the spaces after it stop at or
    // before the NUL.
    is_ident_start(unsafe { src.byte_unchecked(skip_space_at(src, p)) })
}

/// Whether the name `[lhs, rhs)`, with `p` its next non-blank byte, is
/// called by something other than a plain `(`: a failable `init?(` or
/// `init!(` head, or a trailing closure. A condition's `{` (`cond`) opens
/// its body instead, a capitalized name before `{` is a type, and
/// `get`/`set`/`didSet`/`willSet` open accessor blocks (`$swiftCallAhead`).
#[inline(never)]
fn call_ahead(src: Input, lhs: usize, rhs: usize, p: usize, member: bool, cond: bool) -> bool {
    let c = src.byte(p);
    let name = &src.bytes()[lhs..rhs];
    if c == b'?' || c == b'!' {
        return !member && src.byte(p + 1) == b'(' && name == b"init";
    }
    if c != b'{' || cond {
        return false;
    }
    if member {
        return true;
    }
    if is_upper(name[0]) {
        return false;
    }
    !(name == b"get" || name == b"set" || name == b"didSet" || name == b"willSet")
}

/// The parameter-list machine's registers (`$sig*` globals in `sig.wat`;
/// Swift never reads `$sigAngle`).
#[derive(Default)]
struct Sig {
    parens: u32,
    mask: u32,
    obscure: u32,
    pattern: bool,
    fn_pend: bool,
    fn_angle: u32,
}

impl Sig {
    /// The innermost open paren is a marked parameter list (`$sigActive`).
    #[inline(always)]
    fn active(&self) -> bool {
        self.parens < 32 && (self.mask >> self.parens) & 1 != 0
    }

    /// Mark the innermost paren as a parameter list (`$sigMark`).
    #[inline(always)]
    fn mark(&mut self) {
        if self.parens < 32 {
            self.mask |= 1 << self.parens;
        }
        self.obscure = 0;
        self.pattern = false;
    }

    /// Unmark the innermost paren (`$sigUnmark`).
    #[inline(always)]
    fn unmark(&mut self) {
        if self.parens < 32 {
            self.mask &= !(1 << self.parens);
        }
        self.obscure = 0;
        self.pattern = false;
    }

    /// Arm a pending definition head (`$sigFnPend` with no angles).
    #[inline(always)]
    fn arm(&mut self) {
        self.fn_pend = true;
        self.fn_angle = 0;
    }

    /// Adjust the pending head's angle depth by the `<` and `>` bytes of
    /// the operator `[p, e)`, and cancel the head when another operator
    /// byte appears outside angles (`$sigAngleOps`, `$sigFnAngleDrop`).
    fn angle_ops(&mut self, src: Input, p: usize, e: usize) {
        for i in p..e {
            // SAFETY: the operator `[p, e)` lies inside the input.
            match unsafe { src.byte_unchecked(i) } {
                b'<' => self.fn_angle = self.fn_angle.wrapping_add(1),
                b'>' => self.fn_angle = self.fn_angle.saturating_sub(1),
                _ => {
                    if self.fn_angle == 0 {
                        self.fn_pend = false;
                    }
                }
            }
        }
    }
}

/// Lex the Swift input of `len` bytes at `base` (`$hlSwift`).
fn highlight(inst: &mut Instance, base: usize, len: usize) {
    // SAFETY: `base..base + len + SLACK` lies inside lexer memory, which
    // stays in place while this lexer runs: it calls no translated code.
    let src = unsafe { Input::new(inst, base, len) };
    let end = len;
    let mut out = Recs::load(inst);

    // `$lexEmitLeadingContinuation`
    let mut ptr = scan::utf8_span_end(src.bytes(), 0, end);
    if ptr > 0 {
        out.tok(tok::NONE, ptr);
    }
    // Leading whitespace; every later gap follows a token's record.
    let first = whitespace_end(src, ptr);
    if first > ptr {
        if ptr == 0 {
            out.tok(tok::NONE, first);
        } else {
            out.extend(first);
        }
    }
    ptr = first;

    let mut sig = Sig::default();
    // the pending declaration head: 1 = `func`, 2 = a type keyword
    let mut expect = 0u32;
    // right after `.`
    let mut member = false;
    // parens open inside a `\(…)` interpolation, 0 outside one
    let mut interp = 0u32;
    // bit `n`: a condition (`if`, `guard`, …) is open at paren/bracket
    // depth `n`
    let mut cond = 0u32;
    // paren and bracket depth
    let mut cond_paren = 0u32;

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
    // The `"` body from `ptr`, its bytes from `seg` not yet emitted (the
    // `$stringMode` step at the top of `$hlSwift`'s loop).
    macro_rules! string_body {
        ($seg:expr) => {{
            let (p, opened) = with_copy!(string_body(ptr, end, $seg, interp != 0));
            ptr = p;
            if opened {
                interp = 1;
            }
        }};
    }
    // The bit of the condition at the current depth.
    macro_rules! cond_bit {
        () => {
            if cond_paren < 32 {
                1u32 << cond_paren
            } else {
                0
            }
        };
    }

    // The bracket `c` at `ptr`.
    macro_rules! bracket {
        ($c:expr) => {{
            let c: u8 = $c;
            ptr += 1;
            if c == b')' && interp == 1 {
                // the paren matching `\(` returns to the string body
                out.tok(tok::PUNCTUATION_SPECIAL, ptr);
                interp = 0;
                member = false;
                string_body!(ptr);
                continue;
            }
            if interp != 0 {
                if c == b'(' {
                    interp += 1;
                }
                if c == b')' {
                    interp -= 1;
                }
            }
            if matches!(c, b'{' | b'}' | b')' | b']') {
                cond &= !cond_bit!();
            }
            if c == b'(' || c == b'[' {
                cond_paren = cond_paren.wrapping_add(1);
            }
            if cond_paren != 0 && (c == b')' || c == b']') {
                cond_paren -= 1;
            }
            // parameter machine: a paren may open the armed func list
            // and puts the next name in parameter position; other
            // brackets inside a marked list obscure its top level
            if c == b'(' {
                sig.parens = sig.parens.wrapping_add(1);
                if sig.fn_angle == 0 {
                    if sig.fn_pend {
                        sig.mark();
                    }
                    sig.fn_pend = false;
                }
                sig.pattern = true;
            } else {
                sig.pattern = false;
                if c == b')' {
                    if sig.active() {
                        sig.unmark();
                    }
                    if sig.parens > 0 {
                        sig.parens -= 1;
                    }
                } else {
                    if sig.fn_pend && sig.fn_angle == 0 {
                        sig.fn_pend = false;
                    }
                    if sig.active() {
                        if c == b'[' || c == b'{' {
                            sig.obscure = sig.obscure.wrapping_add(1);
                        } else if sig.obscure > 0 {
                            sig.obscure -= 1;
                        }
                    }
                }
            }
            out.tok(tok::PUNCTUATION_BRACKET, ptr);
            member = false;
        }};
    }
    // The `,`, `;`, or `:` token `c` at `ptr`.
    macro_rules! delimiter {
        ($c:expr) => {{
            let c: u8 = $c;
            ptr += 1;
            out.tok(tok::PUNCTUATION_DELIMITER, ptr);
            member = false;
            // a comma returns to parameter position; `:`/`;` leave it,
            // and a top-level `;` proves the marked list was not a
            // parameter list
            sig.pattern = c == b',';
            if c == b';' {
                cond &= !cond_bit!();
                if sig.active() && sig.obscure == 0 {
                    sig.unmark();
                }
            }
        }};
    }
    // The `.`, `..`, or `...` token at `ptr`, when no digit follows.
    macro_rules! dot {
        ($c2:expr) => {{
            let c2: u8 = $c2;
            ptr += 1;
            if c2 == b'.' {
                ptr += 1;
                // SAFETY: `..` lies inside the input.
                if unsafe { src.byte_unchecked(ptr) } == b'.' {
                    ptr += 1;
                }
                out.tok(tok::OPERATOR, ptr);
                member = false;
            } else {
                out.tok(tok::PUNCTUATION_DELIMITER, ptr);
                member = true;
            }
            sig.pattern = false;
        }};
    }

    // Every token stops at or before the NUL after the input, so `ptr`
    // stays at most `end` and reads a few bytes past it stay inside the
    // slack.
    loop {
        // SAFETY: `ptr` is at most `end` (see above).
        let mut c = unsafe { src.byte_unchecked(ptr) };
        // SAFETY: as above.
        if c == b' ' && !is_space(unsafe { src.byte_unchecked(ptr + 1) }) {
            ptr += 1;
            out.extend(ptr);
            // SAFETY: `ptr` is at most `end`.
            c = unsafe { src.byte_unchecked(ptr) };
        } else if is_space(c) {
            ptr = whitespace_end(src, ptr + 1);
            out.extend(ptr);
            // SAFETY: `ptr` is at most `end`.
            c = unsafe { src.byte_unchecked(ptr) };
        }
        let lhs = ptr;
        let class = CLASS[c as usize];

        // Names, the most common tokens, skip the jump table.
        if class == class::IDENT {
            // a pending func head outside its generic angles expects only
            // the opening paren; another identifier here is stale context
            if sig.fn_pend && sig.fn_angle == 0 {
                sig.fn_pend = false;
            }
            let rhs = ident_end(src, ptr + 1);
            ptr = rhs;
            let mut kind = word_value(src, lhs, rhs);
            // a soft modifier is a keyword only before a word
            if kind > 2047 && !word_follows(src, rhs) {
                kind = -1;
            }
            let hl;
            if kind >= 0 {
                hl = (kind & 255) as u32;
                if kind & 0x300 != 0 {
                    expect = (kind as u32 >> 8) & 3;
                } else if kind == tok::KEYWORD_DECLARATION as i32 {
                    // `let`/`var` end a pending type capture; `subscript(`
                    // opens a parameter list, like a func head
                    expect = 0;
                    if rhs - lhs == 9 && src.bytes()[lhs..lhs + 8] == *b"subscrip" {
                        sig.arm();
                    }
                }
                if kind & 1024 != 0 {
                    cond |= cond_bit!();
                }
            } else if expect != 0 {
                hl = if expect == 1 {
                    tok::FUNCTION_DEFINITION
                } else {
                    tok::TYPE
                };
                // a func name arms the parameter machine for the paren
                // after its optional generic angles
                if expect == 1 {
                    sig.arm();
                }
                expect = 0;
            } else {
                let p = skip_space_at(src, rhs);
                // SAFETY: the spaces after the name stop at or before the
                // NUL.
                let next = unsafe { src.byte_unchecked(p) };
                let call = next == b'('
                    || (matches!(next, b'{' | b'?' | b'!')
                        && call_ahead(src, lhs, rhs, p, member, cond & cond_bit!() != 0));
                if call {
                    hl = if member {
                        tok::FUNCTION_METHOD
                    } else {
                        tok::FUNCTION
                    };
                    // a bare `init(` or `init?(` head opens a parameter list
                    // too
                    if !member && src.bytes()[lhs..rhs] == *b"init" {
                        sig.arm();
                    }
                } else if member {
                    hl = tok::PROPERTY;
                } else if sig.active()
                    && sig.pattern
                    && sig.obscure == 0
                    && !(rhs - lhs == 1 && c == b'_')
                {
                    // names at the top level of a marked list are
                    // parameters, except the `_` wildcard label
                    hl = tok::VARIABLE_PARAMETER;
                } else if (is_upper(c) || c == b'_') && is_const_case(src, lhs, rhs) {
                    // (only `[A-Z_]` can start a constant name)
                    hl = tok::CONSTANT;
                } else if is_upper(c) {
                    hl = tok::TYPE;
                } else {
                    hl = tok::VARIABLE;
                }
            }
            out.tok(hl, rhs);
            member = false;
            // `(`, `)`, `,`, `:`, or `.` right after a name: its rule runs
            // here, without
            // the gap and dispatch steps
            // SAFETY: the name stopped at or before the NUL.
            match unsafe { src.byte_unchecked(ptr) } {
                b'(' => bracket!(b'('),
                b')' => bracket!(b')'),
                b',' => delimiter!(b','),
                b':' => delimiter!(b':'),
                b'.' => {
                    // SAFETY: `ptr` is below `end`.
                    let c2 = unsafe { src.byte_unchecked(ptr + 1) };
                    if !is_digit(c2) {
                        dot!(c2);
                    }
                }
                _ => {}
            }
            continue;
        }

        // SAFETY: `ptr` is at most `end`.
        let c2 = unsafe { src.byte_unchecked(ptr + 1) };
        match class {
            class::BRACKET => bracket!(c),
            class::DELIMITER => delimiter!(c),
            class::DOT if !is_digit(c2) => dot!(c2),
            class::DOT | class::DIGIT => {
                ptr = number_end(src, ptr);
                out.tok(tok::NUMBER, ptr);
                member = false;
            }
            class::DQUOTE => {
                // SAFETY: `ptr` is below `end`.
                if c2 == b'"' && unsafe { src.byte_unchecked(ptr + 2) } == b'"' {
                    ptr = with_copy!(hash_string(lhs, end));
                } else {
                    // a one-line body without escapes is one token
                    let close = scan::string_special(src.bytes(), ptr + 1, end, b'"');
                    // SAFETY: the scan stops at most at `end`.
                    if unsafe { src.byte_unchecked(close) } == b'"' {
                        ptr = close + 1;
                        out.tok(tok::STRING, ptr);
                    } else {
                        ptr += 1;
                        string_body!(lhs);
                    }
                }
                member = false;
            }
            class::SLASH if c2 == b'/' => {
                // SAFETY: `ptr` is below `end`.
                let doc = unsafe { src.byte_unchecked(ptr + 2) } == b'/';
                ptr = scan::line_end(src.bytes(), ptr + 2, end);
                out.tok(if doc { tok::COMMENT_DOC } else { tok::COMMENT }, ptr);
            }
            class::SLASH if c2 == b'*' => {
                // SAFETY: `ptr` is below `end`.
                let doc = unsafe { src.byte_unchecked(ptr + 2) } == b'*';
                ptr = nested_comment_end(src, ptr, end);
                out.tok(if doc { tok::COMMENT_DOC } else { tok::COMMENT }, ptr);
            }
            class::HASH if raw_start(src, ptr) => {
                ptr = with_copy!(hash_string(lhs, end));
                member = false;
            }
            class::HASH if is_ident_start(c2) => {
                ptr = ident_end(src, ptr + 1);
                out.tok(tok::PREPROC, ptr);
            }
            class::AT => {
                ptr = ident_end(src, ptr + 1);
                out.tok(tok::ATTRIBUTE, ptr);
            }
            class::OP | class::SLASH => {
                // a run of operator bytes, ended by a comment opener
                loop {
                    // SAFETY: the NUL after the input is no operator byte,
                    // so `ptr` stays at most `end`.
                    let b = unsafe { src.byte_unchecked(ptr) };
                    if !OPS[b as usize] {
                        break;
                    }
                    // SAFETY: as above, `ptr` is below `end`.
                    if b == b'/' && matches!(unsafe { src.byte_unchecked(ptr + 1) }, b'/' | b'*') {
                        break;
                    }
                    ptr += 1;
                }
                out.tok(tok::OPERATOR, ptr);
                member = false;
                if expect == 1 {
                    // an operator function's name: `static func == (lhs:`
                    expect = 0;
                    sig.arm();
                } else if sig.fn_pend
                    // SAFETY: the operator ends at or before the NUL.
                    && !(ptr - lhs == 1
                        && (c == b'?' || c == b'!')
                        && unsafe { src.byte_unchecked(ptr) } == b'(')
                {
                    // a pending func head rides `<`/`>` generic operators,
                    // and `init?(` keeps its head across the `?`
                    sig.angle_ops(src, lhs, ptr);
                }
                sig.pattern = false;
            }
            class::NUL if ptr >= end => break,
            _ => {
                ptr += 1;
                out.tok(tok::NONE, ptr);
                member = false;
            }
        }
    }
    out.store(inst);
}
