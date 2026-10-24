//! Benchmarks for the native build of Highlights.
//!
//! Default mode: token generation for every language's benchmark input
//! (`gen/bench`), comparing the published wasm in JavaScriptCore (bun) and
//! V8 (node) with the translated lexers in Rust.
//!
//! The JS side produces the wasm's mode-3 records, `(endUtf16, tokenId)`
//! pairs split at line breaks, which `codeToTokens` reads. Rust's main
//! column is `Highlighter::tokenize`: byte-offset records, the Rust API.
//! Rust also runs mode 3 itself, whose bytes must hash-match the JS output,
//! and the byte records must give every byte the same token as mode 3.
//!
//! Usage:
//!   bench [--budget-ms N] [--no-js] [--json OUT] [--pgo PGO.json] [filter]
//!   bench --train DIR          PGO training workload over DIR/corpus.<lang>
//!   bench --parallel           speculative parallel lexing vs one thread
//!   bench --viewport           time to the first or a middle screen
//!   bench --profile FILE SECS  loop one input for a sampling profiler

use std::collections::BTreeMap;
use std::hint::black_box;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::thread;
use std::time::{Duration, Instant};

use highlights::{Highlighter, Mode, Rec};
use serde_json::{Value, json};

#[cfg(feature = "native-core")]
mod native_core;

fn root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("..")
}

/// Time `f` in batches of roughly 2 MB of input until `budget` runs out and
/// return the best batch as MiB/s.
fn measure(bytes: usize, budget: Duration, mut f: impl FnMut()) -> f64 {
    for _ in 0..10 {
        f();
    }
    let batch = (2_000_000 / bytes.max(1)).max(1);
    let deadline = Instant::now() + budget;
    let mut best = f64::INFINITY;
    while Instant::now() < deadline {
        let t = Instant::now();
        for _ in 0..batch {
            f();
        }
        best = best.min(t.elapsed().as_secs_f64() / batch as f64);
    }
    bytes as f64 / 1048576.0 / best
}

/// 32-bit FNV-1a, matching `scripts/bench-wasm.mjs`.
fn fnv1a(bytes: &[u8]) -> u32 {
    let mut h = 0x811c_9dc5u32;
    for &b in bytes {
        h = (h ^ b as u32).wrapping_mul(0x0100_0193);
    }
    h
}

fn read_json(path: &Path) -> Value {
    serde_json::from_slice(
        &std::fs::read(path).unwrap_or_else(|e| panic!("{}: {e}", path.display())),
    )
    .unwrap()
}

/// Run `scripts/bench-wasm.mjs` under a JS runtime and parse its JSON.
fn js_engine(cmd: &str, budget: Duration) -> Option<Value> {
    let root = root();
    let out = Command::new(cmd)
        .arg(root.join("scripts/bench-wasm.mjs"))
        .arg(root.join("gen"))
        .arg(budget.as_millis().to_string())
        .output()
        .ok()?;
    if !out.status.success() {
        eprintln!("{cmd} failed: {}", String::from_utf8_lossy(&out.stderr));
        return None;
    }
    serde_json::from_slice(&out.stdout).ok()
}

struct Input {
    file: String,
    lang_name: String,
    label: String,
    lang: u8,
    bytes: Vec<u8>,
}

fn load_inputs(filter: Option<&str>) -> Vec<Input> {
    let dir = root().join("gen/bench");
    let manifest = read_json(&dir.join("manifest.json"));
    manifest
        .as_array()
        .unwrap()
        .iter()
        .filter_map(|e| {
            let file = e["file"].as_str().unwrap().to_string();
            let label = e["label"].as_str().unwrap().to_string();
            if filter.is_some_and(|f| !label.contains(f)) {
                return None;
            }
            let lang_name = e["lang"].as_str().unwrap().to_string();
            let lang = highlights::language_id(&lang_name).unwrap();
            let bytes = std::fs::read(dir.join(&file)).unwrap();
            Some(Input {
                file,
                lang_name,
                label,
                lang,
                bytes,
            })
        })
        .collect()
}

