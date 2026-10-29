//! Lookup tables for the native lexers, built at compile time from the WAT's
//! own data (`generated/wat_tables.rs`), so a native lexer never carries a
//! hand-copied word list.

use crate::wat_tables::Keyword;

/// A `keyword-table`: [`KeywordTable::group`] and [`KeywordTable::value`]
/// answer like `keyword-table.get` and `keyword-table.value`. Words match
/// exactly, byte for byte, and are 2 to 31 bytes long.
///
/// A lookup first checks that some word has the name's first byte and
/// length, then hashes the name's bytes (as two zero-padded 64-bit
/// integers) to one of `N` index slots, which names an entry to compare
/// against. `N` is a power of two, about a quarter of the word count
/// squared or more; [`KeywordTable::new`] fails to compile when the words
/// don't fit.
pub(crate) struct KeywordTable<const N: usize> {
    /// For each first byte, a bit per length of the words starting with it.
    lengths: [u32; 256],
    /// Entry number plus one for each hash slot, or 0 for no word.
    index: [u8; N],
    /// Each word's bytes 0-7 and 8-15 as little-endian integers, zero past
    /// its end.
    keys: [(u64, u64); 255],
    /// Each word's group and value.
    answers: [(u8, i32); 255],
    /// Each word, for words longer than 16 bytes.
    words: [&'static [u8]; 255],
    mul: u64,
}

/// The integers of the word `w`: bytes 0-7 and 8-15, zero past its end.
const fn key_of(w: &[u8]) -> (u64, u64) {
    let mut lo = 0u64;
    let mut hi = 0u64;
    let mut i = 0;
    while i < w.len() && i < 16 {
        if i < 8 {
            lo |= (w[i] as u64) << (8 * i);
        } else {
            hi |= (w[i] as u64) << (8 * (i - 8));
        }
        i += 1;
    }
    (lo, hi)
}

/// The index slot for a word's integers and length in a table of `n`
/// slots hashed with `mul`.
#[inline(always)]
const fn slot_of(lo: u64, hi: u64, len: usize, mul: u64, n: usize) -> usize {
    let h = lo ^ hi.rotate_left(29) ^ (len as u64) << 58;
    (h.wrapping_mul(mul) >> (64 - n.trailing_zeros())) as usize
}

impl<const N: usize> KeywordTable<N> {
    /// Build the table for `words`, searching for a collision-free hash.
    pub(crate) const fn new(words: &[Keyword]) -> Self {
        assert!(
            N.is_power_of_two() && N >= 2,
            "slot count must be a power of two"
        );
        assert!(words.len() <= 255, "at most 255 words");
        let mut lengths = [0u32; 256];
        let mut keys = [(0u64, 0u64); 255];
        let mut answers = [(0u8, -1i32); 255];
        let mut long: [&'static [u8]; 255] = [b""; 255];
        let mut i = 0;
        while i < words.len() {
            let w = words[i].word;
            assert!(w.len() >= 2 && w.len() <= 31, "keyword length out of range");
            lengths[w[0] as usize] |= 1 << w.len();
            keys[i] = key_of(w);
            answers[i] = (words[i].group, words[i].value);
            long[i] = w;
            i += 1;
        }
        let mut mul: u64 = 0x2545_f491_4f6c_dd1d;
        let mut attempt = 0;
        'search: while attempt < 20_000 {
            let mut index = [0u8; N];
            let mut i = 0;
            while i < words.len() {
                let s = slot_of(keys[i].0, keys[i].1, words[i].word.len(), mul, N);
                if index[s] != 0 {
                    // The next odd multiplier from a Weyl sequence.
                    mul = mul.wrapping_add(0x6a09_e667_f3bc_c909) | 1;
                    attempt += 1;
                    continue 'search;
                }
                index[s] = i as u8 + 1;
                i += 1;
            }
            return KeywordTable {
                lengths,
                index,
                keys,
                answers,
                words: long,
                mul,
            };
        }
        panic!("no collision-free hash: use more slots");
    }

