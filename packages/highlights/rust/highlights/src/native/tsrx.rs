//! WAT sources: src/langs/jsx.wat src/langs/tsx.wat src/langs/tsrx.wat src/langs/js.wat src/langs/ts.wat src/sig.wat src/scan.wat src/common.wat
//!
//! Native TSRX highlighter: the JSX lexer of [`super::jsx`] with
//! TypeScript and the TSRX syntax and rules (directives, statement
//! containers, `<script>` and `<style>` bodies).

use super::Lexer;

pub(crate) fn lexer(name: &str) -> Option<Lexer> {
    (name == "tsrx").then_some(super::jsx::tsrx as Lexer)
}