/// Whether byte records `recs` give every byte of `input` the token the
/// mode-3 records give it. Line terminators, which mode 3 marks with token
/// `0xffffffff`, are skipped.
fn same_tokens(input: &[u8], mode3: &[u8], recs: &[Rec]) -> bool {
    let mut by_byte = vec![u32::MAX; input.len()];
    let mut start = 0;
    for r in recs {
        by_byte[start..r.end as usize].fill(r.token);
        start = r.end as usize;
    }
    let pairs: Vec<(u32, u32)> = mode3
        .as_chunks::<8>()
        .0
        .iter()
        .map(|c| {
            (
                u32::from_le_bytes(c[..4].try_into().unwrap()),
                u32::from_le_bytes(c[4..].try_into().unwrap()),
            )
        })
        .collect();
    let (mut i, mut utf16, mut b) = (0, 0u32, 0);
    while b < input.len() {
        let len = match input[b] {
            0xf0.. => 4,
            0xe0.. => 3,
            0xc0.. => 2,
            _ => 1,
        }
        .min(input.len() - b);
        while i < pairs.len() && pairs[i].0 <= utf16 {
            i += 1;
        }
        let Some(&(_, token)) = pairs.get(i) else {
            return false;
        };
        if token != u32::MAX && by_byte[b..b + len].iter().any(|&t| t != token) {
            return false;
        }
        utf16 += if len == 4 { 2 } else { 1 };
        b += len;
    }
    true
}

