//! Native JavaScript and TypeScript highlighter in one pass: each token is
//! scanned and colored in the same step, with no token buffer. A token
//! whose color depends on the token after it (identifiers, contextual
//! words, `?`, and `:`) waits until that token is scanned. The records
//! equal the translated `js`/`ts` lexers' records.

#[cfg(target_arch = "aarch64")]
use core::arch::aarch64::*;

use super::ecma::{
    COLON_OR_QUESTION, LEX_HL_TABLE, MULTI, NO_NEXT, Next, Recs, Sig, Ts, emit_multi, is,
    metadata_marker, tag_marker,
};
use super::ecma_scan::{
    BRACKETS, KIND_TABLE, TEMPLATES, code_point, keyword, kf, scan_regexp, scan_string,
    scan_template, utf8_bits,
};
use super::scan;
use crate::Rec;
use crate::generated::Instance;
use crate::lex_ids as lex;
use crate::token_ids as tok;

/// The kind's color waits for the next token.
const DEFER: u32 = 1 << 20;
/// Before an identifier: a kind that a rule of `$identHl` ahead of its
/// word rules tests, apart from `(`.
const ID_PREV: u32 = 1 << 21;
/// After an identifier: a kind that a rule of `$identHl` ahead of its word
/// rules tests, apart from `(` and the kinds in [`ID_PAREN_NEXT`].
const ID_NEXT: u32 = 1 << 22;
/// After `( identifier`: a kind that makes a parameter rule apply.
const ID_PAREN_NEXT: u32 = 1 << 23;

/// Set `bit` in `t` for each of `kinds`.
const fn mark(mut t: [u32; 256], kinds: &[u8], bit: u32) -> [u32; 256] {
    let mut i = 0;
    while i < kinds.len() {
        t[kinds[i] as usize] |= bit;
        i += 1;
    }
    t
}

/// Per-kind flags: the [`kf`] bits and [`DEFER`], with the kind's fixed
/// color (`$LexHl`) in the top byte.
static FLAGS: [u32; 256] = {
    let mut t = [0u32; 256];
    let mut k = 0;
    while k < 256 {
        let hl = LEX_HL_TABLE[k];
        let mut f = KIND_TABLE[k] | (hl as u32) << 24;
        if hl >= COLON_OR_QUESTION {
            f |= DEFER;
        }
        if f & kf::CTX_IDENT_NEXT != 0 {
            f |= ID_NEXT;
        }
        t[k] = f;
        k += 1;
    }
    use lex::*;
    t = mark(
        t,
        &[
            DOT,
            QUESTION_MARK_DOT,
            COLON,
            IDENTIFIER,
            KEYWORD_EXTENDS,
            KEYWORD_NEW,
            KEYWORD_CLASS,
            KEYWORD_INTERFACE,
            KEYWORD_ENUM,
            CTXWORD_TYPE,
            KEYWORD_FUNCTION,
        ],
        ID_PREV,
    );
    t = mark(t, &[FUNCTION_ARROW, CTXWORD_IS], ID_NEXT);
    t = mark(t, &[R_PAREN, COLON, QUESTION_MARK], ID_PAREN_NEXT);
    t
};

/// First bytes of identifiers that only the "variable" rule can match
/// (not uppercase, `_`, or the first letter of `undefined`): lowercase
/// letters and `$`.
static PLAIN_START: [bool; 256] = {
    let mut t = [false; 256];
    let mut c = 0;
    while c < 256 {
        let b = c as u8;
        t[c] = (b.is_ascii_lowercase() && b != b'u') || b == b'$';
        c += 1;
    }
    t
};

/// Identifier-continuation bytes: `[A-Za-z0-9_$]`.
static IDENT_CONT: [bool; 256] = {
    let mut t = [false; 256];
    let mut c = 0;
    while c < 256 {
        let b = c as u8;
        t[c] = b.is_ascii_alphanumeric() || b == b'_' || b == b'$';
        c += 1;
    }
    t
};

/// The end of the run of `[A-Za-z0-9_$]` bytes starting at `p`. The input
/// ends with a NUL and slack, so the run stops by the end.
#[inline(always)]
fn ident_end(src: &[u8], mut p: usize) -> usize {
    // SAFETY: runs stop at the NUL after the input, and each 16-byte load
    // starts before it, inside the slack.
    unsafe {
        if !IDENT_CONT[*src.get_unchecked(p) as usize] {
            return p;
        }
        #[cfg(target_arch = "aarch64")]
        loop {
            let v = vld1q_u8(src.as_ptr().add(p));
            let alpha = vcleq_u8(
                vsubq_u8(vorrq_u8(v, vdupq_n_u8(0x20)), vdupq_n_u8(b'a')),
                vdupq_n_u8(25),
            );
            let digit = vcleq_u8(vsubq_u8(v, vdupq_n_u8(b'0')), vdupq_n_u8(9));
            let extra = vorrq_u8(vceqq_u8(v, vdupq_n_u8(b'_')), vceqq_u8(v, vdupq_n_u8(b'$')));
            let ok = vorrq_u8(vorrq_u8(alpha, digit), extra);
            let nib = vget_lane_u64::<0>(vreinterpret_u64_u8(vshrn_n_u16::<4>(
                vreinterpretq_u16_u8(vmvnq_u8(ok)),
            )));
            if nib != 0 {
                return p + (nib.trailing_zeros() / 4) as usize;
            }
            p += 16;
        }
        #[cfg(not(target_arch = "aarch64"))]
        {
            while IDENT_CONT[*src.get_unchecked(p) as usize] {
                p += 1;
            }
            p
        }
    }
}

