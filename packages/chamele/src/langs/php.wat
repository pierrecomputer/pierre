(module
  (import "../common.wat")
  (import "./html.wat")

  (global $phpStreamingCode (mut i32) (i32.const 0))
  (global $phpStreamDecl (mut i32) (i32.const 0))
  (global $phpStreamMember (mut i32) (i32.const 0))

  (func $phpIsOpen (param $p i32) (result i32)
    (local $c i32)
    (if (i32.gt_u (i32.add (local.get $p) (i32.const 3)) (global.get $end))
      (then (return (i32.const 0))))
    (if (i32.ne (i32.and (i32.load (local.get $p)) (i32.const 0xffff)) (i32.const "<?"))
      (then (return (i32.const 0))))
    (local.set $c (i32.load8_u offset=2 (local.get $p)))
    (if (i32.eq (local.get $c) (i32.const "=")) (then (return (i32.const 1))))
    (if (i32.gt_u (i32.add (local.get $p) (i32.const 5)) (global.get $end))
      (then (return (i32.const 0))))
    (if (i32.ne
          (i32.and
            (i32.or (i32.load offset=2 (local.get $p)) (i32.const 0x202020))
            (i32.const 0xffffff))
          (i32.const "php"))
      (then (return (i32.const 0))))
    (i32.or
      (i32.eq (i32.add (local.get $p) (i32.const 5)) (global.get $end))
      (call $lexIsSpace (i32.load8_u offset=5 (local.get $p)))))

  (func $phpFindOpen (param $p i32) (result i32)
    (block $done
      (loop $scan
        (local.set $p (call $lexFindEither (local.get $p) (i32.const "<") (i32.const "<")))
        (br_if $done (i32.ge_u (local.get $p) (global.get $end)))
        (if (call $phpIsOpen (local.get $p)) (then (return (local.get $p))))
        (local.set $p (i32.add (local.get $p) (i32.const 1)))
        (br $scan)))
    (global.get $end))

  ;; A PHP line comment ends at `?>` as well as at a newline.
  (func $phpLineComment (param $skip i32)
    (local $close i32)
    (local $lhs i32)
    (local $lineEnd i32)
    (local $saveEnd i32)
    (local $stop i32)
    (local.set $lhs (global.get $ptr))
    (global.set $ptr (i32.add (global.get $ptr) (local.get $skip)))
    (if (i32.gt_u (global.get $ptr) (global.get $end))
      (then (global.set $ptr (global.get $end))))
    (local.set $lineEnd
      (call $lexFindEither (global.get $ptr) (i32.const 10) (i32.const 13)))
    (local.set $stop (local.get $lineEnd))
    (local.set $saveEnd (global.get $end))
    (global.set $end (local.get $lineEnd))
    (block $done
      (loop $find
        (local.set $close
          (call $lexFindEither (global.get $ptr) (i32.const "?") (i32.const "?")))
        (br_if $done (i32.ge_u (local.get $close) (local.get $lineEnd)))
        (if (i32.and
              (i32.lt_u (i32.add (local.get $close) (i32.const 1)) (local.get $lineEnd))
              (i32.eq (i32.load8_u offset=1 (local.get $close)) (i32.const ">")))
          (then
            (local.set $stop (local.get $close))
            (br $done)))
        (global.set $ptr (i32.add (local.get $close) (i32.const 1)))
        (br $find)))
    (global.set $end (local.get $saveEnd))
    (global.set $ptr (local.get $stop))
    (call $emitTok (enum.get $Token.comment) (local.get $lhs) (global.get $ptr)))

  (func $phpWordHl (param $lhs i32) (param $rhs i32) (result i32)
    (local $n i32)
    (local $w i64)
    (local.set $n (i32.sub (local.get $rhs) (local.get $lhs)))
    (local.set $w (i64.or (i64.load (local.get $lhs)) (i64.const 0x2020202020202020)))
    (if (i32.or
          (i32.and (i32.eq (local.get $n) (i32.const 4))
            (i64.eq (i64.and (local.get $w) (i64.const 0xffffffff)) (i64.const "true")))
          (i32.and (i32.eq (local.get $n) (i32.const 5))
            (i64.eq (i64.and (local.get $w) (i64.const 0xffffffffff)) (i64.const "false"))))
      (then (return (enum.get $Token.boolean))))
    (if (i32.and (i32.eq (local.get $n) (i32.const 4))
                 (i64.eq (i64.and (local.get $w) (i64.const 0xffffffff)) (i64.const "null")))
      (then (return (enum.get $Token.constant.builtin))))
    (if (i32.or
          (i32.and (i32.eq (local.get $n) (i32.const 2))
            (i32.or
              (i64.eq (i64.and (local.get $w) (i64.const 0xffff)) (i64.const "as"))
              (i64.eq (i64.and (local.get $w) (i64.const 0xffff)) (i64.const "fn"))))
          (i32.or
            (i32.and (i32.eq (local.get $n) (i32.const 3))
              (i32.or
                (i64.eq (i64.and (local.get $w) (i64.const 0xffffff)) (i64.const "new"))
                (i64.eq (i64.and (local.get $w) (i64.const 0xffffff)) (i64.const "use"))))
            (i32.and (i32.eq (local.get $n) (i32.const 5))
              (i64.eq (i64.and (local.get $w) (i64.const 0xffffffffff)) (i64.const "yield")))))
      (then (return (enum.get $Token.keyword))))
    (if (i32.or
          (i32.and (i32.eq (local.get $n) (i32.const 2))
            (i64.eq (i64.and (local.get $w) (i64.const 0xffff)) (i64.const "if")))
          (i32.and (i32.eq (local.get $n) (i32.const 3))
            (i32.or
              (i64.eq (i64.and (local.get $w) (i64.const 0xffffff)) (i64.const "for"))
              (i64.eq (i64.and (local.get $w) (i64.const 0xffffff)) (i64.const "try")))))
      (then (return (enum.get $Token.keyword.control))))
    (if (i32.or
          (i32.and (i32.eq (local.get $n) (i32.const 4))
            (i32.or
              (i64.eq (i64.and (local.get $w) (i64.const 0xffffffff)) (i64.const "else"))
              (i32.or
                (i64.eq (i64.and (local.get $w) (i64.const 0xffffffff)) (i64.const "case"))
                (i64.eq (i64.and (local.get $w) (i64.const 0xffffffff)) (i64.const "echo")))))
          (i32.or
            (i32.and (i32.eq (local.get $n) (i32.const 5))
              (i32.or
                (i64.eq (i64.and (local.get $w) (i64.const 0xffffffffff)) (i64.const "break"))
                (i32.or
                  (i64.eq (i64.and (local.get $w) (i64.const 0xffffffffff)) (i64.const "catch"))
                  (i32.or
                    (i64.eq (i64.and (local.get $w) (i64.const 0xffffffffff)) (i64.const "while"))
                    (i64.eq (i64.and (local.get $w) (i64.const 0xffffffffff)) (i64.const "throw"))))))
            (i32.and (i32.eq (local.get $n) (i32.const 6))
              (i64.eq (i64.and (local.get $w) (i64.const 0xffffffffffff)) (i64.const "return")))))
      (then (return (enum.get $Token.keyword.control))))
    (if (i32.or
          (i32.and (i32.eq (local.get $n) (i32.const 5))
            (i32.or
              (i64.eq (i64.and (local.get $w) (i64.const 0xffffffffff)) (i64.const "class"))
              (i32.or
                (i64.eq (i64.and (local.get $w) (i64.const 0xffffffffff)) (i64.const "const"))
                (i64.eq (i64.and (local.get $w) (i64.const 0xffffffffff)) (i64.const "trait")))))
          (i32.and (i32.eq (local.get $n) (i32.const 8))
            (i64.eq (local.get $w) (i64.const "function"))))
      (then (return (enum.get $Token.keyword.declaration))))
    (if (i32.and
          (i32.eq (local.get $n) (i32.const 9))
          (i32.and
            (i64.eq (local.get $w) (i64.const "interfac"))
            (i32.eq (i32.or (i32.load8_u offset=8 (local.get $lhs)) (i32.const 32)) (i32.const "e"))))
      (then (return (enum.get $Token.keyword.declaration))))
    (if (i32.or
          (i32.and (i32.eq (local.get $n) (i32.const 3))
            (i64.eq (i64.and (local.get $w) (i64.const 0xffffff)) (i64.const "int")))
          (i32.or
            (i32.and (i32.eq (local.get $n) (i32.const 4))
              (i64.eq (i64.and (local.get $w) (i64.const 0xffffffff)) (i64.const "bool")))
            (i32.or
              (i32.and (i32.eq (local.get $n) (i32.const 5))
                (i32.or
                  (i64.eq (i64.and (local.get $w) (i64.const 0xffffffffff)) (i64.const "array"))
                  (i32.or
                    (i64.eq (i64.and (local.get $w) (i64.const 0xffffffffff)) (i64.const "float"))
                    (i64.eq (i64.and (local.get $w) (i64.const 0xffffffffff)) (i64.const "mixed")))))
              (i32.and (i32.eq (local.get $n) (i32.const 6))
                (i64.eq (i64.and (local.get $w) (i64.const 0xffffffffffff)) (i64.const "string"))))))
      (then (return (enum.get $Token.type.builtin))))
    (enum.get $Token.variable))

  (func $phpAfterLine (param $p i32) (result i32)
    (if (i32.lt_u (local.get $p) (global.get $end))
      (then
        (if (i32.eq (i32.load8_u (local.get $p)) (i32.const 13))
          (then (local.set $p (i32.add (local.get $p) (i32.const 1)))))
        (if (i32.and
              (i32.lt_u (local.get $p) (global.get $end))
              (i32.eq (i32.load8_u (local.get $p)) (i32.const 10)))
          (then (local.set $p (i32.add (local.get $p) (i32.const 1)))))))
    (local.get $p))

  (func $phpLineEndAt (param $p i32) (result i32)
    (block $done
      (loop $l
        (br_if $done (i32.ge_u (local.get $p) (global.get $end)))
        (br_if $done (i32.or
          (i32.eq (i32.load8_u (local.get $p)) (i32.const 10))
          (i32.eq (i32.load8_u (local.get $p)) (i32.const 13))))
        (local.set $p (i32.add (local.get $p) (i32.const 1)))
        (br $l)))
    (local.get $p))

  (func $phpBlanksAt (param $p i32) (result i32)
    (block $done
      (loop $l
        (br_if $done (i32.ge_u (local.get $p) (global.get $end)))
        (br_if $done (i32.eqz (i32.or
          (i32.eq (i32.load8_u (local.get $p)) (i32.const 32))
          (i32.eq (i32.load8_u (local.get $p)) (i32.const 9)))))
        (local.set $p (i32.add (local.get $p) (i32.const 1)))
        (br $l)))
    (local.get $p))

  (func $phpBytesEq (param $a i32) (param $b i32) (param $n i32) (result i32)
    (block $done
      (loop $l
        (br_if $done (i32.eqz (local.get $n)))
        (if (i32.ge_u (local.get $a) (global.get $end)) (then (return (i32.const 0))))
        (if (i32.ne (i32.load8_u (local.get $a)) (i32.load8_u (local.get $b)))
          (then (return (i32.const 0))))
        (local.set $a (i32.add (local.get $a) (i32.const 1)))
        (local.set $b (i32.add (local.get $b) (i32.const 1)))
        (local.set $n (i32.sub (local.get $n) (i32.const 1)))
        (br $l)))
    (i32.const 1))

  ;; `<<<ID`, `<<<"ID"` and nowdoc `<<<'ID'`. The body runs to the first line
  ;; whose first non-blank run is the identifier, so everything in between -
  ;; `?>` included - stays literal text instead of closing PHP mode.
  ;; Returns 1 when a heredoc was consumed, 0 to leave `<<<` to the caller.
  (func $phpHeredoc (result i32)
    (local $body i32)
    (local $c i32)
    (local $delim i32)
    (local $line i32)
    (local $lhs i32)
    (local $n i32)
    (local $p i32)
    (local $quote i32)
    (local $start i32)
    (local.set $lhs (global.get $ptr))
    (local.set $p (call $phpBlanksAt (i32.add (global.get $ptr) (i32.const 3))))
    (if (i32.ge_u (local.get $p) (global.get $end)) (then (return (i32.const 0))))
    (local.set $quote (i32.load8_u (local.get $p)))
    (if (i32.or (i32.eq (local.get $quote) (i32.const 34))
                (i32.eq (local.get $quote) (i32.const 39)))
      (then (local.set $p (i32.add (local.get $p) (i32.const 1))))
      (else (local.set $quote (i32.const 0))))
    ;; a label starts with a letter or `_`, never a digit and never `$`
    (if (i32.ge_u (local.get $p) (global.get $end)) (then (return (i32.const 0))))
    (local.set $c (i32.load8_u (local.get $p)))
    (if (i32.or (i32.eqz (call $lexIsIdentStart (local.get $c)))
                (i32.eq (local.get $c) (i32.const "$")))
      (then (return (i32.const 0))))
    (local.set $delim (local.get $p))
    (block $idDone
      (loop $id
        (br_if $idDone (i32.ge_u (local.get $p) (global.get $end)))
        (local.set $c (i32.load8_u (local.get $p)))
        (br_if $idDone (i32.or
          (i32.eqz (call $lexIsIdentContinue (local.get $c)))
          (i32.eq (local.get $c) (i32.const "$"))))
        (local.set $p (i32.add (local.get $p) (i32.const 1)))
        (br $id)))
    (local.set $n (i32.sub (local.get $p) (local.get $delim)))
    (if (local.get $quote)
      (then
        (if (i32.or (i32.ge_u (local.get $p) (global.get $end))
                    (i32.ne (i32.load8_u (local.get $p)) (local.get $quote)))
          (then (return (i32.const 0))))
        (local.set $p (i32.add (local.get $p) (i32.const 1)))))
    ;; the opener has to end its line
    (local.set $start (call $phpBlanksAt (local.get $p)))
    (if (i32.and
          (i32.lt_u (local.get $start) (global.get $end))
          (i32.and
            (i32.ne (i32.load8_u (local.get $start)) (i32.const 10))
            (i32.ne (i32.load8_u (local.get $start)) (i32.const 13))))
      (then (return (i32.const 0))))
    (call $emitTok (enum.get $Token.operator)
      (local.get $lhs) (i32.add (local.get $lhs) (i32.const 3)))
    (call $emitTok (enum.get $Token.string)
      (i32.add (local.get $lhs) (i32.const 3)) (local.get $p))
    (call $emitGap (local.get $p) (local.get $start))
    (local.set $body (call $phpAfterLine (local.get $start)))
    (call $emitGap (local.get $start) (local.get $body))
    (global.set $ptr (local.get $body))
    ;; walk whole lines looking for the closing label
    (local.set $line (local.get $body))
    (block $found
      (block $eof
        (loop $scan
          (br_if $eof (i32.ge_u (local.get $line) (global.get $end)))
          (local.set $start (call $phpBlanksAt (local.get $line)))
          (if (call $phpBytesEq (local.get $start) (local.get $delim) (local.get $n))
            (then
              (local.set $c (i32.add (local.get $start) (local.get $n)))
              ;; the label must not be a prefix of a longer word
              (if (i32.or
                    (i32.ge_u (local.get $c) (global.get $end))
                    (i32.eqz (call $lexIsIdentContinue (i32.load8_u (local.get $c)))))
                (then (br $found)))))
          (local.set $line (call $phpAfterLine
            (call $phpLineEndAt (local.get $line))))
          (br $scan)))
      ;; unterminated: the body is the rest of the range
      (call $emitTok (enum.get $Token.string) (local.get $body) (global.get $end))
      (global.set $ptr (global.get $end))
      (return (i32.const 1)))
    (call $emitTok (enum.get $Token.string) (local.get $body) (local.get $line))
    (call $emitGap (local.get $line) (local.get $start))
    (call $emitTok (enum.get $Token.string)
      (local.get $start) (i32.add (local.get $start) (local.get $n)))
    (global.set $ptr (i32.add (local.get $start) (local.get $n)))
    (i32.const 1))

  ;; PHP code, stopping before a live `?>` delimiter.
  (func $phpCode
    (local $c i32)
    (local $decl i32) ;; 1 function, 2 class-like
    (local $hl i32)
    (local $lhs i32)
    (local $member i32)
    (local $next i32)
    (local $p i32)
    (if (i32.and (global.get $streaming) (global.get $phpStreamingCode))
      (then
        (local.set $decl (global.get $phpStreamDecl))
        (local.set $member (global.get $phpStreamMember))))
    (block $done
      (loop $token
        (local.set $lhs (global.get $ptr))
        (call $lexScanWhitespace)
        (call $emitGap (local.get $lhs) (global.get $ptr))
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        (local.set $lhs (global.get $ptr))
        (local.set $c (i32.load8_u (global.get $ptr)))
        (local.set $next (select
          (i32.load8_u offset=1 (global.get $ptr)) (i32.const 0)
          (i32.lt_u (i32.add (global.get $ptr) (i32.const 1)) (global.get $end))))
        (br_if $done (i32.and (i32.eq (local.get $c) (i32.const "?"))
                              (i32.eq (local.get $next) (i32.const ">"))))
        (if (i32.or
              (i32.and (i32.eq (local.get $c) (i32.const "/"))
                       (i32.eq (local.get $next) (i32.const "/")))
              (i32.and (i32.eq (local.get $c) (i32.const "#"))
                       (i32.ne (local.get $next) (i32.const "["))))
          (then
            (call $phpLineComment
              (select (i32.const 2) (i32.const 1) (i32.eq (local.get $c) (i32.const "/")))
            )
            (br $token)))
        (if (i32.and (i32.eq (local.get $c) (i32.const "/"))
                     (i32.eq (local.get $next) (i32.const "*")))
          (then
            (call $lexBlockComment (i32.const 2) (enum.get $Token.comment))
            (br $token)))
        (if (i32.and
              (i32.and (i32.eq (local.get $c) (i32.const "<"))
                       (i32.eq (local.get $next) (i32.const "<")))
              (i32.and
                (i32.lt_u (i32.add (global.get $ptr) (i32.const 2)) (global.get $end))
                (i32.eq (i32.load8_u offset=2 (global.get $ptr)) (i32.const "<"))))
          (then
            (if (call $phpHeredoc)
              (then
                (local.set $decl (i32.const 0))
                (local.set $member (i32.const 0))
                (br $token)))))
        (if (i32.or
              (i32.eq (local.get $c) (i32.const 34))
              (i32.or (i32.eq (local.get $c) (i32.const 39))
                      (i32.eq (local.get $c) (i32.const "`"))))
          (then
            (call $lexString (local.get $c) (i32.const 1) (enum.get $Token.string))
            (local.set $decl (i32.const 0))
            (local.set $member (i32.const 0))
            (br $token)))
        (if (i32.eq (local.get $c) (i32.const "$"))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (call $lexScanIdent)
            (call $emitTok (enum.get $Token.variable) (local.get $lhs) (global.get $ptr))
            (local.set $decl (i32.const 0))
            (local.set $member (i32.const 0))
            (br $token)))
        (if (i32.or
              (call $lexIsDigit (local.get $c))
              (i32.and
                (i32.eq (local.get $c) (i32.const "."))
                (call $lexIsDigit (local.get $next))))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (call $lexScanNumber)
            (call $emitTok (enum.get $Token.number) (local.get $lhs) (global.get $ptr))
            (local.set $decl (i32.const 0))
            (local.set $member (i32.const 0))
            (br $token)))
        (if (call $lexIsIdentStart (local.get $c))
          (then
            (call $lexScanIdent)
            (local.set $hl (call $phpWordHl (local.get $lhs) (global.get $ptr)))
            (if (local.get $decl)
              (then
                (local.set $hl (select
                  (enum.get $Token.function.definition) (enum.get $Token.type.class)
                  (i32.eq (local.get $decl) (i32.const 1))))
                (local.set $decl (i32.const 0)))
              (else
                (if (local.get $member)
                  (then
                    (local.set $p (call $lexSkipSpaceAt (global.get $ptr)))
                    (local.set $hl (select
                      (enum.get $Token.function.method) (enum.get $Token.property)
                      (i32.and (i32.lt_u (local.get $p) (global.get $end))
                               (i32.eq (i32.load8_u (local.get $p)) (i32.const "(")))))
                    (local.set $member (i32.const 0)))
                  (else
                    (if (i32.eq (local.get $hl) (enum.get $Token.variable))
                      (then
                        (local.set $p (call $lexSkipSpaceAt (global.get $ptr)))
                        (if (i32.and (i32.lt_u (local.get $p) (global.get $end))
                                     (i32.eq (i32.load8_u (local.get $p)) (i32.const "(")))
                          (then (local.set $hl (enum.get $Token.function))))))))))
            (if (i32.eq (local.get $hl) (enum.get $Token.keyword.declaration))
              (then
                (local.set $decl (select
                  (i32.const 1) (i32.const 2)
                  (i32.and
                    (i32.eq (i32.sub (global.get $ptr) (local.get $lhs)) (i32.const 8))
                    (i64.eq (i64.or (i64.load (local.get $lhs)) (i64.const 0x2020202020202020))
                            (i64.const "function")))))))
            (call $emitTok (local.get $hl) (local.get $lhs) (global.get $ptr))
            (br $token)))
        (if (i32.or
              (i32.and (i32.eq (local.get $c) (i32.const "-"))
                       (i32.eq (local.get $next) (i32.const ">")))
              (i32.and (i32.eq (local.get $c) (i32.const ":"))
                       (i32.eq (local.get $next) (i32.const ":"))))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 2)))
            (call $emitTok (enum.get $Token.operator) (local.get $lhs) (global.get $ptr))
            (local.set $decl (i32.const 0))
            (local.set $member (i32.const 1))
            (br $token)))
        (if (i32.or
              (i32.or (i32.eq (local.get $c) (i32.const "("))
                      (i32.eq (local.get $c) (i32.const ")")))
              (i32.or
                (i32.or (i32.eq (local.get $c) (i32.const "["))
                        (i32.eq (local.get $c) (i32.const "]")))
                (i32.or (i32.eq (local.get $c) (i32.const "{"))
                        (i32.eq (local.get $c) (i32.const "}")))))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (call $emitTok (enum.get $Token.punctuation.bracket) (local.get $lhs) (global.get $ptr))
            (local.set $decl (i32.const 0))
            (local.set $member (i32.const 0))
            (br $token)))
        (if (i32.or
              (i32.eq (local.get $c) (i32.const ","))
              (i32.or (i32.eq (local.get $c) (i32.const ";"))
                      (i32.eq (local.get $c) (i32.const ":"))))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (call $emitTok (enum.get $Token.punctuation.delimiter) (local.get $lhs) (global.get $ptr))
            (local.set $decl (i32.const 0))
            (local.set $member (i32.const 0))
            (br $token)))
        (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
        (call $emitTok (select
          (enum.get $Token.attribute) (enum.get $Token.operator)
          (i32.and (i32.eq (local.get $c) (i32.const "#"))
                   (i32.eq (local.get $next) (i32.const "["))))
          (local.get $lhs) (global.get $ptr))
        (if (i32.ne (local.get $c) (i32.const "&"))
          (then (local.set $decl (i32.const 0))))
        (local.set $member (i32.const 0))
        (br $token)))
    (if (global.get $streaming)
      (then
        (global.set $phpStreamDecl (local.get $decl))
        (global.set $phpStreamMember (local.get $member)))))

  (func $phpStreamResume (result i32)
    (local $lhs i32)
    (if (i32.eqz (global.get $phpStreamingCode))
      (then (return (i32.const 0))))
    (call $phpCode)
    (if (i32.and
          (i32.lt_u (i32.add (global.get $ptr) (i32.const 1)) (global.get $end))
          (i32.eq (i32.load16_u (global.get $ptr)) (i32.const "?>")))
      (then
        (local.set $lhs (global.get $ptr))
        (global.set $ptr (i32.add (global.get $ptr) (i32.const 2)))
        (call $emitTok (enum.get $Token.preproc) (local.get $lhs) (global.get $ptr))
        (global.set $phpStreamingCode (i32.const 0))
        (return (i32.const 0))))
    (i32.const 1))

  (func $hlPhp
    (local $open i32)
    (local $p i32)
    (local $saveEnd i32)
    (call $lexEmitLeadingContinuation)
    (block $out
      (local.set $open (call $phpFindOpen (global.get $ptr)))
      (if (i32.eq (local.get $open) (global.get $end))
        (then
          (local.set $p (call $lexSkipSpaceAt (global.get $ptr)))
          (if (i32.and
                (i32.lt_u (i32.add (local.get $p) (i32.const 1)) (global.get $end))
                (i32.and
                  (i32.eq (i32.load8_u (local.get $p)) (i32.const "<"))
                  (i32.or
                    (call $lexIsIdentStart (i32.load8_u offset=1 (local.get $p)))
                    (i32.or
                      (i32.eq (i32.load8_u offset=1 (local.get $p)) (i32.const "!"))
                      (i32.eq (i32.load8_u offset=1 (local.get $p)) (i32.const "/"))))))
            (then (call $hlHtml))
            (else
              (global.set $phpStreamingCode (i32.const 0))
              (call $phpCode)
              (if (i32.and
                    (global.get $streaming)
                    (i32.eq (global.get $ptr) (global.get $end)))
                (then (global.set $phpStreamingCode (i32.const 1))))
              (if (i32.lt_u (global.get $ptr) (global.get $end))
                (then
                  (local.set $open (global.get $ptr))
                  (global.set $ptr (global.get $end))
                  (call $emitTok (enum.get $Token.none) (local.get $open) (global.get $ptr))))))
          (br $out)))
      (block $done
        (loop $part
        (if (i32.lt_u (global.get $ptr) (local.get $open))
          (then
            (local.set $saveEnd (global.get $end))
            (global.set $end (local.get $open))
            (call $hlHtml)
            (global.set $end (local.get $saveEnd))))
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        (local.set $open (global.get $ptr))
        (global.set $ptr (i32.add (global.get $ptr)
          (select (i32.const 3) (i32.const 5)
            (i32.eq (i32.load8_u offset=2 (global.get $ptr)) (i32.const "=")))))
        (call $emitTok (enum.get $Token.preproc) (local.get $open) (global.get $ptr))
        (global.set $phpStreamingCode (i32.const 0))
        (call $phpCode)
        (if (i32.and
              (i32.lt_u (i32.add (global.get $ptr) (i32.const 1)) (global.get $end))
              (i32.eq (i32.and (i32.load (global.get $ptr)) (i32.const 0xffff)) (i32.const "?>")))
          (then
            (local.set $open (global.get $ptr))
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 2)))
            (call $emitTok (enum.get $Token.preproc) (local.get $open) (global.get $ptr)))
          (else
            (if (i32.and
                  (global.get $streaming)
                  (i32.eq (global.get $ptr) (global.get $end)))
              (then (global.set $phpStreamingCode (i32.const 1))))
            (br $done)))
        (local.set $open (call $phpFindOpen (global.get $ptr)))
        (if (i32.lt_u (global.get $ptr) (local.get $open))
          (then
            (local.set $saveEnd (global.get $end))
            (global.set $end (local.get $open))
            (call $hlHtml)
            (global.set $end (local.get $saveEnd))))
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
          (br $part)))))
)