/// Rust token-generation throughput for each input, with parity data.
fn measure_rust(inputs: &[Input], budget: Duration) -> BTreeMap<String, Value> {
    let mut hl = Highlighter::new();
    let mut out = BTreeMap::new();
    for input in inputs {
        let n = input.bytes.len();
        // Mode 3 through the translated wasm emitter: the JS records exactly.
        let mode3 = hl
            .highlight(input.lang, Mode::LineRecords, &input.bytes)
            .to_vec();
        let mode3_hash = fnv1a(&mode3);
        let js_format = measure(n, budget, || {
            black_box(hl.highlight(input.lang, Mode::LineRecords, &input.bytes));
        });
        // Byte records through the native emitter: the Rust API.
        hl.input_mut(n).copy_from_slice(&input.bytes);
        let bytes_ok = same_tokens(&input.bytes, &mode3, hl.tokenize(input.lang, n));
        let native = measure(n, budget, || {
            hl.input_mut(n).copy_from_slice(&input.bytes);
            black_box(hl.tokenize(input.lang, n));
        });
        out.insert(
            input.file.clone(),
            json!({ "native": native, "js_format": js_format, "mode3_hash": mode3_hash, "bytes_ok": bytes_ok }),
        );
    }
    out
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    match args.first().map(String::as_str) {
        Some("--train") => return train(Path::new(&args[1])),
        Some("--parallel") => return parallel(),
        Some("--viewport") => return viewport(),
        Some("--html-parity") => return html_parity(&args[1..]),
        #[cfg(feature = "native-core")]
        Some("--native-parity") => return native_core::parity(&args[1..]),
        #[cfg(feature = "native-core")]
        Some("--native-fuzz") => {
            return native_core::fuzz(&args[1], args[2].parse().unwrap(), &args[3..]);
        }
        #[cfg(feature = "native-core")]
        Some("--profile-core") => {
            return native_core::profile(&args[1], &args[2], args[3].parse().unwrap());
        }
        Some("--profile") => {
            return profile(&args[1], args.get(2).map_or(10.0, |s| s.parse().unwrap()));
        }
        _ => {}
    }

    let mut budget = Duration::from_millis(200);
    let mut with_js = true;
    let mut json_out = None;
    let mut pgo_in = None;
    let mut filter = None;
    let mut it = args.iter();
    while let Some(a) = it.next() {
        match a.as_str() {
            "--budget-ms" => budget = Duration::from_millis(it.next().unwrap().parse().unwrap()),
            "--no-js" => with_js = false,
            "--json" => json_out = Some(PathBuf::from(it.next().unwrap())),
            "--pgo" => pgo_in = Some(PathBuf::from(it.next().unwrap())),
            f => filter = Some(f.to_string()),
        }
    }

    let inputs = load_inputs(filter.as_deref());
    let rust = measure_rust(&inputs, budget);
    if let Some(path) = json_out {
        std::fs::write(&path, serde_json::to_vec_pretty(&rust).unwrap()).unwrap();
        println!("wrote {}", path.display());
        return;
    }
    let pgo = pgo_in.map(|p| read_json(&p));
    let (jsc, v8) = if with_js {
        (js_engine("bun", budget), js_engine("node", budget))
    } else {
        (None, None)
    };
    let sources = std::fs::read(root().join("target/train/sources.json"))
        .ok()
        .and_then(|b| serde_json::from_slice::<Value>(&b).ok());

    let num = |v: Option<&Value>, k: &str| v.and_then(|v| v[k].as_f64());
    let fmt = |x: Option<f64>| x.map_or("—".to_string(), |x| format!("{x:.0}"));
    let mut header = vec![
        "language",
        "KiB",
        "JSC",
        "V8",
        "Rust",
        "Rust PGO",
        "PGO/JSC",
        "PGO/V8",
        "PGO JS-format",
        "parity",
    ];
    if sources.is_some() {
        header.push("PGO trained on");
    }
    let mut rows = vec![];
    let mut ratios_jsc = vec![];
    let mut ratios_v8 = vec![];
    let mut mismatches = 0;
    for input in &inputs {
        let r = &rust[&input.file];
        let p = pgo.as_ref().map(|p| &p[&input.file]);
        let j = jsc.as_ref().map(|j| &j[&input.file]);
        let v = v8.as_ref().map(|v| &v[&input.file]);
        let rust_best = num(Some(r), "native");
        let pgo_best = num(p, "native");
        let js_hash = j.or(v).and_then(|x| x["hash"].as_u64());
        let mode3_ok = js_hash.is_none_or(|h| r["mode3_hash"].as_u64() == Some(h));
        let bytes_ok = r["bytes_ok"].as_bool() == Some(true);
        let parity = if mode3_ok && bytes_ok {
            if js_hash.is_some() {
                "ok"
            } else {
                "ok (no JS run)"
            }
            .to_string()
        } else {
            mismatches += 1;
            format!(
                "MISMATCH{}{}",
                if mode3_ok { "" } else { " mode3" },
                if bytes_ok { "" } else { " bytes" }
            )
        };
        let (jm, vm) = (num(j, "mibs"), num(v, "mibs"));
        let ratio = |a: Option<f64>, b: Option<f64>, acc: &mut Vec<f64>| match (a, b) {
            (Some(a), Some(b)) => {
                acc.push(a / b);
                format!("{:.2}×", a / b)
            }
            _ => "—".to_string(),
        };
        let mut row = vec![
            input.label.clone(),
            format!("{}", input.bytes.len() / 1024),
            fmt(jm),
            fmt(vm),
            fmt(rust_best),
            fmt(pgo_best),
            ratio(pgo_best, jm, &mut ratios_jsc),
            ratio(pgo_best, vm, &mut ratios_v8),
            fmt(num(p, "js_format")),
            parity,
        ];
        if let Some(s) = &sources {
            let src = s[&input.lang_name].as_str().unwrap_or("—");
            row.push(if src.starts_with("test sample") {
                "sample (not held out)".into()
            } else {
                "real files".into()
            });
        }
        rows.push(row);
    }

    let widths: Vec<usize> = (0..header.len())
        .map(|i| {
            rows.iter()
                .map(|r| r[i].chars().count())
                .chain([header[i].len()])
                .max()
                .unwrap()
        })
        .collect();
    let line = |cells: &[String]| {
        let parts: Vec<String> = cells
            .iter()
            .enumerate()
            .map(|(i, c)| {
                let pad = widths[i] - c.chars().count();
                if i == 0 || i >= 9 {
                    format!("{c}{}", " ".repeat(pad))
                } else {
                    format!("{}{c}", " ".repeat(pad))
                }
            })
            .collect();
        println!("{}", parts.join("  ").trim_end());
    };
    println!(
        "Token generation, input MiB/s (best batch, {}ms per cell)\n",
        budget.as_millis()
    );
    line(&header.iter().map(|s| s.to_string()).collect::<Vec<_>>());
    for r in &rows {
        line(r);
    }
    let geo = |v: &[f64]| (v.iter().map(|x| x.ln()).sum::<f64>() / v.len() as f64).exp();
    if !ratios_jsc.is_empty() {
        println!(
            "\nPGO vs JSC: geometric mean {:.2}×, min {:.2}×, max {:.2}× over {} inputs",
            geo(&ratios_jsc),
            ratios_jsc.iter().cloned().fold(f64::INFINITY, f64::min),
            ratios_jsc.iter().cloned().fold(0.0, f64::max),
            ratios_jsc.len()
        );
    }
    if !ratios_v8.is_empty() {
        println!(
            "PGO vs V8:  geometric mean {:.2}×, min {:.2}×, max {:.2}× over {} inputs",
            geo(&ratios_v8),
            ratios_v8.iter().cloned().fold(f64::INFINITY, f64::min),
            ratios_v8.iter().cloned().fold(0.0, f64::max),
            ratios_v8.len()
        );
    }
    println!(
        "\nJSC/V8: the published wasm's mode-3 token records (UTF-16, split per line), as codeToTokens\n\
         reads them, before JS token objects. Rust/Rust PGO: Highlighter::tokenize, byte-offset records.\n\
         PGO JS-format: the translated lexers emitting the JS mode-3 records themselves (with PGO).\n\
         Sample inputs repeat a language's test sample to ~128 KiB; fixtures are real files.\n\
         parity: {}",
        if mismatches == 0 {
            "mode-3 records match the JS package byte for byte, and byte records give every byte the same token"
                .to_string()
        } else {
            format!("{mismatches} MISMATCHES")
        }
    );
}