/// The end of the run of whitespace bytes (space, TAB..CR) starting at
/// `p`, and whether it holds a line break.
#[inline(always)]
fn space_run(src: &[u8], mut p: usize) -> (usize, bool) {
    // SAFETY: as in `ident_end`; NUL is not whitespace.
    unsafe {
        #[cfg(target_arch = "aarch64")]
        {
            let mut nl = false;
            loop {
                let v = vld1q_u8(src.as_ptr().add(p));
                let sp = vorrq_u8(
                    vceqq_u8(v, vdupq_n_u8(b' ')),
                    vcleq_u8(vsubq_u8(v, vdupq_n_u8(9)), vdupq_n_u8(4)),
                );
                let br = vorrq_u8(
                    vceqq_u8(v, vdupq_n_u8(b'\n')),
                    vceqq_u8(v, vdupq_n_u8(b'\r')),
                );
                let nib = |m: uint8x16_t| {
                    vget_lane_u64::<0>(vreinterpret_u64_u8(vshrn_n_u16::<4>(vreinterpretq_u16_u8(
                        m,
                    ))))
                };
                let stop = nib(vmvnq_u8(sp));
                let breaks = nib(br);
                if stop != 0 {
                    let k = stop.trailing_zeros();
                    nl |= breaks & ((1u64 << k) - 1) != 0;
                    return (p + (k / 4) as usize, nl);
                }
                nl |= breaks != 0;
                p += 16;
            }
        }
        #[cfg(not(target_arch = "aarch64"))]
        {
            let mut nl = false;
            loop {
                let c = *src.get_unchecked(p);
                if !(c == b' ' || c.wrapping_sub(9) <= 4) {
                    return (p, nl);
                }
                nl |= c == b'\n' || c == b'\r';
                p += 1;
            }
        }
    }
}

/// The end of the run of spaces (0x20) starting at `p`, eight bytes at a
/// time. The input ends with a NUL, so the run stops by the end.
#[inline(always)]
fn spaces_end(src: &[u8], mut p: usize) -> usize {
    loop {
        // SAFETY: the run stops at the NUL after the input; each load
        // starts before it, inside the slack.
        let w = u64::from_le(unsafe { src.as_ptr().add(p).cast::<u64>().read_unaligned() });
        let x = w ^ 0x2020_2020_2020_2020;
        if x != 0 {
            return p + (x.trailing_zeros() / 8) as usize;
        }
        p += 8;
    }
}

/// Skip whitespace from `p`, including no-break spaces, the line and
/// paragraph separators, and byte order marks: the new position, and
/// whether a line break was crossed.
#[inline(always)]
fn skip_space(src: &[u8], mut p: usize, end: usize) -> (usize, bool) {
    let mut nl = false;
    // SAFETY: reads stay within a few bytes past `end`, inside the slack.
    let at = |q: usize| unsafe { *src.get_unchecked(q) };
    while p < end {
        let c = at(p);
        if c.wrapping_sub(33) <= 93 {
            break;
        }
        if c == b' ' || c.wrapping_sub(9) <= 4 {
            let (q, br) = space_run(src, p);
            p = q;
            nl |= br;
            continue;
        }
        if c == 194 && p + 1 < end && at(p + 1) == 160 {
            p += 2;
            continue;
        }
        if p + 3 <= end && c == 0xe2 && at(p + 1) == 0x80 && at(p + 2) & 0xfe == 0xa8 {
            nl = true;
            p += 3;
            continue;
        }
        if p + 3 <= end && c == 0xef && at(p + 1) == 0xbb && at(p + 2) == 0xbf {
            p += 3;
            continue;
        }
        break;
    }
    (p, nl)
}

/// The end of an identifier's tail from `p`, through ASCII and Unicode
/// identifier characters.
#[inline(never)]
fn ident_tail_unicode(src: &[u8], end: usize, mut p: usize) -> usize {
    while p < end && src[p] >= 128 {
        let bits = utf8_bits(src[p]);
        if bits == 0 {
            break;
        }
        let ok = code_point(src, p, bits).is_some_and(|c| {
            c == '\u{200c}' || c == '\u{200d}' || unicode_ident::is_xid_continue(c)
        });
        if !ok {
            break;
        }
        p = ident_end(src, p + bits);
    }
    p.min(end)
}

/// A token starting with the non-ASCII byte `c` at `lhs`: an identifier,
/// or one invalid code point. Returns its kind and end.
#[inline(never)]
fn non_ascii(src: &[u8], end: usize, c: u8, lhs: usize) -> (u8, usize) {
    let bits = utf8_bits(c);
    if bits != 0 && code_point(src, lhs, bits).is_some_and(unicode_ident::is_xid_start) {
        let p = ident_end(src, lhs + bits);
        return (lex::IDENTIFIER, ident_tail_unicode(src, end, p));
    }
    (lex::INVALID, (lhs + bits.max(1)).min(end))
}

/// A number's tail from `p`; the first digit or leading dot at `lhs` is
/// already consumed (`$scanNumber`). Returns its end.
#[inline(always)]
fn number(src: &[u8], end: usize, lhs: usize, mut p: usize, seen_dot: bool) -> usize {
    let byte = |q: usize| if q < end { src[q] } else { 0 };
    let hex = src[lhs] == b'0' && byte(lhs + 1) | 32 == b'x';
    let mut seen_dot = seen_dot;
    let mut prev = 0u8;
    while p < end {
        let c = src[p];
        let take = c.is_ascii_alphanumeric()
            || c == b'_'
            || ((c == b'+' || c == b'-') && !hex && prev | 32 == b'e')
            || (c == b'.' && !seen_dot && {
                seen_dot = true;
                true
            });
        if !take {
            break;
        }
        prev = c;
        p += 1;
    }
    p
}