    /// The entry for `src[lhs..rhs]`, if the word is in the table. `src`
    /// must hold at least 16 bytes past `lhs`, as the input slack does for
    /// any name in the input.
    #[inline(always)]
    fn find(&self, src: &[u8], lhs: usize, rhs: usize) -> Option<usize> {
        let len = rhs.wrapping_sub(lhs);
        if len.wrapping_sub(2) > 29 {
            return None;
        }
        assert!(lhs + 16 <= src.len());
        // SAFETY: `lhs + 16 <= src.len()`, checked above.
        let (first, lo, hi) = unsafe {
            let p = src.as_ptr().add(lhs);
            (
                *p,
                p.cast::<u64>().read_unaligned(),
                p.add(8).cast::<u64>().read_unaligned(),
            )
        };
        if self.lengths[first as usize] >> len & 1 == 0 {
            return None;
        }
        let keep = |n: usize| {
            if n >= 8 {
                u64::MAX
            } else {
                (1u64 << (8 * n)) - 1
            }
        };
        let lo = u64::from_le(lo) & keep(len);
        let hi = if len > 8 {
            u64::from_le(hi) & keep(len - 8)
        } else {
            0
        };
        let at = self.index[slot_of(lo, hi, len, self.mul, N)];
        if at == 0 {
            return None;
        }
        let e = at as usize - 1;
        if self.keys[e] != (lo, hi) || (len > 16 && src[lhs..rhs] != *self.words[e]) {
            return None;
        }
        Some(e)
    }

    /// The word's 1-based group, or 0 when absent (`keyword-table.get`).
    #[inline(always)]
    pub(crate) fn group(&self, src: &[u8], lhs: usize, rhs: usize) -> u32 {
        self.find(src, lhs, rhs)
            .map_or(0, |e| self.answers[e].0 as u32)
    }

    /// The word's group value, or -1 when absent (`keyword-table.value`).
    #[inline(always)]
    pub(crate) fn value(&self, src: &[u8], lhs: usize, rhs: usize) -> i32 {
        self.find(src, lhs, rhs).map_or(-1, |e| self.answers[e].1)
    }
}

/// A `byteset.get "bytes"` set as a table indexed by byte.
pub(crate) const fn byteset(bytes: &[u8]) -> [bool; 256] {
    let mut t = [false; 256];
    let mut i = 0;
    while i < bytes.len() {
        t[bytes[i] as usize] = true;
        i += 1;
    }
    t
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::wat_tables::*;

    /// Every generated keyword table builds, and finds each of its words
    /// with the declared group and value, and nothing else.
    #[test]
    fn keyword_tables_match_their_words() {
        for table in [
            ANGULAR_WORDS,
            BASH_WORDS,
            BATCH_WORDS,
            C_WORDS,
            C3_WORDS,
            CLOJURE_WORDS,
            CMAKE_WORDS,
            CPP_WORDS,
            CUDA_WORDS,
            CS_WORDS,
            DART_WORDS,
            DOCKERFILE_WORDS,
            EX_WORDS,
            ELM_WORDS,
            ERLANG_WORDS,
            FORTRAN_WORDS,
            ML_WORDS,
            FSHARP_WORDS,
            PY_WORDS,
            GD_TYPES,
            GD_PACKED_WORDS,
            GD_WORDS,
            GD_RESOURCE_WORDS,
            GLSL_WORDS,
            GD_SHADER_WORDS,
            GLEAM_WORDS,
            GO_WORDS,
            GRAPHQL_WORDS,
            GROOVY_WORDS,
            HS_WORDS,
            HLSL_WORDS,
            JAVA_WORDS,
            JULIA_WORDS,
            KOTLIN_WORDS,
            LATEX_WORDS,
            LISP_WORDS,
            LUA_WORDS,
            MAKEFILE_WORDS,
            MATLAB_WORDS,
            NIM_WORDS,
            NIX_WORDS,
            OBJC_WORDS,
            PASCAL_WORDS,
            PERL_WORDS,
            PHP_WORDS,
            POWERSHELL_WORDS,
            PROTO_WORDS,
            R_WORDS,
            RUBY_WORDS,
            RUST_WORDS,
            SCALA_WORDS,
            SOLIDITY_WORDS,
            SWIFT_WORDS,
            TF_WORDS,
            WAT_WORDS,
            WGSL_WORDS,
            ZIG_WORDS,
        ] {
            let t = KeywordTable::<8192>::new(table);
            for k in table {
                let mut src = k.word.to_vec();
                src.resize(k.word.len() + 32, b' ');
                assert_eq!(t.group(&src, 0, k.word.len()), k.group as u32);
                assert_eq!(t.value(&src, 0, k.word.len()), k.value);
                // A one-byte-shorter prefix is never the same word.
                if k.word.len() > 2 && !table.iter().any(|o| *o.word == k.word[..k.word.len() - 1])
                {
                    assert_eq!(t.group(&src, 0, k.word.len() - 1), 0);
                }
            }
        }
    }
}
