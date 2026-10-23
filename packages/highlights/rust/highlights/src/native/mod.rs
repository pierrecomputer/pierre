//! Hand-written native JavaScript and TypeScript lexer (`fast`), with the
//! classifier rules (`ecma`) and tables and scans (`ecma_scan`, `scan`) it
//! uses. Its records match the translated lexer's exactly; the bench's
//! parity check compares them.
//!
//! The lexer reads a byte slice that extends past the input (the input
//! slack), so SIMD scans can load whole vectors at the end.

pub mod ecma;
pub mod ecma_scan;
pub mod fast;
pub mod scan;

use crate::rt::PAGE;
use crate::{Highlighter, Mode, Rec, language_id};

impl Highlighter {
    /// Lex the first `len` input bytes with the hand-written core when one
    /// exists for `lang` (JavaScript and TypeScript), returning `None`
    /// otherwise. The records equal [`Highlighter::tokenize`]'s.
    #[doc(hidden)]
    pub fn tokenize_native(&mut self, lang: u8, len: usize) -> Option<&[Rec]> {
        let ts = if Some(lang) == language_id("ts") {
            true
        } else if Some(lang) == language_id("js") {
            false
        } else {
            return None;
        };
        let inst = &mut self.inst;
        let mem = inst.mem.bytes_mut();
        mem[0] = lang;
        mem[1] = Mode::LineRecords as u8;
        mem[2..6].copy_from_slice(&(len as u32).to_le_bytes());
        mem[PAGE + len] = 0;
        inst.ext.native = true;
        inst.ext.recs.clear();
        inst.ext.recs.reserve(len / 4 + 16);
        inst.g_srcBase = PAGE as i32;
        inst.g_docStart = PAGE as i32;
        inst.g_streaming = 0;
        inst.g_streamDepth = 0;
        inst.f_sigReset();
        inst.f_hlBegin();
        fast::highlight(inst, PAGE, len, ts);
        inst.ext.native = false;
        Some(&inst.ext.recs)
    }
}

#[cfg(all(feature = "native-asm", target_arch = "aarch64"))]
impl Highlighter {
    /// [`Highlighter::tokenize_native`] with the token loop in assembly.
    /// The records are the same.
    #[doc(hidden)]
    pub fn tokenize_native_asm(&mut self, lang: u8, len: usize) -> Option<&[Rec]> {
        let ts = if Some(lang) == language_id("ts") {
            true
        } else if Some(lang) == language_id("js") {
            false
        } else {
            return None;
        };
        let inst = &mut self.inst;
        let mem = inst.mem.bytes_mut();
        mem[0] = lang;
        mem[1] = Mode::LineRecords as u8;
        mem[2..6].copy_from_slice(&(len as u32).to_le_bytes());
        mem[PAGE + len] = 0;
        inst.ext.native = true;
        inst.ext.recs.clear();
        inst.ext.recs.reserve(len / 4 + 16);
        inst.g_srcBase = PAGE as i32;
        inst.g_docStart = PAGE as i32;
        inst.g_streaming = 0;
        inst.g_streamDepth = 0;
        inst.f_sigReset();
        inst.f_hlBegin();
        fast::lexasm::highlight(inst, PAGE, len, ts);
        inst.ext.native = false;
        Some(&inst.ext.recs)
    }
}
