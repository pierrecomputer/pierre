//! Native Rust build of the Highlights syntax highlighter.
//!
//! The lexers are translated from the WAT sources (see `xtask`), so they
//! produce the same output as the WebAssembly package.

mod generated;
mod html;
pub mod parallel;
mod rt;

#[path = "generated/languages.rs"]
mod languages;
#[path = "generated/token_ids.rs"]
pub mod token_ids;
#[path = "generated/token_types.rs"]
mod token_types;

pub use generated::Instance;
pub use html::HtmlTheme;
pub use languages::LANGUAGES;
use rt::PAGE;
pub use rt::Rec;
pub use token_types::TOKEN_TYPES;

/// Lookahead and NUL-sentinel space the lexers may read past the input.
const INPUT_SLACK: usize = 96;
const THEME_TABLE: usize = 64;
const THEME_TABLE_BYTES: usize = 384;

/// Output modes understood by the Wasm driver.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(u8)]
pub enum Mode {
    /// HTML with inline colors from the packed theme table.
    Html = 0,
    /// `(endUtf16, tokenId)` records split at line terminators.
    LineRecords = 3,
}

/// Language id for a name or alias, ignoring ASCII case.
pub fn language_id(name: &str) -> Option<u8> {
    LANGUAGES
        .iter()
        .find(|(n, _)| n.eq_ignore_ascii_case(name))
        .map(|&(_, id)| id)
}

pub struct Highlighter {
    inst: Instance,
    theme: Option<Vec<u8>>,
}

impl Default for Highlighter {
    fn default() -> Self {
        Self::new()
    }
}

impl Highlighter {
    pub fn new() -> Self {
        Highlighter {
            inst: Instance::new(),
            theme: None,
        }
    }

    /// Buffer for `len` input bytes inside lexer memory. Fill it, then call
    /// [`Highlighter::run`] with the same length; no copy happens in between.
    pub fn input_mut(&mut self, len: usize) -> &mut [u8] {
        self.inst.mem.reserve(PAGE + len + INPUT_SLACK);
        &mut self.inst.mem.bytes_mut()[PAGE..PAGE + len]
    }

    /// Write the packed theme table (five bytes per token) used by HTML mode.
    pub fn set_theme_table(&mut self, table: &[u8]) {
        if self.theme.as_deref() == Some(table) {
            return;
        }
        let mem = self.inst.mem.bytes_mut();
        mem[THEME_TABLE..THEME_TABLE + table.len()].copy_from_slice(table);
        mem[THEME_TABLE + table.len()..THEME_TABLE + THEME_TABLE_BYTES].fill(0);
        self.theme = Some(table.to_vec());
    }

    /// Lex the first `len` input bytes with the translated wasm emitter and
    /// return its output bytes, which borrow lexer memory until the next
    /// call. The output equals the JS package's for the same mode.
    pub fn run(&mut self, lang: u8, mode: Mode, len: usize) -> &[u8] {
        let mem = self.inst.mem.bytes_mut();
        mem[0] = lang;
        mem[1] = mode as u8;
        mem[2..6].copy_from_slice(&(len as u32).to_le_bytes());
        mem[PAGE + len] = 0;
        self.inst.export_highlight();
        let mem = self.inst.mem.bytes();
        let start = u32::from_le_bytes(mem[6..10].try_into().unwrap()) as usize;
        let out_len = u32::from_le_bytes(mem[10..14].try_into().unwrap()) as usize;
        &mem[start..start + out_len]
    }

    /// Copy `input` into lexer memory and highlight it.
    pub fn highlight(&mut self, lang: u8, mode: Mode, input: &[u8]) -> &[u8] {
        self.input_mut(input.len()).copy_from_slice(input);
        self.run(lang, mode, input.len())
    }

    /// Lex the first `len` input bytes with the native emitter and return
    /// byte-offset token records. Adjacent tokens with the same id merge, and
    /// whitespace extends the previous token, as in the wasm record mode.
    pub fn tokenize(&mut self, lang: u8, len: usize) -> &[Rec] {
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
        inst.call_table(lang as u32);
        inst.ext.native = false;
        &inst.ext.recs
    }

    /// Lex the current input and render it as HTML into `out`.
    pub fn html(&mut self, lang: u8, len: usize, theme: &HtmlTheme, out: &mut Vec<u8>) {
        self.tokenize(lang, len);
        let input = &self.inst.mem.bytes()[PAGE..PAGE + len + INPUT_SLACK];
        theme.render(input, len, &self.inst.ext.recs, out);
    }
}

/// Where `$lvCaptureBlob` writes a state snapshot: past the input slack.
fn state_blob_addr(len: usize) -> usize {
    (PAGE + len + INPUT_SLACK + 15) & !15
}

/// Room reserved for a state snapshot (stacks plus fixed fields).
const STATE_BLOB_MAX: usize = 4 * PAGE;

impl Highlighter {
    /// Lex the current input as one streaming chunk with the native emitter.
    /// `reset` starts from a fresh lexer state; otherwise the state left by
    /// the previous chunk carries over. `doc_start` allows document-start
    /// syntax (`#!`, front matter) at the chunk's first line.
    pub fn tokenize_chunk(&mut self, lang: u8, len: usize, reset: bool, doc_start: bool) -> &[Rec] {
        let inst = &mut self.inst;
        inst.mem.reserve(state_blob_addr(len) + STATE_BLOB_MAX);
        let mem = inst.mem.bytes_mut();
        mem[0] = lang;
        mem[1] = Mode::LineRecords as u8;
        mem[2..6].copy_from_slice(&(len as u32).to_le_bytes());
        mem[PAGE + len] = 0;
        inst.ext.native = true;
        inst.ext.chunked = true;
        inst.ext.lead_gap_end = 0;
        inst.ext.recs.clear();
        inst.ext.recs.reserve(len / 4 + 16);
        inst.g_srcBase = PAGE as i32;
        inst.g_streaming = 1;
        inst.g_streamReset = reset as i32;
        inst.g_docStart = if doc_start { PAGE as i32 } else { 0 };
        inst.g_streamDepth = 0;
        if reset {
            inst.f_streamResetGlobals();
        }
        inst.f_hlBegin();
        inst.f_streamChunk(lang as i32, reset as i32);
        inst.g_streaming = 0;
        inst.g_streamDepth = 0;
        inst.ext.native = false;
        inst.ext.chunked = false;
        &inst.ext.recs
    }

    /// End of the whitespace before the last chunk's first token, or 0.
    pub fn chunk_lead_gap_end(&self) -> u32 {
        self.inst.ext.lead_gap_end
    }

    /// The records from the last chunk, taken out of the highlighter.
    pub fn take_records(&mut self) -> Vec<Rec> {
        std::mem::take(&mut self.inst.ext.recs)
    }

    /// Serialize the stream lexer state (what the next chunk resumes from)
    /// into `out`, using the live tokenizer's state snapshot. Two equal
    /// snapshots lex the following text identically. `len` is the length of
    /// the last chunk, which the snapshot is written after.
    pub fn capture_state(&mut self, len: usize, out: &mut Vec<u8>) {
        let at = state_blob_addr(len);
        let n = self.inst.export_lvCaptureBlob(at as i32) as usize;
        out.clear();
        out.extend_from_slice(&self.inst.mem.bytes()[at..at + n]);
    }
}
