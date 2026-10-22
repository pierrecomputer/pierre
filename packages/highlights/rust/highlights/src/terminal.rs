//! 24-bit ANSI terminal output from token records.

use crate::theme::{Color, Theme};
use crate::{Rec, TOKEN_TYPES, TokenKind};

/// Options for [`crate::Highlighter::terminal`].
#[derive(Clone, Copy, Debug)]
pub struct TerminalOptions {
    /// Paint the theme's background behind the code, out to the end of
    /// each line, instead of leaving the terminal's own background.
    pub background: bool,
}

impl Default for TerminalOptions {
    fn default() -> Self {
        TerminalOptions { background: true }
    }
}

/// Bytes that need care in terminal output: line breaks, and control
/// characters, which are shown in caret notation (`^[`) so file contents
/// cannot send escape sequences to the terminal.
const fn special_table() -> [bool; 256] {
    let mut t = [false; 256];
    let mut b = 0;
    while b < 32 {
        t[b] = b != b'\t' as usize;
        b += 1;
    }
    t[0x7f] = true;
    t
}
static SPECIAL: [bool; 256] = special_table();

/// Escape sequences for one theme. The background is set once at the start;
/// a token then only changes the foreground color and toggles italic and
/// bold, from each of the four italic/bold states the text may be in.
struct Palette {
    /// Reset, then the background if painted.
    start: Vec<u8>,
    /// `sgr[kind * 4 + previous]`, where `previous` is the italic (bit 0)
    /// and bold (bit 1) state before the token, padded to [`SGR_SLOT`]
    /// bytes so one fixed-size copy writes it; `sgr_len` is its length.
    sgr: Vec<[u8; SGR_SLOT]>,
    sgr_len: Vec<u8>,
    /// The italic/bold state after each kind.
    attrs: Vec<u8>,
    /// Kinds with the same style share a key, so switching between them
    /// emits nothing.
    key: Vec<u64>,
}

/// Room for the longest sequence, `\x1b[38;2;255;255;255;23;22m`.
const SGR_SLOT: usize = 32;

fn push_num(out: &mut Vec<u8>, n: u8) {
    if n >= 100 {
        out.push(b'0' + n / 100);
    }
    if n >= 10 {
        out.push(b'0' + n / 10 % 10);
    }
    out.push(b'0' + n % 10);
}

fn push_rgb(out: &mut Vec<u8>, c: Color) {
    push_num(out, c.r);
    out.push(b';');
    push_num(out, c.g);
    out.push(b';');
    push_num(out, c.b);
}

impl Palette {
    fn new(theme: &Theme, options: &TerminalOptions) -> Self {
        let black = Color {
            r: 0,
            g: 0,
            b: 0,
            a: 255,
        };
        let bg = theme.background().map(|c| c.over(black));
        let base = bg.unwrap_or(black);
        let fg = theme.foreground().map(|c| c.over(base));
        let mut start = b"\x1b[0".to_vec();
        if let (true, Some(c)) = (options.background, bg) {
            start.extend_from_slice(b";48;2;");
            push_rgb(&mut start, c);
        }
        start.push(b'm');
        let kinds = TOKEN_TYPES.len();
        let mut sgr = Vec::with_capacity(kinds * 4);
        let mut sgr_len = Vec::with_capacity(kinds * 4);
        let mut attrs = Vec::with_capacity(kinds);
        let mut key = Vec::with_capacity(kinds);
        for kind in 0..kinds as u32 {
            let style = theme.style(TokenKind(kind));
            let color = style.color.map(|c| c.over(base)).or(fg);
            let italic = style.italic;
            let bold = style.weight >= 600;
            for previous in 0..4u8 {
                let mut s = b"\x1b[".to_vec();
                match color {
                    Some(c) => {
                        s.extend_from_slice(b"38;2;");
                        push_rgb(&mut s, c);
                    }
                    None => s.extend_from_slice(b"39"),
                }
                match (italic, previous & 1 != 0) {
                    (true, false) => s.extend_from_slice(b";3"),
                    (false, true) => s.extend_from_slice(b";23"),
                    _ => {}
                }
                match (bold, previous & 2 != 0) {
                    (true, false) => s.extend_from_slice(b";1"),
                    (false, true) => s.extend_from_slice(b";22"),
                    _ => {}
                }
                s.push(b'm');
                let mut slot = [0u8; SGR_SLOT];
                slot[..s.len()].copy_from_slice(&s);
                sgr.push(slot);
                sgr_len.push(s.len() as u8);
            }
            attrs.push(italic as u8 | (bold as u8) << 1);
            let packed = color.map_or(1 << 40, |c| {
                (c.r as u64) << 16 | (c.g as u64) << 8 | c.b as u64
            });
            key.push(packed | (italic as u64) << 32 | (bold as u64) << 33);
        }
        Palette {
            start,
            sgr,
            sgr_len,
            attrs,
            key,
        }
    }
}

