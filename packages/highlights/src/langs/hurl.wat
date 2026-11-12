(module
  (import "../emitter.wat")
  (import "@pierre/wat-tools/lexer-state.wat")
  (import "@pierre/wat-tools/common.wat")
  (import "./ini.wat")
  (import "./http.wat")

  (memory-region $mem.hurlWords 64)
  (keyword-table $hurlWords $mem.hurlWords $mem.hurlWords+64
    (group "contains" "endsWith" "exists" "includes" "matches" "not" "startsWith"))

  ;; The length of a `base64,`, `hex,`, or `file,` prefix at $p before $rhs,
  ;; or 0.
  (func $hurlEncoding (param $p i32) (param $rhs i32) (result i32)
    (local $n i32)
    (local $w i64)
    (local.set $w (i64.load (local.get $p)))
    (local.set $n
      (select
        (i32.const 4)
        (select
          (i32.const 5)
          (select
            (i32.const 7)
            (i32.const 0)
            (i64.eq (i64.and (local.get $w) (i64.const 0xffffffffffffff)) (i64.const "base64,")))
          (i64.eq (i64.and (local.get $w) (i64.const 0xffffffffff)) (i64.const "file,")))
        (i32.eq (i32.wrap_i64 (local.get $w)) (i32.const "hex,"))))
    (select
      (local.get $n)
      (i32.const 0)
      (i32.le_u (i32.add (local.get $p) (local.get $n)) (local.get $rhs))))

  ;; Text up to $rhs with `{{name}}` templates as $hl. A `#` after a blank
  ;; starts a comment.
  (func $hurlText (param $hl i32) (param $rhs i32)
    (local $p i32)
    (local $q i32)
    (local.set $p (global.get $ptr))
    (block $found
      (loop $find
        (local.set $p
          (call $scanFindSpecial (local.get $p) (local.get $rhs) (i32.const "#") (i32.const 0) (i32.const 0)))
        (br_if $found (i32.ge_u (local.get $p) (local.get $rhs)))
        (local.set $q (i32.load8_u (i32.sub (local.get $p) (i32.const 1))))
        (br_if $found (byteset.get " \t" (local.get $q)))
        (local.set $p (i32.add (local.get $p) (i32.const 1)))
        (br $find)))
    (local.set $q (local.get $p))
    (local.set $q (call $iniTrim (global.get $ptr) (local.get $q)))
    (call $httpText (local.get $hl) (local.get $q))
    (call $emitGap (local.get $q) (local.get $p))
    (call $emitTok (enum.get $Token.comment) (local.get $p) (local.get $rhs))
    (global.set $ptr (local.get $rhs)))

  ;; The tokens of a line up to $rhs: strings, `/regex/`, templates, numbers,
  ;; operators, and words. With $query, as in asserts and captures, the first
  ;; word is the query and later words are filters (function) or predicates
  ;; (keyword.operator).
  (func $hurlTokens (param $rhs i32) (param $query i32)
    (local $c i32)
    (local $lhs i32)
    (local $p i32)
    (local $hl i32)
    (block $done
      (loop $next
        (local.set $lhs (call $lexSkipSpaceAt (global.get $ptr)))
        (call $emitGap (global.get $ptr) (local.get $lhs))
        (global.set $ptr (local.get $lhs))
        (br_if $done (i32.ge_u (local.get $lhs) (local.get $rhs)))
        (local.set $c (i32.load8_u (local.get $lhs)))
        (if (i32.eq (local.get $c) (i32.const "#"))
          (then
            (call $emitTok (enum.get $Token.comment) (local.get $lhs) (local.get $rhs))
            (global.set $ptr (local.get $rhs))
            (br $done)))
        (if
          (i32.or
            (i32.or (i32.eq (local.get $c) (i32.const 34)) (i32.eq (local.get $c) (i32.const "`")))
            (i32.and (i32.ne (local.get $query) (i32.const 0)) (i32.eq (local.get $c) (i32.const "/"))))
          (then
            (call $lexString
              (local.get $c)
              (i32.const 0)
              (select (enum.get $Token.string.regex) (enum.get $Token.string) (i32.eq (local.get $c) (i32.const "/"))))
            (br $next)))
        (if
          (i32.and
            (i32.eq (local.get $c) (i32.const "{"))
            (i32.eq (call $templateByte (i32.add (local.get $lhs) (i32.const 1))) (i32.const "{")))
          (then
            (local.set $p
              (call $scanFindSpecial (local.get $lhs) (local.get $rhs) (i32.const "}") (i32.const 0) (i32.const 0)))
            (local.set $p
              (select
                (i32.add (local.get $p) (i32.const 2))
                (local.get $rhs)
                (i32.lt_u (i32.add (local.get $p) (i32.const 1)) (local.get $rhs))))
            (call $httpText (enum.get $Token.none) (local.get $p))
            (br $next)))
        (local.set $p (call $hurlEncoding (local.get $lhs) (local.get $rhs)))
        (if (local.get $p)
          (then
            ;; `base64,`, `hex,`, or `file,` data up to `;`
            (global.set $ptr (i32.add (local.get $lhs) (local.get $p)))
            (call $emitTok (enum.get $Token.function) (local.get $lhs) (global.get $ptr))
            (local.set $p
              (call $scanFindSpecial (global.get $ptr) (local.get $rhs) (i32.const ";") (i32.const 0) (i32.const 0)))
            (call $httpText (enum.get $Token.string) (local.get $p))
            (if (i32.lt_u (local.get $p) (local.get $rhs))
              (then
                (global.set $ptr (i32.add (local.get $p) (i32.const 1)))
                (call $emitTok (enum.get $Token.punctuation.delimiter) (local.get $p) (global.get $ptr))))
            (br $next)))
        (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
        (local.set $hl (enum.get $Token.none))
        (block $emit
          (if
            (i32.or
              (call $lexIsDigit (local.get $c))
              (i32.and
                (i32.eq (local.get $c) (i32.const "-"))
                (call $lexIsDigit (call $templateByte (global.get $ptr)))))
            (then
              (global.set $ptr (i32.add (local.get $lhs) (i32.eq (local.get $c) (i32.const "-"))))
              (call $lexScanNumber)
              (local.set $hl (enum.get $Token.number))
              (br $emit)))
          (if (byteset.get "!<=>" (local.get $c))
            (then
              (global.set $ptr
                (i32.add
                  (global.get $ptr)
                  (i32.eq (call $templateByte (global.get $ptr)) (i32.const "="))))
              (local.set $hl (enum.get $Token.operator))
              (br $emit)))
          (if (call $lexIsNameStart (local.get $c))
            (then
              (call $scanIdentRun (i32.const 0))
              (local.set $hl (call $jsonWordHl (local.get $lhs) (global.get $ptr) (i32.const 0)))
              (if (i32.and (i32.ne (local.get $query) (i32.const 0)) (i32.eqz (local.get $hl)))
                (then
                  (local.set $hl
                    (select
                      (enum.get $Token.keyword.operator)
                      (enum.get $Token.function)
                      (i32.or
                        (keyword-table.get $hurlWords (local.get $lhs) (global.get $ptr))
                        ;; isInteger, isString, ...
                        (i32.and
                          (i32.eq (i32.load16_u (local.get $lhs)) (i32.const "is"))
                          (i32.le_u (i32.sub (i32.load8_u offset=2 (local.get $lhs)) (i32.const "A")) (i32.const 25))))))
                  (if (i32.eq (local.get $query) (i32.const 1))
                    (then (local.set $hl (enum.get $Token.function))))
                  (local.set $query (i32.const 2))))
              (br $emit)))
          (global.set $ptr (call $utf8SpanEnd (global.get $ptr) (global.get $end))))
        (call $emitTok (local.get $hl) (local.get $lhs) (global.get $ptr))
        (br $next))))

  ;; Hurl bodies end at the response line, not at `###`.
  (func-variant $hurlBody $httpBody (global $httpHurl 1))

  (func $hurlStreamResume (result i32)
    (call $hurlBody (global.get $streamRegionStarted) (i32.const 1))
    (i32.ge_u (global.get $ptr) (global.get $end)))

  ;; Hurl request files: entries of a request line (`GET url`), headers,
  ;; `[Section]` blocks, a body, then an optional `HTTP 200` response with its
  ;; own headers, `[Asserts]`, `[Captures]`, and body. JSON and XML bodies run
  ;; their lexers through $httpBody. $section is 1 in `[Asserts]` and 2 in
  ;; `[Captures]`.
  (func $hlHurl
    (local $c i32)
    (local $gap i32)
    (local $lhs i32)
    (local $p i32)
    (local $rhs i32)
    (local $response i32)
    (local $section i32)
    (call $lexEmitLeadingContinuation)
    (block $done
      (loop $next
        (local.set $gap (global.get $ptr))
        (call $scanWhitespace)
        (call $emitGap (local.get $gap) (global.get $ptr))
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        (local.set $lhs (global.get $ptr))
        (local.set $c (i32.load8_u (local.get $lhs)))
        (local.set $p (call $templateByte (i32.add (local.get $lhs) (i32.const 1))))
        (if (i32.eq (local.get $c) (i32.const "#"))
          (then
            (call $lexLineComment (i32.const 1) (enum.get $Token.comment))
            (br $next)))
        ;; a ``` multiline string, with an optional language on its first line
        (if
          (i32.and
            (i32.eq (local.get $c) (i32.const "`"))
            (i32.and
              (i32.eq (local.get $p) (i32.const "`"))
              (i32.eq (call $templateByte (i32.add (local.get $lhs) (i32.const 2))) (i32.const "`"))))
          (then
            (local.set $p (i32.add (local.get $lhs) (i32.const 3)))
            (block $closed
              (loop $find
                (local.set $p (call $lexFindByte (local.get $p) (i32.const "`")))
                (if (i32.gt_u (i32.add (local.get $p) (i32.const 3)) (global.get $end))
                  (then
                    (global.set $ptr (global.get $end))
                    (call $emitTok (enum.get $Token.string) (local.get $lhs) (global.get $ptr))
                    (call $streamSetFixed32 (i32.const "```") (i32.const 3) (enum.get $Token.string))
                    (br $closed)))
                (local.set $p (i32.add (local.get $p) (i32.const 1)))
                (br_if $find (i32.ne (i32.load16_u (local.get $p)) (i32.const "``")))
                (global.set $ptr (i32.add (local.get $p) (i32.const 2)))
                (call $emitTok (enum.get $Token.string) (local.get $lhs) (global.get $ptr))))
            (br $next)))
        ;; a JSON or XML body
        (if
          (i32.or
            (i32.eq (local.get $c) (i32.const "<"))
            (i32.or
              (i32.and (i32.eq (local.get $c) (i32.const "{")) (i32.ne (local.get $p) (i32.const "{")))
              (i32.and
                (i32.eq (local.get $c) (i32.const "["))
                (i32.gt_u (i32.sub (local.get $p) (i32.const "A")) (i32.const 25)))))
          (then
            (local.set $section (i32.const 0))
            (call $hurlBody
              (select (i32.const 3) (i32.const 2) (i32.eq (local.get $c) (i32.const "<")))
              (i32.const 0))
            (br $next)))
        (call $scanToLineEnd)
        (local.set $rhs (global.get $ptr))
        (global.set $ptr (local.get $lhs))
        (if (i32.eq (local.get $c) (i32.const "["))
          (then
            (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
            (call $emitTok (enum.get $Token.punctuation.bracket) (local.get $lhs) (global.get $ptr))
            (local.set $lhs (global.get $ptr))
            (local.set $p
              (call $scanFindSpecial (local.get $lhs) (local.get $rhs) (i32.const "]") (i32.const 0) (i32.const 0)))
            (call $emitTok (enum.get $Token.type) (local.get $lhs) (local.get $p))
            (local.set $c (i32.sub (local.get $p) (local.get $lhs)))
            (local.set $section
              (select
                (i32.const 1)
                (i32.shl
                  (i32.and
                    (i32.eq (local.get $c) (i32.const 8))
                    (i64.eq (i64.load (local.get $lhs)) (i64.const "Captures")))
                  (i32.const 1))
                (i32.and
                  (i32.eq (local.get $c) (i32.const 7))
                  (i64.eq
                    (i64.and (i64.load (local.get $lhs)) (i64.const 0xffffffffffffff))
                    (i64.const "Asserts")))))
            (global.set $ptr (local.get $p))
            (if (i32.lt_u (local.get $p) (local.get $rhs))
              (then
                (global.set $ptr (i32.add (local.get $p) (i32.const 1)))
                (call $emitTok (enum.get $Token.punctuation.bracket) (local.get $p) (global.get $ptr))))
            (call $hurlTokens (local.get $rhs) (i32.const 0))
            (br $next)))
        ;; a request line `GET url` or a response line `HTTP/1.1 200`
        (local.set $p (local.get $lhs))
        (block $upperDone
          (loop $upper
            (br_if $upperDone (i32.ge_u (local.get $p) (local.get $rhs)))
            (br_if $upperDone (i32.gt_u (i32.sub (i32.load8_u (local.get $p)) (i32.const "A")) (i32.const 25)))
            (local.set $p (i32.add (local.get $p) (i32.const 1)))
            (br $upper)))
        (local.set $c (call $templateByte (local.get $p)))
        (local.set $response
          (i32.and
            (i32.eq (i32.sub (local.get $p) (local.get $lhs)) (i32.const 4))
            (i32.eq (i32.load (local.get $lhs)) (i32.const "HTTP"))))
        (if
          (i32.and
            (i32.gt_u (local.get $p) (local.get $lhs))
            (i32.or
              (i32.or (i32.ge_u (local.get $p) (local.get $rhs)) (byteset.get " \t" (local.get $c)))
              (i32.and (local.get $response) (i32.eq (local.get $c) (i32.const "/")))))
          (then
            (local.set $section (i32.const 0))
            (if (i32.eqz (call $httpVersion (local.get $rhs)))
              (then
                (call $emitTok (enum.get $Token.keyword) (local.get $lhs) (local.get $p))
                (global.set $ptr (local.get $p))))
            (call $httpSkipBlanks)
            (if (local.get $response)
              (then (call $hurlTokens (local.get $rhs) (i32.const 0)))
              (else (call $hurlText (enum.get $Token.string) (local.get $rhs))))
            (br $next)))
        (if (i32.eq (local.get $section) (i32.const 1))
          (then
            (call $hurlTokens (local.get $rhs) (i32.const 1))
            (br $next)))
        ;; `name: value` headers and section entries; other lines are values
        (local.set $c (i32.load8_u (local.get $lhs)))
        (local.set $p
          (call $scanFindSpecial (local.get $lhs) (local.get $rhs) (i32.const ":") (i32.const 0) (i32.const 0)))
        (if
          (i32.or
            (i32.or
              (i32.eq (local.get $c) (i32.const 34))
              (i32.eq (local.get $c) (i32.const "`")))
            (i32.or
              (i32.ge_u (local.get $p) (local.get $rhs))
              (call $hurlEncoding (local.get $lhs) (local.get $rhs))))
          (then
            (call $hurlTokens (local.get $rhs) (i32.const 0))
            (br $next)))
        (call $emitTok (enum.get $Token.property) (local.get $lhs) (local.get $p))
        (global.set $ptr (i32.add (local.get $p) (i32.const 1)))
        (call $emitTok (enum.get $Token.punctuation.delimiter) (local.get $p) (global.get $ptr))
        (call $httpSkipBlanks)
        (local.set $c (call $templateByte (global.get $ptr)))
        (if
          (i32.or
            (i32.or (local.get $section) (call $hurlEncoding (global.get $ptr) (local.get $rhs)))
            (i32.or (i32.eq (local.get $c) (i32.const 34)) (i32.eq (local.get $c) (i32.const "`"))))
          (then (call $hurlTokens (local.get $rhs) (i32.ne (local.get $section) (i32.const 0))))
          (else (call $hurlText (enum.get $Token.string) (local.get $rhs))))
        (br $next))))
)
