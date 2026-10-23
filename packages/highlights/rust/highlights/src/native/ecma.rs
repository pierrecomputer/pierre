//! Native JavaScript and TypeScript highlighter: the `js`/`ts` pipeline of
//! `src/langs/tsx.wat` with `ts.wat`'s classification, over the native
//! scanner. JSX and TSRX are not handled; those languages use the
//! translated lexer.
//!
//! Per-token work is native. Tokens with several spans - strings with
//! escapes, templates (which may embed HTML or CSS), and JSDoc comments -
//! call the translated WAT emitters, which append to the same records.

use super::ecma_scan::{KIND, kf};
use crate::generated::Instance;
use crate::lex_ids as lex;
use crate::token_ids as tok;

pub(super) const MULTI: u8 = 253;
/// [`Ts::ident_hl_context`]'s answer for a parameter that marks its list.
pub(super) const MARK_PARAMETER: u32 = u32::MAX;
pub(super) const COLON_OR_QUESTION: u8 = 254;
pub(super) const IDENT: u8 = 255;

/// `$LexHl`: the token for each `$Lex` kind, or a sentinel for kinds the
/// pipeline (`MULTI`), the colon rule, or the identifier rules decide.
pub(super) static LEX_HL: [u8; 256] = LEX_HL_TABLE;

/// [`LEX_HL`] as a constant, for tables built from it.
pub(super) const LEX_HL_TABLE: [u8; 256] = {
    use lex::*;
    let mut t = [tok::OPERATOR as u8; 256];
    macro_rules! map {
        ($v:expr; $($k:expr),* $(,)?) => {{ $( t[$k as usize] = $v; )* }};
    }
    map!(MULTI; EOF, INVALID, COMMENT, MULTILINE_COMMENT, HASH_BANG, STRING_LITERAL, BACKTICK, DOLLAR_BRACE);
    map!(COLON_OR_QUESTION; COLON, QUESTION_MARK);
    map!(IDENT; IDENTIFIER, CTXWORD_AS, CTXWORD_ASYNC, CTXWORD_AWAIT, CTXWORD_FROM, CTXWORD_GET,
        CTXWORD_OF, CTXWORD_SET, CTXWORD_ABSTRACT, CTXWORD_DECLARE, CTXWORD_INFER, CTXWORD_IS,
        CTXWORD_KEYOF, CTXWORD_NAMESPACE, CTXWORD_OVERRIDE, CTXWORD_READONLY, CTXWORD_SATISFIES,
        CTXWORD_TYPE);
    map!(tok::PUNCTUATION_BRACKET as u8; L_PAREN, R_PAREN, L_BRACKET, R_BRACKET, L_BRACE, R_BRACE);
    map!(tok::PUNCTUATION_DELIMITER as u8; COMMA, SEMICOLON, DOT, QUESTION_MARK_DOT);
    map!(tok::NUMBER as u8; NUMBER_LITERAL, BIGINT_LITERAL);
    map!(tok::STRING_REGEX as u8; REGEXP_LITERAL);
    map!(tok::ATTRIBUTE as u8; AT_IDENTIFIER);
    map!(tok::PROPERTY as u8; HASH_IDENTIFIER);
    map!(tok::KEYWORD_CONTROL as u8; KEYWORD_IF, KEYWORD_ELSE, KEYWORD_SWITCH, KEYWORD_CASE,
        KEYWORD_DEFAULT, KEYWORD_FOR, KEYWORD_WHILE, KEYWORD_DO, KEYWORD_RETURN, KEYWORD_TRY,
        KEYWORD_CATCH, KEYWORD_FINALLY, KEYWORD_THROW, KEYWORD_BREAK, KEYWORD_CONTINUE, KEYWORD_YIELD);
    map!(tok::KEYWORD_DECLARATION as u8; KEYWORD_CONST, KEYWORD_LET, KEYWORD_VAR, KEYWORD_FUNCTION,
        KEYWORD_CLASS, KEYWORD_ENUM, KEYWORD_INTERFACE);
    map!(tok::KEYWORD_IMPORT as u8; KEYWORD_IMPORT, KEYWORD_EXPORT);
    map!(tok::BOOLEAN as u8; KEYWORD_TRUE, KEYWORD_FALSE);
    map!(tok::CONSTANT_BUILTIN as u8; KEYWORD_NULL);
    map!(tok::VARIABLE_SPECIAL as u8; KEYWORD_THIS, KEYWORD_SUPER);
    map!(tok::KEYWORD as u8; KEYWORD_DEBUGGER, KEYWORD_DELETE, KEYWORD_EXTENDS, KEYWORD_IN,
        KEYWORD_INSTANCEOF, KEYWORD_NEW, KEYWORD_TYPEOF, KEYWORD_VOID, KEYWORD_WITH,
        KEYWORD_IMPLEMENTS, KEYWORD_PACKAGE, KEYWORD_PRIVATE, KEYWORD_PROTECTED, KEYWORD_PUBLIC,
        KEYWORD_STATIC);
    t
};

