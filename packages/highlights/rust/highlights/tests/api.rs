//! The public API: tokens, terminal output, themes, and language lookup.

use std::path::Path;

use highlights::{Highlighter, Language, TerminalOptions, Theme};

fn terminal(text: &[u8], background: bool) -> String {
    let mut hl = Highlighter::new();
    hl.set_input(text);
    let mut out = Vec::new();
    let theme = Theme::named("pierre-dark").unwrap();
    hl.terminal(
        Language::from_name("ts").unwrap(),
        &theme,
        &TerminalOptions { background },
        &mut out,
    );
    String::from_utf8(out).unwrap()
}

/// The visible text of terminal output: escape sequences removed.
fn visible(ansi: &str) -> String {
    let mut out = String::new();
    let mut chars = ansi.chars();
    while let Some(c) = chars.next() {
        if c == '\x1b' {
            for c in chars.by_ref() {
                if c.is_ascii_alphabetic() {
                    break;
                }
            }
        } else {
            out.push(c);
        }
    }
    out
}

#[test]
fn tokens_cover_the_input_in_order() {
    let text = b"const x = 'a' + 1; // done\nlet y = x;\n";
    let mut hl = Highlighter::new();
    hl.set_input(text);
    let tokens: Vec<_> = hl.tokens(Language::from_name("ts").unwrap()).collect();
    assert_eq!(tokens.first().unwrap().range.start, 0);
    assert_eq!(tokens.last().unwrap().range.end, text.len());
    for pair in tokens.windows(2) {
        assert_eq!(pair[0].range.end, pair[1].range.start);
    }
    let kinds: Vec<_> = tokens.iter().map(|t| t.kind.name()).collect();
    assert!(kinds.contains(&"keyword.declaration"), "{kinds:?}");
    assert!(kinds.contains(&"comment"), "{kinds:?}");
}

#[test]
fn terminal_text_survives_and_controls_are_shown() {
    let ansi = terminal(b"let a = \"\x1b[31m\";\r\nlet b = 1;\n", true);
    // The escape byte from the input is shown as `^[`, never sent raw, and
    // the CRLF becomes a plain line break.
    assert_eq!(visible(&ansi), "let a = \"^[[31m\";\nlet b = 1;\n");
    assert!(ansi.starts_with("\x1b[0;48;2;"), "theme background first");
    assert!(ansi.contains("\x1b[K\n"), "lines fill to the edge");
    assert!(ansi.ends_with("\x1b[0m"));
}

#[test]
fn terminal_lines_restate_their_style() {
    // A comment spanning lines: each line must carry the comment color on
    // its own, so pagers that draw lines separately keep it.
    let ansi = terminal(b"/* one\ntwo\nthree */ let x = 1;\n", true);
    let lines: Vec<&str> = ansi.split('\n').collect();
    let comment_sgr = lines[0]
        .split('\x1b')
        .find(|s| s.starts_with("[38;2;"))
        .map(|s| &s[..=s.find('m').unwrap()])
        .unwrap();
    for line in &lines[1..3] {
        assert!(line.contains(comment_sgr), "{line:?} lacks {comment_sgr:?}");
    }
}

#[test]
fn terminal_without_background_paints_none() {
    let ansi = terminal(b"let a = 1;\n", false);
    assert!(
        !ansi.contains("48;2;") && !ansi.contains("\x1b[K"),
        "{ansi:?}"
    );
    assert_eq!(visible(&ansi), "let a = 1;\n");
}

#[test]
fn languages_resolve_from_paths_and_names() {
    let name = |p: &str| Language::from_path(Path::new(p)).map(|l| l.name());
    assert_eq!(name("src/app.ts"), Some("ts"));
    assert_eq!(name("main.rs"), Some("rust"));
    assert_eq!(name("Dockerfile"), Some("dockerfile"));
    assert_eq!(name("Makefile"), Some("makefile"));
    assert_eq!(name("notes.unknownext"), None);
    assert_eq!(
        Language::from_name("TypeScript").map(|l| l.name()),
        Some("ts")
    );
}

#[test]
fn bundled_themes_resolve() {
    assert!(Theme::all().count() > 50);
    let theme = Theme::named("pierre-dark").unwrap();
    assert!(theme.background().is_some() && theme.foreground().is_some());
    assert!(Theme::named("no-such-theme").is_none());
}
