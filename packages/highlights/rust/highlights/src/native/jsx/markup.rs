//! The JSX markup steps of `src/langs/jsx.wat` and the TSRX helpers of
//! `src/langs/tsrx.wat`: tags, attributes, and children scanned byte by
//! byte, with the mode stack that says which step runs next. Expression
//! containers (and TSRX directive and script bodies) return to the token
//! loop in the parent module.
//!
//! Modes: 1 tag (attributes), 2 children, 3 expression container; TSRX
//! adds 4 directive, 5 script body, 6 style body, 7 the tail of a dynamic
//! close tag `</{expr}>`.

#[cfg(target_arch = "aarch64")]
use core::arch::aarch64::*;

use super::{Cold, FLAGS, PLAIN_START, ident_end, ident_word, run_end};
use crate::generated::Instance;
use crate::lex_ids as lex;
use crate::native::ecma::{Next, metadata_marker, tag_marker};
use crate::native::ecma_scan::{keyword, kf};
use crate::native::recs::Recs;
use crate::native::scan;
use crate::token_ids as tok;

/// Mode stack capacity: deeper pushes are counted, not stored.
const STACK: usize = 512;

/// The markup mode stack (`$jsxPush` and the `$jsxTop…` accessors): each
/// entry is a mode and a target, whose meaning depends on the mode.
pub(super) struct JsxStack {
    /// Entries pushed and not popped, stored or not (`$jsxSp`).
    pub sp: u32,
    mode: [u8; STACK],
    target: [i32; STACK],
}

impl JsxStack {
    pub(super) const fn new() -> Self {
        JsxStack {
            sp: 0,
            mode: [0; STACK],
            target: [0; STACK],
        }
    }

    /// Push an entry; past the capacity only count it (`$jsxPush`).
    #[inline(always)]
    fn push(&mut self, mode: u8, target: i32) {
        let i = self.sp as usize;
        if i < STACK {
            self.mode[i] = mode;
            self.target[i] = target;
        }
        self.sp += 1;
    }

    /// The top entry, clamped to the last stored one (`$jsxTopSlot`).
    #[inline(always)]
    fn top_slot(&self) -> usize {
        (self.sp.wrapping_sub(1) as usize).min(STACK - 1)
    }

    /// `$jsxTopMode`: 0 with the stack empty.
    #[inline(always)]
    pub(super) fn top_mode(&self) -> u8 {
        if self.sp == 0 {
            return 0;
        }
        self.mode[self.top_slot()]
    }

    /// `$jsxTopTarget`: 0 with the stack empty.
    #[inline(always)]
    pub(super) fn top_target(&self) -> i32 {
        if self.sp == 0 {
            return 0;
        }
        self.target[self.top_slot()]
    }

    /// `$jsxSetTopMode`.
    #[inline(always)]
    fn set_top_mode(&mut self, mode: u8) {
        if self.sp != 0 {
            let i = self.top_slot();
            self.mode[i] = mode;
        }
    }

    /// `$jsxSetTopTarget`.
    #[inline(always)]
    fn set_top_target(&mut self, target: i32) {
        if self.sp != 0 {
            let i = self.top_slot();
            self.target[i] = target;
        }
    }
}

/// Modes that scan bytes rather than tokens: tag, children, style, and
/// close tail (`$jsxByteMode`).
#[inline(always)]
fn byte_mode(m: u8) -> bool {
    m.wrapping_sub(1) <= 1 || m >= 6
}

/// `p` past blanks and line breaks (`$jsxSpaceEndAt`), with a line break's
/// indentation, often long between attributes, eight bytes at a time.
#[inline(always)]
fn space_skip(src: &[u8], end: usize, mut p: usize) -> usize {
    if at(src, p) == b'\n' {
        p += 1;
        p = if at(src, p) == b'\t' {
            run_end(src, p, 0x0909_0909_0909_0909)
        } else {
            run_end(src, p, 0x2020_2020_2020_2020)
        };
    }
    space_end_at(src, end, p)
}

/// `[A-Za-z_$]` (`$jsxNameStart`).
#[inline(always)]
fn name_start(c: u8) -> bool {
    c.is_ascii_alphabetic() || c == b'_' || c == b'$'
}

/// Tag-name bytes `[A-Za-z0-9_$.:-]` (`$jsxNameCont`).
#[inline(always)]
fn name_cont(c: u8) -> bool {
    NAME_CONT[c as usize]
}

static NAME_CONT: [bool; 256] = {
    let mut t = [false; 256];
    let mut c = 0;
    while c < 256 {
        let b = c as u8;
        t[c] = b.is_ascii_alphanumeric() || matches!(b, b'_' | b'$' | b'.' | b':' | b'-');
        c += 1;
    }
    t
};