/// Whether kind `k` has [`kf`] flag `bit`.
#[inline(always)]
pub(super) fn is(k: u8, bit: u32) -> bool {
    KIND[k as usize] & bit != 0
}

/// An identifier, keyword, or contextual word.
#[inline(always)]
fn is_identish(t: u8) -> bool {
    is(t, kf::IDENTISH)
}

#[inline(always)]
fn is_name_start(c: u8) -> bool {
    c.is_ascii_alphabetic() || c == b'_' || c == b'$'
}

/// The parameter-list machine of `sig.wat` and `$sigStep`.
#[derive(Clone, Copy, Default)]
pub(super) struct Sig {
    pub parens: u32,
    pub mask: u32,
    pub obscure: u32,
    pub pattern: bool,
    pub angle: u32,
    pub fn_pend: bool,
    pub fn_angle: u32,
}

impl Sig {
    #[inline(always)]
    pub(super) fn active(&self) -> bool {
        self.parens < 32 && self.mask >> self.parens & 1 != 0
    }
    pub(super) fn mark(&mut self) {
        if self.parens < 32 {
            self.mask |= 1 << self.parens;
        }
        self.obscure = 0;
        self.pattern = false;
        self.angle = 0;
    }
    fn unmark(&mut self) {
        if self.parens < 32 {
            self.mask &= !(1 << self.parens);
        }
        self.obscure = 0;
        self.pattern = false;
        self.angle = 0;
    }
    fn angle_drop(&mut self, n: u32) {
        self.angle = self.angle.saturating_sub(n);
    }
    fn fn_angle_drop(&mut self, n: u32) {
        self.fn_angle = self.fn_angle.saturating_sub(n);
    }
}

/// Stands in for the next token where a kind's color does not depend on it.
pub(super) const NO_NEXT: Next = Next {
    t: lex::EOF,
    lhs: 0,
    rhs: 0,
    nl: false,
};

/// The token after the current one: its kind and range, and whether a line
/// break precedes it.
#[derive(Clone, Copy)]
pub(super) struct Next {
    pub t: u8,
    pub lhs: usize,
    pub rhs: usize,
    pub nl: bool,
}

/// Classifier state. Out-of-line helpers take a copy and return what
/// changed, so the hot loop keeps this in registers.
#[derive(Clone, Copy)]
pub(super) struct Ts<'a> {
    pub src: &'a [u8],
    pub end: usize,
    /// TypeScript syntax and rules (`$ecmaHasTypeScript`).
    pub ts: bool,
    pub sig: Sig,
    pub ecma_import: bool,
    pub prev_tok: u8,
}

impl<'a> Ts<'a> {
    #[inline(always)]
    fn byte(&self, p: usize) -> u8 {
        if p < self.end { self.src[p] } else { 0 }
    }

    #[inline(always)]
    fn word_eq(&self, lhs: usize, rhs: usize, w: &[u8]) -> bool {
        rhs - lhs == w.len() && &self.src[lhs..rhs] == w
    }

