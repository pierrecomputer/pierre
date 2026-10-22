//! `hl`: print files syntax-highlighted in a 24-bit color terminal.
//!
//! The language comes from each file's extension (or `--lang`), and the
//! colors from one of the bundled themes (`--theme`, default `pierre-dark`).

use std::fs::File;
use std::io::{self, IsTerminal, Read, Write};
use std::path::{Path, PathBuf};
use std::process::ExitCode;
use std::time::{Duration, Instant};

use highlights::{Highlighter, Language, TerminalOptions, Theme};

const USAGE: &str = "\
usage: hl [options] FILE...

Print files syntax-highlighted for a 24-bit color terminal.

options:
  --theme NAME      bundled theme to use (default: pierre-dark)
  --lang NAME       language for every file, instead of guessing from the
                    file extension
  --bg, --no-bg     paint the theme's background, or keep the terminal's
                    (default: paint it only when printing to a terminal,
                    since pagers such as less cannot fill to the line end)
  --time            add read, tokenize, and render times after each file
  --list-themes     print the bundled theme names
  --list-languages  print the language names and aliases
  -h, --help        print this help";

struct Args {
    theme: String,
    lang: Option<String>,
    /// `None` decides from whether stdout is a terminal.
    background: Option<bool>,
    time: bool,
    files: Vec<PathBuf>,
}

/// Parse the command line, or return the exit code for an early exit.
fn parse_args() -> Result<Args, ExitCode> {
    let mut args = Args {
        theme: "pierre-dark".into(),
        lang: None,
        background: None,
        time: false,
        files: vec![],
    };
    let mut it = std::env::args().skip(1);
    while let Some(arg) = it.next() {
        match arg.as_str() {
            "-h" | "--help" => {
                println!("{USAGE}");
                return Err(ExitCode::SUCCESS);
            }
            "--theme" | "--lang" => {
                let Some(value) = it.next() else {
                    eprintln!("hl: {arg} needs a value");
                    return Err(ExitCode::from(2));
                };
                if arg == "--theme" {
                    args.theme = value;
                } else {
                    args.lang = Some(value);
                }
            }
            "--bg" => args.background = Some(true),
            "--no-bg" => args.background = Some(false),
            "--time" => args.time = true,
            "--list-themes" => {
                for theme in Theme::all() {
                    println!("{}", theme.name());
                }
                return Err(ExitCode::SUCCESS);
            }
            "--list-languages" => {
                for lang in Language::all() {
                    let others: Vec<&str> = lang.aliases().filter(|a| *a != lang.name()).collect();
                    if others.is_empty() {
                        println!("{}", lang.name());
                    } else {
                        println!("{} ({})", lang.name(), others.join(", "));
                    }
                }
                return Err(ExitCode::SUCCESS);
            }
            _ if arg.starts_with('-') && arg != "-" => {
                eprintln!("hl: unknown option {arg}\n\n{USAGE}");
                return Err(ExitCode::from(2));
            }
            _ => args.files.push(arg.into()),
        }
    }
    if args.files.is_empty() {
        eprintln!("{USAGE}");
        return Err(ExitCode::from(2));
    }
    Ok(args)
}

/// Read `path` straight into the highlighter's input buffer, so the file is
/// not copied again before lexing.
fn read_into(hl: &mut Highlighter, path: &Path) -> io::Result<usize> {
    let mut file = File::open(path)?;
    let len = file.metadata()?.len() as usize;
    file.read_exact(hl.input_mut(len))?;
    Ok(len)
}

/// The fastest of repeated runs of `f`: at least 5, and more until about
/// 100 ms have passed, so small files get enough samples to be stable.
fn fastest(mut f: impl FnMut()) -> Duration {
    let begin = Instant::now();
    let mut best = Duration::MAX;
    for run in 0..1000 {
        let start = Instant::now();
        f();
        best = best.min(start.elapsed());
        if run >= 4 && begin.elapsed() > Duration::from_millis(100) {
            break;
        }
    }
    best
}