/// Identifier bytes `[A-Za-z0-9_$]` (`$tsrxIdentByte`).
#[inline(always)]
fn ident_byte(c: u8) -> bool {
    name_start(c) || c.is_ascii_digit()
}

/// The byte at `p`, which lies at most one byte past the input end (the
/// NUL), unchecked.
#[inline(always)]
fn at(src: &[u8], p: usize) -> u8 {
    debug_assert!(p < src.len());
    // SAFETY: callers pass positions up to the input end, and the slack
    // extends `src` 96 bytes past it.
    unsafe { *src.get_unchecked(p) }
}

/// The byte at `p`, or 0 at or past `end` (`$tsxByte`).
#[inline(always)]
fn byte(src: &[u8], end: usize, p: usize) -> u8 {
    if p < end { at(src, p) } else { 0 }
}

/// `p` past a tag-name run (`$jsxNameEndAt`).
#[inline(always)]
fn name_end_at(src: &[u8], end: usize, mut p: usize) -> usize {
    while p < end && name_cont(at(src, p)) {
        p += 1;
    }
    p
}

/// `p` past blanks and line breaks (`$jsxSpaceEndAt`).
#[inline(always)]
fn space_end_at(src: &[u8], end: usize, mut p: usize) -> usize {
    while p < end && BLANK[at(src, p) as usize] {
        p += 1;
    }
    p
}

/// Blanks and line breaks: space and TAB..CR.
static BLANK: [bool; 256] = {
    let mut t = [false; 256];
    let mut c = 0;
    while c < 256 {
        t[c] = c == 32 || (c >= 9 && c <= 13);
        c += 1;
    }
    t
};

/// Whether the `<` before `p` can open JSX, without consuming input
/// (`$jsxValidate`): `<>`, or a name followed by `>`, `/`, `{`, a quote,
/// or another name. TypeScript also takes type arguments (`<Select<T>`)
/// and rejects arrow type parameters after an optional `const`: a name
/// followed by `,` or `=`, or by `extends` and then anything except `=`,
/// `>`, or `/`. TSRX also takes a dynamic tag `<{expr}`.
#[inline(never)]
pub(super) fn validate<const TS: bool, const TSRX: bool>(
    src: &[u8],
    end: usize,
    mut p: usize,
) -> bool {
    if p >= end {
        return false;
    }
    let mut c = at(src, p);
    if c == b'>' {
        return true;
    }
    if TSRX && c == b'{' {
        return true;
    }
    if !name_start(c) {
        return false;
    }
    let name = p;
    p = name_end_at(src, end, p + 1);
    if TS {
        // `<const T`: judge the name after the modifier.
        if p - name == 5 && &src[name..name + 5] == b"const" {
            let q = space_end_at(src, end, p);
            if q > p && name_start(byte(src, end, q)) {
                p = name_end_at(src, end, q);
            }
        }
        p = space_end_at(src, end, p);
        c = byte(src, end, p);
        if c == b',' || c == b'=' {
            return false;
        }
        if c == b'<' {
            return true;
        }
        if p + 7 <= end && &src[p..p + 7] == b"extends" && !name_cont(byte(src, end, p + 7)) {
            let c = byte(src, end, space_end_at(src, end, p + 7));
            if !(c == b'=' || c == b'>' || c == b'/') {
                return false;
            }
        }
    } else {
        p = space_end_at(src, end, p);
    }
    if p >= end {
        return true;
    }
    let c = at(src, p);
    matches!(c, b'>' | b'/' | b'{' | b'"' | b'\'') || name_start(c)
}

/// The directive word `[lhs, rhs)` after a TSRX `@` as the keyword kind it
/// acts like, or `INVALID` (`$tsrxDirectiveKind`): `if`, `for`, `switch`,
/// `try`, `case`, `default`, `catch`, and `else` keep their own kind;
/// `empty` and `pending` act like `else`.
#[inline(always)]
pub(super) fn directive_kind(src: &[u8], lhs: usize, rhs: usize) -> u8 {
    if let Some(
        k @ (lex::KEYWORD_IF
        | lex::KEYWORD_FOR
        | lex::KEYWORD_TRY
        | lex::KEYWORD_ELSE
        | lex::KEYWORD_CASE
        | lex::KEYWORD_CATCH
        | lex::KEYWORD_SWITCH
        | lex::KEYWORD_DEFAULT),
    ) = keyword(src, lhs, rhs)
    {
        return k;
    }
    let w = &src[lhs..rhs];
    if w == b"empty" || w == b"pending" {
        return lex::KEYWORD_ELSE;
    }
    lex::INVALID
}

