//! WAT sources: src/langs/nix.wat src/common.wat src/scan.wat
//!
//! Native Nix lexer. Names are colored by where they stand: an attribute
//! before `=`, a parameter before `:` or in a `{ a, b ? x }` pattern, the
//! function at the head of an application, a property after `.` or
//! `inherit`. Strings (`"..."` and `''...''`) span lines and carry `${...}`
//! splices, which are lexed as expressions. Paths, search paths, and URIs
//! are literals. The records equal the translated `nix` lexer's records.

use super::Lexer;
use super::input::Input;
use super::recs::Recs;
use super::scan;
use super::tables::{KeywordTable, byteset};
use crate::generated::Instance;
use crate::simd::V;
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
fn find_set(inp: Input, mut p: usize, nib: &([u8; 16], [u8; 16])) -> usize {
    let hi_t = V::from_array(&nib.0);
    let lo_t = V::from_array(&nib.1);
    loop {
        // SAFETY: each 16-byte load starts at or before a set byte that
        // lies at most 16 bytes past the input end, inside the slack.
        let v = unsafe { inp.vec_unchecked(p) };
        let k = hi_t
            .lookup(v.shr::<4>())
            .test(lo_t.lookup(v.and(V::splat(15))))
            .first();
        if k < 16 {
            return p + k;
        }
        p += 16;
    }
}

/// The end of the escape at backslash `p` (`$lexEscapeEnd`).
#[inline(always)]
fn escape_end(inp: Input, p: usize, end: usize) -> usize {
    let mut e = scan::utf8_span_end(inp.bytes(), p + 2, end);
    if e == p + 2 && inp.byte(p + 1) == b'\r' && e < end && inp.byte(e) == b'\n' {
        e += 1;
    }
    e
}