    /// `$sigStep`. With no parameter list open and no function head
    /// pending, only the paren depth and the tokens that start a function
    /// head matter.
    #[inline(always)]
    pub(super) fn sig_step(&mut self, prev: u8, t: u8, next: u8, lhs: usize, rhs: usize) {
        let s = &mut self.sig;
        if s.fn_pend || s.mask != 0 {
            return self.sig_step_busy(prev, t, next, lhs, rhs);
        }
        match t {
            lex::L_PAREN => s.parens += 1,
            lex::R_PAREN => s.parens = s.parens.saturating_sub(1),
            lex::KEYWORD_FUNCTION | lex::KEYWORD_CATCH => {
                s.fn_pend = true;
                s.fn_angle = 0;
            }
            lex::IDENTIFIER | lex::CTXWORD_GET | lex::CTXWORD_SET
                if !(prev == lex::DOT || prev == lex::QUESTION_MARK_DOT)
                    && (if t == lex::IDENTIFIER {
                        next == lex::L_PAREN && &self.src[lhs..rhs] == b"constructor"
                    } else {
                        is_identish(next) || next == lex::HASH_IDENTIFIER
                    }) =>
            {
                s.fn_pend = true;
                s.fn_angle = 0;
            }
            _ => {}
        }
    }

    /// `$sigStep` inside a parameter list or a pending function head.
    #[inline(never)]
    fn sig_step_busy(&mut self, prev: u8, t: u8, next: u8, lhs: usize, rhs: usize) {
        self.sig_step_full(prev, t, next, lhs, rhs);
    }

    #[inline(always)]
    pub(super) fn sig_step_full(&mut self, prev: u8, t: u8, next: u8, lhs: usize, rhs: usize) {
        let s = &mut self.sig;
        if t == lex::L_PAREN {
            s.parens += 1;
            if s.fn_angle == 0 {
                if s.fn_pend {
                    s.mark();
                }
                s.fn_pend = false;
            }
            return;
        }
        if t == lex::R_PAREN {
            if s.active() {
                s.unmark();
            }
            s.parens = s.parens.saturating_sub(1);
            return;
        }
        if t == lex::KEYWORD_FUNCTION || t == lex::KEYWORD_CATCH {
            s.fn_pend = true;
            s.fn_angle = 0;
            return;
        }
        if !(prev == lex::DOT || prev == lex::QUESTION_MARK_DOT) {
            if t == lex::IDENTIFIER
                && next == lex::L_PAREN
                && self.word_eq(lhs, rhs, b"constructor")
            {
                let s = &mut self.sig;
                s.fn_pend = true;
                s.fn_angle = 0;
                return;
            }
            if (t == lex::CTXWORD_GET || t == lex::CTXWORD_SET)
                && (is_identish(next) || next == lex::HASH_IDENTIFIER)
            {
                let s = &mut self.sig;
                s.fn_pend = true;
                s.fn_angle = 0;
                return;
            }
        }
        let s = &mut self.sig;
        if s.fn_pend {
            if t == lex::L_ANGLE {
                s.fn_angle += 1;
                return;
            }
            if t == lex::R_ANGLE {
                s.fn_angle_drop(1);
                return;
            }
            if t == lex::R_SHIFT {
                s.fn_angle_drop(2);
                return;
            }
            let keeps = s.fn_angle != 0
                || t == lex::IDENTIFIER
                || t == lex::HASH_IDENTIFIER
                || t == lex::ASTERISK
                || (lex::CTXWORD_AS..=lex::CTXWORD_TYPE).contains(&t);
            if !keeps {
                s.fn_pend = false;
                s.fn_angle = 0;
            }
        }
        if !s.active() {
            return;
        }
        if t == lex::L_BRACE || t == lex::L_BRACKET {
            if s.obscure == 0 {
                s.pattern = prev == lex::L_PAREN || prev == lex::COMMA;
            }
            s.obscure += 1;
            return;
        }
        if t == lex::R_BRACE || t == lex::R_BRACKET {
            s.obscure = s.obscure.saturating_sub(1);
            return;
        }
        if s.obscure != 0 {
            return;
        }
        match t {
            lex::SEMICOLON => s.unmark(),
            lex::L_ANGLE => s.angle += 1,
            lex::R_ANGLE => s.angle_drop(1),
            lex::R_SHIFT => s.angle_drop(2),
            lex::R_UNSIGNED_SHIFT => s.angle_drop(3),
            _ => {}
        }
    }

