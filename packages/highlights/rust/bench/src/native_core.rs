//! Benchmark subcommands for the hand-written native lexers (`native-*`
//! features): parity and fuzz checks against the translated lexer, and a
//! profiling loop. A file's language comes from its name or extension.

use std::hint::black_box;
use std::path::Path;
use std::time::Instant;

use highlights::{Highlighter, Language, Rec};

/// The language id for `path` when a native lexer for it is built.
fn core_lang(path: &Path) -> Option<u8> {
    let lang = Language::from_path(path)?;
    let mut hl = Highlighter::new();
    hl.input_mut(0);
    hl.tokenize_native(lang.id(), 0).map(|_| lang.id())
}

/// Compare native and translated records for every file in `paths`; print
/// the first difference per file and a summary. Exits nonzero on mismatch.
pub fn parity(paths: &[String]) {
    let mut hl = Highlighter::new();
    let (mut files, mut bytes, mut bad) = (0, 0, 0);
    for p in paths {
        let path = Path::new(p);
        let Some(lang) = core_lang(path) else {
            continue;
        };
        let Ok(input) = std::fs::read(path) else {
            continue;
        };
        hl.input_mut(input.len()).copy_from_slice(&input);
        let wasm: Vec<Rec> = hl.tokenize(lang, input.len()).to_vec();
        let native: Vec<Rec> = hl.tokenize_native(lang, input.len()).unwrap().to_vec();
        files += 1;
        bytes += input.len();
        if wasm != native {
            bad += 1;
            report(p, &input, &wasm, &native);
        }
    }
    println!("native parity: {files} files, {bytes} bytes, {bad} mismatched");
    if files == 0 {
        println!("no file had a native lexer for its language");
        std::process::exit(1);
    }
    if bad > 0 {
        std::process::exit(1);
    }
}

/// Print the first record where `native` differs from `wasm`, with context.
fn report(label: &str, input: &[u8], wasm: &[Rec], native: &[Rec]) {
    let at = wasm
        .iter()
        .zip(native)
        .position(|(a, b)| a != b)
        .unwrap_or(wasm.len().min(native.len()));
    let p = if at > 0 { wasm[at - 1].end as usize } else { 0 };
    let ctx = |r: &[Rec]| r[at.saturating_sub(1)..(at + 2).min(r.len())].to_vec();
    println!(
        "MISMATCH {label}: record {at} at byte {p}: wasm {:?} native {:?}\n  context: {:?}",
        ctx(wasm),
        ctx(native),
        String::from_utf8_lossy(&input[p.saturating_sub(60)..(p + 40).min(input.len())])
    );
}

/// Lex `file` repeatedly for `secs` with the native core or, when `engine`
/// is `wasm`, the translated lexer; print iterations, records per run, and
/// throughput, for instructions-per-token measurements.
pub fn profile(engine: &str, file: &str, secs: f64) {
    let path = Path::new(file);
    let lang = core_lang(path).expect("no native lexer for this file's language");
    let bytes = std::fs::read(path).unwrap();
    let mut hl = Highlighter::new();
    hl.input_mut(bytes.len()).copy_from_slice(&bytes);
    let native = engine == "native";
    let recs = if native {
        hl.tokenize_native(lang, bytes.len()).unwrap().len()
    } else {
        hl.tokenize(lang, bytes.len()).len()
    };
    let t = Instant::now();
    let mut n = 0u64;
    while t.elapsed().as_secs_f64() < secs {
        if native {
            black_box(hl.tokenize_native(lang, bytes.len()));
        } else {
            black_box(hl.tokenize(lang, bytes.len()));
        }
        n += 1;
    }
    let el = t.elapsed().as_secs_f64();
    let mibs = (n as f64 * bytes.len() as f64) / 1048576.0 / el;
    println!("{engine} {file}: iters {n} recs {recs} {mibs:.0} MiB/s");
}

/// Compare native and translated records on `rounds` mutated copies of the
/// files in `paths`: random cuts, duplicated slices, and inserted syntax
/// bytes, lexed as each language in `langs` (comma-separated names). Exits
/// nonzero on mismatch; the first failing inputs are saved under
/// `target/native-fuzz/<langs>/`.
pub fn fuzz(langs_arg: &str, rounds: usize, paths: &[String]) {
    let inputs: Vec<Vec<u8>> = paths
        .iter()
        .filter_map(|p| std::fs::read(p).ok())
        .filter(|b| !b.is_empty() && b.len() < 64 * 1024)
        .collect();
    assert!(!inputs.is_empty(), "no fuzz inputs");
    let langs: Vec<u8> = langs_arg
        .split(',')
        .map(|name| Language::from_name(name).expect("unknown language").id())
        .collect();
    let out_dir = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../target/native-fuzz")
        .join(langs_arg);
    std::fs::create_dir_all(&out_dir).unwrap();
    const SYNTAX: &[u8] =
        b"(){}[]<>;:,.?!=+-*/%&|^~`'\"\\$#@_ \t\n\r0123456789aAzZ\x80\xc3\xa9\xe2\x80\xa8";
    let mut seed = 0x9e37_79b9_7f4a_7c15u64;
    let mut rand = move |n: usize| {
        seed ^= seed << 13;
        seed ^= seed >> 7;
        seed ^= seed << 17;
        (seed % n.max(1) as u64) as usize
    };
    let mut hl = Highlighter::new();
    let mut bad = 0;
    for round in 0..rounds {
        let mut buf = inputs[rand(inputs.len())].clone();
        for _ in 0..1 + rand(8) {
            let at = rand(buf.len() + 1);
            match rand(4) {
                0 => {
                    let end = (at + rand(64)).min(buf.len());
                    buf.drain(at..end);
                }
                1 => {
                    let from = rand(buf.len() + 1);
                    let end = (from + rand(64)).min(buf.len());
                    let slice = buf[from..end].to_vec();
                    buf.splice(at..at, slice);
                }
                _ => {
                    let bytes: Vec<u8> = (0..1 + rand(4))
                        .map(|_| SYNTAX[rand(SYNTAX.len())])
                        .collect();
                    buf.splice(at..at, bytes);
                }
            }
        }
        if rand(4) == 0 {
            buf.truncate(rand(buf.len() + 1));
        }
        for &lang in &langs {
            hl.input_mut(buf.len()).copy_from_slice(&buf);
            let wasm: Vec<Rec> = hl.tokenize(lang, buf.len()).to_vec();
            let native: Vec<Rec> = hl.tokenize_native(lang, buf.len()).unwrap().to_vec();
            if wasm != native {
                bad += 1;
                if bad <= 5 {
                    let label = format!("round {round} lang {lang}");
                    report(&label, &buf, &wasm, &native);
                    let _ = std::fs::write(out_dir.join(format!("fail-{bad}.txt")), &buf);
                }
            }
        }
    }
    println!(
        "native fuzz: {rounds} inputs x {} languages, {bad} mismatched",
        langs.len()
    );
    if bad > 0 {
        std::process::exit(1);
    }
}
