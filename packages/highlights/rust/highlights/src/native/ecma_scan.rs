//! Tables and scans for the native ECMAScript/TypeScript lexer in `fast`:
//! the `$Lex` kind flags, the keyword table, and the string, template, and
//! regexp scans, matching `$nextToken` in `src/langs/js.wat`. JSX and TSRX
//! are not supported; this is the `ts`/`js` feature set.

use super::scan;
use crate::lex_ids as lex;

/// Bits of [`KIND`]: sets of `$Lex` kinds, mirroring `$LexBits` in js.wat
/// and the kind tests of `ts.wat`, so one table load answers them all.
pub mod kf {
    pub const COMMENT: u32 = 1 << 0;
    pub const EXPR_END: u32 = 1 << 1;
    pub const BRACE_BLOCK_PREV: u32 = 1 << 2;
    pub const CTRL_PAREN_PREV: u32 = 1 << 3;
    /// `/` after this kind starts a regexp (kinds without [`RX_DYNAMIC`]).
    pub const RX_OK: u32 = 1 << 4;
    /// Whether `/` starts a regexp depends on scanner state.
    pub const RX_DYNAMIC: u32 = 1 << 5;
    pub const SIG_PARAM_PREV: u32 = 1 << 6;
    pub const SIG_IDLE: u32 = 1 << 7;
    pub const CTX_IDENT_NEXT: u32 = 1 << 8;
    /// An identifier, keyword, or contextual word (`$isIdentish`).
    pub const IDENTISH: u32 = 1 << 9;
    /// Ends an import/export clause (`$ecmaImport` reset).
    pub const IMPORT_END: u32 = 1 << 10;
    /// Before an identifier, a kind some rule of `$identHl` tests.
    pub const IDENT_PREV: u32 = 1 << 11;
    /// After an identifier, a kind some rule of `$identHl` tests.
    pub const IDENT_NEXT: u32 = 1 << 12;
    /// Before an object or member key (`{`, `,`, `;`).
    pub const KEY_PREV: u32 = 1 << 13;
    /// After an object or member key (`:`, `?`).
    pub const KEY_NEXT: u32 = 1 << 14;
    /// A single-span kind that the pipeline's import, metadata, and template
    /// marker rules ignore (apart from an import clause's end).
    pub const PLAIN: u32 = 1 << 15;
    /// Comments and end of input, which leave the last token unchanged.
    pub const NOT_LTO: u32 = 1 << 16;
}

/// Set `bit` in `t` for each of `kinds`.
const fn mark(mut t: [u32; 256], kinds: &[u8], bit: u32) -> [u32; 256] {
    let mut i = 0;
    while i < kinds.len() {
        t[kinds[i] as usize] |= bit;
        i += 1;
    }
    t
}

/// Scratch bit while building [`KIND`]: the kinds that are not
/// [`kf::PLAIN`].
const NOT_PLAIN: u32 = 1 << 31;

/// [`kf`] flags for each `$Lex` kind.
pub static KIND: [u32; 256] = KIND_TABLE;

