//! WAT sources: src/langs/css.wat src/common.wat src/scan.wat
//!
//! Native CSS lexer, shared by CSS, Less, SCSS, and the indented Sass syntax
//! (a dialect parameter picks the extra forms each one has). At every
//! statement start it decides whether a selector or a declaration follows,
//! then colors each token by the current mode: selector, at-rule prelude,
//! property, or value. The records equal the translated `css`, `less`,
//! `scss`, and `sass` lexers' records.
//!
//! The WAT tests its rules in one long chain. Most rules match one first
//! byte, so this lexer dispatches on the first byte and, for each byte,
//! tests only the rules that can match it, in the WAT's order.

#[cfg(target_arch = "aarch64")]
use core::arch::aarch64::*;

use super::Lexer;
use super::scan;
use crate::Rec;
use crate::generated::Instance;
use crate::token_ids as tok;

/// The lexer for each language this module handles.
pub(crate) fn lexer(name: &str) -> Option<Lexer> {
    match name {
        "css" => Some(css),
        "less" => Some(less),
        "scss" => Some(scss),
        "sass" => Some(sass),
        _ => None,
    }
}

/// The dialects, as the WAT's `$cssDialect` numbers them.
const CSS: u32 = 0;
const LESS: u32 = 1;
const SCSS: u32 = 2;
const SASS: u32 = 3;

/// The modes of `$hlCssImpl`.
const SELECTOR: u32 = 0;
const PRELUDE: u32 = 1;
const PROPERTY: u32 = 2;
const VALUE: u32 = 3;

/// Plain CSS (`$hlCss`).
fn css(inst: &mut Instance, base: usize, len: usize) {
    highlight::<CSS>(inst, base, len);
}

/// Less (`$hlLess`).
fn less(inst: &mut Instance, base: usize, len: usize) {
    highlight::<LESS>(inst, base, len);
}

/// SCSS (`$hlScss`).
fn scss(inst: &mut Instance, base: usize, len: usize) {
    highlight::<SCSS>(inst, base, len);
}

/// The indented Sass syntax (`$hlSass`).
fn sass(inst: &mut Instance, base: usize, len: usize) {
    highlight::<SASS>(inst, base, len);
}

/// Identifier-start bytes: letters, `_`, and any byte from 128
/// (`$cssIdentStart`).
static IDENT_START: [bool; 256] = {
    let mut t = [false; 256];
    let mut c = 0;
    while c < 256 {
        let b = c as u8;
        t[c] = (b | 32).wrapping_sub(b'a') <= 25 || b == b'_' || b >= 128;
        c += 1;
    }
    t
};

/// ASCII whitespace: space and TAB through CR (`$lexIsSpace`).
static SPACE: [bool; 256] = {
    let mut t = [false; 256];
    let mut c = 0;
    while c < 256 {
        let b = c as u8;
        t[c] = b == 32 || b.wrapping_sub(9) <= 4;
        c += 1;
    }
    t
};

/// Whether `c` starts an identifier (`$cssIdentStart`).
#[inline(always)]
fn ident_start(c: u8) -> bool {
    IDENT_START[c as usize]
}

/// Whether `c` is ASCII whitespace (`$lexIsSpace`).
#[inline(always)]
fn is_space(c: u8) -> bool {
    SPACE[c as usize]
}

/// Whether `c` is an ASCII digit (`$lexIsDigit`).
#[inline(always)]
fn is_digit(c: u8) -> bool {
    c.wrapping_sub(b'0') <= 9
}