/// PGO training: both token paths and the terminal renderer over each
/// `DIR/corpus.<lang>`.
fn train(dir: &Path) {
    let mut hl = Highlighter::new();
    let theme = highlights::Theme::named("pierre-dark").unwrap();
    let options = highlights::TerminalOptions::default();
    let mut out = Vec::new();
    for e in std::fs::read_dir(dir).unwrap() {
        let path = e.unwrap().path();
        let Some(lang) = path
            .extension()
            .and_then(|e| highlights::language_id(e.to_str()?))
        else {
            continue;
        };
        let input = std::fs::read(&path).unwrap();
        for _ in 0..8 {
            black_box(hl.highlight(lang, Mode::LineRecords, &input));
            hl.input_mut(input.len()).copy_from_slice(&input);
            black_box(hl.tokenize(lang, input.len()));
            #[cfg(feature = "native-core")]
            black_box(hl.tokenize_native(lang, input.len()));
            out.clear();
            hl.terminal(
                highlights::Language::from_name(&path.extension().unwrap().to_string_lossy())
                    .unwrap(),
                &theme,
                &options,
                &mut out,
            );
            black_box(&out);
        }
    }
}

/// Speculative parallel lexing of one large input, and many files at once.
fn parallel() {
    let threads = thread::available_parallelism().map_or(8, |n| n.get());
    let budget = Duration::from_millis(300);
    let dir = root().join("../benchmark/fixtures");
    println!("threads: {threads}\n");
    println!(
        "{:<16} {:>6} {:>9} {:>9} {:>6} {:>8}  stress (64 threads, 1 KiB segments)",
        "input", "KiB", "1 thread", "parallel", "×", "relexed"
    );
    let mut hl = Highlighter::new();
    for name in [
        "large.css.txt",
        "large.html.txt",
        "large.jsonc.txt",
        "large.ts.txt",
    ] {
        let base = std::fs::read(dir.join(name)).unwrap();
        let lang = highlights::language_id(name.split('.').nth(1).unwrap()).unwrap();
        for copies in [1usize, 10] {
            let input = base.repeat(copies);
            let n = input.len();
            hl.input_mut(n).copy_from_slice(&input);
            let single = hl.tokenize(lang, n).to_vec();
            let (par, stats) = highlights::parallel::tokenize(lang, &input, threads);
            let (stress, sstats) = highlights::parallel::tokenize_with(lang, &input, 64, 1024);
            let ok = |r: &[highlights::Rec]| {
                if r == single.as_slice() {
                    "ok"
                } else {
                    "MISMATCH"
                }
            };
            let one = measure(n, budget, || {
                black_box(hl.tokenize(lang, n));
            });
            let many = measure(n, budget, || {
                black_box(highlights::parallel::tokenize(lang, &input, threads));
            });
            println!(
                "{:<16} {:>6} {:>9.0} {:>9.0} {:>6.1} {:>4}/{:<4}  {} ({} of {} relexed), default {}",
                format!(
                    "{}{}",
                    name.trim_end_matches(".txt"),
                    if copies > 1 { " x10" } else { "" }
                ),
                n / 1024,
                one,
                many,
                many / one,
                stats.relexed,
                stats.segments,
                ok(&stress),
                sstats.relexed,
                sstats.segments,
                ok(&par),
            );
        }
    }
    // Many independent files: one highlighter per thread, no shared state.
    let ts = std::fs::read(dir.join("large.ts.txt")).unwrap();
    let lang = highlights::language_id("ts").unwrap();
    let rounds = 20;
    let t = Instant::now();
    thread::scope(|s| {
        for _ in 0..threads {
            s.spawn(|| {
                let mut hl = Highlighter::new();
                for _ in 0..rounds {
                    hl.input_mut(ts.len()).copy_from_slice(&ts);
                    black_box(hl.tokenize(lang, ts.len()));
                }
            });
        }
    });
    let total = (ts.len() * rounds * threads) as f64 / 1048576.0;
    println!(
        "\nmany files: {threads} threads x {rounds} copies of large.ts: {:.0} MiB/s aggregate",
        total / t.elapsed().as_secs_f64()
    );
    println!("\nMiB/s, records only (native emitter). relexed: segments lexed twice / segments.");
}