    /// Eight bytes at `p` (the input slack covers reads past the end).
    #[inline(always)]
    fn word8(&self, p: usize) -> u64 {
        // SAFETY: tokens end inside the input, which the slack extends by
        // more than eight bytes.
        u64::from_le(unsafe { self.src.as_ptr().add(p).cast::<u64>().read_unaligned() })
    }

    #[inline(always)]
    pub(super) fn is_builtin_const(&self, lhs: usize, rhs: usize) -> bool {
        match rhs - lhs {
            9 => self.word8(lhs) == u64::from_le_bytes(*b"undefine") && self.src[lhs + 8] == b'd',
            3 => self.word8(lhs) & 0xff_ffff == u64::from_le_bytes(*b"NaN\0\0\0\0\0"),
            8 => self.word8(lhs) == u64::from_le_bytes(*b"Infinity"),
            _ => false,
        }
    }

    #[inline(always)]
    fn is_predefined_type(&self, lhs: usize, rhs: usize) -> bool {
        matches!(
            &self.src[lhs..rhs],
            b"any"
                | b"never"
                | b"number"
                | b"string"
                | b"symbol"
                | b"object"
                | b"boolean"
                | b"unknown"
        )
    }

    /// The position after the spaces and tabs that end just before `p`.
    fn blanks_before(&self, mut p: usize) -> usize {
        while p > 0 && matches!(self.src[p - 1], b' ' | b'\t') {
            p -= 1;
        }
        p
    }

    fn byte_before(&self, p: usize) -> u8 {
        if p == 0 { 0 } else { self.src[p - 1] }
    }

    fn return_colon_before(&self, lhs: usize) -> bool {
        let p = self.blanks_before(lhs);
        if self.byte_before(p) != b':' {
            return false;
        }
        self.byte_before(self.blanks_before(p - 1)) == b')'
    }

    fn arrow_return_type(&self, prev: u8, lhs: usize) -> bool {
        if !self.ts {
            return false;
        }
        if matches!(prev, lex::CTXWORD_IS | lex::PIPE | lex::AMPERSAND) {
            return true;
        }
        prev == lex::COLON && self.return_colon_before(lhs)
    }

    #[inline(never)]
    pub(super) fn new_member_before(self, lhs: usize) -> bool {
        let mut p = lhs;
        while self.byte_before(p) == b'.' {
            p -= 1;
            loop {
                let c = self.byte_before(p);
                if !(is_name_start(c) || c.is_ascii_digit()) {
                    break;
                }
                p -= 1;
            }
        }
        let p = self.blanks_before(p);
        if p < 3 {
            return false;
        }
        &self.src[p - 3..p] == b"new" && !is_name_start(self.byte_before(p - 3))
    }

    #[inline(never)]
    fn type_slot(self, prev: u8, next: Next, lhs: usize) -> bool {
        if matches!(
            prev,
            lex::CTXWORD_KEYOF
                | lex::CTXWORD_INFER
                | lex::CTXWORD_IS
                | lex::CTXWORD_AS
                | lex::CTXWORD_SATISFIES
        ) {
            return true;
        }
        let next = if next.nl { lex::EOF } else { next.t };
        if prev == lex::KEYWORD_CONST {
            return matches!(next, lex::COMMA | lex::R_ANGLE | lex::KEYWORD_EXTENDS);
        }
        if prev == lex::L_ANGLE || prev == lex::COMMA {
            return matches!(next, lex::R_ANGLE | lex::R_SHIFT | lex::KEYWORD_EXTENDS)
                || (prev == lex::L_ANGLE && matches!(next, lex::COMMA | lex::EQUAL));
        }
        if prev == lex::L_BRACKET {
            return next == lex::KEYWORD_IN;
        }
        if prev == lex::PIPE || prev == lex::AMPERSAND {
            return next == lex::FUNCTION_ARROW;
        }
        if prev == lex::COLON {
            if next == lex::L_ANGLE {
                return true;
            }
            if self.sig.active() && self.sig.obscure == 0 {
                return true;
            }
            return self.return_colon_before(lhs);
        }
        false
    }