/// Whether the identifier bytes at `p`, right after an `@` in TSRX text,
/// spell a directive word (`$tsrxDirectiveAt`).
fn directive_at(src: &[u8], end: usize, p: usize) -> bool {
    let mut e = p;
    while e < end && ident_byte(src[e]) {
        e += 1;
    }
    directive_kind(src, p, e) != lex::INVALID
}

/// The kind of a TSRX word the keyword table does not hold
/// (`$tsrxWordKind`): `fragment` before a name, `(`, or `<` reads like
/// `function`; `module` before a name reads like `namespace`; anything
/// else is an identifier.
#[cold]
#[inline(never)]
pub(super) fn word_kind(src: &[u8], end: usize, lhs: usize, rhs: usize) -> u8 {
    let w = &src[lhs..rhs];
    let fragment = w == b"fragment";
    if !fragment && w != b"module" {
        return lex::IDENTIFIER;
    }
    let c = byte(src, end, space_end_at(src, end, rhs));
    if fragment {
        if name_start(c) || c == b'(' || c == b'<' {
            return lex::KEYWORD_FUNCTION;
        }
        return lex::IDENTIFIER;
    }
    if name_start(c) {
        return lex::CTXWORD_NAMESPACE;
    }
    lex::IDENTIFIER
}

/// Whether the tag name `[lhs, rhs)` opens a TSRX raw-text element: 1
/// `script`, 2 `style`, 0 other (`$tsrxRawKind`).
#[inline(always)]
fn raw_kind(src: &[u8], lhs: usize, rhs: usize) -> u8 {
    match &src[lhs..rhs] {
        b"script" => 1,
        b"style" => 2,
        _ => 0,
    }
}

/// Whether `p` is the `<` of `</script` (`kind` 1) or `</style` (2), with
/// the name ending at whitespace, `>`, `/`, or the input end
/// (`$tsrxRawClose`).
#[inline(never)]
pub(super) fn raw_close(src: &[u8], end: usize, p: usize, kind: u8) -> bool {
    let n = if kind == 1 { 8 } else { 7 };
    if p + n > end || &src[p..p + 2] != b"</" || raw_kind(src, p + 2, p + n) != kind {
        return false;
    }
    if p + n >= end {
        return true;
    }
    let c = src[p + n];
    matches!(c, b'>' | b'/' | b' ') || c.wrapping_sub(9) <= 4
}

/// The next byte at or after `p` that ends a TSRX text run - `<`, `{`,
/// `&`, `@`, `/`, or LF - or `end` (`$tsrxContentFind`).
#[inline(always)]
fn content_find(src: &[u8], mut p: usize, end: usize) -> usize {
    while p < end {
        #[cfg(target_arch = "aarch64")]
        // SAFETY: `p < end`, and the slack covers 16 bytes past `end`.
        let k = unsafe {
            let w = vld1q_u8(src.as_ptr().add(p));
            let eq = |b: u8| vceqq_u8(w, vdupq_n_u8(b));
            scan::first_lane(vorrq_u8(
                vorrq_u8(vorrq_u8(eq(b'<'), eq(b'{')), vorrq_u8(eq(b'&'), eq(b'@'))),
                vorrq_u8(eq(b'/'), eq(b'\n')),
            ))
        };
        #[cfg(not(target_arch = "aarch64"))]
        let k = (0..16)
            .find(|&i| matches!(src[p + i], b'<' | b'{' | b'&' | b'@' | b'/' | b'\n'))
            .unwrap_or(16);
        if k < 16 {
            p += k;
            break;
        }
        p += 16;
    }
    p.min(end)
}

/// The seven bytes at `p` as a little-endian word (`$tsrxWord` for seven
/// bytes).
#[inline(always)]
fn word7(src: &[u8], p: usize) -> u64 {
    // SAFETY: the input slack covers an eight-byte read at any position up
    // to the input end.
    u64::from_le(unsafe { src.as_ptr().add(p).cast::<u64>().read_unaligned() })
        & 0x00ff_ffff_ffff_ffff
}

/// Whether only blanks lie between `bound` and `p`, or since the last line
/// break before `p`: where a `//` starts a comment in TSRX text
/// (`$tsrxAtBoundary`).
fn at_boundary(src: &[u8], bound: usize, mut p: usize) -> bool {
    while p > bound {
        let c = src[p - 1];
        if c == b'\n' || c == b'\r' {
            return true;
        }
        if !(c == b' ' || c == b'\t') {
            return false;
        }
        p -= 1;
    }
    true
}

/// `finally` after the blanks at `p`, followed by blanks and `{`: the bare
/// clause head of a TSRX template `@try`. Its position, if so
/// (`$tsrxFinallyAhead`).
#[inline(always)]
fn finally_ahead(src: &[u8], end: usize, p: usize) -> Option<usize> {
    // Indentation eight bytes at a time, then the rest of the blanks.
    let p = space_end_at(src, end, run_end(src, p, 0x2020_2020_2020_2020));
    if at(src, p) != b'f' || p + 7 > end || word7(src, p) != u64::from_le_bytes(*b"finally\0") {
        return None;
    }
    let q = p + 7;
    if ident_byte(byte(src, end, q)) {
        return None;
    }
    (byte(src, end, space_end_at(src, end, q)) == b'{').then_some(p)
}

