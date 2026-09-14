(module
  (import "../common.wat")
  (import "./html.wat")

  (keyword-table $angularWords $mem.angularWords $mem.liveHeapStart
    (group $Token.keyword.control
      "if" "else" "for" "empty" "switch" "case" "default" "defer" "placeholder" "loading" "error")
    (group $Token.keyword.declaration "let")
    (group $Token.keyword "as" "of" "track" "on" "when" "prefetch" "hydrate" "never")
    (group $Token.keyword.operator "typeof" "void" "in" "instanceof")
    (group $Token.boolean "true" "false")
    (group $Token.constant.builtin "null" "undefined")
    (group $Token.variable.special
      "this" "$event" "$index" "$count" "$first" "$last" "$even" "$odd" "$implicit"))

  ;; Block names and expression words share an exact keyword lookup.
  (func $angularKeyword (param $from i32) (param $to i32) (result i32)
    (local $hl i32)
    (local.set $hl (keyword-table.value $angularWords (local.get $from) (local.get $to)))
    (select (local.get $hl) (enum.get $Token.variable) (i32.ge_s (local.get $hl) (i32.const 0))))

  ;; Expression kinds in bits 7..9: 1 interpolation, 2 binding, 3 block header,
  ;; 4 @let assignment, 5 awaiting a block header. Bits 10..16 store a string
  ;; quote, 17..28 bracket depth, and 29..30 member/pipe context. Keeping these
  ;; local avoids resetting a surrounding JavaScript lexer during inline emission.
  (func $angularExpression (param $state i32) (result i32)
    (local $mode i32)
    (local $expr i32)
    (local $quote i32)
    (local $depth i32)
    (local $member i32)
    (local $p i32)
    (local $c i32)
    (local $q i32)
    (local $hl i32)
    (local.set $mode (i32.and (local.get $state) (i32.const 63)))
    (local.set $expr (i32.and (i32.shr_u (local.get $state) (i32.const 7)) (i32.const 7)))
    (local.set $quote (i32.and (i32.shr_u (local.get $state) (i32.const 10)) (i32.const 127)))
    (local.set $depth (i32.and (i32.shr_u (local.get $state) (i32.const 17)) (i32.const 4095)))
    (local.set $member (i32.shr_u (local.get $state) (i32.const 29)))
    (block $done
      (loop $next
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        (local.set $p (global.get $ptr))
        (local.set $c (i32.load8_u (local.get $p)))
        (if (local.get $quote)
          (then
            (if
              (call $lexStringBody
                (local.get $quote)
                (i32.const 1)
                (enum.get $Token.string)
                (local.get $p))
              (then (local.set $quote (i32.const 0))))
            (br $next)))
        (if (i32.eq (local.get $expr) (i32.const 2))
          (then
            (if (i32.eq (local.get $c) (local.get $mode))
              (then
                (global.set $ptr (i32.add (local.get $p) (i32.const 1)))
                (call $emitTok (enum.get $Token.string) (local.get $p) (global.get $ptr))
                (return (i32.const 3))))
            (if
              (i32.and
                (i32.eq (local.get $mode) (i32.const 5))
                (i32.or (call $lexIsSpace (local.get $c)) (i32.eq (local.get $c) (i32.const ">"))))
              (then (return (i32.const 3))))))
        (if (call $lexIsSpace (local.get $c))
          (then
            (call $scanWhitespace)
            (call $emitGap (local.get $p) (global.get $ptr))
            (br $next)))
        (if (i32.eq (local.get $expr) (i32.const 5))
          (then
            (if (call $lexIsIdentStart (local.get $c))
              (then
                (call $lexScanIdent)
                (call $emitTok
                  (call $angularKeyword (local.get $p) (global.get $ptr))
                  (local.get $p)
                  (global.get $ptr))
                (br $next)))
            (if (i32.eq (local.get $c) (i32.const "("))
              (then
                (global.set $ptr (i32.add (local.get $p) (i32.const 1)))
                (call $emitTok
                  (enum.get $Token.punctuation.bracket)
                  (local.get $p)
                  (global.get $ptr))
                (local.set $expr (i32.const 3))
                (br $next)))
            (if (i32.eq (local.get $c) (i32.const ";"))
              (then
                (global.set $ptr (i32.add (local.get $p) (i32.const 1)))
                (call $emitTok
                  (enum.get $Token.punctuation.delimiter)
                  (local.get $p)
                  (global.get $ptr))))
            (return (i32.const 1))))
        (if (i32.eqz (local.get $depth))
          (then
            (if
              (i32.and
                (i32.eq (local.get $expr) (i32.const 1))
                (i32.and
                  (i32.eq (local.get $c) (i32.const "}"))
                  (i32.eq (call $tsxByte (i32.add (local.get $p) (i32.const 1))) (i32.const "}"))))
              (then
                (global.set $ptr (i32.add (local.get $p) (i32.const 2)))
                (call $emitTok
                  (enum.get $Token.punctuation.special)
                  (local.get $p)
                  (global.get $ptr))
                (return (local.get $mode))))
            (if
              (i32.or
                (i32.and
                  (i32.eq (local.get $expr) (i32.const 3))
                  (i32.eq (local.get $c) (i32.const ")")))
                (i32.and
                  (i32.eq (local.get $expr) (i32.const 4))
                  (i32.eq (local.get $c) (i32.const ";"))))
              (then
                (global.set $ptr (i32.add (local.get $p) (i32.const 1)))
                (call $emitTok
                  (select
                    (enum.get $Token.punctuation.bracket)
                    (enum.get $Token.punctuation.delimiter)
                    (i32.eq (local.get $expr) (i32.const 3)))
                  (local.get $p)
                  (global.get $ptr))
                (return (i32.const 1))))))
        (if
          (i32.or
            (i32.eq (local.get $c) (i32.const 34))
            (i32.or (i32.eq (local.get $c) (i32.const 39)) (i32.eq (local.get $c) (i32.const 96))))
          (then
            (local.set $quote (local.get $c))
            (local.set $member (i32.const 0))
            (global.set $ptr (i32.add (local.get $p) (i32.const 1)))
            (if
              (call $lexStringBody
                (local.get $quote)
                (i32.const 1)
                (enum.get $Token.string)
                (local.get $p))
              (then (local.set $quote (i32.const 0))))
            (br $next)))
        (if (call $lexIsIdentStart (local.get $c))
          (then
            (call $lexScanIdent)
            (local.set $q (call $lexSkipSpaceAt (global.get $ptr)))
            (local.set $hl (call $angularKeyword (local.get $p) (global.get $ptr)))
            (if (i32.eq (local.get $hl) (enum.get $Token.keyword.control))
              (then (local.set $hl (enum.get $Token.variable))))
            (if (local.get $member)
              (then
                (local.set $hl
                  (select
                    (enum.get $Token.property)
                    (enum.get $Token.function)
                    (i32.eq (local.get $member) (i32.const 1))))))
            (if
              (i32.and
                (i32.ne (local.get $member) (i32.const 2))
                (i32.eq (call $tsxByte (local.get $q)) (i32.const "(")))
              (then
                (local.set $hl
                  (select
                    (enum.get $Token.function.method)
                    (enum.get $Token.function)
                    (local.get $member)))))
            (call $emitTok (local.get $hl) (local.get $p) (global.get $ptr))
            (local.set $member (i32.const 0))
            (br $next)))
        (local.set $member (i32.const 0))
        (if
          (i32.or
            (call $lexIsDigit (local.get $c))
            (i32.and
              (i32.eq (local.get $c) (i32.const "."))
              (call $lexIsDigit (call $tsxByte (i32.add (local.get $p) (i32.const 1))))))
          (then
            (call $lexScanNumber)
            (call $emitTok (enum.get $Token.number) (local.get $p) (global.get $ptr))
            (br $next)))
        (global.set $ptr (i32.add (local.get $p) (i32.const 1)))
        (local.set $hl (enum.get $Token.operator))
        (if
          (i32.or
            (i32.eq (local.get $c) (i32.const "("))
            (i32.or
              (i32.eq (local.get $c) (i32.const "["))
              (i32.eq (local.get $c) (i32.const "{"))))
          (then
            (local.set $depth
              (i32.add (local.get $depth) (i32.lt_u (local.get $depth) (i32.const 4095))))
            (local.set $hl (enum.get $Token.punctuation.bracket))))
        (if
          (i32.or
            (i32.eq (local.get $c) (i32.const ")"))
            (i32.or
              (i32.eq (local.get $c) (i32.const "]"))
              (i32.eq (local.get $c) (i32.const "}"))))
          (then
            (local.set $depth
              (i32.sub (local.get $depth) (i32.ne (local.get $depth) (i32.const 0))))
            (local.set $hl (enum.get $Token.punctuation.bracket))))
        (if
          (i32.or
            (i32.eq (local.get $c) (i32.const ";"))
            (i32.or
              (i32.eq (local.get $c) (i32.const ":"))
              (i32.eq (local.get $c) (i32.const ","))))
          (then (local.set $hl (enum.get $Token.punctuation.delimiter))))
        (if (i32.eq (local.get $c) (i32.const "."))
          (then
            (local.set $hl (enum.get $Token.punctuation.delimiter))
            (local.set $member (i32.const 1))))
        (if (i32.eq (local.get $c) (i32.const "|"))
          (then
            (if (i32.eq (call $tsxByte (global.get $ptr)) (i32.const "|"))
              (then (global.set $ptr (i32.add (global.get $ptr) (i32.const 1))))
              (else (local.set $member (i32.const 2))))))
        (call $emitTok (local.get $hl) (local.get $p) (global.get $ptr))
        (br $next)))
    (i32.or
      (local.get $mode)
      (i32.or
        (i32.shl (local.get $expr) (i32.const 7))
        (i32.or
          (i32.shl (local.get $quote) (i32.const 10))
          (i32.or
            (i32.shl (local.get $depth) (i32.const 17))
            (i32.shl (local.get $member) (i32.const 29)))))))

  (func $hlAngularHtml
    (local $state i32)
    (call $lexEmitLeadingContinuation)
    (local.set $state (i32.const 1))
    (if (i32.and (global.get $streaming) (i32.eqz (global.get $streamReset)))
      (then (local.set $state (global.get $streamA))))
    (local.set $state (call $hlTemplateMarkup (local.get $state) (i32.const 1)))
    (if (global.get $streaming)
      (then (global.set $streamA (local.get $state)))))

  ;; HTML and Angular share the markup modes: 1 text, 2 tag name, 3 attributes,
  ;; 4 value, 5 unquoted value, 6 comment, 7 declaration, 8 PI, 34/39 quoted value.
  ;; Angular adds a directive flag in bit 6 and expression state above bit 7.
  ;; All state is returned to the caller so embedded templates leave JavaScript intact.
  (func $hlTemplateMarkup (param $state i32) (param $angular i32) (result i32)
    (local $from i32)
    (local $p i32)
    (local $c i32)
    (local $mode i32)
    (local $hl i32)
    (local.set $from (global.get $ptr))
    (block $done
      (loop $next
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        (local.set $p (global.get $ptr))
        (local.set $c (i32.load8_u (local.get $p)))
        (if
          (i32.and
            (local.get $angular)
            (i32.ne (i32.and (local.get $state) (i32.const 896)) (i32.const 0)))
          (then
            (local.set $state (call $angularExpression (local.get $state)))
            (br $next)))
        (local.set $mode (i32.and (local.get $state) (i32.const 63)))
        (if
          (i32.or
            (i32.eq (local.get $mode) (i32.const 34))
            (i32.eq (local.get $mode) (i32.const 39)))
          (then
            (if (local.get $angular)
              (then
                (global.set $ptr
                  (call $lexFindEither (global.get $ptr) (local.get $mode) (i32.const "{")))
                (if (i32.eq (call $tsxByte (global.get $ptr)) (i32.const "{"))
                  (then
                    (call $emitEscaped (enum.get $Token.string) (local.get $p) (global.get $ptr))
                    (if
                      (i32.eq
                        (call $tsxByte (i32.add (global.get $ptr) (i32.const 1)))
                        (i32.const "{"))
                      (then
                        (local.set $state (i32.or (local.get $mode) (i32.const 128)))
                        (local.set $p (global.get $ptr))
                        (global.set $ptr (i32.add (global.get $ptr) (i32.const 2)))
                        (call $emitTok
                          (enum.get $Token.punctuation.special)
                          (local.get $p)
                          (global.get $ptr)))
                      (else
                        (local.set $p (global.get $ptr))
                        (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                        (call $emitTok (enum.get $Token.string) (local.get $p) (global.get $ptr))))
                    (br $next))))
              (else (global.set $ptr (call $lexFindByte (global.get $ptr) (local.get $mode)))))
            (if (i32.lt_u (global.get $ptr) (global.get $end))
              (then
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                (local.set $state (i32.const 3))))
            (call $emitEscaped (enum.get $Token.string) (local.get $p) (global.get $ptr))
            (br $next)))
        (if (i32.ge_u (local.get $mode) (i32.const 6))
          (then
            (block $close
              (loop $find
                (global.set $ptr (call $lexFindByte (global.get $ptr) (i32.const ">")))
                (br_if $close (i32.ge_u (global.get $ptr) (global.get $end)))
                (if
                  (i32.or
                    (i32.eq (local.get $mode) (i32.const 7))
                    (i32.or
                      (i32.and
                        (i32.eq (local.get $mode) (i32.const 6))
                        (i32.and
                          (i32.ge_u (i32.sub (global.get $ptr) (local.get $from)) (i32.const 2))
                          (i32.eq
                            (i32.load16_u (i32.sub (global.get $ptr) (i32.const 2)))
                            (i32.const "--"))))
                      (i32.and
                        (i32.eq (local.get $mode) (i32.const 8))
                        (i32.and
                          (i32.gt_u (global.get $ptr) (local.get $from))
                          (i32.eq
                            (i32.load8_u (i32.sub (global.get $ptr) (i32.const 1)))
                            (i32.const "?"))))))
                  (then (local.set $state (i32.const 1))))
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                (br_if $close (i32.eq (local.get $state) (i32.const 1)))
                (br $find)))
            (call $emitTok
              (select
                (enum.get $Token.tag.doctype)
                (enum.get $Token.comment)
                (i32.eq (local.get $mode) (i32.const 7)))
              (local.get $p)
              (global.get $ptr))
            (br $next)))
        (if (i32.eq (local.get $mode) (i32.const 1))
          (then
            (if (local.get $angular)
              (then
                (if
                  (i32.and
                    (i32.eq (local.get $c) (i32.const "{"))
                    (i32.eq (call $tsxByte (i32.add (local.get $p) (i32.const 1))) (i32.const "{")))
                  (then
                    (global.set $ptr (i32.add (local.get $p) (i32.const 2)))
                    (call $emitTok
                      (enum.get $Token.punctuation.special)
                      (local.get $p)
                      (global.get $ptr))
                    (local.set $state (i32.const 129))
                    (br $next)))
                (if (i32.eq (local.get $c) (i32.const "@"))
                  (then
                    (global.set $ptr (i32.add (local.get $p) (i32.const 1)))
                    (call $lexScanIdent)
                    (local.set $hl
                      (call $angularKeyword
                        (i32.add (local.get $p) (i32.const 1))
                        (global.get $ptr)))
                    (if
                      (i32.or
                        (i32.eq (local.get $hl) (enum.get $Token.keyword.control))
                        (i32.eq (local.get $hl) (enum.get $Token.keyword.declaration)))
                      (then
                        (call $emitTok (local.get $hl) (local.get $p) (global.get $ptr))
                        (local.set $state
                          (select
                            (i32.const 513)
                            (i32.const 641)
                            (i32.eq (local.get $hl) (enum.get $Token.keyword.declaration))))
                        (br $next)))
                    (global.set $ptr (local.get $p))))
                (if
                  (i32.or
                    (i32.eq (local.get $c) (i32.const "{"))
                    (i32.eq (local.get $c) (i32.const "}")))
                  (then
                    (global.set $ptr (i32.add (local.get $p) (i32.const 1)))
                    (call $emitTok
                      (enum.get $Token.punctuation.bracket)
                      (local.get $p)
                      (global.get $ptr))
                    (br $next)))))
            (if (i32.eq (local.get $c) (i32.const "&"))
              (then
                (if (call $htmlEntity)
                  (then (br $next)))))
            (if (i32.eq (local.get $c) (i32.const "<"))
              (then
                (local.set $c (call $tsxByte (i32.add (local.get $p) (i32.const 1))))
                (if
                  (i32.or
                    (i32.eq (local.get $c) (i32.const "!"))
                    (i32.eq (local.get $c) (i32.const "?")))
                  (then
                    (local.set $state
                      (select (i32.const 8) (i32.const 7) (i32.eq (local.get $c) (i32.const "?"))))
                    (if
                      (i32.and
                        (i32.le_u (i32.add (local.get $p) (i32.const 4)) (global.get $end))
                        (i32.eq (i32.load (local.get $p)) (i32.const "<!--")))
                      (then (local.set $state (i32.const 6))))
                    (br $next)))
                (if
                  (i32.or
                    (i32.eq (local.get $c) (i32.const "/"))
                    (call $xmlNameStart (local.get $c)))
                  (then
                    (global.set $ptr
                      (i32.add
                        (local.get $p)
                        (select
                          (i32.const 2)
                          (i32.const 1)
                          (i32.eq (local.get $c) (i32.const "/")))))
                    (call $emitTok
                      (enum.get $Token.punctuation.bracket.html)
                      (local.get $p)
                      (global.get $ptr))
                    (local.set $state (i32.const 2))
                    (br $next)))))
            (if (local.get $angular)
              (then
                (global.set $ptr (i32.add (local.get $p) (i32.const 1)))
                (block $textEnd
                  (loop $text
                    (br_if $textEnd (i32.ge_u (global.get $ptr) (global.get $end)))
                    (local.set $c (i32.load8_u (global.get $ptr)))
                    (br_if $textEnd
                      (i32.or
                        (i32.or
                          (i32.eq (local.get $c) (i32.const "<"))
                          (i32.eq (local.get $c) (i32.const "&")))
                        (i32.or
                          (i32.eq (local.get $c) (i32.const "@"))
                          (i32.or
                            (i32.eq (local.get $c) (i32.const "{"))
                            (i32.eq (local.get $c) (i32.const "}"))))))
                    (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                    (br $text))))
              (else
                (global.set $ptr
                  (call $lexFindEither
                    (i32.add (local.get $p) (i32.const 1))
                    (i32.const "<")
                    (i32.const "&")))))
            (call $emitEscaped (enum.get $Token.none) (local.get $p) (global.get $ptr))
            (br $next)))
        (if
          (i32.or
            (i32.eq (local.get $c) (i32.const 32))
            (i32.le_u (i32.sub (local.get $c) (i32.const 9)) (i32.const 4)))
          (then
            (call $scanWhitespace)
            (call $emitGap (local.get $p) (global.get $ptr))
            (if (i32.eq (local.get $mode) (i32.const 5))
              (then (local.set $state (i32.const 3))))
            (br $next)))
        (global.set $ptr (i32.add (local.get $p) (i32.const 1)))
        (local.set $hl (enum.get $Token.punctuation.bracket.html))
        (if (i32.eq (local.get $c) (i32.const ">"))
          (then (local.set $state (i32.const 1)))
          (else
            (if (i32.eq (local.get $c) (i32.const "<"))
              (then
                (global.set $ptr (local.get $p))
                (local.set $state (i32.const 1))
                (br $next)))
            (if
              (i32.or (i32.eq (local.get $c) (i32.const 34)) (i32.eq (local.get $c) (i32.const 39)))
              (then
                (local.set $state
                  (i32.or
                    (local.get $c)
                    (select
                      (i32.const 256)
                      (i32.const 0)
                      (i32.and (local.get $state) (i32.const 64)))))
                (call $emitTok (enum.get $Token.string) (local.get $p) (global.get $ptr))
                (br $next)))
            (if
              (i32.or
                (i32.eq (local.get $mode) (i32.const 4))
                (i32.eq (local.get $mode) (i32.const 5)))
              (then
                (if (i32.and (local.get $state) (i32.const 64))
                  (then
                    (global.set $ptr (local.get $p))
                    (local.set $state (i32.const 261))
                    (br $next)))
                (global.set $ptr (call $htmlValueEnd (local.get $p)))
                (local.set $state (i32.const 5))
                (call $emitEscaped (enum.get $Token.string) (local.get $p) (global.get $ptr))
                (br $next)))
            (if (i32.eq (local.get $c) (i32.const "="))
              (then
                (local.set $state
                  (i32.or (i32.const 4) (i32.and (local.get $state) (i32.const 64))))
                (local.set $hl (enum.get $Token.punctuation.delimiter.html)))
              (else
                (if (i32.ne (local.get $c) (i32.const "/"))
                  (then
                    (global.set $ptr (call $htmlNameEnd (local.get $p)))
                    (local.set $hl
                      (select
                        (enum.get $Token.tag)
                        (enum.get $Token.attribute)
                        (i32.eq (local.get $mode) (i32.const 2))))
                    (local.set $state
                      (i32.or
                        (i32.const 3)
                        (select
                          (i32.const 64)
                          (i32.const 0)
                          (i32.and
                            (local.get $angular)
                            (i32.and
                              (i32.ne (local.get $mode) (i32.const 2))
                              (i32.or
                                (i32.eq (local.get $c) (i32.const "["))
                                (i32.or
                                  (i32.eq (local.get $c) (i32.const "("))
                                  (i32.eq (local.get $c) (i32.const "*")))))))))))))))
        (call $emitTok (local.get $hl) (local.get $p) (global.get $ptr))
        (br $next)))
    (local.get $state))
)
