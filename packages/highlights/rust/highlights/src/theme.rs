//! Bundled themes, resolved to one style per token kind.

use crate::TokenKind;
use crate::token_ids;

#[rustfmt::skip]
#[path = "generated/themes.rs"]
mod bundled;

/// An RGBA color.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Color {
    pub r: u8,
    pub g: u8,
    pub b: u8,
    pub a: u8,
}

impl Color {
    /// This color drawn over an opaque `below`, which removes its alpha.
    pub fn over(self, below: Color) -> Color {
        let mix = |top: u8, bottom: u8| {
            ((top as u32 * self.a as u32 + bottom as u32 * (255 - self.a as u32) + 127) / 255) as u8
        };
        Color {
            r: mix(self.r, below.r),
            g: mix(self.g, below.g),
            b: mix(self.b, below.b),
            a: 255,
        }
    }
}

/// How a theme draws one token kind.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Style {
    /// `None` inherits the theme's foreground.
    pub color: Option<Color>,
    pub italic: bool,
    /// CSS font weight (100-900), or 0 for the default.
    pub weight: u16,
}

/// A bundled theme: the JS package's themes, with the same resolved styles.
#[derive(Clone, Copy, Debug)]
pub struct Theme {
    name: &'static str,
    /// Five bytes per token kind: RGBA (all zero for no color), then font
    /// flags (bit 4 italic, low nibble weight / 100).
    table: &'static [u8],
}

impl Theme {
    /// The bundled theme called `name`, such as `pierre-dark`.
    pub fn named(name: &str) -> Option<Theme> {
        bundled::THEMES
            .iter()
            .find(|(n, _)| *n == name)
            .map(|&(name, table)| Theme { name, table })
    }

    /// Every bundled theme.
    pub fn all() -> impl Iterator<Item = Theme> {
        bundled::THEMES
            .iter()
            .map(|&(name, table)| Theme { name, table })
    }

    pub fn name(&self) -> &'static str {
        self.name
    }

    /// The packed table, as the wasm emitter reads it.
    pub fn table(&self) -> &'static [u8] {
        self.table
    }

    fn record(&self, kind: u32) -> (Option<Color>, u8) {
        let at = kind as usize * 5;
        let Some(r) = self.table.get(at..at + 5) else {
            return (None, 0);
        };
        let color = (r[..4] != [0; 4]).then_some(Color {
            r: r[0],
            g: r[1],
            b: r[2],
            a: r[3],
        });
        (color, r[4])
    }

    /// How this theme draws `kind`.
    pub fn style(&self, kind: TokenKind) -> Style {
        let (color, font) = self.record(kind.0);
        Style {
            color,
            italic: font & 0x10 != 0,
            weight: (font & 15) as u16 * 100,
        }
    }

    /// The default text color.
    pub fn foreground(&self) -> Option<Color> {
        self.record(token_ids::FOREGROUND).0
    }

    /// The editor background color.
    pub fn background(&self) -> Option<Color> {
        self.record(token_ids::BACKGROUND).0
    }
}
