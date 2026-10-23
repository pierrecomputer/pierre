//! The lexer of `fast.rs` in hand-written AArch64 assembly (`lexasm.s`),
//! producing the same records. The assembly runs the whole token loop:
//! whitespace, dispatch, identifiers and keywords, numbers, punctuation and
//! the bracket stack, line comments, the waiting-token pipeline, identifier
//! coloring, the idle parameter-list machine, markers, and record writing.
//! It calls back into Rust only for cold pieces: unusual whitespace,
//! Unicode identifiers, string/regexp/template/block-comment scans, the
//! multi-span emitters, the full context rules, and the busy
//! parameter-list machine.
//!
//! The lexer state lives in [`AsmState`] for the whole run; the assembly
//! caches its hot fields in callee-saved registers (see `lexasm.s`) and
//! addresses the rest by the `offset_of!` constants below.

use core::mem::offset_of;

use super::{
    BRACKETS, Cold, FLAGS_TABLE, Instance, Next, Rec, classify, ident_tail_unicode, ident_word, kf,
    lex, non_ascii, other, resolve_other, scan, scan_regexp, scan_string, sig_busy, skip_space,
    tok,
};
use super::{DEFER, ID_NEXT, ID_PAREN_NEXT, ID_PREV};
use crate::native::ecma_scan::KEYWORD_TABLE;

/// The lexer state for one run, shared by the assembly and the callbacks.
pub(super) struct AsmState<'a> {
    cold: Cold<'a>,
    inst: *mut Instance,
    base: usize,
    src: *const u8,
    /// The record vector's start, one past the last written record, and the
    /// end of its capacity; `last` is the last record's token.
    rp: *mut Rec,
    cur: *mut Rec,
    limit: *mut Rec,
    last: u32,
}

impl AsmState<'_> {
    /// Hand the records written by the assembly to `inst.ext.recs`.
    fn store_recs(&mut self) {
        // SAFETY: the records before `cur` are written.
        unsafe {
            let n = self.cur.offset_from(self.rp) as usize;
            (*self.inst).ext.recs.set_len(n);
        }
    }

    /// Take the record pointers back from `inst.ext.recs`.
    fn load_recs(&mut self) {
        // SAFETY: `inst` outlives the run.
        let recs = unsafe { &mut (*self.inst).ext.recs };
        self.rp = recs.as_mut_ptr();
        // SAFETY: `len` records are written within the capacity.
        unsafe {
            self.cur = self.rp.add(recs.len());
            self.limit = self.rp.add(recs.capacity());
        }
        self.last = recs.last().map_or(u32::MAX, |r| r.token);
    }
}

/// Byte classes for the assembly, then the per-kind flags.
#[repr(C)]
pub(super) struct AsmTables {
    cls: [u8; 256],
    flags: [u32; 256],
}

const CLS_IDENT_START: u8 = 1;
const CLS_IDENT_CONT: u8 = 2;
const CLS_PLAIN_START: u8 = 4;
const CLS_UPPER: u8 = 8;
const CLS_ALNUM_: u8 = 32;

static TABLES: AsmTables = {
    let mut t = AsmTables {
        cls: [0; 256],
        flags: FLAGS_TABLE,
    };
    let mut c = 0;
    while c < 256 {
        let b = c as u8;
        let mut k = 0;
        if b.is_ascii_alphabetic() || b == b'_' || b == b'$' {
            k |= CLS_IDENT_START;
        }
        if b.is_ascii_alphanumeric() || b == b'_' || b == b'$' {
            k |= CLS_IDENT_CONT;
        }
        if (b.is_ascii_lowercase() && b != b'u') || b == b'$' {
            k |= CLS_PLAIN_START;
        }
        if b.is_ascii_uppercase() {
            k |= CLS_UPPER;
        }
        if b.is_ascii_alphanumeric() || b == b'_' {
            k |= CLS_ALNUM_;
        }
        t.cls[c] = k;
        c += 1;
    }
    t
};