/// The markup steps' state: the token loop's rare state, the records, and
/// the scan position (`$ptr`).
struct Markup<'c, 'a, 'i, const TS: bool, const TSRX: bool> {
    cold: &'c mut Cold<'a>,
    inst: &'i mut Instance,
    src: &'a [u8],
    end: usize,
    ptr: usize,
    recs: Recs,
    /// The top mode, kept in step with the stack.
    m: u8,
}

impl<'c, 'a, 'i, const TS: bool, const TSRX: bool> Markup<'c, 'a, 'i, TS, TSRX> {
    /// Push a mode (`$jsxPush`).
    #[inline(always)]
    fn push(&mut self, mode: u8, target: i32) {
        let j = &mut self.cold.jsx;
        // Past the capacity the top stays the last stored entry.
        let stored = (j.sp as usize) < STACK;
        j.push(mode, target);
        self.m = if stored { mode } else { j.top_mode() };
    }

    /// Change the top mode (`$jsxSetTopMode`).
    #[inline(always)]
    fn set_mode(&mut self, mode: u8) {
        if self.cold.jsx.sp != 0 {
            self.cold.jsx.set_top_mode(mode);
            self.m = mode;
        }
    }

    /// `$jsxEmit`: a token, if not empty.
    #[inline(always)]
    fn emit(&mut self, hl: u32, lhs: usize, rhs: usize) {
        if lhs < rhs {
            self.recs.tok(hl, rhs);
        }
    }

    /// Pop one element or container (`$jsxPop`). Whatever completed is an
    /// ended expression, so what follows sees an identifier. In TSRX an
    /// element in statement position also ends its statement, and a
    /// directive whose body was that bare element ends with it.
    #[inline(always)]
    fn pop(&mut self) {
        let c = &mut *self.cold;
        if c.jsx.sp != 0 {
            c.jsx.sp -= 1;
        }
        c.prev = lex::IDENTIFIER;
        c.lto = lex::IDENTIFIER;
        if TSRX {
            c.prev = lex::EOF;
            if c.jsx.top_mode() == 4 && c.brace_depth == c.jsx.top_target() {
                c.jsx.sp -= 1;
            }
        }
        self.m = self.cold.jsx.top_mode();
    }

    /// Scan and emit the tag name at the scan position (`$jsxEmitName`):
    /// lowercase simple names are tags, capitalized or dotted names are
    /// components, and an empty name (a fragment) emits nothing. Returns
    /// the TSRX raw-text kind of the name, else 0.
    #[inline(always)]
    fn emit_name(&mut self) -> u8 {
        let (src, end) = (self.src, self.end);
        let from = self.ptr;
        let mut dotted = false;
        let mut p = from;
        while p < end && name_cont(at(src, p)) {
            dotted |= at(src, p) == b'.';
            p += 1;
        }
        self.ptr = p;
        let mut kind = 0;
        if p > from {
            let hl = if dotted || at(src, from).is_ascii_uppercase() {
                tok::TAG_COMPONENT_JSX
            } else {
                tok::TAG_JSX
            };
            self.emit(hl, from, p);
            if TSRX {
                kind = raw_kind(src, from, p);
            }
        }
        kind
    }

    /// Open the expression container whose `{` (or TSRX `@{`) is at the
    /// scan position (`$jsxOpenContainer`): the brace goes through the
    /// scanner's bracket bookkeeping, and tokens run until the brace depth
    /// returns to the recorded target.
    #[inline(always)]
    fn open_container(&mut self) {
        let lhs = self.ptr;
        let two = TSRX && at(self.src, lhs) == b'@';
        let c = &mut *self.cold;
        if two {
            c.brk_push(1);
        } else {
            // `$braceIsBlock`, with no line break before the brace.
            let block = !c.rx_allowed_after(c.lto, false)
                || FLAGS[c.lto as usize] & kf::BRACE_BLOCK_PREV != 0;
            c.brk_push(block as u8);
        }
        c.brace_depth += 1;
        c.lto = lex::L_BRACE;
        let target = c.brace_depth - 1;
        c.prev = lex::L_BRACE;
        self.push(3, target);
        if two {
            // `$tsrxEmitContainerOpen`: the `@` keeps the directive color.
            self.emit(tok::KEYWORD_CONTROL, lhs, lhs + 1);
            self.emit(tok::PUNCTUATION_BRACKET, lhs + 1, lhs + 2);
            self.ptr = lhs + 2;
        } else {
            self.emit(tok::PUNCTUATION_BRACKET, lhs, lhs + 1);
            self.ptr = lhs + 1;
            self.container_ident();
        }
    }

