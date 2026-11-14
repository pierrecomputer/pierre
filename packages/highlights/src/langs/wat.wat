(module
  (import "../emitter.wat")
  (import "@pierre/wat-tools/lexer-state.wat")
  (memory-region $mem.watWords 112)

  (import "@pierre/wat-tools/common.wat")

  ;; group order is the dispatch order in $watWordHl below
  (keyword-table $watWords $mem.watWords $mem.watWords+112
    (group ;; 1: value types
      "i32" "i64" "f32" "f64" "v128")
    (group ;; 2: control; longer words are matched in $watWordHl
      "if" "br" "end" "call" "else" "loop" "then" "block" "br_if" "return")
    (group ;; 3: module fields and declarations
      "mut" "nop" "data" "elem" "func" "type" "start" "local" "param" "table" "global" "memory"
      "export" "import" "module" "result"))

  ;; Highlight for the bare word [$lhs,$rhs). Every table word is at most six
  ;; bytes, so the lookup's length check rejects the dotted instructions that
  ;; dominate real wat in one compare; a miss falls back to the dot scan, which
  ;; makes `local.get` and friends functions and everything else a keyword.
  (func $watWordHl (param $lhs i32) (param $rhs i32) (result i32)
    (local $c i32)
    (local $g i32)
    (local $p i32)
    ;; Numeric atoms include their sign, trailing dot, and NaN payload.
    (local.set $p (local.get $lhs))
    (local.set $c (i32.load8_u (local.get $p)))
    (if (i32.or (i32.eq (local.get $c) (i32.const "+")) (i32.eq (local.get $c) (i32.const "-")))
      (then (local.set $p (i32.add (local.get $p) (i32.const 1)))))
    (if
      (i32.and
        (i32.lt_u (local.get $p) (local.get $rhs))
        (call $lexIsDigit (i32.load8_u (local.get $p))))
      (then (return (enum.get $Token.number))))
    (local.set $c (i32.and (i32.load (local.get $p)) (i32.const 0xffffff)))
    (if
      (i32.and
        (i32.eq (i32.sub (local.get $rhs) (local.get $p)) (i32.const 3))
        (i32.or
          (i32.eq (local.get $c) (i32.const "inf"))
          (i32.eq (local.get $c) (i32.const "nan"))))
      (then (return (enum.get $Token.number))))
    (if
      (i32.and
        (i32.gt_u (i32.sub (local.get $rhs) (local.get $p)) (i32.const 6))
        (i64.eq
          (i64.and (i64.load (local.get $p)) (i64.const 0xffffffffffff))
          (i64.const "nan:0x")))
      (then
        (local.set $p (i32.add (local.get $p) (i32.const 6)))
        (block $notNumber
          (loop $payload
            (br_if $notNumber (i32.eqz (call $lexIsHex (i32.load8_u (local.get $p)))))
            (local.set $p (i32.add (local.get $p) (i32.const 1)))
            (if (i32.eq (local.get $p) (local.get $rhs))
              (then (return (enum.get $Token.number))))
            (if (i32.eq (i32.load8_u (local.get $p)) (i32.const "_"))
              (then (local.set $p (i32.add (local.get $p) (i32.const 1)))))
            (br_if $payload (i32.lt_u (local.get $p) (local.get $rhs)))))))
    (local.set $g (keyword-table.get $watWords (local.get $lhs) (local.get $rhs)))
    (if (i32.eq (local.get $g) (i32.const 1))
      (then (return (enum.get $Token.type.builtin))))
    (if (i32.eq (local.get $g) (i32.const 2))
      (then (return (enum.get $Token.keyword.control))))
    (if (local.get $g)
      (then (return (enum.get $Token.keyword))))
    (local.set $p (local.get $lhs))
    (block $plain
      (loop $dot
        (br_if $plain (i32.ge_u (local.get $p) (local.get $rhs)))
        (local.set $c (i32.load8_u (local.get $p)))
        (if (i32.eq (local.get $c) (i32.const "."))
          (then (return (enum.get $Token.function))))
        (local.set $p (i32.add (local.get $p) (i32.const 1)))
        (br $dot)))
    ;; kept out of line so this function stays small enough to inline
    (call $watLongWordHl (local.get $lhs) (local.get $rhs)))

  ;; words longer than every table word: control for `br_table` and friends, else keyword
  (func $watLongWordHl (param $lhs i32) (param $rhs i32) (result i32)
    (local $p i32)
    (local.set $p (i32.sub (local.get $rhs) (local.get $lhs)))
    (if
      (i32.or
        (i32.and
          (i32.eq (local.get $p) (i32.const 8))
          (i64.eq (i64.load (local.get $lhs)) (i64.const "br_table")))
        (i32.or
          (i32.and
            (i32.eq (local.get $p) (i32.const 11))
            (i32.or
              (i32.and
                (i64.eq (i64.load (local.get $lhs)) (i64.const "unreacha"))
                (i64.eq (i64.load offset=3 (local.get $lhs)) (i64.const "eachable")))
              (i32.and
                (i64.eq (i64.load (local.get $lhs)) (i64.const "return_c"))
                (i64.eq (i64.load offset=3 (local.get $lhs)) (i64.const "urn_call")))))
          (i32.and
            (i32.eq (local.get $p) (i32.const 13))
            (i32.and
              (i64.eq (i64.load (local.get $lhs)) (i64.const "call_ind"))
              (i64.eq (i64.load offset=5 (local.get $lhs)) (i64.const "indirect"))))))
      (then (return (enum.get $Token.keyword.control))))
    (enum.get $Token.keyword))

  (func $watBlockComment
    (local $c i32)
    (local $depth i32)
    (local $lhs i32)
    (local $next i32)
    (local.set $lhs (global.get $ptr))
    (local.set $depth (i32.const 1))
    (global.set $ptr (i32.add (global.get $ptr) (i32.const 2)))
    (block $done
      (loop $scan
        (global.set $ptr (call $lexFindEither (global.get $ptr) (i32.const "(") (i32.const ";")))
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        (local.set $c (i32.load8_u (global.get $ptr)))
        (local.set $next
          (select
            (i32.load8_u offset=1 (global.get $ptr))
            (i32.const 0)
            (i32.lt_u (i32.add (global.get $ptr) (i32.const 1)) (global.get $end))))
        (if
          (i32.and
            (i32.eq (local.get $c) (i32.const "("))
            (i32.eq (local.get $next) (i32.const ";")))
          (then
            (local.set $depth (i32.add (local.get $depth) (i32.const 1)))
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 2)))
            (br $scan)))
        (if
          (i32.and
            (i32.eq (local.get $c) (i32.const ";"))
            (i32.eq (local.get $next) (i32.const ")")))
          (then
            (local.set $depth (i32.sub (local.get $depth) (i32.const 1)))
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 2)))
            (br_if $done (i32.eqz (local.get $depth)))
            (br $scan)))
        (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
        (br $scan)))
    (call $emitTok (enum.get $Token.comment) (local.get $lhs) (global.get $ptr))
    (call $streamSetNested
      (local.get $depth)
      (i32.const "(;")
      (i32.const ";)")
      (enum.get $Token.comment)))

  ;; Advance $ptr over a wat name or bare word: any byte up to whitespace, a
  ;; quote, a paren, or `;`. Names are mostly identifier bytes - dotted
  ;; instructions also pass `.` as $extra - so a SIMD identifier run covers
  ;; each token in one step, and only the rarer punctuation inside a name
  ;; (`$a-b`, `!`, `+`) takes the per-byte path before restarting the run.
  (func $watScanName (param $extra i32)
    (local $c i32)
    (block $done
      (loop $l
        (call $scanIdentRun (local.get $extra))
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        (local.set $c (i32.load8_u (global.get $ptr)))
        (br_if $done
          (i32.or
            (call $lexIsSpace (local.get $c))
            (i32.or
              (i32.eq (local.get $c) (i32.const 34))
              (i32.or
                (i32.or
                  (i32.eq (local.get $c) (i32.const "("))
                  (i32.eq (local.get $c) (i32.const ")")))
                (i32.eq (local.get $c) (i32.const ";"))))))
        (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
        (br $l))))

  ;; a backslash before a line break is a lone escape: WAT strings are one line
  (func $watEscapeEnd (param $p i32) (result i32)
    (local $c i32)
    (local $e i32)
    (local.set $e (call $scanHexRun (i32.add (local.get $p) (i32.const 1)) (i32.const 2)))
    (if (i32.eq (local.get $e) (i32.add (local.get $p) (i32.const 3)))
      (then (return (local.get $e))))
    (local.set $c (call $templateByte (i32.add (local.get $p) (i32.const 1))))
    (if (i32.or (i32.eq (local.get $c) (i32.const 10)) (i32.eq (local.get $c) (i32.const 13)))
      (then (return (i32.add (local.get $p) (i32.const 1)))))
    (if
      (i32.and
        (i32.eq (local.get $c) (i32.const "u"))
        (i32.eq (call $templateByte (i32.add (local.get $p) (i32.const 2))) (i32.const "{")))
      (then
        (local.set $e (call $scanHexRun (i32.add (local.get $p) (i32.const 3)) (i32.const 6)))
        (if
          (i32.and
            (i32.gt_u (local.get $e) (i32.add (local.get $p) (i32.const 3)))
            (i32.eq (call $templateByte (local.get $e)) (i32.const "}")))
          (then (return (i32.add (local.get $e) (i32.const 1)))))))
    (call $utf8SpanEnd (i32.add (local.get $p) (i32.const 2)) (global.get $end)))

  (func-variant $watStringBody $lexStringBody (call $lexEscapeEnd $watEscapeEnd))
  (func-variant $watString $lexString (call $lexStringBody $watStringBody))

  (func $hlWat
    (local $c i32)
    (local $lhs i32)
    (local $next i32)
    (call $lexEmitLeadingContinuation)
    (block $done
      (loop $token
        (local.set $lhs (global.get $ptr))
        (call $scanWhitespace)
        (call $emitGap (local.get $lhs) (global.get $ptr))
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        (local.set $lhs (global.get $ptr))
        (local.set $c (i32.load8_u (global.get $ptr)))
        (local.set $next
          (select
            (i32.load8_u offset=1 (global.get $ptr))
            (i32.const 0)
            (i32.lt_u (i32.add (global.get $ptr) (i32.const 1)) (global.get $end))))
        (if
          (i32.and
            (i32.eq (local.get $c) (i32.const ";"))
            (i32.eq (local.get $next) (i32.const ";")))
          (then
            (call $lexLineComment (i32.const 2) (enum.get $Token.comment))
            (br $token)))
        (if
          (i32.and
            (i32.eq (local.get $c) (i32.const "("))
            (i32.eq (local.get $next) (i32.const ";")))
          (then
            (call $watBlockComment)
            (br $token)))
        (if (i32.eq (local.get $c) (i32.const 34))
          (then
            (call $watString (i32.const 34) (i32.const 0) (enum.get $Token.string))
            (br $token)))
        (if (i32.eq (local.get $c) (i32.const "$"))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (call $watScanName (i32.const 0))
            (call $emitTok (enum.get $Token.variable) (local.get $lhs) (global.get $ptr))
            (br $token)))
        (if (i32.or (i32.eq (local.get $c) (i32.const "(")) (i32.eq (local.get $c) (i32.const ")")))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (call $emitTok (enum.get $Token.punctuation.bracket) (local.get $lhs) (global.get $ptr))
            (br $token)))
        (if (i32.eq (local.get $c) (i32.const ";"))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (call $emitTok
              (enum.get $Token.punctuation.delimiter)
              (local.get $lhs)
              (global.get $ptr))
            (br $token)))
        (call $watScanName (i32.const "."))
        ;; the word run always advances: whitespace, quotes, parens and `;` are
        ;; the only stop bytes, and each is consumed by a branch above
        (call $emitTok
          (call $watWordHl (local.get $lhs) (global.get $ptr))
          (local.get $lhs)
          (global.get $ptr))
        (br $token))))
)
