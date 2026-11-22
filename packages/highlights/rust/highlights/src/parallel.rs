//! Speculative parallel lexing of one large input.
//!
//! The input is split at line breaks into segments of a few KiB. Each thread
//! lexes a contiguous run of segments as a stream, starting from a fresh
//! lexer state as if its first segment began at top level, and snapshots the
//! lexer state after every segment.
//!
//! A sequential pass then walks the segments. Where a thread's guessed start
//! state differs from the real one, segments are lexed again from the real
//! state until the real state after a segment equals the speculative
//! snapshot at that point. From there on the speculative records are exact,
//! because equal states lex the rest of the input identically. This is the
//! convergence rule the live tokenizer uses after edits.
//!
//! The result equals streaming the input in segments, which differs from
//! lexing it whole where a lexer looks ahead across a line break (a TS `:` at
//! a line end peeks at the next line's identifier).

use std::thread;

use crate::{Highlighter, Rec};

/// Segment size: the granularity of state snapshots and of re-lexing.
const SEGMENT: usize = 8 * 1024;

/// Statistics from one parallel run.
#[derive(Debug, Default, Clone, Copy)]
pub struct Stats {
    pub threads: usize,
    pub segments: usize,
    /// Segments lexed a second time because their guessed start was wrong.
    pub relexed: usize,
}

struct Segment {
    recs: Vec<Rec>,
    lead_gap_end: u32,
    end_state: Vec<u8>,
}

/// Split `input` into segments of about `size` bytes ending after a line break.
fn split(input: &[u8], size: usize) -> Vec<(usize, usize)> {
    let mut segs = vec![];
    let mut start = 0;
    while start < input.len() {
        let mut end = (start + size).min(input.len());
        if end < input.len() {
            end = match input[end..].iter().position(|&b| b == b'\n') {
                Some(i) => end + i + 1,
                None => input.len(),
            };
        }
        segs.push((start, end));
        start = end;
    }
    segs
}

fn lex_segment(
    hl: &mut Highlighter,
    lang: u8,
    text: &[u8],
    reset: bool,
    doc_start: bool,
) -> Segment {
    hl.input_mut(text.len()).copy_from_slice(text);
    hl.tokenize_chunk(lang, text.len(), reset, doc_start);
    let lead_gap_end = hl.chunk_lead_gap_end();
    let recs = hl.take_records();
    let mut end_state = vec![];
    hl.capture_state(text.len(), &mut end_state);
    Segment {
        recs,
        lead_gap_end,
        end_state,
    }
}

/// The state snapshot of a freshly reset lexer for `lang`.
fn fresh_state(lang: u8) -> Vec<u8> {
    let mut hl = Highlighter::new();
    hl.input_mut(0);
    hl.tokenize_chunk(lang, 0, true, false);
    let mut s = vec![];
    hl.capture_state(0, &mut s);
    s
}

/// Lex `input` on up to `threads` threads and return its byte records,
/// identical to lexing it in one piece.
pub fn tokenize(lang: u8, input: &[u8], threads: usize) -> (Vec<Rec>, Stats) {
    tokenize_with(lang, input, threads, SEGMENT)
}

/// [`tokenize`] with an explicit segment size, for testing boundaries.
pub fn tokenize_with(lang: u8, input: &[u8], threads: usize, segment: usize) -> (Vec<Rec>, Stats) {
    let segs = split(input, segment);
    let threads = threads.clamp(1, segs.len().max(1));
    // Thread `t` lexes segments [first[t], first[t + 1]).
    let first: Vec<usize> = (0..=threads).map(|t| t * segs.len() / threads).collect();
    let fresh = fresh_state(lang);

    // Speculative pass: one stream per thread, a snapshot per segment.
    let mut runs: Vec<(Highlighter, Vec<Segment>)> = thread::scope(|s| {
        let handles: Vec<_> = (0..threads)
            .map(|t| {
                let range = &segs[first[t]..first[t + 1]];
                s.spawn(move || {
                    let mut hl = Highlighter::new();
                    let out: Vec<Segment> = range
                        .iter()
                        .enumerate()
                        .map(|(k, &(a, b))| {
                            lex_segment(&mut hl, lang, &input[a..b], k == 0, t == 0 && k == 0)
                        })
                        .collect();
                    (hl, out)
                })
            })
            .collect();
        handles.into_iter().map(|h| h.join().unwrap()).collect()
    });

    // Sequential pass: fix segments whose guessed start state was wrong.
    let mut stats = Stats {
        threads,
        segments: segs.len(),
        relexed: 0,
    };
    let mut fixed: Option<Highlighter> = None; // holds the real state while relexing
    for t in 1..threads {
        let (before, after) = runs.split_at_mut(t);
        let prev_end = &before[t - 1].1.last().unwrap().end_state;
        if fixed.is_none() && *prev_end == fresh {
            continue;
        }
        // The real state is in `fixed` (still relexing) or in the previous
        // thread's instance (its speculative run was exact through its end).
        let mut hl = fixed
            .take()
            .unwrap_or_else(|| std::mem::take(&mut before[t - 1].0));
        let run = &mut after[0].1;
        let mut converged = false;
        for (k, seg) in run.iter_mut().enumerate() {
            let (a, b) = segs[first[t] + k];
            let real = lex_segment(&mut hl, lang, &input[a..b], false, false);
            stats.relexed += 1;
            let same = real.end_state == seg.end_state;
            *seg = real;
            if same {
                converged = true;
                break;
            }
        }
        if !converged {
            fixed = Some(hl);
        }
    }

    // Stitch segment records into one list.
    let mut out: Vec<Rec> =
        Vec::with_capacity(runs.iter().flat_map(|r| &r.1).map(|s| s.recs.len()).sum());
    for (seg, &(a, _)) in runs.iter().flat_map(|r| &r.1).zip(&segs) {
        let base = a as u32;
        // A leading gap keeps the previous token's style.
        if seg.lead_gap_end > 0 {
            let end = base + seg.lead_gap_end;
            match out.last_mut() {
                Some(last) => last.end = end,
                None => out.push(Rec {
                    end,
                    token: crate::token_ids::NONE,
                }),
            }
        }
        let mut recs = seg.recs.iter().map(|x| Rec {
            end: x.end + base,
            token: x.token,
        });
        if let Some(first) = recs.next() {
            // Equal tokens on both sides of the boundary merge.
            match out.last_mut() {
                Some(last) if last.token == first.token => last.end = first.end,
                _ => out.push(first),
            }
        }
        out.extend(recs);
    }
    (out, stats)
}
