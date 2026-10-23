//! WAT sources: src/langs/nix.wat src/common.wat src/scan.wat
//!
//! Native Nix lexer. Names are colored by where they stand: an attribute
//! before `=`, a parameter before `:` or in a `{ a, b ? x }` pattern, the
//! function at the head of an application, a property after `.` or
//! `inherit`. Strings (`"..."` and `''...''`) span lines and carry `${...}`
//! splices, which are lexed as expressions. Paths, search paths, and URIs
//! are literals. The records equal the translated `nix` lexer's records.

#[cfg(target_arch = "aarch64")]
use core::arch::aarch64::*;

use super::Lexer;
use super::scan;
use super::tables::{KeywordTable, byteset};
use crate::Rec;
use crate::generated::Instance;
use crate::token_ids as tok;
use crate::wat_tables::NIX_WORDS;

/// The lexer for `name`, if this module handles it.
pub(crate) fn lexer(name: &str) -> Option<Lexer> {
    match name {
        "nix" => Some(highlight),
        _ => None,
    }
}

/// `$nixWords`: each value is the word's token.
static WORDS: KeywordTable<1024> = KeywordTable::new(NIX_WORDS);

/// Path bytes: identifier bytes and `+`, `-`, `.`, `/` (`$nixIsPathByte`).
static PATH: [bool; 256] = {
    let extra = byteset(b"+-./");
    let mut t = [false; 256];
    let mut c = 0;
    while c < 256 {
        t[c] = is_ident_continue(c as u8) || extra[c];
        c += 1;
    }
    t
};

/// URI bytes: identifier bytes and `!%&'*+,-./:=?@~` (`$nixIsUriByte`).
static URI: [bool; 256] = {
    let extra = byteset(b"!%&'*+,-./:=?@~");
    let mut t = [false; 256];
    let mut c = 0;
    while c < 256 {
        t[c] = is_ident_continue(c as u8) || extra[c];
        c += 1;
    }
    t
};

/// Operator bytes (`$nixIsOp`).
static OP: [bool; 256] = byteset(b"!&*+-/<=>?@|:");

/// Bytes that end a name: all but `[A-Za-z0-9_-']` and bytes from 0x80
/// (`$scanIdentRun` with `-`, then `'`, repeated).
const NAME_STOP: [bool; 256] = {
    let mut t = [false; 256];
    let mut c = 0;
    while c < 256 {
        let b = c as u8;
        t[c] = !(b >= 0x80
            || (b | 32).wrapping_sub(b'a') <= 25
            || is_digit(b)
            || b == b'_'
            || b == b'-'
            || b == b'\'');
        c += 1;
    }
    t
};
const NAME_STOP_NIB: ([u8; 16], [u8; 16]) = nibbles(&NAME_STOP);

/// Whitespace: space and TAB through CR (`$lexIsSpace`).
static SPACE: [bool; 256] = {
    let mut t = [false; 256];
    let mut c = 0;
    while c < 256 {
        let b = c as u8;
        t[c] = b == b' ' || b.wrapping_sub(9) <= 4;
        c += 1;
    }
    t
};

/// Bytes that can begin an application's argument outright: names,
/// digits, `"`, `(`, `[`, `{` (`$nixIsArgAt`).
static ARG_START: [bool; 256] = {
    let extra = byteset(b"\"([{");
    let mut t = [false; 256];
    let mut c = 0;
    while c < 256 {
        let b = c as u8;
        t[c] = is_ident_start(b) || is_digit(b) || extra[c];
        c += 1;
    }
    t
};

/// The bracket kinds of `$hlNix`'s bracket stack.
const PAREN: u32 = 1;
const LIST: u32 = 2;
const BRACES: u32 = 3;

/// The byte at `i`. Callers read at most 16 bytes past the input end, which
/// the 96-byte input slack covers. The byte at the input end is NUL, so at
/// any position up to the end this is also `$nixByte`, which reads 0 at and
/// past the end; every `$nixByte` position here lies at or before the end,
/// or is read only after a byte before it was found inside the input.
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

