//! Hand-written native lexers. Each one gives exactly the token records of
//! the translated lexer for its languages, and `tokenize_native` uses it
//! in place of the translated one. `.agents/skills/highlights-native-lexers`
//! describes how to write and maintain one.
//!
//! Every lexer reads a byte slice that extends past the input (the input
//! slack), so word-wide and SIMD scans can load past the end.
//!
//! Shared pieces: [`recs`] writes records, [`tables`] builds keyword tables
//! and byte sets from the WAT's data, and [`scan`] holds SIMD byte scans.
//! The JavaScript and TypeScript lexer is [`fast`], with its classifier
//! rules in [`ecma`] and tables in [`ecma_scan`].

pub mod ecma;
pub mod ecma_scan;
pub mod fast;
pub mod recs;
pub mod scan;
// Used by the per-language modules, which build behind their own features.
#[allow(dead_code)]
pub mod tables;

use crate::generated::Instance;
use crate::rt::PAGE;
use crate::{Highlighter, LANGUAGE_NAMES, Mode, Rec};

/// A native lexer: writes `inst.ext.recs` for the input of `len` bytes at
/// `base` in linear memory, as the translated lexer would. The setup the
/// translated lexers share (`$sigReset`, `$hlBegin`) has already run.
pub(crate) type Lexer = fn(inst: &mut Instance, base: usize, len: usize);

/// The JavaScript lexer.
fn js(inst: &mut Instance, base: usize, len: usize) {
    fast::highlight(inst, base, len, false);
}

/// The TypeScript lexer.
fn ts(inst: &mut Instance, base: usize, len: usize) {
    fast::highlight(inst, base, len, true);
}

/// Declare the per-language lexer modules, each behind its own cargo
/// feature, and the lookup that finds a language's lexer among them. A
/// module provides `pub(crate) fn lexer(name: &str) -> Option<Lexer>`.
macro_rules! lexer_modules {
    ($($feature:literal => $module:ident,)*) => {
        $(
            #[cfg(feature = $feature)]
            pub mod $module;
        )*

        /// The native lexer for the language called `name`, if one is built.
        fn lexer(name: &str) -> Option<Lexer> {
            match name {
                "js" => return Some(js),
                "ts" => return Some(ts),
                _ => {}
            }
            $(
                #[cfg(feature = $feature)]
                if let Some(lexer) = $module::lexer(name) {
                    return Some(lexer);
                }
            )*
            None
        }
    };
}

lexer_modules! {
    "native-angular-html" => angular_html,
    "native-asm" => asm,
    "native-astro" => astro,
    "native-bash" => bash,
    "native-batch" => batch,
    "native-c" => c,
    "native-c3" => c3,
    "native-clojure" => clojure,
    "native-cmake" => cmake,
    "native-cpp" => cpp,
    "native-csharp" => csharp,
    "native-css" => css,
    "native-cuda" => cuda,
    "native-dart" => dart,
    "native-diff" => diff,
    "native-dockerfile" => dockerfile,
    "native-elixir" => elixir,
    "native-elm" => elm,
    "native-erlang" => erlang,
    "native-fortran" => fortran,
    "native-fsharp" => fsharp,
    "native-gdresource" => gdresource,
    "native-gdscript" => gdscript,
    "native-gdshader" => gdshader,
    "native-gleam" => gleam,
    "native-glsl" => glsl,
    "native-go" => go,
    "native-graphql" => graphql,
    "native-groovy" => groovy,
    "native-haskell" => haskell,
    "native-hlsl" => hlsl,
    "native-html" => html,
    "native-java" => java,
    "native-json" => json,
    "native-jsx" => jsx,
    "native-julia" => julia,
    "native-kotlin" => kotlin,
    "native-latex" => latex,
    "native-lisp" => lisp,
    "native-lua" => lua,
    "native-makefile" => makefile,
    "native-markdown" => markdown,
    "native-matlab" => matlab,
    "native-mdx" => mdx,
    "native-nim" => nim,
    "native-nix" => nix,
    "native-objc" => objc,
    "native-ocaml" => ocaml,
    "native-pascal" => pascal,
    "native-perl" => perl,
    "native-php" => php,
    "native-powershell" => powershell,
    "native-proto" => proto,
    "native-python" => python,
    "native-r" => r,
    "native-ruby" => ruby,
    "native-rust" => rust,
    "native-scala" => scala,
    "native-solidity" => solidity,
    "native-sql" => sql,
    "native-svelte" => svelte,
    "native-swift" => swift,
    "native-terraform" => terraform,
    "native-toml" => toml,
    "native-tsrx" => tsrx,
    "native-tsx" => tsx,
    "native-vue" => vue,
    "native-wat" => wat,
    "native-wgsl" => wgsl,
    "native-xml" => xml,
    "native-yaml" => yaml,
    "native-zig" => zig,
}

impl Highlighter {
    /// Lex the first `len` input bytes with the native lexer for `lang`,
    /// returning `None` when it has none. The records equal
    /// [`Highlighter::tokenize`]'s.
    #[doc(hidden)]
    pub fn tokenize_native(&mut self, lang: u8, len: usize) -> Option<&[Rec]> {
        let lexer = lexer(LANGUAGE_NAMES.get(lang as usize)?)?;
        let inst = &mut self.inst;
        let mem = inst.mem.bytes_mut();
        mem[0] = lang;
        mem[1] = Mode::LineRecords as u8;
        mem[2..6].copy_from_slice(&(len as u32).to_le_bytes());
        mem[PAGE + len] = 0;
        inst.ext.native = true;
        inst.ext.recs.clear();
        // Every record covers at least one input byte.
        inst.ext.recs.reserve(len + 2);
        inst.g_srcBase = PAGE as i32;
        inst.g_docStart = PAGE as i32;
        inst.g_streaming = 0;
        inst.g_streamDepth = 0;
        inst.f_sigReset();
        inst.f_hlBegin();
        lexer(inst, PAGE, len);
        inst.ext.native = false;
        Some(&inst.ext.recs)
    }
}
