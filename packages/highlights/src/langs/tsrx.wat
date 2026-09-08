(module
  ;; TSRX https://tsrx.dev
  (import "../common.wat")
  (import "./css.wat")
  (import "./tsx.wat")

  ;; the first $len bytes at $p as a little-endian word, $len <= 8. The load
  ;; may pass $end into the buffer slack; the mask drops those bytes
  (func $tsrxWord (param $p i32) (param $len i32) (result i64)
    (if (i32.ge_u (local.get $len) (i32.const 8))
      (then (return (i64.load (local.get $p)))))
    (i64.and (i64.load (local.get $p))
      (i64.sub
        (i64.shl (i64.const 1)
          (i64.extend_i32_u (i32.shl (local.get $len) (i32.const 3))))
        (i64.const 1))))

  ;; identifier byte: [A-Za-z0-9_$]
  (func $tsrxIdentByte (param $c i32) (result i32)
    (i32.or
      (call $jsxNameStart (local.get $c))
      (i32.le_u (i32.sub (local.get $c) (i32.const "0")) (i32.const 9))))

  ;; the directive word [lhs,rhs) - the bytes after an `@` - as the keyword
  ;; kind it acts like. if/for/switch/try/case/default/catch keep their own
  ;; kind, so the scanner's paren and brace bookkeeping and the parameter
  ;; machine treat `@if (x) {` and `@catch (e) {` like the plain statements.
  ;; else/empty/pending are clause heads that a block follows, so they share
  ;; keyword_else. Any other word returns $Lex.invalid
  (func $tsrxDirectiveKind (param $lhs i32) (param $rhs i32) (result i32)
    (local $len i32)
    (local $w i64)
    (local.set $len (i32.sub (local.get $rhs) (local.get $lhs)))
    (if (i32.gt_u (i32.sub (local.get $len) (i32.const 2)) (i32.const 5))
      (then (return (enum.get $Lex.invalid))))
    (local.set $w (call $tsrxWord (local.get $lhs) (local.get $len)))
    (if (i64.eq (local.get $w) (i64.const "if"))
      (then (return (enum.get $Lex.keyword_if))))
    (if (i64.eq (local.get $w) (i64.const "for"))
      (then (return (enum.get $Lex.keyword_for))))
    (if (i64.eq (local.get $w) (i64.const "try"))
      (then (return (enum.get $Lex.keyword_try))))
    (if (i64.eq (local.get $w) (i64.const "else"))
      (then (return (enum.get $Lex.keyword_else))))
    (if (i64.eq (local.get $w) (i64.const "case"))
      (then (return (enum.get $Lex.keyword_case))))
    (if (i64.eq (local.get $w) (i64.const "empty"))
      (then (return (enum.get $Lex.keyword_else))))
    (if (i64.eq (local.get $w) (i64.const "catch"))
      (then (return (enum.get $Lex.keyword_catch))))
    (if (i64.eq (local.get $w) (i64.const "switch"))
      (then (return (enum.get $Lex.keyword_switch))))
    (if (i64.eq (local.get $w) (i64.const "default"))
      (then (return (enum.get $Lex.keyword_default))))
    (if (i64.eq (local.get $w) (i64.const "pending"))
      (then (return (enum.get $Lex.keyword_else))))
    (enum.get $Lex.invalid))

  ;; do the identifier bytes at $p - right after an `@` in template text -
  ;; spell a directive word? pure lookahead
  (func $tsrxDirectiveAt (param $p i32) (result i32)
    (local $e i32)
    (local.set $e (local.get $p))
    (block $done
      (loop $l
        (br_if $done (i32.ge_u (local.get $e) (global.get $end)))
        (br_if $done (i32.eqz (call $tsrxIdentByte (i32.load8_u (local.get $e)))))
        (local.set $e (i32.add (local.get $e) (i32.const 1)))
        (br $l)))
    (i32.ne
      (call $tsrxDirectiveKind (local.get $p) (local.get $e))
      (enum.get $Lex.invalid)))

  ;; TSRX declaration words the keyword table does not hold. `fragment`
  ;; before a name, `(`, or `<` heads a component and reads like `function`;
  ;; `module` before a name declares a submodule and reads like `namespace`.
  ;; Both are reserved identifiers, so anywhere else they stay identifiers
  (func $tsrxWordKind (param $lhs i32) (param $rhs i32) (result i32)
    (local $len i32)
    (local $c i32)
    (local $p i32)
    (local.set $len (i32.sub (local.get $rhs) (local.get $lhs)))
    (if (i32.eq (local.get $len) (i32.const 8))
      (then
        (if (i64.ne (i64.load (local.get $lhs)) (i64.const "fragment"))
          (then (return (enum.get $Lex.identifier)))))
      (else
        (if (i32.ne (local.get $len) (i32.const 6))
          (then (return (enum.get $Lex.identifier))))
        (if (i64.ne (call $tsrxWord (local.get $lhs) (i32.const 6)) (i64.const "module"))
          (then (return (enum.get $Lex.identifier))))))
    ;; the next non-blank byte decides
    (local.set $p (local.get $rhs))
    (block $stop
      (loop $skip
        (local.set $c (call $tsxByte (local.get $p)))
        (br_if $stop (i32.eqz (i32.or
          (i32.eq (local.get $c) (i32.const 32))
          (i32.le_u (i32.sub (local.get $c) (i32.const 9)) (i32.const 4)))))
        (local.set $p (i32.add (local.get $p) (i32.const 1)))
        (br $skip)))
    (if (i32.eq (local.get $len) (i32.const 8))
      (then
        (if (i32.or
              (call $jsxNameStart (local.get $c))
              (i32.or (i32.eq (local.get $c) (i32.const "("))
                      (i32.eq (local.get $c) (i32.const "<"))))
          (then (return (enum.get $Lex.keyword_function))))
        (return (enum.get $Lex.identifier))))
    (if (call $jsxNameStart (local.get $c))
      (then (return (enum.get $Lex.ctxword_namespace))))
    (enum.get $Lex.identifier))

  ;; `index` or `key`: the clause words of a `@for` head
  (func $tsrxForClauseWord (param $lhs i32) (param $rhs i32) (result i32)
    (local $len i32)
    (local.set $len (i32.sub (local.get $rhs) (local.get $lhs)))
    (if (i32.eq (local.get $len) (i32.const 5))
      (then (return (i64.eq (call $tsrxWord (local.get $lhs) (i32.const 5)) (i64.const "index")))))
    (if (i32.eq (local.get $len) (i32.const 3))
      (then (return (i64.eq (call $tsrxWord (local.get $lhs) (i32.const 3)) (i64.const "key")))))
    (i32.const 0))

  ;; does the tag name [lhs,rhs) open a raw-text element? 1 script, 2 style,
  ;; 0 other. Exact lowercase: `<Style>` is a component
  (func $tsrxRawKind (param $lhs i32) (param $rhs i32) (result i32)
    (local $len i32)
    (local.set $len (i32.sub (local.get $rhs) (local.get $lhs)))
    (if (i32.eq (local.get $len) (i32.const 6))
      (then
        (if (i64.eq (call $tsrxWord (local.get $lhs) (i32.const 6)) (i64.const "script"))
          (then (return (i32.const 1))))))
    (if (i32.eq (local.get $len) (i32.const 5))
      (then
        (if (i64.eq (call $tsrxWord (local.get $lhs) (i32.const 5)) (i64.const "style"))
          (then (return (i32.const 2))))))
    (i32.const 0))

  ;; is $p the `<` of `</script` (kind 1) or `</style` (kind 2), with the
  ;; name ending there: whitespace, `>`, `/`, or the input end?
  (func $tsrxRawClose (param $p i32) (param $kind i32) (result i32)
    (local $n i32)
    (local $c i32)
    (local.set $n (select (i32.const 8) (i32.const 7) (i32.eq (local.get $kind) (i32.const 1))))
    (if (i32.gt_u (i32.add (local.get $p) (local.get $n)) (global.get $end))
      (then (return (i32.const 0))))
    (if (i32.ne (i32.load16_u (local.get $p)) (i32.const "</"))
      (then (return (i32.const 0))))
    (if (i32.ne
          (call $tsrxRawKind
            (i32.add (local.get $p) (i32.const 2)) (i32.add (local.get $p) (local.get $n)))
          (local.get $kind))
      (then (return (i32.const 0))))
    (if (i32.ge_u (i32.add (local.get $p) (local.get $n)) (global.get $end))
      (then (return (i32.const 1))))
    (local.set $c (i32.load8_u (i32.add (local.get $p) (local.get $n))))
    (i32.or
      (i32.or (i32.eq (local.get $c) (i32.const ">")) (i32.eq (local.get $c) (i32.const "/")))
      (i32.or (i32.eq (local.get $c) (i32.const 32))
              (i32.le_u (i32.sub (local.get $c) (i32.const 9)) (i32.const 4)))))

  ;; the next byte at or after $p that ends a TSRX text run - `<` `{` `&`
  ;; `@` `/` or LF - else $end. 16 bytes per step, like $scanFind3
  (func $tsrxContentFind (param $p i32) (result i32)
    (local $mask i32)
    (local $w v128)
    (if (i32.ge_u (local.get $p) (global.get $end))
      (then (return (global.get $end))))
    (block $done
      (loop $simd
        (local.set $w (v128.load (local.get $p)))
        (local.set $mask (i8x16.bitmask (v128.or
          (v128.or
            (v128.or
              (i8x16.eq (local.get $w) (i8x16.splat (i32.const "<")))
              (i8x16.eq (local.get $w) (i8x16.splat (i32.const "{"))))
            (v128.or
              (i8x16.eq (local.get $w) (i8x16.splat (i32.const "&")))
              (i8x16.eq (local.get $w) (i8x16.splat (i32.const "@")))))
          (v128.or
            (i8x16.eq (local.get $w) (i8x16.splat (i32.const "/")))
            (i8x16.eq (local.get $w) (i8x16.splat (i32.const 10)))))))
        (if (local.get $mask)
          (then
            (local.set $p (i32.add (local.get $p) (i32.ctz (local.get $mask))))
            (br $done)))
        (local.set $p (i32.add (local.get $p) (i32.const 16)))
        (br_if $simd (i32.lt_u (local.get $p) (global.get $end)))))
    (select (local.get $p) (global.get $end)
      (i32.lt_u (local.get $p) (global.get $end))))

  ;; only blanks between $bound and $p, or since the last line break before
  ;; $p: where a `//` starts a comment in template text. $bound is the start
  ;; of the text run, or the end of the last comment in it
  (func $tsrxAtBoundary (param $bound i32) (param $p i32) (result i32)
    (local $c i32)
    (block $done
      (loop $back
        (br_if $done (i32.le_u (local.get $p) (local.get $bound)))
        (local.set $c (i32.load8_u (i32.sub (local.get $p) (i32.const 1))))
        (if (i32.or (i32.eq (local.get $c) (i32.const 10)) (i32.eq (local.get $c) (i32.const 13)))
          (then (return (i32.const 1))))
        (if (i32.eqz (i32.or (i32.eq (local.get $c) (i32.const 32)) (i32.eq (local.get $c) (i32.const 9))))
          (then (return (i32.const 0))))
        (local.set $p (i32.sub (local.get $p) (i32.const 1)))
        (br $back)))
    (i32.const 1))

  ;; `finally` after the blanks at $p, itself followed by blanks and `{`: the
  ;; bare clause head of a template `@try`. Returns its position, else 0
  (func $tsrxFinallyAhead (param $p i32) (result i32)
    (local $c i32)
    (local $q i32)
    (block $stop
      (loop $skip
        (local.set $c (call $tsxByte (local.get $p)))
        (br_if $stop (i32.eqz (i32.or
          (i32.eq (local.get $c) (i32.const 32))
          (i32.le_u (i32.sub (local.get $c) (i32.const 9)) (i32.const 4)))))
        (local.set $p (i32.add (local.get $p) (i32.const 1)))
        (br $skip)))
    (if (i32.gt_u (i32.add (local.get $p) (i32.const 7)) (global.get $end))
      (then (return (i32.const 0))))
    (if (i64.ne (call $tsrxWord (local.get $p) (i32.const 7)) (i64.const "finally"))
      (then (return (i32.const 0))))
    (local.set $q (i32.add (local.get $p) (i32.const 7)))
    (if (call $tsrxIdentByte (call $tsxByte (local.get $q)))
      (then (return (i32.const 0))))
    (block $stop2
      (loop $skip2
        (local.set $c (call $tsxByte (local.get $q)))
        (br_if $stop2 (i32.eqz (i32.or
          (i32.eq (local.get $c) (i32.const 32))
          (i32.le_u (i32.sub (local.get $c) (i32.const 9)) (i32.const 4)))))
        (local.set $q (i32.add (local.get $q) (i32.const 1)))
        (br $skip2)))
    (select (local.get $p) (i32.const 0) (i32.eq (local.get $c) (i32.const "{"))))

  ;; one step inside a `<style>` body (mode 6): CSS up to `</style`, then
  ;; the close tag. The CSS lexer's resumable state lives in the stack
  ;; entry's target field, so a body cut by a chunk end continues in the
  ;; next chunk with the same state a whole-buffer run reaches there
  (func $tsrxStyleStep
    (local $from i32)
    (local $p i32)
    (local $found i32)
    (local $savePtr i32)
    (local $saveEnd i32)
    (local $saveStreaming i32)
    (local $saveDialect i32)
    (local.set $from (global.get $ptr))
    (local.set $p (local.get $from))
    (block $done
      (loop $find
        (local.set $p (call $lexFindByte (local.get $p) (i32.const "<")))
        (br_if $done (i32.ge_u (local.get $p) (global.get $end)))
        (if (call $tsrxRawClose (local.get $p) (i32.const 2))
          (then
            (local.set $found (i32.const 1))
            (br $done)))
        (local.set $p (i32.add (local.get $p) (i32.const 1)))
        (br $find)))
    (if (i32.gt_u (local.get $p) (local.get $from))
      (then
        (local.set $savePtr (global.get $ptr))
        (local.set $saveEnd (global.get $end))
        (local.set $saveStreaming (global.get $streaming))
        (local.set $saveDialect (global.get $cssDialect))
        (global.set $ptr (local.get $from))
        (global.set $end (local.get $p))
        (global.set $streaming (i32.const 0))
        (global.set $cssDialect (i32.const 0))
        (call $jsxSetTopTarget (call $hlCssImpl (call $jsxTopTarget)))
        (global.set $cssDialect (local.get $saveDialect))
        (global.set $streaming (local.get $saveStreaming))
        (global.set $end (local.get $saveEnd))
        (global.set $ptr (local.get $savePtr))))
    (global.set $ptr (local.get $p))
    (if (i32.eqz (local.get $found)) (then (return)))
    (global.set $ptr (i32.add (local.get $p) (i32.const 2)))
    (call $emitTok (enum.get $Token.punctuation.bracket.jsx) (local.get $p) (global.get $ptr))
    (drop (call $jsxEmitName))
    (drop (call $jsxCloseTagTail))
    (call $jsxPop))

  ;; emit a `@{` statement-container opener - the scanner's two-byte
  ;; l_brace: the `@` keeps the directive color, the `{` is an ordinary
  ;; bracket like the `}` that closes it
  (func $tsrxEmitContainerOpen (param $lhs i32) (param $rhs i32)
    (call $emitTok (enum.get $Token.keyword.control)
      (local.get $lhs) (i32.add (local.get $lhs) (i32.const 1)))
    (call $emitTok (enum.get $Token.punctuation.bracket)
      (i32.add (local.get $lhs) (i32.const 1)) (local.get $rhs)))

  (func $hlTsrx (call $hlEcma (i32.const 7)))
  (func $hlTsrxStream (param $reset i32)
    (call $hlEcmaStream (i32.const 7) (local.get $reset)))
)