/// Two values returned in `x0` and `x1`.
#[repr(C)]
struct Pair(u64, u64);

/// The previous, current, and next kinds and the next token's line-break
/// flag, as the assembly packs them, with the next token's range.
fn unpack(kinds: u32, next_lhs: usize, next_rhs: usize) -> (u8, u8, Next) {
    let next = Next {
        t: (kinds >> 16) as u8,
        lhs: next_lhs,
        rhs: next_rhs,
        nl: kinds >> 24 & 1 != 0,
    };
    (kinds as u8, (kinds >> 8) as u8, next)
}

extern "C" fn cb_skip_space(st: &mut AsmState, p: usize) -> Pair {
    let (p, nl) = skip_space(st.cold.src, p, st.cold.end);
    Pair(p as u64, nl as u64)
}

extern "C" fn cb_ident_unicode(st: &mut AsmState, q: usize) -> usize {
    ident_tail_unicode(st.cold.src, st.cold.end, q)
}

extern "C" fn cb_non_ascii(st: &mut AsmState, lhs: usize) -> Pair {
    let src = st.cold.src;
    let (t, q) = non_ascii(src, st.cold.end, src[lhs], lhs);
    Pair(t as u64, q as u64)
}

/// Scan a token the assembly hands off: 0 a string, 1 a regexp, 2 a
/// template after a backtick, 3 a template resumed by `}`, 4 a block
/// comment. Returns its kind and end.
extern "C" fn cb_scan(st: &mut AsmState, code: u32, lhs: usize) -> Pair {
    let src = st.cold.src;
    let end = st.cold.end;
    let (t, q) = match code {
        0 => scan_string(src, lhs, end, src[lhs]),
        1 => scan_regexp(src, lhs, end),
        2 => st.cold.template(lhs + 1),
        3 => {
            st.cold.tpl_sp -= 1;
            st.cold.template(lhs + 1)
        }
        _ => (
            lex::MULTILINE_COMMENT,
            scan::block_comment_end(src, (lhs + 2).min(end), end),
        ),
    };
    Pair(t as u64, q as u64)
}

extern "C" fn cb_other(st: &mut AsmState, prev: u32, t: u32, lhs: usize, rhs: usize) {
    st.store_recs();
    // SAFETY: `inst` outlives the run and nothing else borrows it.
    let inst = unsafe { &mut *st.inst };
    other(&mut st.cold, inst, st.base, prev as u8, t as u8, lhs, rhs);
    st.load_recs();
}

extern "C" fn cb_classify_ident(
    st: &mut AsmState,
    kinds: u32,
    next_lhs: usize,
    next_rhs: usize,
    lhs: usize,
    rhs: usize,
) -> u32 {
    let (prev, _, next) = unpack(kinds, next_lhs, next_rhs);
    classify(&mut st.cold, prev, lex::IDENTIFIER, next, lhs, rhs)
}

extern "C" fn cb_ident_word(
    st: &mut AsmState,
    kinds: u32,
    next_lhs: usize,
    next_rhs: usize,
    lhs: usize,
    rhs: usize,
) -> u32 {
    let (prev, _, next) = unpack(kinds, next_lhs, next_rhs);
    ident_word(&st.cold, prev, next, lhs, rhs)
}

extern "C" fn cb_resolve_other(
    st: &mut AsmState,
    kinds: u32,
    next_lhs: usize,
    next_rhs: usize,
    lhs: usize,
    rhs: usize,
) -> u32 {
    let (prev, t, next) = unpack(kinds, next_lhs, next_rhs);
    resolve_other(&mut st.cold, prev, t, next, lhs, rhs)
}

extern "C" fn cb_sig_busy(st: &mut AsmState, prev: u32, t: u32, lhs: usize, rhs: usize) -> u32 {
    sig_busy(&mut st.cold, prev as u8, t as u8, lhs, rhs) as u32
}

extern "C" fn cb_trap() -> ! {
    crate::rt::trap()
}