    /// A container that holds just a name, `{name}`, right after its `{`:
    /// what the token loop would do for the name and the closing `}`,
    /// without leaving the markup steps. Does nothing, and leaves the
    /// container to the token loop, for anything else (spaces, a keyword,
    /// a Unicode name, an open parameter list, or a `}` that the bracket
    /// bookkeeping would read differently).
    #[inline(always)]
    fn container_ident(&mut self) {
        let src = self.src;
        let lhs = self.ptr;
        if !name_start(at(src, lhs)) {
            return;
        }
        let rhs = ident_end(src, lhs + 1);
        let c = &mut *self.cold;
        if at(src, rhs) != b'}'
            || c.busy()
            || keyword(src, lhs, rhs).is_some()
            || (TSRX && word_kind(src, self.end, lhs, rhs) != lex::IDENTIFIER)
            || (c.tpl_sp > 0 && c.brace_depth == c.tpl[c.tpl_sp - 1])
            || self.m != 3
            || c.brace_depth - 1 > c.jsx.top_target()
        {
            return;
        }
        // The name waits for the `}`, which the scanner pops.
        c.lto = lex::IDENTIFIER;
        c.brk_pop();
        c.brace_depth -= 1;
        c.lto = lex::R_BRACE;
        // Color the name as `identifier!` does after `{` and before `}`,
        // where only the word rules apply, and set the template marker
        // after it.
        let next = Next {
            t: lex::R_BRACE,
            lhs: rhs,
            rhs: rhs + 1,
            nl: false,
        };
        let metadata = metadata_marker(src, lex::IDENTIFIER, lhs, rhs);
        let hl = if PLAIN_START[at(src, lhs) as usize] {
            tok::VARIABLE
        } else {
            ident_word(c, lex::L_BRACE, next, lhs, rhs)
        };
        c.marker = if metadata != 0 {
            metadata
        } else if (rhs - lhs).wrapping_sub(3) <= 1 {
            tag_marker(src, lex::IDENTIFIER, lhs, rhs)
        } else {
            0
        };
        c.prev = lex::IDENTIFIER;
        self.emit(hl, lhs, rhs);
        // The `}` closes the container.
        self.emit(tok::PUNCTUATION_BRACKET, rhs, rhs + 1);
        self.ptr = rhs + 1;
        self.pop();
    }