    /// `( ident )` followed by `=>` on the bytes after the `)`.
    fn arrow_ahead(&self, after: usize) -> bool {
        let mut p = after;
        let mut c = self.byte(p);
        while c != 0 && c <= 32 {
            p += 1;
            c = self.byte(p);
        }
        c == b'=' && self.byte(p + 1) == b'>'
    }

    fn ctxword_hl(&self, prev: u8, t: u8, next: Next) -> Option<u32> {
        let nl = next.nl;
        let next = next.t;
        if t == lex::CTXWORD_TYPE && nl && !self.ecma_import {
            return None;
        }
        if next == lex::EOF && nl {
            if self.ecma_import
                && t == lex::CTXWORD_FROM
                && matches!(
                    prev,
                    lex::IDENTIFIER
                        | lex::CTXWORD_FROM
                        | lex::CTXWORD_TYPE
                        | lex::R_BRACE
                        | lex::ASTERISK
                )
            {
                return Some(tok::KEYWORD_IMPORT);
            }
            if t == lex::CTXWORD_TYPE
                && self.ts
                && self.ecma_import
                && matches!(
                    prev,
                    lex::KEYWORD_EXPORT | lex::KEYWORD_IMPORT | lex::L_BRACE | lex::COMMA
                )
            {
                return Some(tok::KEYWORD_DECLARATION);
            }
        }
        match t {
            lex::CTXWORD_AWAIT => return Some(tok::KEYWORD_CONTROL),
            lex::CTXWORD_ASYNC if is_identish(next) || next == lex::L_PAREN => {
                return Some(tok::KEYWORD);
            }
            lex::CTXWORD_OF if is(prev, kf::EXPR_END) => return Some(tok::KEYWORD),
            lex::CTXWORD_KEYOF if is_identish(next) || next == lex::L_PAREN => {
                return Some(tok::KEYWORD);
            }
            lex::CTXWORD_FROM if next == lex::STRING_LITERAL => return Some(tok::KEYWORD_IMPORT),
            lex::CTXWORD_AS if is_identish(next) => return Some(tok::KEYWORD),
            _ => {}
        }
        if (lex::CTXWORD_GET..=lex::CTXWORD_TYPE).contains(&t)
            && t != lex::CTXWORD_OF
            && (is_identish(next)
                || (!nl
                    && ((next == lex::HASH_IDENTIFIER
                        && (t == lex::CTXWORD_GET || t == lex::CTXWORD_SET))
                        || (next == lex::L_BRACKET
                            && t == lex::CTXWORD_READONLY
                            && prev != lex::DOT))))
        {
            return Some(if t == lex::CTXWORD_TYPE {
                tok::KEYWORD_DECLARATION
            } else {
                tok::KEYWORD
            });
        }
        None
    }

    fn ctx_ident_hl(&self, prev: u8, next: u8, lhs: usize, rhs: usize) -> Option<u32> {
        let w = &self.src[lhs..rhs];
        if next == lex::L_BRACE {
            return (prev == lex::CTXWORD_DECLARE && w == b"global").then_some(tok::KEYWORD);
        }
        let name = next == lex::IDENTIFIER || (next >= lex::CTXWORD_AS && next != lex::CTXWORD_OF);
        match w.len() {
            5 => return (name && w == b"using").then_some(tok::KEYWORD_DECLARATION),
            8 => {
                return ((name || next == lex::HASH_IDENTIFIER) && w == b"accessor")
                    .then_some(tok::KEYWORD);
            }
            _ if !self.ts => return None,
            6 => {
                if (name || next == lex::STRING_LITERAL) && w == b"module" {
                    return Some(tok::KEYWORD);
                }
                return (name && w == b"unique").then_some(tok::KEYWORD);
            }
            7 if prev == lex::COLON && (name || next == lex::KEYWORD_THIS) && w == b"asserts" => {
                return Some(tok::KEYWORD);
            }
            _ => {}
        }
        None
    }

