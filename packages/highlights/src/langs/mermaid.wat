(module
  (import "../common.wat")
  (import "./astro.wat")
  (import "./markdown.wat")

  ;; +256: the rest of a line that starts with the word is text (`title`,
  ;; `loop`). +512: the rest of the line is a `key:value` list (`style`,
  ;; `classDef`, gitGraph commands).
  (keyword-table $mermaidWords $mem.mermaidWords $mem.typstWords
    (group $Token.keyword
      "subgraph" "end" "direction" "participant" "actor" "as" "note" "Note" "over" "of" "left"
      "right" "class" "click" "callback" "call" "href" "state" "namespace" "autonumber" "activate"
      "deactivate" "create" "destroy" "link" "showData" "x-axis" "y-axis" "PK" "FK" "UK")
    (group $Token.keyword+256
      "title" "section" "dateFormat" "axisFormat" "tickInterval" "excludes"
      "includes" "todayMarker" "weekday" "box")
    (group $Token.keyword.control+256
      "loop" "alt" "else" "opt" "option" "par" "and" "critical" "break" "rect")
    (group $Token.keyword+512
      "classDef" "linkStyle" "commit" "merge" "cherry-pick" "branch" "checkout"))

  ;; Scan a quoted string body from $ptr, after the opening quote, with
  ;; `#quot;` and `#9829;` entity codes as escapes. Mermaid strings have no
  ;; backslash escapes and may span lines. Bytes from $seg are not yet
  ;; emitted. Returns 1 when the string is still open at $end.
  (func $mmdString (param $seg i32) (result i32)
    (local $p i32)
    (block $done
      (loop $scan
        (local.set $p (call $lexFindEither (global.get $ptr) (i32.const 34) (i32.const "#")))
        (global.set $ptr (local.get $p))
        (br_if $done (i32.ge_u (local.get $p) (global.get $end)))
        (global.set $ptr (i32.add (local.get $p) (i32.const 1)))
        (if (i32.eq (i32.load8_u (local.get $p)) (i32.const 34))
          (then
            (call $emitTok (enum.get $Token.string) (local.get $seg) (global.get $ptr))
            (return (i32.const 0))))
        (call $scanIdentRun (i32.const "_"))
        (if
          (i32.and
            (i32.gt_u (global.get $ptr) (i32.add (local.get $p) (i32.const 1)))
            (i32.eq (call $templateByte (global.get $ptr)) (i32.const ";")))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (call $emitTok (enum.get $Token.string) (local.get $seg) (local.get $p))
            (call $emitTok (enum.get $Token.string.escape) (local.get $p) (global.get $ptr))
            (local.set $seg (global.get $ptr))
            (br $scan)))
        (global.set $ptr (i32.add (local.get $p) (i32.const 1)))
        (br $scan)))
    (call $emitTok (enum.get $Token.string) (local.get $seg) (global.get $ptr))
    (i32.const 1))

  ;; The end of a link arrow at $p (`-->`, `-.->`, `==>`, `->>+`, `-x`, `--)`,
  ;; and with $wide the class and entity ends `<|--`, `*--`, `}o--||`), or $p
  ;; when the run there is no link: a link has two bytes and a shaft byte.
  (func $mmdArrowEnd (param $p i32) (param $wide i32) (result i32)
    (local $c i32)
    (local $last i32)
    (local $q i32)
    (local $shaft i32)
    (local.set $q (local.get $p))
    (block $done
      (loop $run
        (local.set $c (call $templateByte (local.get $q)))
        (if (byteset.get "-.<=>~" (local.get $c))
          (then
            ;; `<` and `>` (0x3c, 0x3e) are heads; the rest are shafts
            (local.set $shaft
              (i32.or (local.get $shaft) (i32.ne (i32.or (local.get $c) (i32.const 2)) (i32.const ">")))))
          (else (br_if $done (i32.eqz (i32.and (local.get $wide) (byteset.get "*o{|}" (local.get $c)))))))
        (local.set $last (local.get $c))
        (local.set $q (i32.add (local.get $q) (i32.const 1)))
        (br $run)))
    ;; `--x` and `--o` heads, unless a lowercase word follows (`---other`);
    ;; sequence `--)` async heads; `->>+` activations
    (if
      (i32.or
        (i32.and
          (i32.or (i32.eq (local.get $c) (i32.const "x")) (i32.eq (local.get $c) (i32.const "o")))
          (i32.and
            (i32.or (i32.eq (local.get $last) (i32.const "-")) (i32.eq (local.get $last) (i32.const ".")))
            (i32.gt_u
              (i32.sub (call $templateByte (i32.add (local.get $q) (i32.const 1))) (i32.const "a"))
              (i32.const 25))))
        (i32.or
          (i32.and (i32.eq (local.get $c) (i32.const ")")) (i32.eq (local.get $last) (i32.const "-")))
          (i32.and (i32.eq (local.get $c) (i32.const "+")) (i32.eq (local.get $last) (i32.const ">")))))
      (then (local.set $q (i32.add (local.get $q) (i32.const 1)))))
    (select
      (local.get $q)
      (local.get $p)
      (i32.and (local.get $shaft) (i32.ge_u (i32.sub (local.get $q) (local.get $p)) (i32.const 2)))))

  ;; $kind: 0 before the diagram type, 1 a flowchart-like diagram, 2 class and
  ;; entity diagrams (wide arrows, `name(` calls, no node shapes), 3 sequence
  ;; diagrams (no `-` inside names). $mid: a token precedes on this line.
  ;; $style: the line is a `key:value` list. $attr: inside `@{ ... }`.
  ;; $dir: inside a `%%{ ... }%%` directive. $quote: a string is open.
  (func $hlMermaid
    (local $c i32)
    (local $c2 i32)
    (local $first i32)
    (local $gap i32)
    (local $lhs i32)
    (local $tok i32)
    (local $p i32)
    (local $q i32)
    (local $v i32)
    (local $kind i32)
    (local $mid i32)
    (local $style i32)
    (local $attr i32)
    (local $dir i32)
    (local $quote i32)
    (call $lexEmitLeadingContinuation)
    ;; YAML front matter between `---` lines at the document start
    (local.set $p (call $frontMatterOpen))
    (if (local.get $p)
      (then
        (call $emitTok (enum.get $Token.punctuation.special) (global.get $ptr) (local.get $p))
        (local.set $q (call $frontMatterClose (local.get $p)))
        (call $markdownYamlRange (local.get $p) (local.get $q))
        (if (i32.and (global.get $streaming) (i32.eq (local.get $q) (global.get $end)))
          (then
            (call $streamSetRegion (i32.const 4))
            (global.set $streamRegionStarted (i32.const 1)))
          (else
            (if (global.get $streaming)
              (then (call $markdownClearEmbeddedStream)))))
        (call $frontMatterCloser (local.get $q))))
    (if (local.get $quote)
      (then (local.set $quote (call $mmdString (global.get $ptr)))))
    (block $done
      (loop $next
        (block $emit
          (local.set $gap (global.get $ptr))
          (call $scanWhitespace)
          (if (call $lexGapHasBreak (local.get $gap) (global.get $ptr))
            (then
              (local.set $mid (i32.const 0))
              (local.set $style (i32.const 0))))
          (call $emitGap (local.get $gap) (global.get $ptr))
          (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
          (local.set $lhs (global.get $ptr))
          (local.set $c (i32.load8_u (local.get $lhs)))
          (local.set $c2 (call $templateByte (i32.add (local.get $lhs) (i32.const 1))))
          (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
          (local.set $first (i32.eqz (local.get $mid)))
          (local.set $mid (i32.const 1))

          ;; a directive body: JSON-like keys and values up to `}%%`
          (if (local.get $dir)
            (then
              (if
                (i32.and
                  (i32.eq (local.get $c) (i32.const "}"))
                  (i32.and
                    (i32.eq (local.get $c2) (i32.const "%"))
                    (i32.eq (call $templateByte (i32.add (local.get $lhs) (i32.const 2))) (i32.const "%"))))
                (then
                  (global.set $ptr (i32.add (local.get $lhs) (i32.const 3)))
                  (call $emitTok (enum.get $Token.punctuation.special) (local.get $lhs) (global.get $ptr))
                  (local.set $dir (i32.const 0))
                  (br $next)))
              (if (i32.or (i32.eq (local.get $c) (i32.const 34)) (i32.eq (local.get $c) (i32.const 39)))
                (then
                  (global.set $ptr (local.get $lhs))
                  (call $lexString (local.get $c) (i32.const 0) (enum.get $Token.string))
                  (br $next)))
              (if (call $lexIsIdentContinue (local.get $c))
                (then
                  (call $scanIdentRun (i32.const "-"))
                  (local.set $tok
                    (select (enum.get $Token.number) (enum.get $Token.property) (call $lexIsDigit (local.get $c))))
                  (br $emit)))
              (local.set $tok
                (select (enum.get $Token.punctuation.bracket) (enum.get $Token.punctuation.delimiter) (byteset.get "()[]{}" (local.get $c))))
              (br $emit)))

          ;; `%%` comments and `%%{ ... }%%` directives
          (if (i32.and (i32.eq (local.get $c) (i32.const "%")) (i32.eq (local.get $c2) (i32.const "%")))
            (then
              (if (i32.eq (call $templateByte (i32.add (local.get $lhs) (i32.const 2))) (i32.const "{"))
                (then
                  (global.set $ptr (i32.add (local.get $lhs) (i32.const 3)))
                  (call $emitTok (enum.get $Token.punctuation.special) (local.get $lhs) (global.get $ptr))
                  (local.set $dir (i32.const 1))
                  (local.set $mid (i32.eqz (local.get $first)))
                  (br $next)))
              (global.set $ptr (local.get $lhs))
              (call $lexLineComment (i32.const 2) (enum.get $Token.comment))
              (local.set $mid (i32.eqz (local.get $first)))
              (br $next)))

          ;; the first word names the diagram type
          (if (i32.eqz (local.get $kind))
            (then
              (local.set $kind (i32.const 1))
              (if (call $lexIsIdentStart (local.get $c))
                (then
                  (call $scanIdentRun (i32.const "-"))
                  (local.set $p (i32.sub (global.get $ptr) (local.get $lhs)))
                  (if
                    (i32.or
                      (i32.and
                        (i32.eq (local.get $p) (i32.const 9))
                        (i64.eq (i64.load (local.get $lhs)) (i64.const "erDiagra")))
                      (i32.and
                        (i32.ge_u (local.get $p) (i32.const 12))
                        (i64.eq (i64.load (local.get $lhs)) (i64.const "classDia"))))
                    (then (local.set $kind (i32.const 2))))
                  (if
                    (i32.and
                      (i32.eq (local.get $p) (i32.const 15))
                      (i64.eq (i64.load (local.get $lhs)) (i64.const "sequence")))
                    (then (local.set $kind (i32.const 3))))
                  (call $emitTok (enum.get $Token.keyword.declaration) (local.get $lhs) (global.get $ptr))
                  (local.set $mid (i32.const 0))
                  (br $next)))))

          (if (i32.eq (local.get $c) (i32.const 34))
            (then
              (local.set $quote (call $mmdString (local.get $lhs)))
              (br $next)))

          ;; `<<interface>>` and `<<fork>>` annotations
          (if (i32.and (i32.eq (local.get $c) (i32.const "<")) (i32.eq (local.get $c2) (i32.const "<")))
            (then
              (global.set $ptr (i32.add (local.get $lhs) (i32.const 2)))
              (call $scanIdentRun (i32.const "_"))
              (if
                (i32.and
                  (i32.gt_u (global.get $ptr) (i32.add (local.get $lhs) (i32.const 2)))
                  (i32.and
                    (i32.eq (call $templateByte (global.get $ptr)) (i32.const ">"))
                    (i32.eq (call $templateByte (i32.add (global.get $ptr) (i32.const 1))) (i32.const ">"))))
                (then
                  (global.set $ptr (i32.add (global.get $ptr) (i32.const 2)))
                  (local.set $tok (enum.get $Token.attribute))
                  (br $emit)))
              (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))))

          ;; links; a two-byte `--`, `-.`, or `==` opener before a blank takes
          ;; the text up to the closing arrow as its label
          (if
            (i32.or
              (byteset.get "-.<=>~" (local.get $c))
              (i32.and (i32.eq (local.get $kind) (i32.const 2)) (byteset.get "*o{|}" (local.get $c))))
            (then
              (local.set $p (call $mmdArrowEnd (local.get $lhs) (i32.eq (local.get $kind) (i32.const 2))))
              (if (i32.gt_u (local.get $p) (local.get $lhs))
                (then
                  (global.set $ptr (local.get $p))
                  (call $emitTok (enum.get $Token.operator) (local.get $lhs) (global.get $ptr))
                  (if
                    (i32.and
                      (i32.and
                        (i32.eq (local.get $kind) (i32.const 1))
                        (i32.eq (i32.sub (local.get $p) (local.get $lhs)) (i32.const 2)))
                      (i32.and
                        (i32.eq (call $templateByte (local.get $p)) (i32.const 32))
                        (i32.or
                          (i32.eq (local.get $c2) (local.get $c))
                          (i32.eq (local.get $c2) (i32.const ".")))))
                    (then
                      ;; a `.->` closer is found at its `-`
                      (local.set $q (local.get $p))
                      (block $labelDone
                        (loop $label
                          (local.set $q (call $scanFind3 (local.get $q) (i32.const "-") (i32.const "=") (i32.const 10)))
                          (local.set $v (call $templateByte (local.get $q)))
                          (br_if $labelDone (i32.le_u (local.get $v) (i32.const 10)))
                          (if
                            (i32.and
                              (i32.eq (local.get $v) (local.get $c))
                              (i32.gt_u (call $mmdArrowEnd (local.get $q) (i32.const 0)) (local.get $q)))
                            (then
                              (if (i32.eq (i32.load8_u (i32.sub (local.get $q) (i32.const 1))) (i32.const "."))
                                (then (local.set $q (i32.sub (local.get $q) (i32.const 1)))))
                              (call $emitTok (enum.get $Token.string) (local.get $p) (local.get $q))
                              (global.set $ptr (local.get $q))
                              (br $labelDone)))
                          (local.set $q (i32.add (local.get $q) (i32.const 1)))
                          (br $label)))))
                  (br $next)))))

          ;; `-->|label|`: a bar after a link opens its label
          (if (i32.eq (local.get $c) (i32.const "|"))
            (then
              (local.set $v (call $lexLineByteBefore (local.get $lhs)))
              (local.set $p (call $scanFind3 (global.get $ptr) (i32.const "|") (i32.const 10) (i32.const 13)))
              (if
                (i32.and
                  (byteset.get "-.<=>~" (local.get $v))
                  (i32.eq (call $templateByte (local.get $p)) (i32.const "|")))
                (then
                  (call $emitTok (enum.get $Token.punctuation.bracket) (local.get $lhs) (global.get $ptr))
                  (call $emitTok (enum.get $Token.string) (global.get $ptr) (local.get $p))
                  (global.set $ptr (i32.add (local.get $p) (i32.const 1)))
                  (call $emitTok (enum.get $Token.punctuation.bracket) (local.get $p) (global.get $ptr))
                  (br $next)))))

          (if (i32.eq (local.get $c) (i32.const ":"))
            (then
              ;; `:::name` applies a class
              (if
                (i32.and
                  (i32.eq (local.get $c2) (i32.const ":"))
                  (i32.eq (call $templateByte (i32.add (local.get $lhs) (i32.const 2))) (i32.const ":")))
                (then
                  (global.set $ptr (i32.add (local.get $lhs) (i32.const 3)))
                  (call $emitTok (enum.get $Token.operator) (local.get $lhs) (global.get $ptr))
                  (local.set $p (global.get $ptr))
                  (call $scanIdentRun (i32.const "-"))
                  (call $emitTok (enum.get $Token.type) (local.get $p) (global.get $ptr))
                  (br $next)))
              (call $emitTok (enum.get $Token.punctuation.delimiter) (local.get $lhs) (global.get $ptr))
              (br_if $next (i32.or (local.get $style) (local.get $attr)))
              ;; the rest of the line is a message, description, or value
              (local.set $p (call $lexSkipSpaceAt (global.get $ptr)))
              (call $emitGap (global.get $ptr) (local.get $p))
              (global.set $ptr (local.get $p))
              (call $scanToLineEnd)
              (local.set $q (local.get $p))
              (loop $digits
                (if (i32.lt_u (local.get $q) (global.get $ptr))
                  (then
                    (local.set $v (i32.load8_u (local.get $q)))
                    (if
                      (i32.or
                        (i32.or (call $lexIsDigit (local.get $v)) (i32.eq (local.get $v) (i32.const ".")))
                        (byteset.get " \t" (local.get $v)))
                      (then
                        (local.set $q (i32.add (local.get $q) (i32.const 1)))
                        (br $digits))))))
              (call $emitTok
                (select (enum.get $Token.number) (enum.get $Token.string) (i32.eq (local.get $q) (global.get $ptr)))
                (local.get $p)
                (global.get $ptr))
              (br $next)))

          ;; `[*]` starts and ends state diagrams
          (if
            (i32.and
              (i32.eq (local.get $c) (i32.const "["))
              (i32.and
                (i32.eq (local.get $c2) (i32.const "*"))
                (i32.eq (call $templateByte (i32.add (local.get $lhs) (i32.const 2))) (i32.const "]"))))
            (then
              (global.set $ptr (i32.add (local.get $lhs) (i32.const 3)))
              (local.set $tok (enum.get $Token.constant.builtin))
              (br $emit)))
          (if (i32.and (i32.eq (local.get $c) (i32.const "@")) (i32.eq (local.get $c2) (i32.const "{")))
            (then
              (global.set $ptr (i32.add (local.get $lhs) (i32.const 2)))
              (call $emitTok (enum.get $Token.punctuation.special) (local.get $lhs) (global.get $ptr))
              (local.set $attr (i32.const 1))
              (br $next)))
          (if (i32.and (i32.eq (local.get $c) (i32.const "}")) (local.get $attr))
            (then
              (call $emitTok (enum.get $Token.punctuation.special) (local.get $lhs) (global.get $ptr))
              (local.set $attr (i32.const 0))
              (br $next)))
          ;; `#f9f` colors in style lists
          (if (i32.and (i32.eq (local.get $c) (i32.const "#")) (local.get $style))
            (then
              (call $scanIdentRun (i32.const "_"))
              (local.set $tok (enum.get $Token.string.special))
              (br $emit)))

          (block $punct
            (block $shape
              (if (call $lexIsIdentContinue (local.get $c))
                (then
                  (call $scanIdentRun (i32.const "_"))
                  ;; `-` joins words (`DELIVERY-ADDRESS`, `cherry-pick`) except
                  ;; in sequence diagrams, where `A-xB` is a link
                  (loop $words
                    (if
                      (i32.and
                        (i32.ne (local.get $kind) (i32.const 3))
                        (i32.and
                          (i32.eq (call $templateByte (global.get $ptr)) (i32.const "-"))
                          (call $lexIsIdentContinue
                            (call $templateByte (i32.add (global.get $ptr) (i32.const 1))))))
                      (then
                        (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                        (call $scanIdentRun (i32.const "_"))
                        (br $words))))
                  (local.set $p (global.get $ptr))
                  (local.set $c2 (call $templateByte (local.get $p)))
                  (if (call $lexIsDigit (local.get $c))
                    (then
                      (call $emitTok (enum.get $Token.number) (local.get $lhs) (local.get $p))
                      (br $next)))
                  ;; values in style lists and `@{ ... }` are never keywords;
                  ;; `style` shares the table hash of `state`
                  (local.set $v (i32.const -1))
                  (if (i32.eqz (i32.or (local.get $style) (local.get $attr)))
                    (then
                      (local.set $v
                        (if (result i32)
                          (i32.and
                            (i32.eq (i32.sub (local.get $p) (local.get $lhs)) (i32.const 5))
                            (i64.eq (i64.and (i64.load (local.get $lhs)) (i64.const 0xffffffffff)) (i64.const "style")))
                          (then (i32.or (enum.get $Token.keyword) (i32.const 512)))
                          (else (keyword-table.value $mermaidWords (local.get $lhs) (local.get $p)))))))
                  (if (i32.ge_s (local.get $v) (i32.const 0))
                    (then
                      (call $emitTok (i32.and (local.get $v) (i32.const 255)) (local.get $lhs) (local.get $p))
                      (if (i32.and (local.get $first) (i32.eq (i32.shr_u (local.get $v) (i32.const 8)) (i32.const 1)))
                        (then
                          (global.set $ptr (call $lexSkipSpaceAt (local.get $p)))
                          (call $emitGap (local.get $p) (global.get $ptr))
                          (local.set $p (global.get $ptr))
                          (call $scanToLineEnd)
                          (call $emitTok (enum.get $Token.string) (local.get $p) (global.get $ptr))))
                      (local.set $style
                        (i32.or (local.get $style) (i32.eq (i32.shr_u (local.get $v) (i32.const 8)) (i32.const 2))))
                      (br $next)))
                  ;; `TD`, `LR`, and other directions
                  (if
                    (i32.and
                      (i32.eq (i32.sub (local.get $p) (local.get $lhs)) (i32.const 2))
                      (i32.or
                        (i32.or
                          (i32.eq (local.tee $q (i32.load16_u (local.get $lhs))) (i32.const "TD"))
                          (i32.eq (local.get $q) (i32.const "TB")))
                        (i32.or
                          (i32.or (i32.eq (local.get $q) (i32.const "BT")) (i32.eq (local.get $q) (i32.const "RL")))
                          (i32.eq (local.get $q) (i32.const "LR")))))
                    (then
                      (call $emitTok (enum.get $Token.constant) (local.get $lhs) (local.get $p))
                      (br $next)))
                  (if (i32.and (i32.eq (local.get $c2) (i32.const ":")) (i32.or (local.get $style) (local.get $attr)))
                    (then
                      (call $emitTok (enum.get $Token.property) (local.get $lhs) (local.get $p))
                      (br $next)))
                  (if (i32.eq (local.get $kind) (i32.const 2))
                    (then
                      (call $emitTok
                        (select (enum.get $Token.function) (enum.get $Token.variable) (i32.eq (local.get $c2) (i32.const "(")))
                        (local.get $lhs)
                        (local.get $p))
                      (br $next)))
                  (call $emitTok (enum.get $Token.variable) (local.get $lhs) (local.get $p))
                  ;; a node id glued to its shape: `A[text]`, `B((text))`, `C{text}`, `D>text]`
                  (br_if $shape (i32.or (byteset.get "([{" (local.get $c2)) (i32.eq (local.get $c2) (i32.const ">"))))
                  (br $next)))
              ;; a bare `[text]` or `(text)` node, as in mindmaps
              (br_if $punct
                (i32.or
                  (i32.eq (local.get $kind) (i32.const 2))
                  (i32.and (i32.ne (local.get $c) (i32.const "[")) (i32.ne (local.get $c) (i32.const "(")))))
              (local.set $p (local.get $lhs)))
            ;; shape openers `[[`, `[(`, `((`, `{{`, `[/`; the label is one
            ;; quoted string or runs to the closer of the last opener bracket on
            ;; this line
            (local.set $q (local.get $p))
            (loop $open
              (local.set $v (call $templateByte (local.get $q)))
              (local.set $q (i32.add (local.get $q) (i32.const 1)))
              (local.set $c (call $templateByte (local.get $q)))
              (br_if $open (byteset.get "([{" (local.get $c))))
            (if (i32.or (i32.eq (local.get $c) (i32.const "/")) (i32.eq (local.get $c) (i32.const 92)))
              (then (local.set $q (i32.add (local.get $q) (i32.const 1)))))
            (call $emitTok (enum.get $Token.punctuation.bracket) (local.get $p) (local.get $q))
            (global.set $ptr (local.get $q))
            (br_if $next (i32.eq (call $templateByte (local.get $q)) (i32.const 34)))
            (local.set $p
              (call $scanFind3
                (local.get $q)
                (select
                  (i32.const ")")
                  (select (i32.const "}") (i32.const "]") (i32.eq (local.get $v) (i32.const "{")))
                  (i32.eq (local.get $v) (i32.const "(")))
                (i32.const 10)
                (i32.const 13)))
            (if (i32.gt_u (local.get $p) (local.get $q))
              (then
                (local.set $c (i32.load8_u (i32.sub (local.get $p) (i32.const 1))))
                (if (i32.or (i32.eq (local.get $c) (i32.const "/")) (i32.eq (local.get $c) (i32.const 92)))
                  (then (local.set $p (i32.sub (local.get $p) (i32.const 1)))))))
            (call $emitTok (enum.get $Token.string) (local.get $q) (local.get $p))
            (global.set $ptr (local.get $p))
            (local.set $c (call $templateByte (local.get $p)))
            (if (i32.or (i32.eq (local.get $c) (i32.const "/")) (i32.eq (local.get $c) (i32.const 92)))
              (then (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))))
            (block $closed
              (loop $close
                (local.set $c (call $templateByte (global.get $ptr)))
                (br_if $closed (i32.eqz (byteset.get ")]}" (local.get $c))))
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                (br $close)))
            (call $emitTok (enum.get $Token.punctuation.bracket) (local.get $p) (global.get $ptr))
            (br $next))

          ;; punctuation
          (local.set $tok
            (select
              (enum.get $Token.punctuation.delimiter)
              (select
                (enum.get $Token.punctuation.bracket)
                (select (enum.get $Token.operator) (enum.get $Token.none) (byteset.get "!#$%&*+-./:<=>?@\5c^|~" (local.get $c)))
                (byteset.get "()[]{}" (local.get $c)))
              (i32.or (i32.eq (local.get $c) (i32.const ",")) (i32.eq (local.get $c) (i32.const ";")))))
          (br $emit))
        (call $emitTok (local.get $tok) (local.get $lhs) (global.get $ptr))
        (br $next))))
)