/// State the hot loop touches rarely, kept in memory so the loop's own
/// variables stay in registers. The out-of-line helpers take it by
/// reference.
struct Cold<'a> {
    src: &'a [u8],
    end: usize,
    /// TypeScript syntax and rules (`$ecmaHasTypeScript`).
    ts: bool,
    /// The parameter-list machine (`sig.wat`).
    sig: Sig,
    /// An import or export clause is open (`$ecmaImport`).
    import: bool,
    /// `$jsTemplateMarker`, handed to the delegated emitters.
    marker: i32,
    /// The last non-comment kind before the last string literal, which
    /// `$rxAllowedAfter` reads after a string.
    before_string: u8,
    /// The range of the token waiting for the next one.
    pend_lhs: usize,
    pend_rhs: usize,
    source_start: usize,
    brace_depth: i32,
    brk_sp: usize,
    rx_closer: u8,
    tpl_sp: usize,
    brk: [u8; BRACKETS],
    tpl: [i32; TEMPLATES],
}

impl<'a> Cold<'a> {
    /// The classifier's view of the state, with `prev` the last
    /// non-comment kind.
    #[inline(always)]
    fn ts(&self, prev: u8) -> Ts<'a> {
        Ts {
            src: self.src,
            end: self.end,
            ts: self.ts,
            sig: self.sig,
            ecma_import: self.import,
            prev_tok: prev,
        }
    }

    /// Whether the parameter-list machine has a list open or a function
    /// head pending; otherwise it only tracks the paren depth.
    #[inline(always)]
    fn busy(&self) -> bool {
        self.sig.fn_pend || self.sig.mask != 0
    }

    #[inline(always)]
    fn brk_push(&mut self, k: u8) {
        if self.brk_sp < BRACKETS {
            self.brk[self.brk_sp] = k;
        }
        self.brk_sp += 1;
    }

    #[inline(always)]
    fn brk_pop(&mut self) {
        self.rx_closer = 0;
        if self.brk_sp == 0 {
            return;
        }
        self.brk_sp -= 1;
        if self.brk_sp < BRACKETS {
            self.rx_closer = self.brk[self.brk_sp] & 1;
        }
    }

    /// Template characters from `p`; a `${` pushes the brace depth it
    /// returns to. Returns the kind and end.
    #[inline(always)]
    fn template(&mut self, p: usize) -> (u8, usize) {
        let (kind, q) = scan_template(self.src, p, self.end, self.tpl_sp >= TEMPLATES);
        if kind == lex::DOLLAR_BRACE {
            self.tpl[self.tpl_sp] = self.brace_depth;
            self.tpl_sp += 1;
        }
        (kind, q)
    }

    /// Whether `/` after `lto` starts a regexp (`$rxAllowedAfter`); `nl`
    /// is whether a line break precedes the `/`.
    #[inline(always)]
    fn rx_allowed_after(&self, lto: u8, nl: bool) -> bool {
        let f = FLAGS[lto as usize];
        if f & kf::RX_DYNAMIC == 0 {
            return f & kf::RX_OK != 0;
        }
        if lto == lex::STRING_LITERAL {
            return nl
                && matches!(
                    self.before_string,
                    lex::CTXWORD_FROM | lex::KEYWORD_IMPORT | lex::KEYWORD_EXPORT
                );
        }
        self.rx_closer != 0
    }
}

/// `$sigStep` for a kind other than an identifier or accessor word while
/// the machine is busy. Returns whether it stays busy.
#[inline(never)]
fn sig_busy(cold: &mut Cold, prev: u8, t: u8, lhs: usize, rhs: usize) -> bool {
    let mut ts = cold.ts(prev);
    ts.sig_step_full(prev, t, lex::EOF, lhs, rhs);
    cold.sig = ts.sig;
    cold.busy()
}

/// `$classify` for kind `t` through the full rules, keeping the
/// parameter-list machine's changes.
#[inline(never)]
fn classify(cold: &mut Cold, prev: u8, t: u8, next: Next, lhs: usize, rhs: usize) -> u32 {
    let mut ts = cold.ts(prev);
    let hl = ts.classify(t, next, lhs, rhs);
    cold.sig = ts.sig;
    hl
}

/// The word rules for an identifier no context rule applies to: builtin
/// constants, calls, SCREAMING_CASE constants, and capitalized types.
#[inline(never)]
fn ident_word(cold: &Cold, prev: u8, next: Next, lhs: usize, rhs: usize) -> u32 {
    let ts = cold.ts(prev);
    if next.t == lex::L_PAREN && !ts.is_builtin_const(lhs, rhs) {
        return tok::FUNCTION;
    }
    ts.ident_by_word(prev, next, lhs, rhs)
}

/// Color a waiting contextual word, `?`, or `:`, and set the template
/// marker after it.
#[inline(never)]
fn resolve_other(cold: &mut Cold, prev: u8, t: u8, next: Next, lhs: usize, rhs: usize) -> u32 {
    let hl = classify(cold, prev, t, next, lhs, rhs);
    // A metadata key's marker survives to the template after its colon.
    cold.marker = if t == lex::COLON && cold.marker & 0x4000_0000 != 0 {
        cold.marker & 0xbfff_ffffu32 as i32
    } else {
        0
    };
    hl
}