    #[inline(always)]
    fn is_const_case(&self, lhs: usize, rhs: usize) -> bool {
        let c = self.src[lhs];
        if !(c.is_ascii_uppercase() || c == b'_') {
            return false;
        }
        self.src[lhs..rhs]
            .iter()
            .all(|&c| c.is_ascii_uppercase() || c.is_ascii_digit() || c == b'_')
    }

    /// `$identHl`. An identifier between tokens no context rule tests,
    /// outside a parameter list, depends only on its own bytes.
    #[inline(always)]
    fn ident_hl(&mut self, prev: u8, t: u8, next: Next, lhs: usize, rhs: usize) -> u32 {
        if t == lex::IDENTIFIER {
            if prev == lex::DOT || prev == lex::QUESTION_MARK_DOT {
                return self.member_hl(next, lhs);
            }
            let pf = KIND[prev as usize];
            let nf = KIND[next.t as usize];
            if pf & kf::IDENT_PREV == 0
                && nf & kf::IDENT_NEXT == 0
                && (pf & kf::KEY_PREV == 0 || nf & kf::KEY_NEXT == 0)
                && !self.sig.active()
            {
                return self.ident_by_word(prev, next, lhs, rhs);
            }
        }
        let hl = self.ident_hl_context(prev, t, next, lhs, rhs);
        if hl == MARK_PARAMETER {
            self.sig.mark();
            return tok::VARIABLE_PARAMETER;
        }
        hl
    }

    /// A member after `.` or `?.`: a method when called, except the class
    /// in `new ns.Class()`, and otherwise a property.
    #[inline(always)]
    fn member_hl(&self, next: Next, lhs: usize) -> u32 {
        if next.t == lex::L_PAREN {
            if self.src[lhs].is_ascii_uppercase() && self.new_member_before(lhs) {
                return tok::TYPE_CLASS;
            }
            return tok::FUNCTION_METHOD;
        }
        tok::PROPERTY
    }

    /// The rules of `$identHl` that read only the identifier's bytes:
    /// builtin constants, SCREAMING_CASE constants, and capitalized types.
    #[inline(always)]
    pub(super) fn ident_by_word(&self, prev: u8, next: Next, lhs: usize, rhs: usize) -> u32 {
        if self.is_builtin_const(lhs, rhs) {
            return tok::CONSTANT_BUILTIN;
        }
        if self.is_const_case(lhs, rhs) {
            if self.ts && self.type_slot(prev, next, lhs) {
                return tok::TYPE;
            }
            return tok::CONSTANT;
        }
        if self.src[lhs].is_ascii_uppercase() {
            return tok::TYPE;
        }
        tok::VARIABLE
    }