/// Timings for one file, printed after its highlighted text.
struct Timings {
    len: usize,
    lines: usize,
    tokens: usize,
    read: Duration,
    /// The run that produced the output, with cold caches.
    first: Duration,
    tokenize: Duration,
    /// Tokenizing plus rendering, warm; rendering alone is the difference.
    total: Duration,
}

/// A dim summary line: sizes, then each step's time and throughput.
fn footer(path: &Path, lang: Language, t: &Timings) -> String {
    let ms = |d: Duration| d.as_secs_f64() * 1e3;
    let rate = |d: Duration| t.len as f64 / 1048576.0 / d.as_secs_f64().max(1e-9);
    let render = t.total.saturating_sub(t.tokenize);
    format!(
        "\x1b[0;2m── {} · {} · {:.1} KiB · {} lines · {} tokens\n   \
         read {:.3} ms · tokenize {:.3} ms ({:.0} MiB/s) · \
         render {:.3} ms ({:.0} MiB/s) · total {:.3} ms ({:.0} MiB/s) · \
         first run {:.3} ms\x1b[0m\n",
        path.display(),
        lang.name(),
        t.len as f64 / 1024.0,
        t.lines,
        t.tokens,
        ms(t.read),
        ms(t.tokenize),
        rate(t.tokenize),
        ms(render),
        rate(render),
        ms(t.total),
        rate(t.total),
        ms(t.first),
    )
}

fn main() -> ExitCode {
    let args = match parse_args() {
        Ok(args) => args,
        Err(code) => return code,
    };
    let Some(theme) = Theme::named(&args.theme) else {
        eprintln!("hl: unknown theme {} (see --list-themes)", args.theme);
        return ExitCode::from(2);
    };
    let forced = match &args.lang {
        Some(name) => match Language::from_name(name) {
            Some(lang) => Some(lang),
            None => {
                eprintln!("hl: unknown language {name} (see --list-languages)");
                return ExitCode::from(2);
            }
        },
        None => None,
    };
    let options = TerminalOptions {
        background: args
            .background
            .unwrap_or_else(|| io::stdout().is_terminal()),
    };

    let mut hl = Highlighter::new();
    let mut out = Vec::new();
    let mut stdout = io::stdout().lock();
    let mut status = ExitCode::SUCCESS;
    for (i, path) in args.files.iter().enumerate() {
        let lang = forced
            .or_else(|| Language::from_path(path))
            .unwrap_or_else(|| Language::from_name("plain").unwrap());
        let start = Instant::now();
        let len = match read_into(&mut hl, path) {
            Ok(len) => len,
            Err(e) => {
                eprintln!("hl: {}: {e}", path.display());
                status = ExitCode::FAILURE;
                continue;
            }
        };
        let read = start.elapsed();
        out.clear();
        if args.files.len() > 1 {
            if i > 0 {
                out.push(b'\n');
            }
            out.extend_from_slice(format!("\x1b[0;1m{}\x1b[0m\n", path.display()).as_bytes());
        }
        let start = Instant::now();
        hl.terminal(lang, &theme, &options, &mut out);
        let first = start.elapsed();
        if args.time {
            let mut scratch = Vec::with_capacity(out.capacity());
            let total = fastest(|| {
                scratch.clear();
                hl.terminal(lang, &theme, &options, &mut scratch);
            });
            let tokenize = fastest(|| {
                hl.tokenize(lang.id(), len);
            });
            let timings = Timings {
                len,
                lines: scratch.iter().filter(|&&b| b == b'\n').count(),
                tokens: hl.tokenize(lang.id(), len).len(),
                read,
                first,
                tokenize,
                total,
            };
            out.extend_from_slice(footer(path, lang, &timings).as_bytes());
        }
        if let Err(e) = stdout.write_all(&out) {
            // A closed pipe (`hl file | head`) just ends the output.
            if e.kind() == io::ErrorKind::BrokenPipe {
                return status;
            }
            eprintln!("hl: {e}");
            return ExitCode::FAILURE;
        }
    }
    let _ = stdout.flush();
    status
}