/// The end of at most `max` ASCII hex digits from `p`, bounded by `end`
/// (`$scanHexRun`).
#[inline(always)]
fn hex_run(src: &[u8], mut p: usize, max: usize, end: usize) -> usize {
    let stop = (p + max).min(end);
    while p < stop && src[p].is_ascii_hexdigit() {
        p += 1;
    }
    p
}

/// Emit the string `[from, to)` with its escapes (`$emitEscaped`): the text
/// between escapes as strings, and each `\x`, `\u`, `\u{...}`, or
/// single-character escape as an escape, never splitting a code point.
#[inline(never)]
fn emit_escaped(recs: &mut Recs, src: &[u8], end: usize, from: usize, to: usize) {
    let byte = |q: usize| if q < end { src[q] } else { 0 };
    let mut seg = from;
    let mut p = from;
    while p < to {
        let q = scan::find3(src, p, to, b'\\', b'\\', b'\\');
        if q >= to {
            break;
        }
        if seg < q {
            recs.tok(tok::STRING, q);
        }
        let mut e = match byte(q + 1) {
            b'u' if byte(q + 2) == b'{' => {
                let e = hex_run(src, q + 3, 16, end);
                if e < to && src[e] == b'}' { e + 1 } else { e }
            }
            b'u' => hex_run(src, q + 2, 4, end),
            b'x' => hex_run(src, q + 2, 2, end),
            _ => q + 2,
        };
        e = scan::utf8_span_end(src, e, to);
        if q < e {
            recs.tok(tok::STRING_ESCAPE, e);
        }
        p = e;
        seg = e;
    }
    if seg < to {
        recs.tok(tok::STRING, to);
    }
}

/// Whether the block comment `[lhs, rhs)` is a `/** ... */` doc comment
/// (`$isDocComment`): a third `*`, except in the empty `/**/`. A comment
/// still open at its end is judged by its opener alone.
#[inline(always)]
fn is_doc_comment(src: &[u8], end: usize, lhs: usize, rhs: usize) -> bool {
    let open = rhs - lhs < 4 || &src[rhs - 2..rhs] != b"*/";
    lhs + 2 < end && src[lhs + 2] == b'*' && (rhs - lhs > 4 || open)
}

/// Whether the JSDoc tag name `[lhs, rhs)` takes a parameter path
/// (`$isParamTag`).
#[inline(always)]
fn is_param_tag(src: &[u8], lhs: usize, rhs: usize) -> bool {
    matches!(
        &src[lhs..rhs],
        b"param"
            | b"arg"
            | b"argument"
            | b"prop"
            | b"property"
            | b"template"
            | b"typedef"
            | b"callback"
    )
}

/// A JSDoc parameter path byte: identifier characters and `.`
/// (`$docNameChar`).
#[inline(always)]
fn doc_name_char(c: u8) -> bool {
    c.is_ascii_alphanumeric() || c == b'_' || c == b'$' || c == b'.'
}

/// The first byte at or after `p` that is not a space or tab, or `rhs`
/// (`$blanksEnd`).
#[inline(always)]
fn blanks_end(src: &[u8], mut p: usize, rhs: usize) -> usize {
    while p < rhs && matches!(src[p], b' ' | b'\t') {
        p += 1;
    }
    p
}

/// Emit the doc comment `[lhs, rhs)` (`$emitDocCommentRange` with the
/// `/**` opener skipped): `@tag` as a JSDoc keyword, a balanced `{type}`
/// right after it on the same line as a JSDoc type in brackets, and the
/// name path after parameter-like tags as a JSDoc variable. Everything else
/// is doc comment text.
#[inline(never)]
fn emit_doc_comment(recs: &mut Recs, src: &[u8], lhs: usize, rhs: usize) {
    // `$emitTok`: empty ranges emit nothing.
    let emit = |recs: &mut Recs, hl: u32, a: usize, b: usize| {
        if a < b {
            recs.tok(hl, b);
        }
    };
    let mut seg = lhs;
    let mut p = lhs + 3;
    loop {
        p = scan::find3(src, p, rhs, b'@', b'@', b'@').max(p);
        if p >= rhs {
            break;
        }
        // A tag starts a word, after whitespace, `*`, `{`, or `(`.
        let c = if p > lhs { src[p - 1] } else { b' ' };
        if !(c == b' ' || c.wrapping_sub(9) <= 4 || matches!(c, b'*' | b'{' | b'(')) {
            p += 1;
            continue;
        }
        // ... and a letter follows the `@`.
        let mut e = p + 1;
        if e >= rhs || !src[e].is_ascii_alphabetic() {
            p = e;
            continue;
        }
        loop {
            e += 1;
            if e >= rhs || !src[e].is_ascii_alphanumeric() {
                break;
            }
        }
        emit(recs, tok::COMMENT_DOC, seg, p);
        emit(recs, tok::KEYWORD_JSDOC, p, e);
        let param = e - (p + 1) <= 8 && is_param_tag(src, p + 1, e);
        seg = e;
        p = e;
        // An optional `{type}`, balanced and on this line.
        let q = blanks_end(src, p, rhs);
        if q < rhs && src[q] == b'{' {
            let mut b = q + 1;
            let mut depth = 1;
            let closed = loop {
                if b >= rhs || matches!(src[b], b'\n' | b'\r') {
                    break false;
                }
                match src[b] {
                    b'{' => depth += 1,
                    b'}' => depth -= 1,
                    _ => {}
                }
                b += 1;
                if depth == 0 {
                    break true;
                }
            };
            if closed {
                emit(recs, tok::COMMENT_DOC, seg, q);
                emit(recs, tok::PUNCTUATION_BRACKET, q, q + 1);
                emit(recs, tok::TYPE_JSDOC, q + 1, b - 1);
                emit(recs, tok::PUNCTUATION_BRACKET, b - 1, b);
                seg = b;
                p = b;
            }
        }
        // The tag's name argument.
        if param {
            let q = blanks_end(src, p, rhs);
            if q < rhs {
                let mut b = q;
                while b < rhs && doc_name_char(src[b]) {
                    b += 1;
                }
                if b != q {
                    emit(recs, tok::COMMENT_DOC, seg, q);
                    emit(recs, tok::VARIABLE_JSDOC, q, b);
                    seg = b;
                    p = b;
                }
            }
        }
    }
    emit(recs, tok::COMMENT_DOC, seg, rhs);
}