    /// `$identHl` in full.
    /// Returns [`MARK_PARAMETER`] for a parameter that also marks its list.
    #[inline(never)]
    pub(super) fn ident_hl_context(
        &self,
        prev: u8,
        t: u8,
        next: Next,
        lhs: usize,
        rhs: usize,
    ) -> u32 {
        if t != lex::IDENTIFIER {
            if let Some(hl) = self.ctxword_hl(prev, t, next) {
                return hl;
            }
        } else if is(next.t, kf::CTX_IDENT_NEXT)
            && !(next.nl || prev == lex::DOT || prev == lex::QUESTION_MARK_DOT)
            && let Some(hl) = self.ctx_ident_hl(prev, next.t, lhs, rhs)
        {
            return hl;
        }
        if prev == lex::DOT || prev == lex::QUESTION_MARK_DOT {
            return self.member_hl(next, lhs);
        }
        if next.t == lex::FUNCTION_ARROW && !self.arrow_return_type(prev, lhs) {
            return tok::VARIABLE_PARAMETER;
        }
        if prev == lex::L_PAREN && next.t == lex::R_PAREN && self.arrow_ahead(next.rhs) {
            return tok::VARIABLE_PARAMETER;
        }
        if next.t == lex::CTXWORD_IS && self.ts {
            return tok::VARIABLE_PARAMETER;
        }
        if self.sig.active() {
            let s = &self.sig;
            if s.obscure == 0 && s.angle == 0 && is(prev, kf::SIG_PARAM_PREV) {
                return tok::VARIABLE_PARAMETER;
            }
            if s.obscure == 1
                && s.pattern
                && next.t != lex::COLON
                && matches!(prev, lex::L_BRACE | lex::L_BRACKET | lex::COMMA)
            {
                return tok::VARIABLE_PARAMETER;
            }
        }
        if prev == lex::L_PAREN
            && self.ts
            && (next.t == lex::COLON
                || (next.t == lex::QUESTION_MARK && self.byte(next.rhs) == b':'))
        {
            return MARK_PARAMETER;
        }
        if self.is_builtin_const(lhs, rhs) {
            return tok::CONSTANT_BUILTIN;
        }
        if self.ts && self.is_predefined_type(lhs, rhs) {
            if prev == lex::COLON {
                return tok::TYPE_BUILTIN;
            }
            if prev == lex::KEYWORD_EXTENDS
                && matches!(
                    next.t,
                    lex::R_ANGLE | lex::R_SHIFT | lex::QUESTION_MARK | lex::PIPE | lex::AMPERSAND
                )
            {
                return tok::TYPE_BUILTIN;
            }
            if prev == lex::IDENTIFIER {
                let c = self.blanks_before(lhs);
                if c >= 6
                    && &self.src[c - 6..c] == b"unique"
                    && !is_name_start(self.byte_before(c - 6))
                {
                    return tok::TYPE_BUILTIN;
                }
            }
        }
        if prev == lex::KEYWORD_NEW && (next.t != lex::DOT || next.nl) {
            return tok::TYPE_CLASS;
        }
        if prev == lex::KEYWORD_CLASS || prev == lex::KEYWORD_EXTENDS {
            return tok::TYPE_CLASS;
        }
        if matches!(
            prev,
            lex::KEYWORD_INTERFACE | lex::KEYWORD_ENUM | lex::CTXWORD_TYPE
        ) {
            return tok::TYPE;
        }
        if prev == lex::KEYWORD_FUNCTION {
            return tok::FUNCTION;
        }
        if (matches!(prev, lex::L_BRACE | lex::COMMA) || (self.ts && prev == lex::SEMICOLON))
            && (next.t == lex::COLON
                || (self.ts && next.t == lex::QUESTION_MARK && self.byte(next.rhs) == b':'))
        {
            return tok::PROPERTY;
        }
        if next.t == lex::L_PAREN {
            return tok::FUNCTION;
        }
        self.ident_by_word(prev, next, lhs, rhs)
    }

    /// `$classify` for a single-span token.
    #[inline(always)]
    pub(super) fn classify(&mut self, t: u8, next: Next, lhs: usize, rhs: usize) -> u32 {
        let prev = self.prev_tok;
        self.sig_step(prev, t, next.t, lhs, rhs);
        let hl = LEX_HL[t as usize];
        if hl < COLON_OR_QUESTION {
            return hl as u32;
        }
        if hl == IDENT {
            return self.ident_hl(prev, t, next, lhs, rhs);
        }
        if self.ts {
            if t == lex::COLON {
                if next.t == lex::IDENTIFIER
                    && (self.byte(next.lhs).is_ascii_uppercase()
                        || self.is_predefined_type(next.lhs, next.rhs))
                {
                    return tok::PUNCTUATION_SPECIAL;
                }
            } else if next.t == lex::COLON {
                return tok::PUNCTUATION_SPECIAL;
            }
        }
        if t == lex::COLON {
            tok::PUNCTUATION_DELIMITER
        } else {
            tok::OPERATOR
        }
    }
}

