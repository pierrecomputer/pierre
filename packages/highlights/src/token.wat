(module
  (import "./memory.wat")

  ;; Alphabetical, except that the members lexers rarely name come last so
  ;; every frequently emitted member keeps a one-byte constant (ids below 64).
  (enum $Token
    "none" ;; plain text
    "attribute"
    "attribute.jsx"
    "boolean"
    "comment"
    "comment.doc"
    "constant"
    "constant.builtin"
    "constructor"
    "diff.minus"
    "diff.plus"
    "embedded"
    "emphasis"
    "emphasis.strong"
    "function"
    "function.definition"
    "function.method"
    "keyword"
    "keyword.control"
    "keyword.declaration"
    "keyword.import"
    "keyword.operator"
    "label"
    "namespace"
    "number"
    "operator"
    "predictive"
    "preproc"
    "primary"
    "property"
    "property.json_key"
    "punctuation"
    "punctuation.bracket"
    "punctuation.bracket.html"
    "punctuation.bracket.jsx"
    "punctuation.delimiter"
    "punctuation.delimiter.html"
    "punctuation.delimiter.jsx"
    "punctuation.list_marker"
    "punctuation.markup"
    "punctuation.special"
    "selector"
    "selector.class"
    "selector.id"
    "string"
    "string.escape"
    "string.regex"
    "string.special"
    "string.special.symbol"
    "tag"
    "tag.doctype"
    "tag.jsx"
    "text.jsx"
    "text.literal"
    "title"
    "type"
    "type.builtin"
    "type.class"
    "variable"
    "variable.parameter"
    "variable.special"
    ;; rarely named by lexers
    "enum"
    "hint"
    "keyword.jsdoc"
    "link_text"
    "link_uri"
    "selector.pseudo"
    "tag.component.jsx"
    "type.jsdoc"
    "variable.jsdoc"
    "variant"
    ;; resolved from theme.style, not from syntax
    "background"
    "foreground")

  ;; [ptr:u16, length:u8] records over the kebab-case CSS-variable suffixes
  (css-variable-table $Token $mem.tokenCssTable $mem.tokenCssTable+912)

  ;; theme record for a $Token member: [r][g][b][a][style], where style
  ;; packs italic in bit 4 and font-weight/100 in the low nibble;
  ;; all-zero = unthemed
  (func $themeRec (param $hl i32) (result i32)
    (i32.add
      (i32.const $mem.themeTable)
      (i32.add (i32.shl (local.get $hl) (i32.const 2)) (local.get $hl)))) ;; hl * 5
)