/// A byte set as two nibble tables: byte `b` is in the set when
/// `hi[b >> 4] & lo[b & 15]` is nonzero. Each bit stands for a group of
/// high nibbles that admit the same low nibbles; building fails when the
/// set needs more than eight groups.
const fn nibbles(set: &[bool; 256]) -> ([u8; 16], [u8; 16]) {
    let mut rows = [0u16; 16];
    let mut h = 0;
    while h < 16 {
        let mut l = 0;
        while l < 16 {
            if set[h * 16 + l] {
                rows[h] |= 1 << l;
            }
            l += 1;
        }
        h += 1;
    }
    let mut hi = [0u8; 16];
    let mut lo = [0u8; 16];
    let mut groups = [0u16; 8];
    let mut n = 0;
    h = 0;
    while h < 16 {
        if rows[h] != 0 {
            let mut g = 0;
            while g < n && groups[g] != rows[h] {
                g += 1;
            }
            if g == n {
                assert!(n < 8, "too many nibble groups");
                groups[n] = rows[h];
                n += 1;
            }
            hi[h] = 1 << g;
            let mut l = 0;
            while l < 16 {
                if rows[h] >> l & 1 != 0 {
                    lo[l] |= 1 << g;
                }
                l += 1;
            }
        }
        h += 1;
    }
    (hi, lo)
}

/// The first byte from `p` in the set of the nibble tables `nib` (see
/// [`nibbles`]), 16 bytes per step. The caller makes sure a set byte lies
/// within 16 bytes past the input end, or stops the scan itself.
#[inline(always)]
fn find_set(src: &[u8], mut p: usize, nib: &([u8; 16], [u8; 16]), set: &[bool; 256]) -> usize {
    #[cfg(target_arch = "aarch64")]
    // SAFETY: each 16-byte load starts at or before a set byte that lies
    // at most 16 bytes past the input end, inside the slack.
    unsafe {
        let _ = set;
        let hi_t = vld1q_u8(nib.0.as_ptr());
        let lo_t = vld1q_u8(nib.1.as_ptr());
        loop {
            let v = vld1q_u8(src.as_ptr().add(p));
            let hi = vqtbl1q_u8(hi_t, vshrq_n_u8::<4>(v));
            let lo = vqtbl1q_u8(lo_t, vandq_u8(v, vdupq_n_u8(15)));
            let k = scan::first_lane(vtstq_u8(hi, lo));
            if k < 16 {
                return p + k;
            }
            p += 16;
        }
    }
    #[cfg(not(target_arch = "aarch64"))]
    {
        let _ = nib;
        while !set[at(src, p) as usize] {
            p += 1;
        }
        p
    }
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

    /// `[lhs, rhs)` as `hl` when it is non-empty (`$emitTok`).
    #[inline(always)]
    fn emit(&mut self, hl: u32, lhs: usize, rhs: usize) {
        if lhs < rhs {
            self.tok(hl, rhs);
        }
    }

    /// Whitespace `[lhs, rhs)` extends the last record (`$emitGap`). Every
    /// gap after the input's leading whitespace follows a token's record.
    #[inline(always)]
    fn gap(&mut self, lhs: usize, rhs: usize) {
        if lhs < rhs {
            // SAFETY: the record before `cur` is written (see above).
            unsafe { (*self.cur.sub(1)).end = rhs as u32 };
        }
    }
}

/// The end of the escape at backslash `p` (`$lexEscapeEnd`).
#[inline(always)]
fn escape_end(src: &[u8], p: usize, end: usize) -> usize {
    let mut e = scan::utf8_span_end(src, p + 2, end);
    if e == p + 2 && at(src, p + 1) == b'\r' && e < end && at(src, e) == b'\n' {
        e += 1;
    }
    e
}