/// The marker a component metadata key sets for the template after its
/// colon: `template` (HTML) or `styles` (CSS), bare or quoted; 0 otherwise.
#[inline(always)]
pub(super) fn metadata_marker(src: &[u8], t: u8, lhs: usize, rhs: usize) -> i32 {
    let (a, b) = if t == lex::STRING_LITERAL {
        (lhs + 1, rhs - 1)
    } else {
        (lhs, rhs)
    };
    let n = b.wrapping_sub(a);
    if n != 8 && n != 6 {
        return 0;
    }
    // SAFETY: the input slack covers an eight-byte read at any token.
    let w = u64::from_le(unsafe { src.as_ptr().add(a).cast::<u64>().read_unaligned() });
    if n == 8 && w == u64::from_le_bytes(*b"template") {
        0xc000_0001u32 as i32
    } else if n == 6 && w & 0xffff_ffff_ffff == u64::from_le_bytes(*b"styles\0\0") {
        0x4000_0104
    } else {
        0
    }
}

/// The template marker an identifier or block comment sets: `html` selects
/// HTML (1), and `css` CSS (260). A comment's word is trimmed and matched
/// ignoring ASCII case; 0 for anything else.
#[inline(always)]
pub(super) fn tag_marker(src: &[u8], t: u8, lhs: usize, rhs: usize) -> i32 {
    let (mut ml, mut mr) = (lhs, rhs);
    if t == lex::MULTILINE_COMMENT {
        ml += 2;
        mr = mr.saturating_sub(2);
        while ml < mr && src[ml] <= 32 {
            ml += 1;
        }
        while ml < mr && src[mr - 1] <= 32 {
            mr -= 1;
        }
    }
    let mlen = mr.wrapping_sub(ml);
    if mlen.wrapping_sub(3) > 1 {
        return 0;
    }
    let word = u32::from_le_bytes(src[ml..ml + 4].try_into().unwrap())
        | if t == lex::MULTILINE_COMMENT {
            0x2020_2020
        } else {
            0
        };
    if mlen == 4 {
        (word == u32::from_le_bytes(*b"html")) as i32
    } else if word & 0xff_ffff == u32::from_le_bytes(*b"css\0") {
        260
    } else {
        0
    }
}

/// The multi-part kinds: strings, templates, comments, and invalid tokens.
pub(super) fn emit_multi(inst: &mut Instance, src: &[u8], t: u8, lhs: i32, rhs: i32) {
    let base = inst.g_srcBase;
    match t {
        lex::STRING_LITERAL => inst.f_emitEscaped(tok::STRING as i32, lhs, rhs),
        lex::BACKTICK => inst.f_emitTemplate(lhs, rhs, 0, 1, 1),
        lex::DOLLAR_BRACE => inst.f_emitTemplate(lhs, rhs, 1, 1, 0),
        lex::COMMENT | lex::HASH_BANG => inst.emit_tok_native(tok::COMMENT as i32, lhs, rhs),
        lex::MULTILINE_COMMENT => {
            if inst.f_isDocComment(lhs, rhs) != 0 {
                inst.f_emitDocCommentRange(lhs, rhs, 3);
            } else {
                inst.emit_tok_native(tok::COMMENT as i32, lhs, rhs);
            }
        }
        lex::INVALID => match src[(lhs - base) as usize] {
            b'"' | b'\'' => inst.f_emitEscaped(tok::STRING as i32, lhs, rhs),
            b'`' | b'}' => inst.f_emitTemplate(lhs, rhs, 0, 1, 0),
            b'/' => inst.emit_tok_native(tok::STRING_REGEX as i32, lhs, rhs),
            _ => inst.emit_tok_native(tok::NONE as i32, lhs, rhs),
        },
        _ => inst.emit_tok_native(tok::NONE as i32, lhs, rhs),
    }
}