/// Whether any of the 8 bytes of `w` is below 0x20 or is 0x7f, the bytes
/// [`SPECIAL`] may hold (it also holds TAB, which this flags too).
#[inline(always)]
fn has_control(w: u64) -> bool {
    const ONES: u64 = 0x0101_0101_0101_0101;
    const HIGH: u64 = 0x8080_8080_8080_8080;
    let below = w.wrapping_sub(0x20 * ONES) & !w & HIGH;
    let x = w ^ (0x7f * ONES);
    let del = x.wrapping_sub(ONES) & !x & HIGH;
    below | del != 0
}

/// Render the first `len` bytes of `input` from their token records as
/// 24-bit ANSI text into `out`.
pub(crate) fn render(
    theme: &Theme,
    options: &TerminalOptions,
    input: &[u8],
    len: usize,
    recs: &[Rec],
    out: &mut Vec<u8>,
) {
    let palette = Palette::new(theme, options);
    // Erase to the end of the line in the current background before each
    // line break, so the background reaches the terminal edge.
    let eol: &[u8] = if options.background { b"\x1b[K" } else { b"" };
    // Worst case: every input byte becomes two (caret notation) or a line
    // break becomes four (with the erase); one sequence per record; fixed
    // 32-byte copies may write past the end.
    // Each line also starts by restating the style (see below).
    let lines = input[..len].iter().filter(|&&b| b == b'\n').count();
    let cap = palette.start.len()
        + len * 4
        + recs.len() * SGR_SLOT
        + lines * (palette.start.len() + SGR_SLOT)
        + 64;
    out.reserve(cap);
    let base = out.as_mut_ptr().wrapping_add(out.len());
    // SAFETY: every write stays within `cap` bytes of `base` (see above),
    // and every read of `input` stays within `len`.
    unsafe {
        let mut dst = base;
        let put = |dst: &mut *mut u8, bytes: &[u8]| {
            core::ptr::copy_nonoverlapping(bytes.as_ptr(), *dst, bytes.len());
            *dst = dst.add(bytes.len());
        };
        put(&mut dst, &palette.start);
        let mut current = u64::MAX;
        let mut state = 0u8;
        let mut start = 0;
        for r in recs {
            let end = r.end as usize;
            let kind = r.token as usize;
            if *palette.key.get_unchecked(kind) != current {
                let at = kind * 4 + state as usize;
                dst.cast::<[u8; SGR_SLOT]>()
                    .write_unaligned(*palette.sgr.get_unchecked(at));
                dst = dst.add(*palette.sgr_len.get_unchecked(at) as usize);
                current = *palette.key.get_unchecked(kind);
                state = *palette.attrs.get_unchecked(kind);
            }
            let text = &input[start..end];
            let mut from = 0;
            let mut i = 0;
            while i < text.len() {
                // Skip 8 plain bytes at a time.
                if i + 8 <= text.len()
                    && !has_control(u64::from_le_bytes(text[i..i + 8].try_into().unwrap()))
                {
                    i += 8;
                    continue;
                }
                let b = text[i];
                if !SPECIAL[b as usize] {
                    i += 1;
                    continue;
                }
                put(&mut dst, &text[from..i]);
                match b {
                    b'\n' => {
                        put(&mut dst, eol);
                        put(&mut dst, b"\n");
                        // Restate the full style at the start of every line.
                        // Pagers such as `less` draw each line on its own, so
                        // a color set on an earlier line would not carry over.
                        put(&mut dst, &palette.start);
                        if i + 1 < text.len() {
                            let at = kind * 4;
                            dst.cast::<[u8; SGR_SLOT]>()
                                .write_unaligned(*palette.sgr.get_unchecked(at));
                            dst = dst.add(*palette.sgr_len.get_unchecked(at) as usize);
                            state = *palette.attrs.get_unchecked(kind);
                        } else {
                            // The token ends here; the next one sets its own.
                            current = u64::MAX;
                            state = 0;
                        }
                    }
                    // CRLF: the LF ends the line; a carriage return would
                    // move the cursor and let the erase above wipe the line.
                    b'\r'
                        if text.get(i + 1) == Some(&b'\n')
                            || (i + 1 == text.len() && input.get(end) == Some(&b'\n')) => {}
                    _ => put(&mut dst, &[b'^', b ^ 0x40]),
                }
                i += 1;
                from = i;
            }
            put(&mut dst, &text[from..]);
            start = end;
        }
        // Finish an unterminated last line like the others.
        if len > 0 && input[len - 1] != b'\n' {
            put(&mut dst, eol);
        }
        put(&mut dst, b"\x1b[0m");
        out.set_len(out.len() + dst.offset_from(base) as usize);
    }
}