/// Emit a token that neither waits nor is plain: import clause words,
/// strings, templates, comments, and invalid bytes. Records go through
/// `inst.ext.recs`.
#[inline(never)]
fn other(
    cold: &mut Cold,
    inst: &mut Instance,
    base: usize,
    prev: u8,
    t: u8,
    lhs: usize,
    rhs: usize,
) {
    let flags = FLAGS[t as usize];
    if t == lex::KEYWORD_IMPORT || t == lex::KEYWORD_EXPORT {
        cold.import = true;
    } else if cold.import && flags & kf::IMPORT_END != 0 {
        cold.import = false;
    }
    let mut metadata = 0i32;
    if t == lex::STRING_LITERAL && matches!(prev, lex::EOF | lex::L_BRACE | lex::COMMA) {
        metadata = metadata_marker(cold.src, t, lhs, rhs);
    }
    if (flags >> 24) as u8 != MULTI {
        let hl = classify(cold, prev, t, NO_NEXT, lhs, rhs);
        let mut recs = Recs::load(inst);
        recs.tok(hl, rhs);
        recs.store(inst);
    } else if t == lex::STRING_LITERAL
        || (t == lex::INVALID && matches!(cold.src[lhs], b'"' | b'\''))
    {
        let mut recs = Recs::load(inst);
        emit_escaped(&mut recs, cold.src, cold.end, lhs, rhs);
        recs.store(inst);
    } else if t == lex::MULTILINE_COMMENT {
        let mut recs = Recs::load(inst);
        if is_doc_comment(cold.src, cold.end, lhs, rhs) {
            emit_doc_comment(&mut recs, cold.src, lhs, rhs);
        } else {
            recs.tok(tok::COMMENT, rhs);
        }
        recs.store(inst);
    } else {
        let abs = |p: usize| (base + p) as i32;
        // Delegated emitters read `$ptr`, `$end`, and the template globals.
        inst.g_ptr = abs(rhs);
        inst.g_jsTemplateMarker = cold.marker;
        let mem = inst.mem.bytes().as_ptr();
        emit_multi(inst, cold.src, t, abs(lhs), abs(rhs));
        cold.marker = inst.g_jsTemplateMarker;
        assert!(
            core::ptr::eq(inst.mem.bytes().as_ptr(), mem),
            "lexer memory moved"
        );
    }
    let marker_before = cold.marker;
    cold.marker = 0;
    if t == lex::MULTILINE_COMMENT {
        cold.marker = tag_marker(cold.src, t, lhs, rhs);
    }
    if flags & kf::COMMENT != 0 && cold.marker == 0 {
        cold.marker = marker_before;
    }
    if metadata != 0 {
        cold.marker = metadata;
    }
}

