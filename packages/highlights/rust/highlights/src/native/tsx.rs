//! WAT sources: src/langs/jsx.wat src/langs/tsx.wat src/langs/tsrx.wat src/langs/js.wat src/langs/ts.wat src/sig.wat src/scan.wat src/common.wat
//!
//! Native TSX highlighter: the JSX lexer of [`super::jsx`] with
//! TypeScript syntax and rules.

use super::Lexer;

pub(crate) fn lexer(name: &str) -> Option<Lexer> {
    (name == "tsx").then_some(super::jsx::tsx as Lexer)
}