/// Run the token loop over `st`.
///
/// # Safety
///
/// `st` must be set up by [`highlight`]: the input with its NUL and slack,
/// and room for one record per input byte.
#[allow(named_asm_labels)]
#[unsafe(naked)]
unsafe extern "C" fn run(st: *mut AsmState, tables: *const AsmTables) {
    core::arch::naked_asm!(
        include_str!("lexasm.s"),
        O_SRC = const offset_of!(AsmState, src),
        O_END = const offset_of!(AsmState, cold.end),
        O_TS = const offset_of!(AsmState, cold.ts),
        O_FN_PEND = const offset_of!(AsmState, cold.sig.fn_pend),
        O_MASK = const offset_of!(AsmState, cold.sig.mask),
        O_PARENS = const offset_of!(AsmState, cold.sig.parens),
        O_FN_ANGLE = const offset_of!(AsmState, cold.sig.fn_angle),
        O_IMPORT = const offset_of!(AsmState, cold.import),
        O_MARKER = const offset_of!(AsmState, cold.marker),
        O_BEFORE_STRING = const offset_of!(AsmState, cold.before_string),
        O_PEND_LHS = const offset_of!(AsmState, cold.pend_lhs),
        O_PEND_RHS = const offset_of!(AsmState, cold.pend_rhs),
        O_SOURCE_START = const offset_of!(AsmState, cold.source_start),
        O_BRACE_DEPTH = const offset_of!(AsmState, cold.brace_depth),
        O_BRK_SP = const offset_of!(AsmState, cold.brk_sp),
        O_RX_CLOSER = const offset_of!(AsmState, cold.rx_closer),
        O_TPL_SP = const offset_of!(AsmState, cold.tpl_sp),
        O_BRK = const offset_of!(AsmState, cold.brk),
        O_TPL = const offset_of!(AsmState, cold.tpl),
        O_RP = const offset_of!(AsmState, rp),
        O_CUR = const offset_of!(AsmState, cur),
        O_LIMIT = const offset_of!(AsmState, limit),
        O_LAST = const offset_of!(AsmState, last),
        BRACKETS = const BRACKETS,
        B_COMMENT = const kf::COMMENT.trailing_zeros(),
        B_NOT_LTO = const kf::NOT_LTO.trailing_zeros(),
        B_DEFER = const DEFER.trailing_zeros(),
        B_PLAIN = const kf::PLAIN.trailing_zeros(),
        B_IMPORT_END = const kf::IMPORT_END.trailing_zeros(),
        B_SIG_IDLE = const kf::SIG_IDLE.trailing_zeros(),
        B_ID_PREV = const ID_PREV.trailing_zeros(),
        B_ID_NEXT = const ID_NEXT.trailing_zeros(),
        B_ID_PAREN_NEXT = const ID_PAREN_NEXT.trailing_zeros(),
        B_KEY_PREV = const kf::KEY_PREV.trailing_zeros(),
        B_KEY_NEXT = const kf::KEY_NEXT.trailing_zeros(),
        B_RX_DYNAMIC = const kf::RX_DYNAMIC.trailing_zeros(),
        B_RX_OK = const kf::RX_OK.trailing_zeros(),
        B_BRACE_BLOCK_PREV = const kf::BRACE_BLOCK_PREV.trailing_zeros(),
        B_CTRL_PAREN_PREV = const kf::CTRL_PAREN_PREV.trailing_zeros(),
        C_IDENT_CONT = const CLS_IDENT_CONT.trailing_zeros(),
        C_PLAIN_START = const CLS_PLAIN_START.trailing_zeros(),
        C_UPPER = const CLS_UPPER.trailing_zeros(),
        C_ALNUM_ = const CLS_ALNUM_.trailing_zeros(),
        EOF = const lex::EOF,
        INVALID = const lex::INVALID,
        IDENTIFIER = const lex::IDENTIFIER,
        NUMBER_LITERAL = const lex::NUMBER_LITERAL,
        STRING_LITERAL = const lex::STRING_LITERAL,
        COMMENT = const lex::COMMENT,
        HASH_BANG = const lex::HASH_BANG,
        AT_IDENTIFIER = const lex::AT_IDENTIFIER,
        HASH_IDENTIFIER = const lex::HASH_IDENTIFIER,
        DOT = const lex::DOT,
        QUESTION_MARK_DOT = const lex::QUESTION_MARK_DOT,
        QUESTION_MARK = const lex::QUESTION_MARK,
        SPREAD = const lex::SPREAD,
        COMMA = const lex::COMMA,
        SEMICOLON = const lex::SEMICOLON,
        COLON = const lex::COLON,
        L_PAREN = const lex::L_PAREN,
        R_PAREN = const lex::R_PAREN,
        L_BRACKET = const lex::L_BRACKET,
        R_BRACKET = const lex::R_BRACKET,
        L_BRACE = const lex::L_BRACE,
        R_BRACE = const lex::R_BRACE,
        EQUAL = const lex::EQUAL,
        FUNCTION_ARROW = const lex::FUNCTION_ARROW,
        SLASH = const lex::SLASH,
        AMPERSAND = const lex::AMPERSAND,
        BANG = const lex::BANG,
        BANG_EQUAL = const lex::BANG_EQUAL,
        BANG_EQUAL_EQUAL = const lex::BANG_EQUAL_EQUAL,
        PIPE = const lex::PIPE,
        L_ANGLE = const lex::L_ANGLE,
        R_ANGLE = const lex::R_ANGLE,
        R_UNSIGNED_SHIFT = const lex::R_UNSIGNED_SHIFT,
        R_UNSIGNED_SHIFT_EQUAL = const lex::R_UNSIGNED_SHIFT_EQUAL,
        PLUS = const lex::PLUS,
        MINUS = const lex::MINUS,
        ASTERISK = const lex::ASTERISK,
        PERCENT = const lex::PERCENT,
        CARET = const lex::CARET,
        TILDE = const lex::TILDE,
        CTXWORD_ABSTRACT = const lex::CTXWORD_ABSTRACT,
        CTXWORD_FROM = const lex::CTXWORD_FROM,
        KEYWORD_IMPORT = const lex::KEYWORD_IMPORT,
        KEYWORD_EXPORT = const lex::KEYWORD_EXPORT,
        T_NONE = const tok::NONE,
        T_COMMENT = const tok::COMMENT,
        T_PROPERTY = const tok::PROPERTY,
        T_FUNCTION_METHOD = const tok::FUNCTION_METHOD,
        T_FUNCTION = const tok::FUNCTION,
        T_VARIABLE = const tok::VARIABLE,
        kw = sym KEYWORD_TABLE,
        cb_skip_space = sym cb_skip_space,
        cb_ident_unicode = sym cb_ident_unicode,
        cb_non_ascii = sym cb_non_ascii,
        cb_scan = sym cb_scan,
        cb_other = sym cb_other,
        cb_classify_ident = sym cb_classify_ident,
        cb_ident_word = sym cb_ident_word,
        cb_resolve_other = sym cb_resolve_other,
        cb_sig_busy = sym cb_sig_busy,
        cb_trap = sym cb_trap,
    )
}

/// Highlight `len` bytes of JavaScript, or TypeScript when `ts` is set, at
/// lexer memory offset `base` into `inst.ext.recs`, with the assembly loop.
/// The records equal [`super::highlight`]'s.
pub(crate) fn highlight(inst: &mut Instance, base: usize, len: usize, ts: bool) {
    let cold = super::setup(inst, base, len, ts);
    let mut st = AsmState {
        src: cold.src.as_ptr(),
        cold,
        inst,
        base,
        rp: core::ptr::null_mut(),
        cur: core::ptr::null_mut(),
        limit: core::ptr::null_mut(),
        last: 0,
    };
    st.load_recs();
    // SAFETY: `st` is set up as `run` requires.
    unsafe { run(&mut st, &TABLES) };
    st.store_recs();
    // SAFETY: as above.
    unsafe { (*st.inst).g_jsTemplateMarker = st.cold.marker };
}