/// Lex every token from `cold.source_start` to the end into
/// `inst.ext.recs`.
// The end-of-input step updates loop state that is not read again.
#[allow(unused_assignments)]
#[inline(always)]
fn lex(cold: &mut Cold, inst: &mut Instance, base: usize) {
    let src = cold.src;
    let end = cold.end;
    // SAFETY: reads stay within a few bytes past `end`, inside the slack.
    // The byte at `end` is NUL, so an identifier run never reaches a
    // non-ASCII byte there.
    let at = |q: usize| unsafe { *src.get_unchecked(q) };
    let byte = |q: usize| if q < end { at(q) } else { 0 };
    let mut p = cold.source_start;
    // Kind of the last non-comment token as scanned, and as classified.
    let mut lto = lex::EOF;
    let mut prev = lex::EOF;
    let mut busy = false;
    // The token waiting for the next one (`EOF` when none).
    let mut pend = lex::EOF;
    let mut done = p;
    // A line break precedes the current token.
    let mut nl: bool;
    // The records: the vector's start, one past the last written one, and
    // the end of its capacity.
    let mut rp = inst.ext.recs.as_mut_ptr();
    // SAFETY: `len` records are written.
    let mut cur = unsafe { rp.add(inst.ext.recs.len()) };
    // SAFETY: one past the allocation.
    let mut limit = unsafe { rp.add(inst.ext.recs.capacity()) };
    let mut last = inst.ext.recs.last().map_or(u32::MAX, |r| r.token);

    // Append a record (`$emitTok`), merging with a same-colored last one.
    // Records never outnumber input bytes, which the vector has room for;
    // running out of room means a lexer bug, which traps.
    macro_rules! emit {
        ($hl:expr, $end:expr) => {{
            let hl: u32 = $hl;
            // SAFETY: see above; a merge rewrites the last record.
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
    // Whitespace before `lhs` extends the last record (`$emitGap`).
    macro_rules! gap {
        ($lhs:expr) => {{
            let lhs: usize = $lhs;
            if done < lhs {
                if cur == rp {
                    emit!(tok::NONE, lhs);
                } else {
                    // SAFETY: the record before `cur` is written.
                    unsafe { (*cur.sub(1)).end = lhs as u32 };
                }
            }
        }};
    }
    // Hand the records to `inst.ext.recs` around helpers that write them.
    macro_rules! store_recs {
        () => {
            // SAFETY: the records before `cur` are written.
            unsafe { inst.ext.recs.set_len(cur.offset_from(rp) as usize) }
        };
    }
    macro_rules! load_recs {
        () => {{
            rp = inst.ext.recs.as_mut_ptr();
            // SAFETY: `len` records are written.
            cur = unsafe { rp.add(inst.ext.recs.len()) };
            // SAFETY: one past the allocation.
            limit = unsafe { rp.add(inst.ext.recs.capacity()) };
            last = inst.ext.recs.last().map_or(u32::MAX, |r| r.token);
        }};
    }
    // `$classify` for the waiting identifier at `lhs..rhs`.
    macro_rules! identifier {
        ($next:expr, $lhs:expr, $rhs:expr) => {{
            let (next, lhs, rhs): (Next, usize, usize) = ($next, $lhs, $rhs);
            let pf = FLAGS[prev as usize];
            let nf = FLAGS[next.t as usize];
            if busy || (next.t == lex::L_PAREN && rhs - lhs == 11) {
                let hl = classify(cold, prev, lex::IDENTIFIER, next, lhs, rhs);
                busy = cold.busy();
                hl
            } else if prev == lex::DOT || prev == lex::QUESTION_MARK_DOT {
                if next.t != lex::L_PAREN {
                    tok::PROPERTY
                } else if !at(lhs).is_ascii_uppercase() {
                    tok::FUNCTION_METHOD
                } else {
                    classify(cold, prev, lex::IDENTIFIER, next, lhs, rhs)
                }
            } else if pf & ID_PREV == 0
                && nf & ID_NEXT == 0
                && (pf & kf::KEY_PREV == 0 || nf & kf::KEY_NEXT == 0)
                && (prev != lex::L_PAREN || nf & ID_PAREN_NEXT == 0)
            {
                // Only the builtin-constant, call, and word rules remain.
                if PLAIN_START[at(lhs) as usize] {
                    if next.t == lex::L_PAREN {
                        tok::FUNCTION
                    } else {
                        tok::VARIABLE
                    }
                } else {
                    ident_word(cold, prev, next, lhs, rhs)
                }
            } else {
                let hl = classify(cold, prev, lex::IDENTIFIER, next, lhs, rhs);
                busy = cold.busy();
                hl
            }
        }};
    }
    // Color and emit the waiting token, if any, now that `t` at
    // `lhs..rhs` follows it.
    macro_rules! resolve {
        ($t:expr, $lhs:expr, $rhs:expr) => {{
            if pend != lex::EOF {
                let next = Next {
                    t: $t,
                    lhs: $lhs,
                    rhs: $rhs,
                    nl,
                };
                let (t, lhs, rhs) = (pend, cold.pend_lhs, cold.pend_rhs);
                pend = lex::EOF;
                if t == lex::IDENTIFIER {
                    // A component metadata key (`template:`, `styles:`) or a
                    // template tag (`html`, `css`) sets the marker.
                    let mut metadata = 0i32;
                    if matches!(prev, lex::EOF | lex::L_BRACE | lex::COMMA) {
                        metadata = metadata_marker(src, t, lhs, rhs);
                    }
                    let hl = if metadata != 0
                        && (next.t == lex::COLON || next.t == lex::EOF || is(next.t, kf::COMMENT))
                    {
                        tok::PROPERTY
                    } else {
                        identifier!(next, lhs, rhs)
                    };
                    emit!(hl, rhs);
                    cold.marker = if metadata != 0 {
                        metadata
                    } else if (rhs - lhs).wrapping_sub(3) <= 1 {
                        tag_marker(src, t, lhs, rhs)
                    } else {
                        0
                    };
                } else {
                    let hl = resolve_other(cold, prev, t, next, lhs, rhs);
                    busy = cold.busy();
                    emit!(hl, rhs);
                }
                done = rhs;
                prev = t;
            }
        }};
    }
    // Finish the scanned token `t` at `lhs..rhs`: color the waiting token,
    // then emit this one or make it wait.
    macro_rules! finish {
        ($t:expr, $lhs:expr, $rhs:expr) => {{
            let (t, lhs, rhs): (u8, usize, usize) = ($t, $lhs, $rhs);
            let f = FLAGS[t as usize];
            if f & kf::NOT_LTO == 0 {
                if t == lex::STRING_LITERAL {
                    cold.before_string = lto;
                }
                lto = t;
            }
            resolve!(t, lhs, rhs);
            gap!(lhs);
            if f & DEFER != 0 {
                pend = t;
                cold.pend_lhs = lhs;
                cold.pend_rhs = rhs;
            } else if f & kf::PLAIN != 0 && (f & kf::IMPORT_END == 0 || !cold.import) {
                if busy {
                    busy = sig_busy(cold, prev, t, lhs, rhs);
                } else if f & kf::SIG_IDLE != 0 {
                    if t == lex::L_PAREN {
                        cold.sig.parens += 1;
                    } else if t == lex::R_PAREN {
                        cold.sig.parens = cold.sig.parens.saturating_sub(1);
                    } else {
                        cold.sig.fn_pend = true;
                        cold.sig.fn_angle = 0;
                        busy = true;
                    }
                }
                emit!(f >> 24, rhs);
                cold.marker = 0;
                prev = t;
                done = rhs;
            } else if t == lex::COMMENT || t == lex::HASH_BANG {
                // A line comment keeps the marker and the previous kind.
                emit!(tok::COMMENT, rhs);
            } else {
                store_recs!();
                other(cold, inst, base, prev, t, lhs, rhs);
                load_recs!();
                busy = cold.busy();
                if f & kf::COMMENT == 0 {
                    prev = t;
                }
                done = rhs;
            }
        }};
    }
    // A fixed-length token of kind `t`.
    macro_rules! take {
        ($lhs:expr, $t:expr, $len:expr) => {{
            p = $lhs + $len;
            finish!($t, $lhs, p);
        }};
    }
    // An operator family: `XX=`, `XX`, `X=`, or `X`, whose kinds sit at
    // `x - 3`, `x - 2`, `x - 1`, and `x` in `$Lex`. `forms`: 1 `X=`,
    // 2 `XX`, 4 `XX=`.
    macro_rules! family {
        ($lhs:expr, $c:expr, $x:expr, $forms:expr) => {{
            let (lhs, c, x, forms): (usize, u8, u8, u8) = ($lhs, $c, $x, $forms);
            let c2 = byte(lhs + 1);
            let (kind, len) = if c2 == c && forms & 2 != 0 {
                if forms & 4 != 0 && byte(lhs + 2) == b'=' {
                    (x - 3, 3)
                } else {
                    (x - 2, 2)
                }
            } else if forms & 1 != 0 && c2 == b'=' {
                (x - 1, 2)
            } else {
                (x, 1)
            };
            take!(lhs, kind, len);
        }};
    }

    loop {
        let mut c = at(p);
        nl = false;
        if (c as u32).wrapping_sub(33) > 93 {
            if c == b' ' || c == b'\n' {
                // A line break and indentation, or spaces between tokens.
                if c == b'\n' {
                    nl = true;
                    p += 1;
                }
                p = spaces_end(src, p);
                if (at(p) as u32).wrapping_sub(33) > 93 {
                    let (q, br) = skip_space(src, p, end);
                    p = q;
                    nl |= br;
                }
            } else {
                (p, nl) = skip_space(src, p, end);
            }
            c = at(p);
        }
        let lhs = p;
        match c {
            b'a'..=b'z' | b'A'..=b'Z' | b'_' | b'$' => {
                let mut q = ident_end(src, lhs + 1);
                if at(q) >= 128 {
                    q = ident_tail_unicode(src, end, q);
                }
                p = q;
                let t = if lto == lex::DOT || lto == lex::QUESTION_MARK_DOT {
                    lex::IDENTIFIER
                } else {
                    match keyword(src, lhs, q) {
                        None => lex::IDENTIFIER,
                        Some(kw) if !cold.ts && kw >= lex::CTXWORD_ABSTRACT => lex::IDENTIFIER,
                        Some(kw) => kw,
                    }
                };
                finish!(t, lhs, q);
            }
            b'0'..=b'9' => {
                p = number(src, end, lhs, lhs + 1, false);
                finish!(lex::NUMBER_LITERAL, lhs, p);
            }
            0 if lhs >= end => break,
            0x80..=0xff => {
                let (t, q) = non_ascii(src, end, c, lhs);
                p = q;
                finish!(t, lhs, q);
            }
            b'(' => {
                let k = (FLAGS[lto as usize] & kf::CTRL_PAREN_PREV != 0) as u8;
                cold.brk_push(k);
                take!(lhs, lex::L_PAREN, 1);
            }
            b')' => {
                cold.brk_pop();
                take!(lhs, lex::R_PAREN, 1);
            }
            b'.' => {
                let c2 = byte(lhs + 1);
                if c2 == b'.' && byte(lhs + 2) == b'.' {
                    take!(lhs, lex::SPREAD, 3);
                } else if c2.is_ascii_digit() {
                    p = number(src, end, lhs, lhs + 1, true);
                    finish!(lex::NUMBER_LITERAL, lhs, p);
                } else {
                    take!(lhs, lex::DOT, 1);
                }
            }
            b';' => take!(lhs, lex::SEMICOLON, 1),
            b',' => take!(lhs, lex::COMMA, 1),
            b':' => take!(lhs, lex::COLON, 1),
            b'{' => {
                let block = !cold.rx_allowed_after(lto, nl)
                    || FLAGS[lto as usize] & kf::BRACE_BLOCK_PREV != 0;
                cold.brk_push(block as u8);
                cold.brace_depth += 1;
                take!(lhs, lex::L_BRACE, 1);
            }
            b'}' => {
                if cold.tpl_sp > 0 && cold.brace_depth == cold.tpl[cold.tpl_sp - 1] {
                    cold.tpl_sp -= 1;
                    let (t, q) = cold.template(lhs + 1);
                    p = q;
                    finish!(t, lhs, q);
                } else {
                    cold.brk_pop();
                    cold.brace_depth -= 1;
                    take!(lhs, lex::R_BRACE, 1);
                }
            }
            b'=' => {
                if byte(lhs + 1) == b'>' {
                    take!(lhs, lex::FUNCTION_ARROW, 2);
                } else {
                    family!(lhs, c, lex::EQUAL, 6);
                }
            }
            b'/' => {
                let c2 = byte(lhs + 1);
                if c2 == b'/' {
                    p = scan::line_end(src, lhs + 2, end);
                    finish!(lex::COMMENT, lhs, p);
                } else if c2 == b'*' {
                    p = scan::block_comment_end(src, (lhs + 2).min(end), end);
                    finish!(lex::MULTILINE_COMMENT, lhs, p);
                } else if cold.rx_allowed_after(lto, nl) {
                    let (t, q) = scan_regexp(src, lhs, end);
                    p = q;
                    finish!(t, lhs, q);
                } else {
                    family!(lhs, c, lex::SLASH, 1);
                }
            }
            b'&' => family!(lhs, c, lex::AMPERSAND, 7),
            b'!' => {
                if byte(lhs + 1) == b'=' {
                    if byte(lhs + 2) == b'=' {
                        take!(lhs, lex::BANG_EQUAL_EQUAL, 3);
                    } else {
                        take!(lhs, lex::BANG_EQUAL, 2);
                    }
                } else {
                    take!(lhs, lex::BANG, 1);
                }
            }
            b'|' => family!(lhs, c, lex::PIPE, 7),
            b'?' => {
                if byte(lhs + 1) == b'.' {
                    if byte(lhs + 2).is_ascii_digit() {
                        take!(lhs, lex::QUESTION_MARK, 1);
                    } else {
                        take!(lhs, lex::QUESTION_MARK_DOT, 2);
                    }
                } else {
                    family!(lhs, c, lex::QUESTION_MARK, 6);
                }
            }
            b'[' => {
                cold.brk_push(0);
                take!(lhs, lex::L_BRACKET, 1);
            }
            b']' => {
                cold.brk_pop();
                take!(lhs, lex::R_BRACKET, 1);
            }
            b'"' | b'\'' => {
                let (t, q) = scan_string(src, lhs, end, c);
                p = q;
                finish!(t, lhs, q);
            }
            b'<' => family!(lhs, c, lex::L_ANGLE, 7),
            b'>' => {
                if byte(lhs + 1) == b'>' && byte(lhs + 2) == b'>' {
                    if byte(lhs + 3) == b'=' {
                        take!(lhs, lex::R_UNSIGNED_SHIFT_EQUAL, 4);
                    } else {
                        take!(lhs, lex::R_UNSIGNED_SHIFT, 3);
                    }
                } else {
                    family!(lhs, c, lex::R_ANGLE, 7);
                }
            }
            b'+' => family!(lhs, c, lex::PLUS, 3),
            b'-' => family!(lhs, c, lex::MINUS, 3),
            b'*' => family!(lhs, c, lex::ASTERISK, 7),
            b'%' => family!(lhs, c, lex::PERCENT, 1),
            b'^' => family!(lhs, c, lex::CARET, 1),
            b'~' => take!(lhs, lex::TILDE, 1),
            b'`' => {
                let (t, q) = cold.template(lhs + 1);
                p = q;
                finish!(t, lhs, q);
            }
            b'@' => {
                let mut q = ident_end(src, lhs + 1);
                if at(q) >= 128 {
                    q = ident_tail_unicode(src, end, q);
                }
                p = q;
                finish!(lex::AT_IDENTIFIER, lhs, q);
            }
            b'#' => {
                if lhs == cold.source_start && byte(lhs + 1) == b'!' {
                    p = scan::line_end(src, lhs + 2, end);
                    finish!(lex::HASH_BANG, lhs, p);
                } else {
                    let mut q = ident_end(src, lhs + 1);
                    if at(q) >= 128 {
                        q = ident_tail_unicode(src, end, q);
                    }
                    p = q;
                    finish!(lex::HASH_IDENTIFIER, lhs, q);
                }
            }
            _ => take!(lhs, lex::INVALID, 1),
        }
    }
    // The end of input: color the waiting token before it.
    resolve!(lex::EOF, p, p);
    gap!(p);
    store_recs!();
    inst.g_jsTemplateMarker = cold.marker;
}

/// Highlight `len` bytes of JavaScript, or TypeScript when `ts` is set, at
/// lexer memory offset `base` into `inst.ext.recs`.
pub fn highlight(inst: &mut Instance, base: usize, len: usize, ts: bool) {
    let mem_ptr = inst.mem.bytes().as_ptr();
    // SAFETY: `base..base + len + 96` lies inside lexer memory, which the
    // delegated emitters never reallocate (checked after each call).
    let src: &[u8] = unsafe { core::slice::from_raw_parts(mem_ptr.add(base), len + 96) };
    let abs = |p: usize| (base + p) as i32;

    inst.g_srcBase = base as i32;
    inst.g_eof = abs(len);
    inst.g_end = abs(len);
    inst.g_ecmaFeatures = ts as i32;
    inst.g_tsxStreaming = 0;
    inst.g_tsxStreamExpressionClose = 0;
    inst.f_ecmaReset();
    inst.ext.recs.clear();
    inst.ext.recs.reserve(len + 2);

    // A range that starts inside a code point keeps its continuation bytes.
    let start = scan::utf8_span_end(src, 0, len);
    let mut recs = Recs::load(inst);
    recs.gap(0, start);
    recs.store(inst);
    let mut cold = Cold {
        src,
        end: len,
        ts,
        sig: Sig::default(),
        import: false,
        marker: 0,
        before_string: lex::EOF,
        pend_lhs: 0,
        pend_rhs: 0,
        source_start: start,
        brace_depth: 0,
        brk_sp: 0,
        rx_closer: 0,
        tpl_sp: 0,
        brk: [0; BRACKETS],
        tpl: [0; TEMPLATES],
    };
    lex(&mut cold, inst, base);
}
