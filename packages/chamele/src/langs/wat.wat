(module
  (import "../common.wat")

  ;; group order is the dispatch order in $watWordHl below
  (keyword-table $watWords $mem.watWords $mem.watWords+384 16 64
    (group ;; 1: value types
      "i32" "i64" "f32" "f64" "v128")
    (group ;; 2: structured control
      "if" "br" "else" "loop" "then" "block")
    (group ;; 3: module fields and declarations
      "mut" "nop" "data" "elem" "func" "type" "start" "local" "param" "table"
      "global" "memory" "export" "import" "module" "result"))

  ;; Highlight for the bare word [$lhs,$rhs). Every table word is at most six
  ;; bytes, so the lookup's length check rejects the dotted instructions that
  ;; dominate real wat in one compare; a miss falls back to the dot scan, which
  ;; makes `local.get` and friends functions and everything else a keyword.
  (func $watWordHl (param $lhs i32) (param $rhs i32) (result i32)
    (local $c i32)
    (local $g i32)
    (local $p i32)
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
        (global.set $ptr
          (call $lexFindEither (global.get $ptr) (i32.const "(") (i32.const ";")))
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        (local.set $c (i32.load8_u (global.get $ptr)))
        (local.set $next (select
          (i32.load8_u offset=1 (global.get $ptr)) (i32.const 0)
          (i32.lt_u (i32.add (global.get $ptr) (i32.const 1)) (global.get $end))))
        (if (i32.and (i32.eq (local.get $c) (i32.const "("))
                     (i32.eq (local.get $next) (i32.const ";")))
          (then
            (local.set $depth (i32.add (local.get $depth) (i32.const 1)))
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 2)))
            (br $scan)))
        (if (i32.and (i32.eq (local.get $c) (i32.const ";"))
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
      (local.get $depth) (i32.const "(;") (i32.const ";)")
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
        (br_if $done (i32.or
          (call $lexIsSpace (local.get $c))
          (i32.or
            (i32.eq (local.get $c) (i32.const 34))
            (i32.or
              (i32.or (i32.eq (local.get $c) (i32.const "("))
                      (i32.eq (local.get $c) (i32.const ")")))
              (i32.eq (local.get $c) (i32.const ";"))))))
        (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
        (br $l))))

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
        (local.set $next (select
          (i32.load8_u offset=1 (global.get $ptr)) (i32.const 0)
          (i32.lt_u (i32.add (global.get $ptr) (i32.const 1)) (global.get $end))))
        (if (i32.and (i32.eq (local.get $c) (i32.const ";"))
                     (i32.eq (local.get $next) (i32.const ";")))
          (then
            (call $lexLineComment (i32.const 2) (enum.get $Token.comment))
            (br $token)))
        (if (i32.and (i32.eq (local.get $c) (i32.const "("))
                     (i32.eq (local.get $next) (i32.const ";")))
          (then
            (call $watBlockComment)
            (br $token)))
        (if (i32.eq (local.get $c) (i32.const 34))
          (then
            (call $lexString (i32.const 34) (i32.const 0) (enum.get $Token.string))
            (br $token)))
        (if (i32.eq (local.get $c) (i32.const "$"))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (call $watScanName (i32.const 0))
            (call $emitTok (enum.get $Token.variable) (local.get $lhs) (global.get $ptr))
            (br $token)))
        (if (i32.or
              (call $lexIsDigit (local.get $c))
              (i32.and
                (i32.or (i32.eq (local.get $c) (i32.const "+"))
                        (i32.eq (local.get $c) (i32.const "-")))
                (call $lexIsDigit (local.get $next))))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (call $lexScanNumber)
            (call $emitTok (enum.get $Token.number) (local.get $lhs) (global.get $ptr))
            (br $token)))
        (if (i32.or (i32.eq (local.get $c) (i32.const "("))
                    (i32.eq (local.get $c) (i32.const ")")))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (call $emitTok (enum.get $Token.punctuation.bracket) (local.get $lhs) (global.get $ptr))
            (br $token)))
        (if (i32.eq (local.get $c) (i32.const ";"))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (call $emitTok (enum.get $Token.punctuation.delimiter) (local.get $lhs) (global.get $ptr))
            (br $token)))
        (call $watScanName (i32.const "."))
        ;; the word run always advances: whitespace, quotes, parens and `;` are
        ;; the only stop bytes, and each is consumed by a branch above
        (call $emitTok (call $watWordHl (local.get $lhs) (global.get $ptr))
          (local.get $lhs) (global.get $ptr))
        (br $token))))
)