    /// Whitespace and one attribute or tag end (`$jsxTagStep`). Type
    /// arguments (`<Select<Option> …>`) count their depth in the entry's
    /// target in steps of 256, above the TSRX raw-text kind; names inside
    /// them are types.
    #[inline(always)]
    fn tag_step(&mut self) {
        let (src, end) = (self.src, self.end);
        let from = self.ptr;
        self.ptr = space_skip(src, end, from);
        self.recs.gap(from, self.ptr);
        if self.ptr >= end {
            return;
        }
        let mut from = self.ptr;
        let mut c = at(src, from);
        // An attribute name, or a type name inside type arguments. Its `=`
        // and value usually follow at once; each is still the step it would
        // be on its own.
        if name_start(c) {
            let mut p = from + 1;
            while p < end && name_cont(at(src, p)) {
                p += 1;
            }
            self.ptr = p;
            let hl = if self.cold.jsx.top_target() as u32 >= 256 {
                tok::TYPE
            } else {
                tok::ATTRIBUTE_JSX
            };
            self.emit(hl, from, p);
            if p >= end || at(src, p) != b'=' {
                return;
            }
            from = p;
            c = b'=';
        }
        // `=` between an attribute name and its value; the `=>` of a
        // function type inside type arguments does not close the list.
        if c == b'=' {
            self.ptr = from + 1;
            if byte(src, end, self.ptr) == b'>' && self.cold.jsx.top_target() as u32 >= 256 {
                self.ptr += 1;
                self.emit(tok::OPERATOR, from, self.ptr);
                return;
            }
            self.emit(tok::PUNCTUATION_DELIMITER_JSX, from, self.ptr);
            from = self.ptr;
            if from >= end {
                return;
            }
            c = at(src, from);
            if !matches!(c, b'"' | b'\'' | b'{') {
                return;
            }
        }
        match c {
            // `>` closes an open type-argument list, else the tag opens and
            // children follow. A TSRX raw-text element takes the style body
            // mode with a fresh CSS state, or the script body mode with the
            // tokens at a statement start.
            b'>' => {
                self.ptr = from + 1;
                let q = self.cold.jsx.top_target();
                if q as u32 >= 256 {
                    self.emit(tok::PUNCTUATION_BRACKET, from, self.ptr);
                    self.cold.jsx.set_top_target(q - 256);
                    return;
                }
                self.emit(tok::PUNCTUATION_BRACKET_JSX, from, self.ptr);
                self.set_mode(2);
                if q == 2 {
                    self.set_mode(6);
                    self.cold.jsx.set_top_target(260);
                }
                if q == 1 {
                    self.set_mode(5);
                    self.cold.jsx.set_top_target(0);
                    self.cold.prev = lex::EOF;
                    self.cold.lto = lex::EOF;
                }
                return;
            }
            // TS: `<` opens a type-argument list.
            b'<' if TS => {
                self.ptr = from + 1;
                self.emit(tok::PUNCTUATION_BRACKET, from, self.ptr);
                let q = self.cold.jsx.top_target();
                self.cold.jsx.set_top_target(q + 256);
                return;
            }
            b'/' => {
                let q = byte(src, end, from + 1);
                // `/>`: self-closing.
                if q == b'>' {
                    self.ptr = from + 2;
                    self.emit(tok::PUNCTUATION_BRACKET_JSX, from, self.ptr);
                    self.pop();
                    return;
                }
                // `// …` between attributes runs to the line end.
                if q == b'/' {
                    self.ptr = scan::line_end(src, from, end);
                    self.emit(tok::COMMENT, from, self.ptr);
                    return;
                }
                if q == b'*' {
                    self.ptr = scan::block_comment_end(src, from + 2, end);
                    self.emit(tok::COMMENT, from, self.ptr);
                    return;
                }
            }
            // `{`: a spread attribute or an expression value.
            b'{' => {
                self.open_container();
                return;
            }
            // A quoted value, which may span lines and has no escapes.
            b'"' | b'\'' => {
                let p = scan::find3(src, from + 1, end, c, c, c);
                self.ptr = if p < end { p + 1 } else { p };
                self.emit(tok::STRING, from, self.ptr);
                return;
            }
            _ => {}
        }
        // Anything else: one lenient plain byte; a `,` between type
        // arguments is a delimiter.
        self.ptr = from + 1;
        let hl = if c == b',' && self.cold.jsx.top_target() as u32 >= 256 {
            tok::PUNCTUATION_DELIMITER
        } else {
            tok::NONE
        };
        self.emit(hl, from, self.ptr);
    }

    /// The lenient tail of a close tag after its name: whitespace, then
    /// `>`; stray bytes stay plain and a `<` stops early. Returns whether
    /// the tag ended before the input end (`$jsxCloseTagTail`).
    #[inline(always)]
    fn close_tag_tail(&mut self) -> bool {
        let (src, end) = (self.src, self.end);
        loop {
            let seg = self.ptr;
            self.ptr = space_end_at(src, end, seg);
            self.recs.gap(seg, self.ptr);
            if self.ptr >= end {
                return false;
            }
            let seg = self.ptr;
            let c = at(src, seg);
            if c == b'>' {
                self.ptr = seg + 1;
                self.emit(tok::PUNCTUATION_BRACKET_JSX, seg, self.ptr);
                return true;
            }
            if c == b'<' {
                return true;
            }
            self.ptr = seg + 1;
            self.emit(tok::NONE, seg, self.ptr);
        }
    }

    /// One step of a TSRX dynamic close tag `</{expr}>` after its container
    /// closed: the tail, then the element pops (`$jsxCloseTailStep`).
    #[inline(always)]
    fn close_tail_step(&mut self) {
        if self.close_tag_tail() {
            self.pop();
        }
    }