/// Time to the first screen of a file, and to a screen in the middle lexed
/// from a guessed (fresh) state, against the whole file.
fn viewport() {
    const SCREEN: usize = 60;
    let dir = root().join("../benchmark/fixtures");
    println!(
        "{:<16} {:>7} {:>10} {:>12} {:>12} {:>16}",
        "input", "KiB", "whole", "first 60", "mid 60", "mid tokens exact"
    );
    let mut hl = Highlighter::new();
    let time = |f: &mut dyn FnMut()| {
        for _ in 0..5 {
            f();
        }
        let n = 50;
        let t = Instant::now();
        for _ in 0..n {
            f();
        }
        t.elapsed().as_secs_f64() / n as f64 * 1e6
    };
    for name in [
        "large.css.txt",
        "large.html.txt",
        "large.jsonc.txt",
        "large.ts.txt",
    ] {
        let base = std::fs::read(dir.join(name)).unwrap();
        let lang = highlights::language_id(name.split('.').nth(1).unwrap()).unwrap();
        for copies in [1usize, 10] {
            let input = base.repeat(copies);
            let lines: Vec<usize> = std::iter::once(0)
                .chain(
                    input
                        .iter()
                        .enumerate()
                        .filter(|&(_, &b)| b == b'\n')
                        .map(|(i, _)| i + 1),
                )
                .collect();
            let line_at = |i: usize| lines[i.min(lines.len() - 1)];
            let whole = time(&mut || {
                hl.input_mut(input.len()).copy_from_slice(&input);
                black_box(hl.tokenize(lang, input.len()));
            });
            let first = &input[..line_at(SCREEN)];
            let top = time(&mut || {
                hl.input_mut(first.len()).copy_from_slice(first);
                black_box(hl.tokenize_chunk(lang, first.len(), true, true));
            });
            let mid_line = lines.len() / 2;
            let (a, b) = (line_at(mid_line), line_at(mid_line + SCREEN));
            let mid_text = &input[a..b];
            let mid = time(&mut || {
                hl.input_mut(mid_text.len()).copy_from_slice(mid_text);
                black_box(hl.tokenize_chunk(lang, mid_text.len(), true, false));
            });
            // Compare the guessed screen with the real tokens there.
            hl.input_mut(input.len()).copy_from_slice(&input);
            let real: Vec<highlights::Rec> = hl.tokenize(lang, input.len()).to_vec();
            hl.input_mut(mid_text.len()).copy_from_slice(mid_text);
            let guess = hl
                .tokenize_chunk(lang, mid_text.len(), true, false)
                .to_vec();
            let tok_at = |recs: &[highlights::Rec], base: usize, at: usize| {
                let i = recs.partition_point(|r| (r.end as usize) + base <= at);
                recs.get(i).map(|r| r.token)
            };
            let same = (a..b)
                .filter(|&p| !input[p].is_ascii_whitespace())
                .filter(|&p| tok_at(&real, 0, p) == tok_at(&guess, a, p))
                .count();
            let total = (a..b).filter(|&p| !input[p].is_ascii_whitespace()).count();
            println!(
                "{:<16} {:>7} {:>8.0}µs {:>10.1}µs {:>10.1}µs {:>15.1}%",
                format!(
                    "{}{}",
                    name.trim_end_matches(".txt"),
                    if copies > 1 { " x10" } else { "" }
                ),
                input.len() / 1024,
                whole,
                top,
                mid,
                same as f64 * 100.0 / total.max(1) as f64
            );
        }
    }
    println!("\nmid tokens exact: share of non-space bytes whose token matches whole-file lexing.");
}

