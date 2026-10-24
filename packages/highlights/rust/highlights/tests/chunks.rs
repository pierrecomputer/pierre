use highlights::{Highlighter, Rec, language_id, parallel};

fn fixture(name: &str) -> Vec<u8> {
    std::fs::read(format!(
        "{}/../../benchmark/fixtures/{name}",
        env!("CARGO_MANIFEST_DIR")
    ))
    .unwrap()
}

#[test]
fn chunked_matches_whole() {
    // TS is left out: its `:` classification peeks across line breaks, so
    // segmented lexing matches streaming, not whole-input lexing.
    for (name, copies) in [
        ("large.jsonc.txt", 10),
        ("large.css.txt", 10),
        ("large.html.txt", 10),
    ] {
        let input = fixture(name).repeat(copies);
        let lang = language_id(name.split('.').nth(1).unwrap()).unwrap();
        let mut hl = Highlighter::new();
        hl.input_mut(input.len()).copy_from_slice(&input);
        let single: Vec<Rec> = hl.tokenize(lang, input.len()).to_vec();
        let (par, _) = parallel::tokenize(lang, &input, 16);
        let at = par.iter().zip(&single).position(|(a, b)| a != b);
        if let Some(at) = at {
            let start = if at > 0 {
                single[at - 1].end as usize
            } else {
                0
            };
            panic!(
                "{name}: first difference at record {at} (byte {start}): par {:?} single {:?}\ntext: {:?}",
                &par[at.saturating_sub(1)..at + 2],
                &single[at.saturating_sub(1)..at + 2],
                String::from_utf8_lossy(&input[start.saturating_sub(40)..start + 40])
            );
        }
        assert_eq!(par.len(), single.len(), "{name}");
    }
}