    /// One step between `>` and the closing tag: a text run, then one item:
    /// a child tag, a close tag, a `{…}` container, or a stray byte
    /// (`$jsxContentStep`). `&entity;` is a special string. TSRX text also
    /// stops at `@{` containers, `@if`-style directive heads, a bare
    /// `finally {` clause head, and comments: `/* */` anywhere, `//` where
    /// only blanks precede it since the run start or the line start.
    #[inline(always)]
    fn content_step(&mut self) {
        let (src, end) = (self.src, self.end);
        let mut seg = self.ptr;
        let mut bound = self.ptr;
        // TSRX: `finally {` as the first word of the run heads a try
        // clause; the blanks before it are text.
        if TSRX && let Some(p) = finally_ahead(src, end, self.ptr) {
            self.emit(tok::TEXT_JSX, self.ptr, p);
            self.ptr = p;
            let depth = self.cold.brace_depth;
            self.push(4, depth);
            return;
        }
        // The text run up to `<` or `{`.
        let mut act = 0;
        let mut c = 0;
        loop {
            self.ptr = if TSRX {
                content_find(src, self.ptr, end)
            } else {
                scan::find3(src, self.ptr, end, b'<', b'{', b'&')
            };
            if self.ptr >= end {
                break;
            }
            c = at(src, self.ptr);
            if c == b'<' || c == b'{' {
                break;
            }
            if c == b'&' {
                let mut p = self.ptr + 1;
                while p < end && (at(src, p).is_ascii_alphanumeric() || at(src, p) == b'#') {
                    p += 1;
                }
                if p > self.ptr + 1 && p < end && at(src, p) == b';' {
                    self.emit(tok::TEXT_JSX, seg, self.ptr);
                    self.emit(tok::STRING_SPECIAL, self.ptr, p + 1);
                    self.ptr = p + 1;
                    seg = self.ptr;
                } else {
                    // A bare `&` is text.
                    self.ptr += 1;
                }
                continue;
            }
            // TSRX text specials: LF, `@`, `/`; JSX text runs stop only
            // at `<`, `{`, and `&`.
            if TSRX {
                if c == b'\n' {
                    // `finally {` after a line's indentation heads a try clause.
                    if let Some(p) = finally_ahead(src, end, self.ptr + 1) {
                        self.ptr = p;
                        act = 2;
                        break;
                    }
                    self.ptr += 1;
                    continue;
                }
                if c == b'@' {
                    if byte(src, end, self.ptr + 1) == b'{' {
                        act = 1;
                        break;
                    }
                    if directive_at(src, end, self.ptr + 1) {
                        act = 2;
                        break;
                    }
                    self.ptr += 1;
                    continue;
                }
                // `/`: a block comment anywhere, a line comment at a boundary.
                let c2 = byte(src, end, self.ptr + 1);
                if c2 == b'*' {
                    self.emit(tok::TEXT_JSX, seg, self.ptr);
                    seg = self.ptr;
                    self.ptr = scan::block_comment_end(src, self.ptr + 2, end);
                    self.emit(tok::COMMENT, seg, self.ptr);
                    seg = self.ptr;
                    bound = self.ptr;
                    continue;
                }
                if c2 == b'/' && at_boundary(src, bound, self.ptr) {
                    self.emit(tok::TEXT_JSX, seg, self.ptr);
                    seg = self.ptr;
                    self.ptr = scan::line_end(src, self.ptr, end);
                    self.emit(tok::COMMENT, seg, self.ptr);
                    seg = self.ptr;
                    bound = self.ptr;
                    continue;
                }
            }
            self.ptr += 1;
        }
        self.emit(tok::TEXT_JSX, seg, self.ptr);
        if self.ptr >= end {
            return;
        }
        // TSRX: an `@{` container, or a directive head the tokens scan.
        if act == 1 {
            self.open_container();
            return;
        }
        if act == 2 {
            let depth = self.cold.brace_depth;
            self.push(4, depth);
            return;
        }
        if c == b'{' {
            self.open_container();
            return;
        }
        // `<…`
        let seg = self.ptr;
        let c2 = byte(src, end, seg + 1);
        // `</name >` closes this element.
        if c2 == b'/' {
            self.ptr = seg + 2;
            self.emit(tok::PUNCTUATION_BRACKET_JSX, seg, self.ptr);
            self.emit_name();
            // TSRX dynamic close tag `</{expr}>`: the tail waits for its
            // container.
            if TSRX && byte(src, end, self.ptr) == b'{' {
                self.set_mode(7);
                self.open_container();
                return;
            }
            self.close_tag_tail();
            self.pop();
            return;
        }
        // `<name` or `<>` opens a child; TSRX also `<{expr}`.
        if name_start(c2) || c2 == b'>' || (TSRX && c2 == b'{') {
            self.ptr = seg + 1;
            self.emit(tok::PUNCTUATION_BRACKET_JSX, seg, self.ptr);
            let kind = self.emit_name();
            self.push(1, kind as i32);
            return;
        }
        // A stray `<` is text.
        self.ptr = seg + 1;
        self.emit(tok::TEXT_JSX, seg, self.ptr);
    }

    /// One step inside a TSRX `<style>` body: CSS up to `</style`, then the
    /// close tag (`$tsrxStyleStep`). The CSS lexer's resumable state lives
    /// in the entry's target.
    #[inline(always)]
    fn style_step(&mut self) {
        let (src, end) = (self.src, self.end);
        let from = self.ptr;
        let mut p = from;
        let mut found = false;
        loop {
            // `$lexFindByte`.
            p = scan::find3(src, p, end, b'<', b'<', b'<');
            if p >= end {
                break;
            }
            if raw_close(src, end, p, 2) {
                found = true;
                break;
            }
            p += 1;
        }
        if p > from {
            let state = self.cold.jsx.top_target();
            self.recs.store(self.inst);
            let state = css_body(self.inst, self.cold.base, from, p, state);
            self.recs = Recs::load(self.inst);
            self.cold.jsx.set_top_target(state);
        }
        self.ptr = p;
        if !found {
            return;
        }
        self.ptr = p + 2;
        self.emit(tok::PUNCTUATION_BRACKET_JSX, p, self.ptr);
        self.emit_name();
        self.close_tag_tail();
        self.pop();
    }