/// [`KIND`] as a constant, for tables built from it.
pub const KIND_TABLE: [u32; 256] = {
    use lex::*;
    let mut t = [0u32; 256];
    t = mark(
        t,
        &[lex::COMMENT, lex::MULTILINE_COMMENT, lex::HASH_BANG],
        kf::COMMENT,
    );
    t = mark(
        t,
        &[
            lex::IDENTIFIER,
            lex::NUMBER_LITERAL,
            lex::BIGINT_LITERAL,
            lex::STRING_LITERAL,
            lex::REGEXP_LITERAL,
            lex::BACKTICK,
            lex::R_PAREN,
            lex::R_BRACKET,
            lex::R_BRACE,
            lex::KEYWORD_THIS,
            lex::KEYWORD_TRUE,
            lex::KEYWORD_FALSE,
            lex::KEYWORD_NULL,
            lex::KEYWORD_SUPER,
            lex::HASH_IDENTIFIER,
            lex::AT_IDENTIFIER,
            lex::CTXWORD_AS,
            lex::CTXWORD_ASYNC,
            lex::CTXWORD_AWAIT,
            lex::CTXWORD_FROM,
            lex::CTXWORD_GET,
            lex::CTXWORD_OF,
            lex::CTXWORD_SET,
            lex::CTXWORD_ABSTRACT,
            lex::CTXWORD_DECLARE,
            lex::CTXWORD_INFER,
            lex::CTXWORD_IS,
            lex::CTXWORD_KEYOF,
            lex::CTXWORD_NAMESPACE,
            lex::CTXWORD_OVERRIDE,
            lex::CTXWORD_READONLY,
            lex::CTXWORD_SATISFIES,
            lex::CTXWORD_TYPE,
        ],
        kf::EXPR_END,
    );
    t = mark(
        t,
        &[
            lex::EOF,
            lex::SEMICOLON,
            lex::L_BRACE,
            lex::R_BRACE,
            lex::R_PAREN,
            lex::FUNCTION_ARROW,
            lex::KEYWORD_ELSE,
            lex::KEYWORD_DO,
            lex::KEYWORD_TRY,
            lex::KEYWORD_FINALLY,
            lex::KEYWORD_STATIC,
        ],
        kf::BRACE_BLOCK_PREV,
    );
    t = mark(
        t,
        &[
            lex::KEYWORD_IF,
            lex::KEYWORD_WHILE,
            lex::KEYWORD_FOR,
            lex::KEYWORD_WITH,
        ],
        kf::CTRL_PAREN_PREV,
    );
    t = mark(t, &[STRING_LITERAL, R_PAREN, R_BRACE], kf::RX_DYNAMIC);
    t = mark(
        t,
        &[
            lex::L_PAREN,
            lex::COMMA,
            lex::SPREAD,
            lex::KEYWORD_PUBLIC,
            lex::KEYWORD_PRIVATE,
            lex::KEYWORD_PROTECTED,
            lex::CTXWORD_READONLY,
            lex::CTXWORD_OVERRIDE,
        ],
        kf::SIG_PARAM_PREV,
    );
    t = mark(
        t,
        &[
            lex::L_PAREN,
            lex::R_PAREN,
            lex::KEYWORD_FUNCTION,
            lex::KEYWORD_CATCH,
            lex::IDENTIFIER,
            lex::CTXWORD_GET,
            lex::CTXWORD_SET,
        ],
        kf::SIG_IDLE,
    );
    t = mark(
        t,
        &[
            lex::IDENTIFIER,
            lex::L_BRACE,
            lex::STRING_LITERAL,
            lex::HASH_IDENTIFIER,
            lex::KEYWORD_THIS,
            lex::CTXWORD_AS,
            lex::CTXWORD_ASYNC,
            lex::CTXWORD_AWAIT,
            lex::CTXWORD_FROM,
            lex::CTXWORD_GET,
            lex::CTXWORD_SET,
            lex::CTXWORD_ABSTRACT,
            lex::CTXWORD_DECLARE,
            lex::CTXWORD_INFER,
            lex::CTXWORD_IS,
            lex::CTXWORD_KEYOF,
            lex::CTXWORD_NAMESPACE,
            lex::CTXWORD_OVERRIDE,
            lex::CTXWORD_READONLY,
            lex::CTXWORD_SATISFIES,
            lex::CTXWORD_TYPE,
        ],
        kf::CTX_IDENT_NEXT,
    );
    t = mark(
        t,
        &[
            STRING_LITERAL,
            SEMICOLON,
            L_PAREN,
            EQUAL,
            KEYWORD_CONST,
            KEYWORD_LET,
            KEYWORD_VAR,
            KEYWORD_FUNCTION,
            KEYWORD_CLASS,
            KEYWORD_ENUM,
            KEYWORD_INTERFACE,
        ],
        kf::IMPORT_END,
    );
    t = mark(
        t,
        &[
            DOT,
            QUESTION_MARK_DOT,
            L_PAREN,
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
        kf::IDENT_PREV,
    );
    t = mark(
        t,
        &[
            FUNCTION_ARROW,
            CTXWORD_IS,
            L_PAREN,
            lex::IDENTIFIER,
            lex::L_BRACE,
            lex::STRING_LITERAL,
            lex::HASH_IDENTIFIER,
            lex::KEYWORD_THIS,
            lex::CTXWORD_AS,
            lex::CTXWORD_ASYNC,
            lex::CTXWORD_AWAIT,
            lex::CTXWORD_FROM,
            lex::CTXWORD_GET,
            lex::CTXWORD_SET,
            lex::CTXWORD_ABSTRACT,
            lex::CTXWORD_DECLARE,
            lex::CTXWORD_INFER,
            lex::CTXWORD_IS,
            lex::CTXWORD_KEYOF,
            lex::CTXWORD_NAMESPACE,
            lex::CTXWORD_OVERRIDE,
            lex::CTXWORD_READONLY,
            lex::CTXWORD_SATISFIES,
            lex::CTXWORD_TYPE,
        ],
        kf::IDENT_NEXT,
    );
    t = mark(t, &[L_BRACE, COMMA, SEMICOLON], kf::KEY_PREV);
    t = mark(t, &[COLON, QUESTION_MARK], kf::KEY_NEXT);
    t = mark(
        t,
        &[EOF, COMMENT, MULTILINE_COMMENT, HASH_BANG],
        kf::NOT_LTO,
    );
    t = mark(
        t,
        &[
            EOF,
            INVALID,
            COMMENT,
            MULTILINE_COMMENT,
            HASH_BANG,
            STRING_LITERAL,
            BACKTICK,
            DOLLAR_BRACE,
            IDENTIFIER,
            COLON,
            KEYWORD_IMPORT,
            KEYWORD_EXPORT,
        ],
        NOT_PLAIN,
    );
    // `$rxAllowedAfter` for the kinds that need no scanner state.
    let mut k = 0;
    while k < 256 {
        let c = k as u8;
        let ok = if c >= CTXWORD_AS && c <= CTXWORD_TYPE {
            c == CTXWORD_AWAIT || c == CTXWORD_OF
        } else if c == AT_IDENTIFIER {
            true
        } else if t[k] & kf::EXPR_END != 0 {
            false
        } else {
            !(c == PLUS_PLUS || c == MINUS_MINUS)
        };
        if ok {
            t[k] |= kf::RX_OK;
        }
        if c == IDENTIFIER || (c >= KEYWORD_BREAK && c <= CTXWORD_TYPE) {
            t[k] |= kf::IDENTISH;
        }
        if t[k] & NOT_PLAIN == 0 {
            t[k] |= kf::PLAIN;
        }
        t[k] &= !NOT_PLAIN;
        k += 1;
    }
    t
};

/// Keywords and contextual words with their `$Lex` kinds.
const KEYWORDS: [(&[u8], u8); 62] = {
    use lex::*;
    [
        (b"break", KEYWORD_BREAK),
        (b"case", KEYWORD_CASE),
        (b"catch", KEYWORD_CATCH),
        (b"class", KEYWORD_CLASS),
        (b"const", KEYWORD_CONST),
        (b"continue", KEYWORD_CONTINUE),
        (b"debugger", KEYWORD_DEBUGGER),
        (b"default", KEYWORD_DEFAULT),
        (b"delete", KEYWORD_DELETE),
        (b"do", KEYWORD_DO),
        (b"else", KEYWORD_ELSE),
        (b"enum", KEYWORD_ENUM),
        (b"export", KEYWORD_EXPORT),
        (b"extends", KEYWORD_EXTENDS),
        (b"false", KEYWORD_FALSE),
        (b"finally", KEYWORD_FINALLY),
        (b"for", KEYWORD_FOR),
        (b"function", KEYWORD_FUNCTION),
        (b"if", KEYWORD_IF),
        (b"import", KEYWORD_IMPORT),
        (b"in", KEYWORD_IN),
        (b"instanceof", KEYWORD_INSTANCEOF),
        (b"new", KEYWORD_NEW),
        (b"null", KEYWORD_NULL),
        (b"return", KEYWORD_RETURN),
        (b"super", KEYWORD_SUPER),
        (b"switch", KEYWORD_SWITCH),
        (b"this", KEYWORD_THIS),
        (b"throw", KEYWORD_THROW),
        (b"true", KEYWORD_TRUE),
        (b"try", KEYWORD_TRY),
        (b"typeof", KEYWORD_TYPEOF),
        (b"var", KEYWORD_VAR),
        (b"void", KEYWORD_VOID),
        (b"while", KEYWORD_WHILE),
        (b"with", KEYWORD_WITH),
        (b"implements", KEYWORD_IMPLEMENTS),
        (b"interface", KEYWORD_INTERFACE),
        (b"let", KEYWORD_LET),
        (b"package", KEYWORD_PACKAGE),
        (b"private", KEYWORD_PRIVATE),
        (b"protected", KEYWORD_PROTECTED),
        (b"public", KEYWORD_PUBLIC),
        (b"static", KEYWORD_STATIC),
        (b"yield", KEYWORD_YIELD),
        (b"as", CTXWORD_AS),
        (b"async", CTXWORD_ASYNC),
        (b"await", CTXWORD_AWAIT),
        (b"from", CTXWORD_FROM),
        (b"get", CTXWORD_GET),
        (b"of", CTXWORD_OF),
        (b"set", CTXWORD_SET),
        (b"abstract", CTXWORD_ABSTRACT),
        (b"declare", CTXWORD_DECLARE),
        (b"infer", CTXWORD_INFER),
        (b"is", CTXWORD_IS),
        (b"keyof", CTXWORD_KEYOF),
        (b"namespace", CTXWORD_NAMESPACE),
        (b"override", CTXWORD_OVERRIDE),
        (b"readonly", CTXWORD_READONLY),
        (b"satisfies", CTXWORD_SATISFIES),
        (b"type", CTXWORD_TYPE),
    ]
};

/// Hash of a word's first two bytes, last byte, and length; collision-free
/// over [`KEYWORDS`] (checked when the table is built).
const fn keyword_hash(b0: u8, b1: u8, last: u8, len: usize) -> usize {
    let key = b0 as u32 | (b1 as u32) << 8 | (last as u32) << 16 | (len as u32) << 24;
    (key.wrapping_mul(0x90f0_0d8d) >> 24) as usize
}

/// Keyword table slot: the word zero-padded to 16 bytes, and its kind
/// (`INVALID` for an empty slot).
#[derive(Clone, Copy)]
#[repr(C)]
pub(super) struct KeywordSlot {
    word: u128,
    kind: u8,
}

pub(super) static KEYWORD_TABLE: [KeywordSlot; 256] = {
    let mut t = [KeywordSlot {
        word: 0,
        kind: lex::INVALID,
    }; 256];
    let mut i = 0;
    while i < KEYWORDS.len() {
        let (w, kind) = KEYWORDS[i];
        let h = keyword_hash(w[0], w[1], w[w.len() - 1], w.len());
        assert!(t[h].kind == lex::INVALID, "keyword hash collision");
        let mut bytes = [0u8; 16];
        let mut j = 0;
        while j < w.len() {
            bytes[j] = w[j];
            j += 1;
        }
        t[h] = KeywordSlot {
            word: u128::from_le_bytes(bytes),
            kind,
        };
        i += 1;
    }
    t
};

/// Keyword and contextual-word kind for the identifier `src[lhs..rhs]`, or
/// `None`. Reads 16 bytes at `lhs`, which the input slack allows.
#[inline(always)]
pub(super) fn keyword(src: &[u8], lhs: usize, rhs: usize) -> Option<u8> {
    let len = rhs - lhs;
    if len.wrapping_sub(2) > 8 {
        return None;
    }
    // SAFETY: the input extends at least 16 bytes past every token.
    unsafe {
        let at = |i: usize| *src.get_unchecked(i);
        let slot = KEYWORD_TABLE[keyword_hash(at(lhs), at(lhs + 1), at(rhs - 1), len)];
        if slot.kind == lex::INVALID {
            return None;
        }
        let word = src.as_ptr().add(lhs).cast::<u128>().read_unaligned();
        let word = u128::from_le(word) & (u128::MAX >> (128 - 8 * len));
        (slot.word == word).then_some(slot.kind)
    }
}

/// Unicode identifier classes for non-ASCII code points, as the wasm host's
/// `is_id_start`/`is_id_continue` imports.
pub(super) fn code_point(src: &[u8], p: usize, bits: usize) -> Option<char> {
    core::str::from_utf8(src.get(p..p + bits)?)
        .ok()?
        .chars()
        .next()
}

/// UTF-8 sequence length for lead byte `c`, or 0 for an invalid lead.
#[inline(always)]
pub(super) fn utf8_bits(c: u8) -> usize {
    if c.wrapping_sub(194) <= 50 {
        (!c).leading_zeros() as usize
    } else {
        0
    }
}

pub const BRACKETS: usize = 1024;
pub const TEMPLATES: usize = 256;

/// A string literal from its opening `quote` at `p`: `STRING_LITERAL` and
/// the position after the closing quote, or `INVALID` where an unterminated
/// string stops (at a line break or the end).
pub(super) fn scan_string(src: &[u8], p: usize, end: usize, quote: u8) -> (u8, usize) {
    let mut p = p + 1;
    loop {
        p = scan::string_special(src, p, end, quote);
        if p >= end {
            break;
        }
        let c = src[p];
        if c == quote {
            return (lex::STRING_LITERAL, p + 1);
        }
        if c == b'\n' || c == b'\r' {
            break;
        }
        let b = |q: usize| if q < end { src[q] } else { 0 };
        if b(p + 1) == b'\r' && b(p + 2) == b'\n' {
            p += 1;
        }
        p = (p + 2).min(end);
    }
    (lex::INVALID, p)
}

/// Template characters from `p`: `BACKTICK` past the closing backtick,
/// `DOLLAR_BRACE` past a `${` (treated as text when `full`, the stack
/// limit), or `INVALID` at the end.
pub(super) fn scan_template(src: &[u8], p: usize, end: usize, full: bool) -> (u8, usize) {
    let mut p = p;
    loop {
        p = scan::find3(src, p, end, b'`', b'$', b'\\');
        if p >= end {
            break;
        }
        match src[p] {
            b'`' => return (lex::BACKTICK, p + 1),
            b'$' if p + 1 < end && src[p + 1] == b'{' => {
                if full {
                    p += 2;
                    continue;
                }
                return (lex::DOLLAR_BRACE, p + 2);
            }
            b'\\' => p = (p + 2).min(end),
            _ => p += 1,
        }
    }
    (lex::INVALID, p)
}

/// A regexp literal from its `/` at `p`, with its flags: `REGEXP_LITERAL`
/// and its end, or `INVALID` where it stops unterminated.
pub(super) fn scan_regexp(src: &[u8], p: usize, end: usize) -> (u8, usize) {
    let mut p = p + 1;
    let mut in_class = false;
    loop {
        if p >= end {
            return (lex::INVALID, p);
        }
        let c = src[p];
        if c == b'\n' || c == b'\r' {
            return (lex::INVALID, p);
        }
        if c == b'\\' {
            p = (p + 2).min(end);
            continue;
        }
        if c == b'[' {
            in_class = true;
        } else if c == b']' {
            in_class = false;
        }
        p += 1;
        if c == b'/' && !in_class {
            break;
        }
    }
    while p < end && src[p].is_ascii_alphabetic() {
        p += 1;
    }
    (lex::REGEXP_LITERAL, p)
}