/// The byte at `p`.
#[inline(always)]
fn at(src: &[u8], p: usize) -> u8 {
    debug_assert!(p < src.len());
    // SAFETY: every position read lies at most 16 bytes past the input
    // end, inside the input slack `src` covers.
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

/// Index of the first set lane in a NEON compare result, or 16.
#[cfg(target_arch = "aarch64")]
#[inline(always)]
fn first_lane(hit: uint8x16_t) -> usize {
    // SAFETY: plain register arithmetic.
    unsafe {
        let nib = vget_lane_u64::<0>(vreinterpret_u64_u8(vshrn_n_u16::<4>(vreinterpretq_u16_u8(
            hit,
        ))));
        if nib == 0 {
            16
        } else {
            (nib.trailing_zeros() / 4) as usize
        }
    }
}

/// Identifier bytes (letters, digits, `_`, `-`, any byte from 128) as two
/// nibble tables: byte `b` is one when `IDENT_HI[b >> 4] & IDENT_LO[b & 15]`
/// is nonzero. Each bit stands for a group of high nibbles that admit the
/// same low nibbles.
const IDENT_HI: [u8; 16] = {
    let mut t = [0u8; 16];
    let mut h = 0;
    while h < 16 {
        t[h] = match h {
            2 => 1,
            3 => 2,
            4 | 6 => 4,
            5 => 8,
            7 => 16,
            8..=15 => 32,
            _ => 0,
        };
        h += 1;
    }
    t
};
const IDENT_LO: [u8; 16] = {
    let mut t = [0u8; 16];
    let mut l = 0;
    while l < 16 {
        let mut m = 32;
        if l == 13 {
            m |= 1; // `-`
        }
        if l <= 9 {
            m |= 2; // digits
        }
        if l >= 1 {
            m |= 4; // `A`-`O`, `a`-`o`
        }
        if l <= 10 || l == 15 {
            m |= 8; // `P`-`Z`, `_`
        }
        if l <= 10 {
            m |= 16; // `p`-`z`
        }
        t[l] = m;
        l += 1;
    }
    t
};

/// The end of the run of identifier bytes (letters, digits, `_`, `-`, any
/// byte from 128) from `p` (`$scanIdentRun` with `-`). The NUL after the
/// input ends every run by the input end.
#[inline(always)]
fn ident_run(src: &[u8], mut p: usize) -> usize {
    #[cfg(target_arch = "aarch64")]
    // SAFETY: the run stops at the NUL after the input, so each 16-byte
    // load starts at or before it, inside the slack.
    unsafe {
        let hi_t = vld1q_u8(IDENT_HI.as_ptr());
        let lo_t = vld1q_u8(IDENT_LO.as_ptr());
        loop {
            let v = vld1q_u8(src.as_ptr().add(p));
            let hi = vqtbl1q_u8(hi_t, vshrq_n_u8::<4>(v));
            let lo = vqtbl1q_u8(lo_t, vandq_u8(v, vdupq_n_u8(15)));
            let k = first_lane(vceqzq_u8(vandq_u8(hi, lo)));
            if k < 16 {
                return p + k;
            }
            p += 16;
        }
    }
    #[cfg(not(target_arch = "aarch64"))]
    {
        loop {
            let c = at(src, p);
            if !(c.is_ascii_alphanumeric() || c == b'_' || c == b'-' || c >= 128) {
                return p;
            }
            p += 1;
        }
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

/// The end of a name from `p`: identifier bytes, `-`, and backslash
/// escapes (`$cssScanIdent`).
#[inline(always)]
fn css_scan_ident(src: &[u8], end: usize, p: usize) -> usize {
    let p = ident_run(src, p);
    if at(src, p) != b'\\' {
        return p;
    }
    core::hint::cold_path();
    ident_escapes(src, end, p)
}

/// The rest of a name from the backslash at `p`: up to six hex digits
/// and one optional blank, or any one character, then more name bytes. A
/// backslash before a line break or the end ends the name
/// (`$cssScanIdent`, `$scanHexRun`, `$utf8SpanEnd`).
#[cold]
#[inline(never)]
fn ident_escapes(src: &[u8], end: usize, mut p: usize) -> usize {
    loop {
        if p + 1 >= end || at(src, p) != b'\\' || at(src, p + 1).wrapping_sub(10) <= 3 {
            return p;
        }
        let mut e = hex_run(src, end, p + 1, 6);
        if e == p + 1 {
            e = scan::utf8_span_end(src, p + 2, end);
        } else if e < end && (at(src, e) == 32 || at(src, e) == 9) {
            e += 1;
        }
        p = ident_run(src, e);
    }
}

/// The end of at most `max` hex digits from `p`, bounded by `end`
/// (`$scanHexRun`).
#[inline(always)]
fn hex_run(src: &[u8], end: usize, mut p: usize, max: usize) -> usize {
    let stop = (p + max).min(end);
    while p < stop && at(src, p).is_ascii_hexdigit() {
        p += 1;
    }
    p
}

/// The end of a number's tail and unit from `p`, after its first byte:
/// digits, dots, exponents with their sign, then `%` or one name
/// (`$cssScanNumber`). The NUL after the input stops every part.
#[inline(always)]
fn css_scan_number(src: &[u8], end: usize, mut p: usize) -> usize {
    let mut prev: u8 = 0;
    loop {
        let c = at(src, p);
        let consume = is_digit(c)
            || c == b'.'
            || c | 32 == b'e'
            || ((c == b'+' || c == b'-') && prev | 32 == b'e');
        if !consume {
            break;
        }
        prev = c;
        p += 1;
    }
    let c = at(src, p);
    if c == b'%' {
        p + 1
    } else if ident_start(c) {
        css_scan_ident(src, end, p)
    } else {
        p
    }
}

/// A quoted string from `lhs` with quote `q`, its escapes as separate
/// tokens; returns its end. A raw CR or LF ends it unconsumed
/// (`$cssString`, `$lexEscapeEnd`).
#[inline(always)]
fn css_string(src: &[u8], end: usize, mut out: Out, q: u8, lhs: usize) -> (usize, Out) {
    let mut seg = lhs;
    let mut p = lhs + 1;
    loop {
        p = scan::string_special(src, p, end, q);
        if p >= end {
            break;
        }
        let c = at(src, p);
        if c == q {
            p += 1;
            break;
        }
        if c == 10 || c == 13 {
            break;
        }
        if seg < p {
            out.tok(tok::STRING, p);
        }
        let mut e = hex_run(src, end, p + 1, 6);
        if e == p + 1 {
            // `$lexEscapeEnd`.
            e = scan::utf8_span_end(src, p + 2, end);
            if e == p + 2 && at(src, p + 1) == 13 && e < end && at(src, e) == 10 {
                e += 1;
            }
        } else {
            e = scan::utf8_span_end(src, e, end);
        }
        out.tok(tok::STRING_ESCAPE, e);
        p = e;
        seg = p;
    }
    if seg < p {
        out.tok(tok::STRING, p);
    }
    (p, out)
}

/// Whether `[lhs, rhs)` is a media or supports query operator (`and`,
/// `or`, `not`, `only`), or in scss and sass a control word (`if`, `in`,
/// `to`, `from`, `through`) (`$cssIsQueryOp`).
#[inline(always)]
fn css_is_query_op<const D: u32>(src: &[u8], lhs: usize, rhs: usize) -> bool {
    let w = &src[lhs..rhs];
    let pre = D >= SCSS;
    match rhs - lhs {
        2 => w == b"or" || (pre && (w == b"if" || w == b"in" || w == b"to")),
        3 => w == b"and" || w == b"not",
        4 => w == b"only" || (pre && w == b"from"),
        7 => pre && w == b"through",
        _ => false,
    }
}

/// The end of an unquoted url body from `p`: up to whitespace, a quote,
/// or `)` (`$cssScanUrlBody`).
#[cold]
#[inline(never)]
fn css_scan_url_body(src: &[u8], end: usize, mut p: usize) -> usize {
    while p < end {
        let c = at(src, p);
        if c.wrapping_sub(9) <= 4 || c == 32 || c == 34 || c == 39 || c == 41 {
            break;
        }
        p += 1;
    }
    p
}

/// The bytes [`decide_special`] stops at, as two nibble tables (see
/// [`IDENT_HI`]): LF and CR (high nibble 0), `"`, `'`, and `/` (2), `:`
/// and `;` (3), `{` and `}` (7).
const DECIDE_HI: [u8; 16] = [1, 0, 8, 4, 0, 0, 0, 2, 0, 0, 0, 0, 0, 0, 0, 0];
const DECIDE_LO: [u8; 16] = [0, 0, 8, 0, 0, 0, 0, 8, 0, 0, 1 | 4, 2 | 4, 0, 1 | 2, 0, 8];

/// The first byte in `[p, stop)` that can end or shape a statement: a
/// line break, `{`, `}`, `;`, `/`, a quote, or `:`; or `stop`. The wide
/// scan of `$cssDecide`.
#[inline(always)]
fn decide_special(src: &[u8], mut p: usize, stop: usize) -> usize {
    while p < stop {
        #[cfg(target_arch = "aarch64")]
        // SAFETY: `p` is below `stop`, at most the input end, so the
        // 16-byte load stays inside the slack.
        let k = unsafe {
            let w = vld1q_u8(src.as_ptr().add(p));
            let hi = vqtbl1q_u8(vld1q_u8(DECIDE_HI.as_ptr()), vshrq_n_u8::<4>(w));
            let lo = vqtbl1q_u8(vld1q_u8(DECIDE_LO.as_ptr()), vandq_u8(w, vdupq_n_u8(15)));
            first_lane(vtstq_u8(hi, lo))
        };
        #[cfg(not(target_arch = "aarch64"))]
        let k = (0..16)
            .find(|&i| {
                matches!(
                    at(src, p + i),
                    10 | 13 | b'{' | b'}' | b';' | b'/' | b'"' | b'\'' | b':'
                )
            })
            .unwrap_or(16);
        if k < 16 {
            return (p + k).min(stop);
        }
        p += 16;
    }
    stop
}

/// Classify the statement starting at `start` without emitting: `true` at
/// a `{` for a selector, `false` at `;` or `}` for a declaration.
/// Comments and strings are skipped; at a line break or the end,
/// [`css_decide_at_end`] decides. `depth` counts open blocks. The
/// `name: ` fast path of the WAT runs at the call site (`$cssDecide`).
#[inline(always)]
fn css_decide<const D: u32>(src: &[u8], end: usize, start: usize, depth: u32) -> bool {
    let mut p = start;
    let mut stop = end;
    // The first `:`: 1 before a blank or the end, 2 otherwise.
    let mut colon = 0u32;
    // `#{` and `@{` interpolations still open.
    let mut interp = 0u32;
    'decl: loop {
        p = decide_special(src, p, stop);
        if p >= stop {
            break 'decl;
        }
        let c = at(src, p);
        if c == 10 || c == 13 {
            stop = p;
            break 'decl;
        }
        if c == b'{' {
            if p > start
                && ((at(src, p - 1) == b'#' && D >= SCSS) || (at(src, p - 1) == b'@' && D == LESS))
            {
                interp += 1;
                p += 1;
                continue;
            }
            return true;
        }
        if c == b'}' && interp != 0 {
            interp -= 1;
            p += 1;
            continue;
        }
        if c == b'}' || c == b';' {
            return false;
        }
        if c == b':' {
            if colon == 0 {
                let n = if p + 1 < stop { at(src, p + 1) } else { 32 };
                colon = if is_space(n) { 1 } else { 2 };
            }
            p += 1;
            continue;
        }
        if c == b'/' {
            if p + 1 < end && at(src, p + 1) == b'*' {
                let line_break;
                (p, line_break) = decide_skip_comment(src, stop, p + 2);
                if line_break {
                    stop = p;
                    break 'decl;
                }
            } else if D != CSS && p + 1 < stop && at(src, p + 1) == b'/' {
                p = scan::line_end(src, p, stop);
            } else {
                p += 1;
            }
            continue;
        }
        p = decide_skip_string(src, stop, p + 1, c);
    }
    css_decide_at_end(src, start, depth, colon, stop)
}

/// Skip a block comment body from `p` for [`css_decide`], star to star:
/// the position after its `*/`, or `stop` for an unterminated one, or the
/// position of a line break inside it and `true` (`$cssDecide`).
#[cold]
#[inline(never)]
fn decide_skip_comment(src: &[u8], stop: usize, mut p: usize) -> (usize, bool) {
    loop {
        if p >= stop {
            return (p, false);
        }
        p = scan::find3(src, p, stop, b'*', 10, 13);
        if p >= stop {
            return (p, false);
        }
        let c = at(src, p);
        if c == 10 || c == 13 {
            return (p, true);
        }
        if p + 1 < stop && at(src, p + 1) == b'/' {
            return (p + 2, false);
        }
        p += 1;
    }
}

/// Skip a string body with quote `q` from `p` for [`css_decide`]: a
/// backslash swallows one byte, and a raw CR or LF ends it unconsumed
/// (`$cssDecide`).
#[cold]
#[inline(never)]
fn decide_skip_string(src: &[u8], stop: usize, mut p: usize, q: u8) -> usize {
    loop {
        if p >= stop {
            return p;
        }
        p = scan::string_special(src, p, stop, q);
        if p >= stop {
            return p;
        }
        let c = at(src, p);
        if c == q {
            return p + 1;
        }
        if c == 10 || c == 13 {
            return p;
        }
        p += 2;
    }
}

/// Decide a statement from `start` that reached a line break or the end
/// without a delimiter, from the shape of its line: `true` for a selector
/// (`$cssDecideAtEnd`).
fn css_decide_at_end(src: &[u8], start: usize, depth: u32, colon: u32, stop: usize) -> bool {
    if colon == 0 {
        return true;
    }
    if colon == 1 {
        return false;
    }
    if depth == 0 {
        return true;
    }
    let mut p = start;
    while p < stop {
        let c = at(src, p);
        if !(ident_start(c) || c == b'-' || is_digit(c)) {
            break;
        }
        p += 1;
    }
    while p < stop {
        let c = at(src, p);
        if c == 10 || c == 13 || !is_space(c) {
            break;
        }
        p += 1;
    }
    if at(src, p) != b':' {
        return true;
    }
    let find = |x: u8| {
        let mut q = p;
        while q < stop && at(src, q) != x {
            q += 1;
        }
        q
    };
    find(b',') < find(b'(')
}

/// The state an at-rule keyword sets for its prelude.
struct AtRule {
    out: Out,
    end: usize,
    mode: u32,
    namespace: bool,
    fn_prelude: bool,
}

/// An at-rule keyword `@name` at `lhs`, at a statement start: its token,
/// and the prelude state it sets. In less, `@name: value` declares a
/// variable and `@name()` calls a detached ruleset (`$hlCssImpl`).
#[inline(always)]
fn at_rule<const D: u32>(src: &[u8], end: usize, mut out: Out, lhs: usize) -> AtRule {
    let p = css_scan_ident(src, end, lhs + 1);
    if D == LESS {
        let mut s = p;
        while s < end && (at(src, s) == 32 || at(src, s) == 9) {
            s += 1;
        }
        if (s < end && at(src, s) == b':')
            || (p + 1 < end && at(src, p) == b'(' && at(src, p + 1) == b')')
        {
            out.tok(tok::VARIABLE, p);
            return AtRule {
                out,
                end: p,
                mode: PROPERTY,
                namespace: false,
                fn_prelude: false,
            };
        }
    }
    let w = &src[lhs..p];
    let namespace = w.len() == 10 && w[1..].iter().zip(b"namespace").all(|(&a, &b)| a | 32 == b);
    let mut mode = PRELUDE;
    let mut fn_prelude = false;
    // scss `@include`, `@mixin`, and `@function` name a mixin or function
    // next; `@extend` names a selector.
    if D >= SCSS {
        fn_prelude = w == b"@include" || w == b"@mixin" || w == b"@function";
        if w == b"@extend" {
            mode = SELECTOR;
        }
    }
    out.tok(tok::KEYWORD, p);
    AtRule {
        out,
        end: p,
        mode,
        namespace,
        fn_prelude,
    }
}

/// Marks a name that opens `url(`, whose tokens [`url`] emits.
const URL: u32 = u32::MAX;

/// Whether `[lhs, rhs)`, glued to `(`, is `url` in any case.
#[inline(always)]
fn is_url(src: &[u8], lhs: usize, rhs: usize) -> bool {
    rhs - lhs == 3
        && at(src, lhs) | 32 == b'u'
        && at(src, lhs + 1) | 32 == b'r'
        && at(src, lhs + 2) | 32 == b'l'
}

/// The color of a name `[lhs, rhs)` in an at-rule prelude, and the
/// `namespace` and `fn_prelude` flags after it: a query operator, the
/// mixin or function a scss `@include`, `@mixin`, or `@function` (or a
/// sass `=` or `+` line) names, a function, the `@namespace` name, a
/// feature name before `:` (a property), or else a value keyword
/// (`$hlCssImpl`, `$cssIsQueryOp`).
#[inline(never)]
fn prelude_word<const D: u32>(
    src: &[u8],
    end: usize,
    lhs: usize,
    rhs: usize,
    namespace: bool,
    fn_prelude: bool,
) -> (u32, bool, bool) {
    // Query operators, also when glued to `(` in minified css.
    if css_is_query_op::<D>(src, lhs, rhs) {
        return (tok::KEYWORD_OPERATOR, namespace, fn_prelude);
    }
    if fn_prelude {
        return (tok::FUNCTION, namespace, false);
    }
    if at(src, rhs) == b'(' {
        let hl = if is_url(src, lhs, rhs) {
            URL
        } else {
            tok::FUNCTION
        };
        return (hl, namespace, fn_prelude);
    }
    if namespace {
        return (tok::NAMESPACE, false, fn_prelude);
    }
    let mut p = rhs;
    while p < end && is_space(at(src, p)) {
        p += 1;
    }
    let hl = if at(src, p) == b':' {
        tok::PROPERTY
    } else if css_is_query_op::<D>(src, lhs, rhs) {
        tok::KEYWORD_OPERATOR
    } else {
        tok::CONSTANT_BUILTIN
    };
    (hl, namespace, fn_prelude)
}

/// `url(` with an unquoted body: the name, the bracket, and the body as one
/// value token; returns the end. A quoted or empty body is left to the main
/// loop (`$hlCssImpl`, `$cssScanUrlBody`).
#[cold]
#[inline(never)]
fn url(src: &[u8], end: usize, mut out: Out, rhs: usize) -> (usize, Out) {
    out.tok(tok::FUNCTION, rhs);
    let mut p = rhs + 1;
    out.tok(tok::PUNCTUATION_BRACKET, p);
    let open = p;
    while p < end && is_space(at(src, p)) {
        p += 1;
    }
    let c = at(src, p);
    if p < end && !(c == b')' || c == 34 || c == 39) {
        // SAFETY: the bracket's record exists.
        unsafe { out.extend(p) };
        let e = css_scan_url_body(src, end, p);
        out.tok(tok::CONSTANT_BUILTIN, e);
        return (e, out);
    }
    (open, out)
}

/// Lex the input at `base` as dialect `D` (`$hlCss`, `$hlLess`, `$hlScss`,
/// `$hlSass`).
fn highlight<const D: u32>(inst: &mut Instance, base: usize, len: usize) {
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
    let out = lex::<D>(src, len, out, p);
    // SAFETY: the records before `out.cur` are written, within capacity.
    unsafe { v.set_len(out.cur.offset_from(rp) as usize) };
}

/// The lexer loop for every dialect, from the start of the input
/// (`$hlCssImpl` with a zero state: no template part and no streaming).
fn lex<const D: u32>(src: &[u8], end: usize, mut out: Out, mut p: usize) -> Out {
    let mut mode = SELECTOR;
    // At a statement start: classify before dispatching.
    let mut decide = true;
    // In a selector's attribute: 1 before `=`, 2 after.
    let mut attr = 0u32;
    // An `@namespace` prelude still expects its optional name.
    let mut namespace = false;
    // Open `{` blocks.
    let mut depth = 0u32;
    // Braces open inside a `#{}` or `@{}` interpolation, and the mode to
    // restore when it closes.
    let mut interp = 0u32;
    let mut interp_mode = SELECTOR;
    // The prelude names a mixin or function next.
    let mut fn_prelude = false;

    // The leading whitespace was taken before the loop, and every pass
    // emits at least one record, so a gap here always has a record to
    // extend.
    loop {
        let mut c = at(src, p);
        if is_space(c) {
            let gap = p;
            p = space_end(src, p + 1);
            // The indented syntax ends a statement at its line break.
            if D == SASS && src[gap..p].iter().any(|&b| b == 10 || b == 13) {
                decide = true;
            }
            // SAFETY: a gap here follows a pass, which emitted a record.
            unsafe { out.extend(p) };
            c = at(src, p);
        }
        if p >= end {
            break;
        }
        let lhs = p;
        // The second byte; the WAT reads 0 past the end, and the NUL after
        // the input is 0. Read only by the rules that need it.
        let c2 = || at(src, lhs + 1);

        // Comments, in any mode, also while a decision is pending; `//`
        // only in the preprocessor dialects.
        if c == b'/' {
            if c2() == b'*' {
                p = scan::block_comment_end(src, p + 2, end);
                out.tok(tok::COMMENT, p);
                continue;
            }
            if D != CSS && c2() == b'/' {
                p = scan::line_end(src, p + 2, end);
                out.tok(tok::COMMENT, p);
                continue;
            }
        }

        // Statement start: an at-rule, or the selector/declaration
        // look-ahead.
        if decide {
            decide = false;
            attr = 0;
            namespace = false;
            fn_prelude = false;
            // sass `=name` defines a mixin and `+name` includes one.
            if D == SASS && (c == b'=' || c == b'+') && ident_start(c2()) {
                core::hint::cold_path();
                p += 1;
                out.tok(tok::KEYWORD, p);
                mode = PRELUDE;
                fn_prelude = true;
                continue;
            }
            if c == b'@' && c2() != b'{' {
                let r = at_rule::<D>(src, end, out, lhs);
                out = r.out;
                p = r.end;
                mode = r.mode;
                namespace = r.namespace;
                fn_prelude = r.fn_prelude;
                continue;
            }
            if c == b'&' {
                // A leading `&` always opens a nested selector.
                mode = SELECTOR;
            } else {
                // The indented syntax nests by indentation: a statement
                // that does not start its line sits inside a block.
                let sass_depth =
                    D == SASS && p > 0 && (at(src, p - 1) == 32 || at(src, p - 1) == 9);
                let d = depth | sass_depth as u32;
                // Inside a block, `name: ` can only open a declaration:
                // color the property and its colon here.
                if d != 0 && (ident_start(c) || c == b'-') {
                    let q = ident_run(src, p);
                    if at(src, q) == b':' && at(src, q + 1) == b' ' {
                        out.tok(
                            if c == b'-' && c2() == b'-' {
                                tok::VARIABLE
                            } else {
                                tok::PROPERTY
                            },
                            q,
                        );
                        // The colon's record also covers the space after
                        // it, as the gap would extend it.
                        p = q + 2;
                        out.tok(tok::PUNCTUATION_DELIMITER, p);
                        mode = VALUE;
                        continue;
                    }
                }
                mode = if css_decide::<D>(src, end, p, d) {
                    SELECTOR
                } else {
                    PROPERTY
                };
            }
        }

        let hl;
        match c {
            b'a'..=b'z' | b'A'..=b'Z' | b'_' | 128..=255 => {
                p = css_scan_ident(src, end, p);
                if mode == SELECTOR {
                    // Element name, attribute name, or unquoted attribute
                    // value; less guards read `when`.
                    hl = if D == LESS && &src[lhs..p] == b"when" {
                        tok::KEYWORD_OPERATOR
                    } else if attr == 0 {
                        if at(src, p) == b'|' {
                            tok::NAMESPACE
                        } else {
                            tok::TAG
                        }
                    } else if attr == 1 {
                        tok::ATTRIBUTE
                    } else {
                        tok::STRING
                    };
                } else if mode == PROPERTY {
                    hl = tok::PROPERTY;
                } else {
                    hl = value_word::<D>(
                        src,
                        end,
                        &mut out,
                        lhs,
                        &mut p,
                        mode,
                        &mut namespace,
                        &mut fn_prelude,
                    );
                    if hl == u32::MAX {
                        continue;
                    }
                }
            }
            b'0'..=b'9' => {
                // Numbers in every mode: `50%`, `2n+1`, `1.5rem`.
                p = css_scan_number(src, end, p + 1);
                hl = tok::NUMBER;
            }
            b'-' => {
                if mode == SELECTOR {
                    p += 1;
                    hl = tok::OPERATOR;
                } else if mode == PROPERTY {
                    p = css_scan_ident(src, end, p);
                    hl = if c2() == b'-' {
                        tok::VARIABLE
                    } else {
                        tok::PROPERTY
                    };
                } else if ident_start(c2()) || c2() == b'-' {
                    // `-webkit-x` and `--custom`.
                    p = css_scan_ident(src, end, p);
                    if c2() == b'-' {
                        hl = tok::VARIABLE;
                    } else {
                        hl = value_word::<D>(
                            src,
                            end,
                            &mut out,
                            lhs,
                            &mut p,
                            mode,
                            &mut namespace,
                            &mut fn_prelude,
                        );
                        if hl == u32::MAX {
                            continue;
                        }
                    }
                } else if is_digit(c2()) || (c2() == b'.' && is_digit(at(src, p + 2))) {
                    p = css_scan_number(src, end, p + 1);
                    hl = tok::NUMBER;
                } else {
                    p += 1;
                    hl = tok::OPERATOR;
                }
            }
            b'+' => {
                if mode != SELECTOR
                    && (is_digit(c2()) || (c2() == b'.' && is_digit(at(src, p + 2))))
                {
                    p = css_scan_number(src, end, p + 1);
                    hl = tok::NUMBER;
                } else {
                    p += 1;
                    hl = tok::OPERATOR;
                }
            }
            b'.' => {
                if mode == SELECTOR {
                    // `.class`, the dot included.
                    p = css_scan_ident(src, end, p + 1);
                    hl = if p - lhs > 1 {
                        tok::SELECTOR_CLASS
                    } else {
                        tok::PUNCTUATION_DELIMITER
                    };
                } else if D == LESS && mode == PROPERTY && ident_start(c2()) {
                    // A less mixin call: `.mixin();`.
                    p = css_scan_ident(src, end, p + 1);
                    hl = tok::SELECTOR_CLASS;
                } else if is_digit(c2()) {
                    p = css_scan_number(src, end, p + 1);
                    hl = tok::NUMBER;
                } else {
                    p += 1;
                    hl = tok::NONE;
                }
            }
            b'#' => {
                if D >= SCSS && c2() == b'{' {
                    core::hint::cold_path();
                    // `#{...}` interpolation.
                    p += 2;
                    out.tok(tok::PUNCTUATION_SPECIAL, p);
                    if interp == 0 {
                        interp_mode = mode;
                    }
                    interp += 1;
                    mode = VALUE;
                    continue;
                }
                p = css_scan_ident(src, end, p + 1);
                hl = if mode == SELECTOR {
                    if p - lhs > 1 {
                        tok::SELECTOR_ID
                    } else {
                        tok::NONE
                    }
                } else if D == LESS && mode == PROPERTY && ident_start(c2()) {
                    // A less mixin call: `#ns > .mixin;`.
                    tok::SELECTOR_ID
                } else {
                    // `#hex` colors.
                    tok::STRING_SPECIAL
                };
            }
            b':' => {
                p += 1;
                if mode == SELECTOR {
                    // `:pseudo` and `::pseudo`, the colons included; a bare
                    // colon is a delimiter.
                    if at(src, p) == b':' {
                        p += 1;
                    }
                    let mid = p;
                    p = css_scan_ident(src, end, p);
                    hl = if p > mid {
                        tok::SELECTOR_PSEUDO
                    } else {
                        tok::PUNCTUATION_DELIMITER
                    };
                } else {
                    if mode == PROPERTY {
                        mode = VALUE;
                    }
                    hl = tok::PUNCTUATION_DELIMITER;
                }
            }
            b';' => {
                decide = true;
                p += 1;
                hl = tok::PUNCTUATION_DELIMITER;
            }
            b'{' => {
                p += 1;
                if interp != 0 {
                    core::hint::cold_path();
                    interp += 1;
                } else {
                    decide = true;
                    depth += 1;
                }
                hl = tok::PUNCTUATION_BRACKET;
            }
            b'}' => {
                p += 1;
                if interp != 0 {
                    core::hint::cold_path();
                    interp -= 1;
                    if interp != 0 {
                        hl = tok::PUNCTUATION_BRACKET;
                    } else {
                        hl = tok::PUNCTUATION_SPECIAL;
                        mode = interp_mode;
                    }
                } else {
                    decide = true;
                    depth = depth.saturating_sub(1);
                    hl = tok::PUNCTUATION_BRACKET;
                }
            }
            b',' => {
                p += 1;
                hl = tok::PUNCTUATION_DELIMITER;
            }
            b'(' | b')' => {
                p += 1;
                hl = tok::PUNCTUATION_BRACKET;
            }
            b'[' | b']' => {
                // `[` and `]` also drive the attribute state.
                if mode == SELECTOR {
                    attr = (c == b'[') as u32;
                }
                p += 1;
                hl = tok::PUNCTUATION_BRACKET;
            }
            b'"' | b'\'' => {
                (p, out) = css_string(src, end, out, c, p);
                continue;
            }
            b'=' => {
                // `=` moves an attribute selector to its value side.
                if mode == SELECTOR && attr != 0 {
                    attr = 2;
                }
                p += 1;
                hl = tok::OPERATOR;
            }
            b'*' | b'>' | b'^' | b'~' => {
                p += 1;
                hl = tok::OPERATOR;
            }
            b'|' | b'$' => {
                if D >= SCSS && c == b'$' && ident_start(c2()) {
                    // `$var` in scss and sass.
                    p = css_scan_ident(src, end, p + 1);
                    hl = tok::VARIABLE;
                } else {
                    p += 1;
                    hl = if mode == SELECTOR {
                        tok::OPERATOR
                    } else {
                        tok::NONE
                    };
                }
            }
            b'<' | b'/' => {
                p += 1;
                hl = if mode == SELECTOR {
                    tok::NONE
                } else {
                    tok::OPERATOR
                };
            }
            b'&' => {
                if mode == SELECTOR {
                    if D != CSS && (ident_start(c2()) || c2() == b'-') {
                        // `&-suffix` and `&__elem` extend the parent
                        // selector.
                        p = css_scan_ident(src, end, p + 1);
                        hl = tok::SELECTOR_CLASS;
                    } else {
                        p += 1;
                        hl = tok::OPERATOR;
                    }
                } else {
                    p += 1;
                    hl = tok::NONE;
                }
            }
            b'!' => {
                p += 1;
                if mode == SELECTOR {
                    hl = tok::NONE;
                } else {
                    // `!important`, the bang included; a bare `!` is an
                    // operator.
                    let mid = p;
                    p = css_scan_ident(src, end, p);
                    hl = if p > mid { tok::KEYWORD } else { tok::OPERATOR };
                }
            }
            b'@' => {
                if D == LESS && c2() == b'{' {
                    core::hint::cold_path();
                    // `@{...}` interpolation.
                    p += 2;
                    out.tok(tok::PUNCTUATION_SPECIAL, p);
                    if interp == 0 {
                        interp_mode = mode;
                    }
                    interp += 1;
                    mode = VALUE;
                    continue;
                }
                if D == LESS && (ident_start(c2()) || c2() == b'@') {
                    // `@var` and `@@var` in less.
                    p = css_scan_ident(src, end, p + if c2() == b'@' { 2 } else { 1 });
                    hl = tok::VARIABLE;
                } else {
                    p += 1;
                    hl = tok::NONE;
                }
            }
            b'%' => {
                if D >= SCSS && ident_start(c2()) && mode <= PRELUDE {
                    // `%placeholder` selectors in scss and sass.
                    p = css_scan_ident(src, end, p + 1);
                    hl = tok::SELECTOR_CLASS;
                } else {
                    p += 1;
                    hl = tok::NONE;
                }
            }
            _ => {
                // Anything unclassified: one plain byte.
                p += 1;
                hl = tok::NONE;
            }
        }
        out.tok(hl, p);
    }
    out
}

/// The color of a name `[lhs, *p)` in a value or an at-rule prelude that
/// is not a `--custom` variable, or `u32::MAX` when it emitted its own
/// tokens (`url(`) and moved `*p` past them (`$hlCssImpl`).
#[allow(clippy::too_many_arguments)]
#[inline(always)]
fn value_word<const D: u32>(
    src: &[u8],
    end: usize,
    out: &mut Out,
    lhs: usize,
    p: &mut usize,
    mode: u32,
    namespace: &mut bool,
    fn_prelude: &mut bool,
) -> u32 {
    let rhs = *p;
    let hl = if mode == PRELUDE {
        let (hl, ns, fp) = prelude_word::<D>(src, end, lhs, rhs, *namespace, *fn_prelude);
        *namespace = ns;
        *fn_prelude = fp;
        hl
    } else if at(src, rhs) == b'(' {
        // A name glued to `(` is a function; `url(` with an unquoted body
        // makes that body one token.
        if is_url(src, lhs, rhs) {
            URL
        } else {
            tok::FUNCTION
        }
    } else {
        tok::CONSTANT_BUILTIN
    };
    if hl == URL {
        core::hint::cold_path();
        (*p, *out) = url(src, end, *out, rhs);
        return hl;
    }
    // A function name's `(` is always the next token: emit both here.
    if hl == tok::FUNCTION && at(src, rhs) == b'(' {
        out.tok(tok::FUNCTION, rhs);
        *p = rhs + 1;
        return tok::PUNCTUATION_BRACKET;
    }
    hl
}