    /// Run markup steps from mode `m` until the stack leaves the byte
    /// modes or the input ends (`$jsxRunBytes`).
    #[inline(always)]
    fn run_bytes(&mut self, mut m: u8) {
        loop {
            match m {
                1 => self.tag_step(),
                2 => self.content_step(),
                6 if TSRX => self.style_step(),
                _ => self.close_tail_step(),
            }
            m = self.m;
            if !(byte_mode(m) && self.ptr < self.end) {
                break;
            }
        }
    }
}

/// Lex the CSS of a TSRX `<style>` body `[from, to)` with the translated
/// `$hlCssImpl`, from its resumable `state`; returns the state after it.
#[cold]
#[inline(never)]
fn css_body(inst: &mut Instance, base: usize, from: usize, to: usize, state: i32) -> i32 {
    let saved = (inst.g_ptr, inst.g_end, inst.g_streaming, inst.g_cssDialect);
    inst.g_ptr = (base + from) as i32;
    inst.g_end = (base + to) as i32;
    inst.g_streaming = 0;
    inst.g_cssDialect = 0;
    let mem = inst.mem.bytes().as_ptr();
    let state = inst.f_hlCssImpl(state);
    assert!(
        core::ptr::eq(inst.mem.bytes().as_ptr(), mem),
        "lexer memory moved"
    );
    (inst.g_ptr, inst.g_end, inst.g_streaming, inst.g_cssDialect) = saved;
    state
}

/// What hands over to the markup steps.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Entry {
    /// A `<` that `$jsxValidate` accepted opens an element.
    Open,
    /// A `}` closes an expression container or a TSRX directive block.
    Close,
    /// A `</script` ends a TSRX script body.
    Script,
}

/// Hand over from the token loop at `lhs..rhs` and run the markup steps
/// while the top mode scans bytes (the mode check at the top of
/// `$hlEcmaImpl`'s loop). Returns the scan position.
#[inline(never)]
fn run<const TS: bool, const TSRX: bool>(
    cold: &mut Cold,
    inst: &mut Instance,
    entry: Entry,
    lhs: usize,
    rhs: usize,
) -> usize {
    let (src, end) = (cold.src, cold.end);
    let recs = Recs::load(inst);
    let mut m = Markup::<TS, TSRX> {
        cold,
        inst,
        src,
        end,
        ptr: rhs,
        recs,
        m: 0,
    };
    match entry {
        Entry::Open => {
            m.emit(tok::PUNCTUATION_BRACKET_JSX, lhs, rhs);
            let kind = m.emit_name();
            m.push(1, kind as i32);
        }
        Entry::Close => {
            m.emit(tok::PUNCTUATION_BRACKET, lhs, rhs);
            m.pop();
        }
        Entry::Script => {
            m.emit(tok::PUNCTUATION_BRACKET_JSX, lhs, rhs);
            m.emit_name();
            m.close_tag_tail();
            m.pop();
        }
    }
    let mode = m.m;
    if byte_mode(mode) && m.ptr < m.end {
        m.run_bytes(mode);
    }
    m.recs.store(m.inst);
    m.ptr
}

/// Open the element whose `<` is at `lhs`, which `$jsxValidate` accepted,
/// and run the markup steps. Returns the scan position.
#[inline(always)]
pub(super) fn open_element<const TS: bool, const TSRX: bool>(
    cold: &mut Cold,
    inst: &mut Instance,
    lhs: usize,
) -> usize {
    run::<TS, TSRX>(cold, inst, Entry::Open, lhs, lhs + 1)
}

/// Close the expression container (or TSRX directive block) whose `}` is
/// `lhs..rhs`, and run the markup steps. Returns the scan position.
#[inline(always)]
pub(super) fn close_container<const TS: bool, const TSRX: bool>(
    cold: &mut Cold,
    inst: &mut Instance,
    lhs: usize,
    rhs: usize,
) -> usize {
    run::<TS, TSRX>(cold, inst, Entry::Close, lhs, rhs)
}

/// End a TSRX `<script>` body at the `</script` at `lhs`: the close tag,
/// then the markup steps. Returns the scan position.
#[inline(always)]
pub(super) fn close_script<const TS: bool, const TSRX: bool>(
    cold: &mut Cold,
    inst: &mut Instance,
    lhs: usize,
) -> usize {
    run::<TS, TSRX>(cold, inst, Entry::Script, lhs, lhs + 2)
}