/// The end of the number at `p` (`$lexScanNumber`, `$lexScanNumberBody`).
/// The NUL after the input stops it.
fn number_end(inp: Input, mut p: usize) -> usize {
    // SAFETY: `p` lies at a digit inside the input, so `p + 1` is at most
    // the NUL.
    let hex = unsafe { inp.byte_unchecked(p) == b'0' && inp.byte_unchecked(p + 1) | 0x20 == b'x' };
    let mut prev = 0u8;
    loop {
        // SAFETY: the NUL at the input end stops the run.
        let c = unsafe { inp.byte_unchecked(p) };
        if is_ident_continue(c) {
            prev = c;
            p += 1;
            continue;
        }
        if c == b'.' {
            // SAFETY: `p` lies before the NUL, so `p + 1` is at most the NUL.
            if !is_digit(unsafe { inp.byte_unchecked(p + 1) }) {
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
fn is_arg_at(inp: Input, p: usize) -> bool {
    // SAFETY: `p` ends a blank run, which the NUL at the input end stops.
    let c = unsafe { inp.byte_unchecked(p) };
    if ARG_START[c as usize] {
        return true;
    }
    // SAFETY: every byte after `c` is read only when `c` lies inside the
    // input, so `p + 2` is at most the NUL.
    let c2 = unsafe { inp.byte_unchecked(p + 1) };
    match c {
        b'\'' => c2 == b'\'',
        b'<' | b'~' => is_ident_start(c2) || c2 == b'/',
        b'.' => c2 == b'/' || (c2 == b'.' && unsafe { inp.byte_unchecked(p + 2) } == b'/'),
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
    inp: Input,
    end: usize,
    mut ptr: usize,
    kind: u32,
    nested: bool,
    mut seg: usize,
    out: &mut Recs,
) -> (usize, u32) {
    let mut o = *out;
    let status = loop {
        let p = if kind == 1 {
            scan::find3(inp.bytes(), ptr, end, b'"', b'\\', b'$')
        } else {
            scan::find3(inp.bytes(), ptr, end, b'\'', b'$', b'$')
        };
        if p >= end {
            ptr = end;
            break 0;
        }
        // SAFETY: `p` lies before the input end, so `p + 1` is at most the
        // NUL.
        let (c, c2) = unsafe { (inp.byte_unchecked(p), inp.byte_unchecked(p + 1)) };
        if c == b'"' {
            ptr = p + 1;
            o.emit(tok::STRING, seg, ptr);
            *out = o;
            return (ptr, 1);
        }
        if c == b'\\' {
            o.emit(tok::STRING, seg, p);
            let e = escape_end(inp, p, end);
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
            // SAFETY: `p + 1` holds a `'`, inside the input, so `p + 2` is
            // at most the NUL.
            let c3 = unsafe { inp.byte_unchecked(p + 2) };
            // `'''`, `''$`, and `''\x` escape; any other `''` closes
            let e = if c3 == b'\'' || c3 == b'$' {
                p + 3
            } else if c3 == b'\\' {
                escape_end(inp, p + 2, end)
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
    // SAFETY: the input and its slack lie inside lexer memory, and this
    // lexer calls no translated code that could move it.
    let inp = unsafe { Input::new(inst, base, len) };
    let end = len;
    let mut o = Recs::load(inst);

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
    let mut ptr = scan::utf8_span_end(inp.bytes(), 0, end);
    // SAFETY: the NUL at the input end stops the run.
    while SPACE[unsafe { inp.byte_unchecked(ptr) } as usize] {
        ptr += 1;
    }
    o.gap(0, ptr);
    loop {
        // an open string body
        if str_kind != 0 {
            if ptr >= end {
                break;
            }
            let mut t = o;
            let (q, status) = string_body(inp, end, ptr, str_kind, interp != 0, seg, &mut t);
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
        // SAFETY (the whitespace reads): `ptr` starts at or before the
        // input end, and the NUL there stops each run.
        if unsafe { inp.byte_unchecked(ptr) } == b' '
            && !SPACE[unsafe { inp.byte_unchecked(ptr + 1) } as usize]
        {
            // one space
            ptr += 1;
        } else {
            loop {
                // runs of spaces (indentation), then one other whitespace
                // byte
                while unsafe { inp.byte_unchecked(ptr) } == b' ' {
                    ptr += 1;
                }
                if !SPACE[unsafe { inp.byte_unchecked(ptr) } as usize] {
                    break;
                }
                ptr += 1;
            }
        }
        if gap < ptr {
            o.extend(ptr)
        }
        if ptr >= end {
            break;
        }
        let lhs = ptr;
        // SAFETY: `ptr` lies inside the input, so `ptr + 2` lies inside the
        // slack.
        let c = unsafe { inp.byte_unchecked(ptr) };
        let c2 = unsafe { inp.byte_unchecked(ptr + 1) };
        // (read only after `c2` was found inside the input)
        let c3 = unsafe { inp.byte_unchecked(ptr + 2) };
        let top = brackets & 3;

        if c == b'#' {
            ptr = scan::line_end(inp.bytes(), ptr + 1, end);
            o.tok(tok::COMMENT, ptr);
            continue;
        }
        if c == b'/' && c2 == b'*' {
            ptr = scan::block_comment_end(inp.bytes(), (ptr + 2).min(end), end);
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
            // SAFETY: the NUL at the input end stops the run.
            while PATH[unsafe { inp.byte_unchecked(ptr) } as usize] {
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
            // SAFETY: the NUL at the input end stops the run.
            while PATH[unsafe { inp.byte_unchecked(p) } as usize] {
                p += 1;
            }
            // SAFETY: as above.
            if unsafe { inp.byte_unchecked(p) } == b'>' {
                ptr = p + 1;
                o.tok(tok::STRING_SPECIAL, ptr);
                after_value = true;
                continue;
            }
        }

        if is_ident_start(c) && c != b'$' {
            // names take `-` and `'`: `hello-world`, `x'`
            // (NUL ends the name, so the scan stops at the input end)
            ptr = find_set(inp, ptr + 1, &NAME_STOP_NIB);
            let rhs = ptr;
            // `https://...` unquoted URIs
            // SAFETY (the unchecked reads up to `pc`): the name ends at or
            // before the input end, each later byte is read only past one
            // inside the input, and the NUL there stops the URI and blank
            // runs.
            if unsafe { inp.byte_unchecked(rhs) } == b':'
                && unsafe { inp.byte_unchecked(rhs + 1) } == b'/'
                && unsafe { inp.byte_unchecked(rhs + 2) } == b'/'
            {
                while URI[unsafe { inp.byte_unchecked(ptr) } as usize] {
                    ptr += 1;
                }
                o.tok(tok::STRING, ptr);
                after_value = true;
                member = false;
                continue;
            }
            let mut p = rhs;
            while unsafe { inp.byte_unchecked(p) } == b' '
                || unsafe { inp.byte_unchecked(p) } == b'\t'
            {
                p += 1;
            }
            let pc = unsafe { inp.byte_unchecked(p) };
            let kind = if member || inherit {
                -1
            } else {
                WORDS.value(inp.bytes(), lhs, rhs)
            };
            let hl;
            if kind >= 0 {
                hl = kind as u32;
                // `inherit` names attributes until its `;`
                if hl == tok::KEYWORD && rhs - lhs == 7 && inp.bytes()[lhs..lhs + 4] == *b"inhe" {
                    inherit = true;
                }
                after_value = hl == tok::BOOLEAN || hl == tok::CONSTANT_BUILTIN;
            } else {
                hl = if inherit {
                    tok::PROPERTY
                // SAFETY: `p` holds a `=`, inside the input, so `p + 1` is at
                // most the NUL.
                } else if pc == b'=' && unsafe { inp.byte_unchecked(p + 1) } != b'=' {
                    // `name =` defines an attribute
                    tok::PROPERTY
                } else if pc == b':'
                    || (top == BRACES && !member && (pc == b',' || pc == b'?' || pc == b'}'))
                {
                    // `name:` binds a parameter, and so does a name in a
                    // `{ a, b ? x }` pattern
                    tok::VARIABLE_PARAMETER
                } else if !after_value && top != LIST && is_arg_at(inp, p) {
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
            ptr = number_end(inp, ptr);
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
            // SAFETY: the NUL at the input end stops the run, and `ptr + 1`
            // lies inside the slack.
            while OP[unsafe { inp.byte_unchecked(ptr) } as usize]
                && !(unsafe { inp.byte_unchecked(ptr) } == b'/'
                    && unsafe { inp.byte_unchecked(ptr + 1) } == b'*')
            {
                ptr += 1;
            }
            o.tok(tok::OPERATOR, ptr);
            after_value = false;
            member = false;
            continue;
        }

        ptr = scan::utf8_span_end(inp.bytes(), ptr + 1, end);
        o.tok(tok::NONE, ptr);
        member = false;
    }
    o.store(inst);
}