/// Compare `Highlighter::html` (records rendered natively) with the wasm
/// emitter's HTML mode for every file in `paths`, with every bundled theme
/// in turn; a file's language comes from its name or extension. Exits
/// nonzero on a mismatch.
fn html_parity(paths: &[String]) {
    let mut hl = Highlighter::new();
    let themes: Vec<highlights::Theme> = highlights::Theme::all().collect();
    let (mut files, mut bad) = (0, 0);
    let mut native = Vec::new();
    for (i, p) in paths.iter().enumerate() {
        let path = Path::new(p);
        let (Some(lang), Ok(input)) = (highlights::Language::from_path(path), std::fs::read(path))
        else {
            continue;
        };
        let theme = &themes[i % themes.len()];
        hl.set_input(&input);
        native.clear();
        hl.html(lang, theme, &mut native);
        hl.set_theme_table(theme.table());
        let wasm = hl.highlight(lang.id(), Mode::Html, &input).to_vec();
        files += 1;
        if native != wasm {
            bad += 1;
            let at = native
                .iter()
                .zip(&wasm)
                .position(|(a, b)| a != b)
                .unwrap_or(0);
            println!(
                "MISMATCH {p} ({}): byte {at}: native {:?} wasm {:?}",
                theme.name(),
                String::from_utf8_lossy(
                    &native[at.saturating_sub(20)..(at + 40).min(native.len())]
                ),
                String::from_utf8_lossy(&wasm[at.saturating_sub(20)..(at + 40).min(wasm.len())]),
            );
        }
    }
    println!("html parity: {files} files, {bad} mismatched");
    if files == 0 || bad > 0 {
        std::process::exit(1);
    }
}

/// Loop native tokenizing of one `gen/bench` input so a sampling profiler
/// can attach.
fn profile(file: &str, secs: f64) {
    // A bench input by name, or any file by path with its language guessed
    // from the extension.
    let (lang, bytes) = match load_inputs(None).into_iter().find(|i| i.file == file) {
        Some(input) => (input.lang, input.bytes),
        None => {
            let path = Path::new(file);
            let lang = highlights::Language::from_path(path).expect("unknown language");
            (
                lang.id(),
                std::fs::read(path).expect("no such bench input or file"),
            )
        }
    };
    let mut hl = Highlighter::new();
    hl.input_mut(bytes.len()).copy_from_slice(&bytes);
    let t = Instant::now();
    let mut n = 0u64;
    while t.elapsed().as_secs_f64() < secs {
        black_box(hl.tokenize(lang, bytes.len()));
        n += 1;
    }
    let mibs = (n as f64 * bytes.len() as f64) / 1048576.0 / t.elapsed().as_secs_f64();
    println!("{file}: {mibs:.0} MiB/s");
}