/// The end of the number at `p` (`$lexScanNumber`, `$lexScanNumberBody`).
/// The NUL after the input stops it.
fn number_end(src: &[u8], mut p: usize) -> usize {
    let hex = at(src, p) == b'0' && at(src, p + 1) | 0x20 == b'x';
    let mut prev = 0u8;
    loop {
        let c = at(src, p);
        if is_ident_continue(c) {
            prev = c;
            p += 1;
            continue;
        }
        if c == b'.' {
            if !is_digit(at(src, p + 1)) {
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

/// Whether the bytes at `p` can begin the argument of a function
/// application: a name, a literal, an opening bracket, a path, or a search
/// path (`$nixIsArgAt`).
#[inline(always)]
fn is_arg_at(src: &[u8], p: usize) -> bool {
    let c = at(src, p);
    if ARG_START[c as usize] {
        return true;
    }
    // (every byte after `c` is read only when `c` lies inside the input)
    let c2 = at(src, p + 1);
    match c {
        b'\'' => c2 == b'\'',
        b'<' | b'~' => is_ident_start(c2) || c2 == b'/',
        b'.' => c2 == b'/' || (c2 == b'.' && at(src, p + 2) == b'/'),
        b'/' => PATH[c2 as usize] && c2 != b'/',
        _ => false,
    }
}

/// A string body from `ptr` with the bytes since `seg` not yet emitted;
/// `kind` is 1 for a `"` string, with backslash escapes, and 2 for an
/// `''` indented string, whose escapes are `'''`, `''$`, and `''\`. Returns
/// the new position and 1 past the closer, 2 past a `${` that opens a
/// splice (emitted as `punctuation.special`; with `nested`, inside a
/// splice, `${` stays plain), or 0 at the input end (`$nixStringBody`).
#[inline(never)]
fn string_body(
    src: &[u8],
    end: usize,
    mut ptr: usize,
    kind: u32,
    nested: bool,
    mut seg: usize,
    out: &mut Out,
) -> (usize, u32) {
    let mut o = *out;
    let status = loop {
        let p = if kind == 1 {
            scan::find3(src, ptr, end, b'"', b'\\', b'$')
        } else {
            scan::find3(src, ptr, end, b'\'', b'$', b'$')
        };
        if p >= end {
            ptr = end;
            break 0;
        }
        let c = at(src, p);
        let c2 = at(src, p + 1);
        if c == b'"' {
            ptr = p + 1;
            o.emit(tok::STRING, seg, ptr);
            *out = o;
            return (ptr, 1);
        }
        if c == b'\\' {
            o.emit(tok::STRING, seg, p);
            let e = escape_end(src, p, end);
            o.emit(tok::STRING_ESCAPE, p, e);
            ptr = e;
            seg = e;
            continue;
        }
        if c == b'\'' {
            if c2 != b'\'' {
                ptr = p + 1;
                continue;
            }
            let c3 = at(src, p + 2);
            // `'''`, `''$`, and `''\x` escape; any other `''` closes
            let e = if c3 == b'\'' || c3 == b'$' {
                p + 3
            } else if c3 == b'\\' {
                escape_end(src, p + 2, end)
            } else {
                ptr = p + 2;
                o.emit(tok::STRING, seg, ptr);
                *out = o;
                return (ptr, 1);
            };
            o.emit(tok::STRING, seg, p);
            o.emit(tok::STRING_ESCAPE, p, e);
            ptr = e;
            seg = e;
            continue;
        }
        // `$`
        if c2 == b'{' && !nested {
            o.emit(tok::STRING, seg, p);
            ptr = p + 2;
            o.tok(tok::PUNCTUATION_SPECIAL, ptr);
            *out = o;
            return (ptr, 2);
        }
        ptr = p + 1;
    };
    o.emit(tok::STRING, seg, ptr);
    *out = o;
    (ptr, status)
}

/// Lex the Nix input of `len` bytes at `base` (`$hlNix`).
fn highlight(inst: &mut Instance, base: usize, len: usize) {
    let mem_ptr = inst.mem.bytes().as_ptr();
    // SAFETY: `base..base + len + 96` lies inside lexer memory, which is not
    // reallocated while this lexer runs.
    let src: &[u8] = unsafe { core::slice::from_raw_parts(mem_ptr.add(base), len + 96) };
    let end = len;
    let v = &mut inst.ext.recs;
    let start = v.as_mut_ptr();
    let mut o = Out {
        // SAFETY: `len` records are written.
        cur: unsafe { start.add(v.len()) },
        // SAFETY: one past the allocation.
        limit: unsafe { start.add(v.capacity()) },
        last: v.last().map_or(u32::MAX, |r| r.token),
    };

    // 1 inside a `"` body, 2 inside an `''` body, with `seg` the start of
    // the bytes not yet emitted
    let mut str_kind = 0u32;
    let mut seg = 0usize;
    // braces inside a `${` splice, and the body to return to
    let mut interp = 0u32;
    let mut interp_kind = 0u32;
    // after a value: a name, a literal, or a closer
    let mut after_value = false;
    // after `.`
    let mut member = false;
    // from `inherit` to its `;`
    let mut inherit = false;
    // the open bracket kinds, two bits each, and the stack's height
    let mut brackets = 0u32;
    let mut depth = 0u32;

    // `$lexEmitLeadingContinuation` and the leading whitespace: one gap,
    // which writes the first record when there is none yet.
    let mut ptr = scan::utf8_span_end(src, 0, end);
    while SPACE[at(src, ptr) as usize] {
        ptr += 1;
    }
    if ptr > 0 {
        if o.cur == start {
            o.tok(tok::NONE, ptr);
        } else {
            o.gap(0, ptr);
        }
    }
    loop {
        // an open string body
        if str_kind != 0 {
            if ptr >= end {
                break;
            }
            let mut t = o;
            let (q, status) = string_body(src, end, ptr, str_kind, interp != 0, seg, &mut t);
            o = t;
            ptr = q;
            seg = ptr;
            if status == 2 {
                interp_kind = str_kind;
                interp = 1;
                str_kind = 0;
                after_value = false;
            } else if status == 1 {
                str_kind = 0;
                after_value = true;
            }
            continue;
        }

        let gap = ptr;
        if at(src, ptr) == b' ' && !SPACE[at(src, ptr + 1) as usize] {
            // one space
            ptr += 1;
        } else {
            loop {
                // runs of spaces (indentation), then one other whitespace
                // byte
                while at(src, ptr) == b' ' {
                    ptr += 1;
                }
                if !SPACE[at(src, ptr) as usize] {
                    break;
                }
                ptr += 1;
            }
        }
        o.gap(gap, ptr);
        if ptr >= end {
            break;
        }
        let lhs = ptr;
        let c = at(src, ptr);
        let c2 = at(src, ptr + 1);
        // (read only after `c2` was found inside the input)
        let c3 = at(src, ptr + 2);
        let top = brackets & 3;

        if c == b'#' {
            ptr = scan::line_end(src, ptr + 1, end);
            o.tok(tok::COMMENT, ptr);
            continue;
        }
        if c == b'/' && c2 == b'*' {
            ptr = scan::block_comment_end(src, (ptr + 2).min(end), end);
            o.tok(tok::COMMENT, ptr);
            continue;
        }

        // string openers are emitted at once; the body is scanned at the
        // top of the loop
        if c == b'"' {
            str_kind = 1;
            ptr += 1;
            o.tok(tok::STRING, ptr);
            seg = ptr;
            member = false;
            continue;
        }
        if c == b'\'' && c2 == b'\'' {
            str_kind = 2;
            ptr += 2;
            o.tok(tok::STRING, ptr);
            seg = ptr;
            member = false;
            continue;
        }

        // `//` updates, `/x` opens a path
        if c == b'/' && c2 == b'/' {
            ptr += 2;
            o.tok(tok::OPERATOR, ptr);
            after_value = false;
            continue;
        }
        // paths: `./x`, `../x`, `/x`, `~/x`
        if (c == b'/' && PATH[c2 as usize])
            || (c == b'.' && (c2 == b'/' || (c2 == b'.' && c3 == b'/')))
            || (c == b'~' && c2 == b'/')
        {
            // the `~` of a home path is not a path byte itself
            if c == b'~' {
                ptr += 1;
            }
            while PATH[at(src, ptr) as usize] {
                ptr += 1;
            }
            o.tok(tok::STRING_SPECIAL, ptr);
            after_value = true;
            member = false;
            continue;
        }
        // `<nixpkgs>` search paths
        if c == b'<' && is_ident_start(c2) {
            let mut p = ptr + 1;
            while PATH[at(src, p) as usize] {
                p += 1;
            }
            if at(src, p) == b'>' {
                ptr = p + 1;
                o.tok(tok::STRING_SPECIAL, ptr);
                after_value = true;
                continue;
            }
        }

        if is_ident_start(c) && c != b'$' {
            // names take `-` and `'`: `hello-world`, `x'`
            // (NUL ends the name, so the scan stops at the input end)
            ptr = find_set(src, ptr + 1, &NAME_STOP_NIB, &NAME_STOP);
            let rhs = ptr;
            // `https://...` unquoted URIs
            if at(src, rhs) == b':' && at(src, rhs + 1) == b'/' && at(src, rhs + 2) == b'/' {
                while URI[at(src, ptr) as usize] {
                    ptr += 1;
                }
                o.tok(tok::STRING, ptr);
                after_value = true;
                member = false;
                continue;
            }
            let mut p = rhs;
            while at(src, p) == b' ' || at(src, p) == b'\t' {
                p += 1;
            }
            let pc = at(src, p);
            let kind = if member || inherit {
                -1
            } else {
                WORDS.value(src, lhs, rhs)
            };
            let hl;
            if kind >= 0 {
                hl = kind as u32;
                // `inherit` names attributes until its `;`
                if hl == tok::KEYWORD && rhs - lhs == 7 && src[lhs..lhs + 4] == *b"inhe" {
                    inherit = true;
                }
                after_value = hl == tok::BOOLEAN || hl == tok::CONSTANT_BUILTIN;
            } else {
                hl = if inherit {
                    tok::PROPERTY
                } else if pc == b'=' && at(src, p + 1) != b'=' {
                    // `name =` defines an attribute
                    tok::PROPERTY
                } else if pc == b':'
                    || (top == BRACES && !member && (pc == b',' || pc == b'?' || pc == b'}'))
                {
                    // `name:` binds a parameter, and so does a name in a
                    // `{ a, b ? x }` pattern
                    tok::VARIABLE_PARAMETER
                } else if !after_value && top != LIST && is_arg_at(src, p) {
                    // the head of an application - a name before an
                    // argument that no value precedes, outside a list - is
                    // the function applied
                    tok::FUNCTION
                } else if member {
                    tok::PROPERTY
                } else {
                    tok::VARIABLE
                };
                after_value = true;
            }
            o.tok(hl, rhs);
            member = false;
            continue;
        }

        if is_digit(c) {
            ptr = number_end(src, ptr);
            o.tok(tok::NUMBER, ptr);
            after_value = true;
            member = false;
            continue;
        }

        match c {
            b'(' | b')' | b'[' | b']' | b'{' | b'}' => {
                ptr += 1;
                if interp != 0 {
                    if c == b'{' {
                        interp = interp.wrapping_add(1);
                    }
                    if c == b'}' {
                        interp = interp.wrapping_sub(1);
                        if interp == 0 {
                            // the brace matching `${` returns to the string
                            // body
                            o.tok(tok::PUNCTUATION_SPECIAL, ptr);
                            str_kind = interp_kind;
                            interp_kind = 0;
                            seg = ptr;
                            member = false;
                            continue;
                        }
                    }
                }
                o.tok(tok::PUNCTUATION_BRACKET, ptr);
                if c == b'(' || c == b'[' || c == b'{' {
                    let k = if c == b'(' {
                        PAREN
                    } else if c == b'[' {
                        LIST
                    } else {
                        BRACES
                    };
                    brackets = brackets << 2 | k;
                    depth = depth.wrapping_add(1);
                    after_value = false;
                } else {
                    if depth != 0 {
                        brackets >>= 2;
                        depth -= 1;
                    }
                    after_value = true;
                }
                member = false;
                continue;
            }
            b';' | b',' => {
                ptr += 1;
                o.tok(tok::PUNCTUATION_DELIMITER, ptr);
                after_value = false;
                member = false;
                if c == b';' {
                    inherit = false;
                }
                continue;
            }
            // `...` in a pattern; `.` selects an attribute
            b'.' => {
                if c2 == b'.' && c3 == b'.' {
                    ptr += 3;
                    o.tok(tok::VARIABLE_SPECIAL, ptr);
                    after_value = true;
                } else {
                    ptr += 1;
                    o.tok(tok::PUNCTUATION_DELIMITER, ptr);
                    member = true;
                    after_value = false;
                }
                continue;
            }
            _ => {}
        }

        if OP[c as usize] {
            // a comment opener ends the run
            while OP[at(src, ptr) as usize] && !(at(src, ptr) == b'/' && at(src, ptr + 1) == b'*') {
                ptr += 1;
            }
            o.tok(tok::OPERATOR, ptr);
            after_value = false;
            member = false;
            continue;
        }

        ptr = scan::utf8_span_end(src, ptr + 1, end);
        o.tok(tok::NONE, ptr);
        member = false;
    }
    // SAFETY: the records before `cur` are written.
    unsafe { inst.ext.recs.set_len(o.cur.offset_from(start) as usize) };
}
