(module
  (import "./markdown.wat")
  (import "./tsx.wat")

  (func $mdxMarkdownRange (param $from i32) (param $to i32)
    (local $save i32)
    (if (i32.ge_u (local.get $from) (local.get $to)) (then (return)))
    (local.set $save (global.get $end))
    (global.set $end (local.get $to))
    (global.set $ptr (local.get $from))
    (call $hlMarkdown)
    (global.set $end (local.get $save))
    (global.set $ptr (local.get $to)))

  (func $mdxTsxRange (param $from i32) (param $to i32)
    (local $c i32)
    (local $lhs i32)
    (local $save i32)
    (local $p i32)
    (local $dotted i32)
    ;; A close tag is a complete MDX token even when this bounded range starts
    ;; at `</`; open tags and expressions delegate to the TSX lexer below.
    (if (i32.and
          (i32.le_u (i32.add (local.get $from) (i32.const 2)) (local.get $to))
          (i32.and
            (i32.eq (i32.load8_u (local.get $from)) (i32.const "<"))
            (i32.eq (i32.load8_u offset=1 (local.get $from)) (i32.const "/"))))
      (then
        (call $emitTok (enum.get $Token.punctuation.bracket.jsx)
          (local.get $from) (i32.add (local.get $from) (i32.const 2)))
        (local.set $p (i32.add (local.get $from) (i32.const 2)))
        (global.set $ptr (local.get $p))
        (block $nameDone
          (loop $name
            (br_if $nameDone (i32.ge_u (global.get $ptr) (local.get $to)))
            (local.set $c (i32.load8_u (global.get $ptr)))
            (br_if $nameDone (i32.eqz (i32.or
              (call $lexIsIdentContinue (local.get $c))
              (i32.or
                (i32.eq (local.get $c) (i32.const "."))
                (i32.or
                  (i32.eq (local.get $c) (i32.const ":"))
                  (i32.eq (local.get $c) (i32.const "-")))))))
            (if (i32.eq (local.get $c) (i32.const "."))
              (then (local.set $dotted (i32.const 1))))
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (br $name)))
        (call $emitTok
          (select (enum.get $Token.tag.component.jsx) (enum.get $Token.tag.jsx)
            (i32.or (local.get $dotted)
              (i32.and
                (i32.lt_u (local.get $p) (global.get $ptr))
                (i32.le_u
                  (i32.sub (i32.load8_u (local.get $p)) (i32.const "A"))
                  (i32.const 25)))))
          (local.get $p) (global.get $ptr))
        (block $tagDone
          (loop $tag
            (br_if $tagDone (i32.ge_u (global.get $ptr) (local.get $to)))
            (local.set $lhs (global.get $ptr))
            (local.set $c (i32.load8_u (global.get $ptr)))
            (if (call $lexIsSpace (local.get $c))
              (then
                (block $spaceDone
                  (loop $space
                    (br_if $spaceDone (i32.ge_u (global.get $ptr) (local.get $to)))
                    (br_if $spaceDone (i32.eqz
                      (call $lexIsSpace (i32.load8_u (global.get $ptr)))))
                    (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                    (br $space)))
                (call $emitGap (local.get $lhs) (global.get $ptr))
                (br $tag)))
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (call $emitTok
              (select (enum.get $Token.punctuation.bracket.jsx) (enum.get $Token.none)
                (i32.eq (local.get $c) (i32.const ">")))
              (local.get $lhs) (global.get $ptr))
            (br $tag)))
        (global.set $ptr (local.get $to))
        (return)))
    (local.set $save (global.get $end))
    (global.set $end (local.get $to))
    (global.set $ptr (local.get $from))
    (call $hlTsx)
    (global.set $end (local.get $save))
    (global.set $ptr (local.get $to)))

  ;; One JSX open/close tag, including quoted and braced attribute values.
  (func $mdxJsxEnd (param $lhs i32) (result i32)
    (local $c i32)
    (local $p i32)
    (local $to i32)
    (local $close i32)
    (local $value i32) ;; 0 tag/name, 1 after `=`, 2 unquoted value
    (local.set $p (i32.add (local.get $lhs) (i32.const 1)))
    (if (i32.ge_u (local.get $p) (global.get $end))
      (then (return (i32.add (local.get $lhs) (i32.const 1)))))
    (local.set $c (i32.load8_u (local.get $p)))
    (if (i32.eq (local.get $c) (i32.const "/"))
      (then
        (local.set $close (i32.const 1))
        (local.set $p (i32.add (local.get $p) (i32.const 1)))
        (if (i32.ge_u (local.get $p) (global.get $end))
          (then (return (i32.add (local.get $lhs) (i32.const 1)))))
        (local.set $c (i32.load8_u (local.get $p)))))
    (if (i32.eqz (i32.or
          (call $lexIsIdentStart (local.get $c))
          (i32.eq (local.get $c) (i32.const ">"))))
      (then (return (i32.add (local.get $lhs) (i32.const 1)))))
    ;; a close tag has no attribute values: it ends at the first `>`; a `<`
    ;; before that starts another tag, so this one never closed
    (if (local.get $close)
      (then
        (local.set $p (call $lexFindEither (local.get $p) (i32.const ">") (i32.const "<")))
        (if (i32.and
              (i32.lt_u (local.get $p) (global.get $end))
              (i32.eq (i32.load8_u (local.get $p)) (i32.const ">")))
          (then (return (i32.add (local.get $p) (i32.const 1)))))
        (return (i32.add (local.get $lhs) (i32.const 1)))))
    (block $done
      (loop $l
        (br_if $done (i32.ge_u (local.get $p) (global.get $end)))
        (local.set $c (i32.load8_u (local.get $p)))
        (if (i32.eq (local.get $c) (i32.const ">"))
          (then (return (i32.add (local.get $p) (i32.const 1)))))
        ;; a stray `<` outside quotes and braces: the tag never closed, and
        ;; a line-fed lexer could not have joined it with the next line either
        (br_if $done (i32.eq (local.get $c) (i32.const "<")))
        (if (i32.and
              (i32.eq (local.get $value) (i32.const 1))
              (i32.eqz (call $lexIsSpace (local.get $c))))
          (then
            (if (i32.or (i32.eq (local.get $c) (i32.const 34))
                        (i32.eq (local.get $c) (i32.const 39)))
              (then
                ;; SIMD-find the closing quote; unterminated stops at $end
                (local.set $p (call $lexFindByte
                  (i32.add (local.get $p) (i32.const 1)) (local.get $c)))
                (if (i32.lt_u (local.get $p) (global.get $end))
                  (then (local.set $p (i32.add (local.get $p) (i32.const 1)))))
                (local.set $value (i32.const 0))
                (br $l)))
            (if (i32.eq (local.get $c) (i32.const "{"))
              (then
                (local.set $to (call $tsxExpressionEnd (local.get $p) (local.get $p)))
                (local.set $p (local.get $to))
                (local.set $value (i32.const 0))
                (br $l)))
            (local.set $value (i32.const 2))))
        (if (i32.and
              (i32.eqz (local.get $value))
              (i32.eq (local.get $c) (i32.const "{")))
          (then
            (local.set $to (call $tsxExpressionEnd (local.get $p) (local.get $p)))
            (local.set $p (local.get $to))
            (br $l)))
        (if (i32.and
              (i32.eq (local.get $value) (i32.const 2))
              (call $lexIsSpace (local.get $c)))
          (then (local.set $value (i32.const 0))))
        (if (i32.and
              (i32.eqz (local.get $value))
              (i32.eq (local.get $c) (i32.const "=")))
          (then (local.set $value (i32.const 1))))
        (local.set $p (i32.add (local.get $p) (i32.const 1)))
        (br $l)))
    (i32.add (local.get $lhs) (i32.const 1)))

  ;; When the line at $p opens a fenced code block, the offset just past its
  ;; closing fence; 0 otherwise. A fenced body belongs to markdown, which knows
  ;; how to delegate it by info string, so `{` and `<` inside one are literal
  ;; text rather than MDX expressions or JSX. The opener may sit behind block
  ;; quote markers and spaces exactly as the markdown lexer accepts them, and
  ;; the closer is found by the markdown lexer's own scan, so the two never
  ;; disagree on where a body ends.
  (func $mdxFenceEnd (param $p i32) (result i32)
    (local $close i32)
    (local $fence i32)
    (local $len i32)
    (local $q i32)
    (local $quotes i32)
    ;; line prefix, as the markdown lexer keeps line-start meaning behind it:
    ;; spaces, `>` markers (counted), and list markers followed by a blank
    (block $prefixDone
      (loop $prefix
        (br_if $prefixDone (i32.ge_u (local.get $p) (global.get $end)))
        (local.set $fence (i32.load8_u (local.get $p)))
        (local.set $q (local.get $p))
        (if (i32.eq (local.get $fence) (i32.const ">"))
          (then
            (local.set $quotes (i32.add (local.get $quotes) (i32.const 1)))
            (local.set $q (i32.add (local.get $q) (i32.const 1))))
          (else
            (if (i32.eq (local.get $fence) (i32.const 32))
              (then (local.set $q (i32.add (local.get $q) (i32.const 1))))
              (else
                (if (i32.or
                      (i32.eq (local.get $fence) (i32.const "-"))
                      (i32.or (i32.eq (local.get $fence) (i32.const "+"))
                              (i32.eq (local.get $fence) (i32.const "*"))))
                  (then (local.set $q (i32.add (local.get $q) (i32.const 1))))
                  (else
                    (block $digitsDone
                      (loop $digits
                        (br_if $digitsDone (i32.ge_u (local.get $q) (global.get $end)))
                        (br_if $digitsDone (i32.eqz (call $lexIsDigit (i32.load8_u (local.get $q)))))
                        (local.set $q (i32.add (local.get $q) (i32.const 1)))
                        (br $digits)))
                    (if (i32.and
                          (i32.gt_u (local.get $q) (local.get $p))
                          (i32.and
                            (i32.lt_u (local.get $q) (global.get $end))
                            (i32.or
                              (i32.eq (i32.load8_u (local.get $q)) (i32.const "."))
                              (i32.eq (i32.load8_u (local.get $q)) (i32.const ")")))))
                      (then (local.set $q (i32.add (local.get $q) (i32.const 1))))
                      (else (local.set $q (local.get $p))))))
                ;; a list marker counts only with a blank after it
                (br_if $prefixDone (i32.eq (local.get $q) (local.get $p)))
                (br_if $prefixDone (i32.or
                  (i32.ge_u (local.get $q) (global.get $end))
                  (i32.eqz (call $lexIsSpace (i32.load8_u (local.get $q))))))))))
        (local.set $p (local.get $q))
        (br $prefix)))
    (if (i32.ge_u (local.get $p) (global.get $end)) (then (return (i32.const 0))))
    (if (i32.and (i32.ne (local.get $fence) (i32.const "`"))
                 (i32.ne (local.get $fence) (i32.const "~")))
      (then (return (i32.const 0))))
    (local.set $q (local.get $p))
    (block $openDone
      (loop $openRun
        (br_if $openDone (i32.ge_u (local.get $q) (global.get $end)))
        (br_if $openDone (i32.ne (i32.load8_u (local.get $q)) (local.get $fence)))
        (local.set $q (i32.add (local.get $q) (i32.const 1)))
        (br $openRun)))
    (local.set $len (i32.sub (local.get $q) (local.get $p)))
    (if (i32.lt_u (local.get $len) (i32.const 3)) (then (return (i32.const 0))))
    (local.set $close (call $markdownFenceClose
      (call $markdownAfterLine (call $markdownLineEnd (local.get $q)))
      (local.get $fence) (local.get $len) (local.get $quotes)))
    ;; unterminated: the block runs to the end, exactly as markdown treats it
    (if (i32.ge_u (local.get $close) (global.get $end))
      (then (return (global.get $end))))
    (call $markdownAfterLine (call $markdownLineEnd (local.get $close))))

  ;; Does the `<` at $p plausibly open a JSX tag whose `>` arrives in a later
  ;; stream chunk? Everything after the tag name up to $end must read as
  ;; attributes: names, `=`, quoted values, braced expressions, `/`, blanks.
  ;; A bare `<word` mid-line with nothing else, as in prose `a <b c`, is not
  ;; enough on its own: the tag must also be a component, sit at a line
  ;; start, or carry an attribute assignment. Without this the region would
  ;; swallow every following line as attributes.
  (func $mdxTagStartContinues (param $p i32) (result i32)
    (local $c i32)
    (local $evidence i32)
    (local $q i32)
    (local.set $c (i32.load8_u offset=1 (local.get $p)))
    (local.set $evidence
      (i32.le_u (i32.sub (local.get $c) (i32.const "A")) (i32.const 25)))
    ;; flow position: only blanks between the line start and the `<`
    (local.set $q (local.get $p))
    (block $lineChecked
      (loop $back
        (if (i32.le_u (local.get $q) (global.get $srcBase))
          (then
            (local.set $evidence (i32.const 1))
            (br $lineChecked)))
        (local.set $c (i32.load8_u (i32.sub (local.get $q) (i32.const 1))))
        (if (i32.or (i32.eq (local.get $c) (i32.const 10))
                    (i32.eq (local.get $c) (i32.const 13)))
          (then
            (local.set $evidence (i32.const 1))
            (br $lineChecked)))
        (br_if $lineChecked (i32.and
          (i32.ne (local.get $c) (i32.const 32))
          (i32.ne (local.get $c) (i32.const 9))))
        (local.set $q (i32.sub (local.get $q) (i32.const 1)))
        (br $back)))
    (local.set $q (i32.add (local.get $p) (i32.const 1)))
    (block $done
      (loop $attrs
        (br_if $done (i32.ge_u (local.get $q) (global.get $end)))
        (local.set $c (i32.load8_u (local.get $q)))
        (if (i32.eq (local.get $c) (i32.const "="))
          (then (local.set $evidence (i32.const 1))))
        (if (i32.or (i32.eq (local.get $c) (i32.const 34))
                    (i32.eq (local.get $c) (i32.const 39)))
          (then
            (local.set $q (call $lexFindByte
              (i32.add (local.get $q) (i32.const 1)) (local.get $c)))
            (br_if $done (i32.ge_u (local.get $q) (global.get $end)))
            (local.set $q (i32.add (local.get $q) (i32.const 1)))
            (br $attrs)))
        (if (i32.eq (local.get $c) (i32.const "{"))
          (then
            (local.set $q (call $tsxExpressionEnd (local.get $q) (local.get $q)))
            (br $attrs)))
        (if (i32.eqz (i32.or
              (i32.or
                (call $lexIsSpace (local.get $c))
                (call $lexIsIdentContinue (local.get $c)))
              (i32.or
                (i32.or (i32.eq (local.get $c) (i32.const "="))
                        (i32.eq (local.get $c) (i32.const "/")))
                (i32.or
                  (i32.or (i32.eq (local.get $c) (i32.const "-"))
                          (i32.eq (local.get $c) (i32.const ":")))
                  (i32.eq (local.get $c) (i32.const "."))))))
          (then (return (i32.const 0))))
        (local.set $q (i32.add (local.get $q) (i32.const 1)))
        (br $attrs)))
    (local.get $evidence))

  (func $hlMdx
    (local $fenceAt i32)
    (local $from i32)
    (local $inFence i32)
    (local $lineEnd i32)
    ;; set once a `>` search from some `<` reached $end: no later `<` in
    ;; this chunk can close a tag, so their scans are skipped
    (local $noClose i32)
    (local $p i32)
    (local $to i32)
    (call $lexEmitLeadingContinuation)
    ;; the memo describes the previous chunk's bytes once restored; the scan
    ;; below restarts from $ptr, so start every call without it
    (local.set $noClose (i32.const 0))
    ;; Keep inherited Markdown YAML front matter opaque to MDX braces/angles.
    ;; Streaming also demands the first chunk, as the markdown lexer does.
    (if (i32.and
          (i32.and
            (i32.eq (global.get $ptr) (global.get $srcBase))
            (i32.or (i32.eqz (global.get $streaming)) (global.get $streamReset)))
          (i32.and
            (i32.le_u (i32.add (global.get $ptr) (i32.const 3)) (global.get $end))
            (i32.eq (i32.and (i32.load (global.get $ptr)) (i32.const 0xffffff))
                    (i32.const "---"))))
      (then
        (local.set $lineEnd (call $markdownLineEnd (global.get $ptr)))
        (if (i32.eq (local.get $lineEnd) (i32.add (global.get $ptr) (i32.const 3)))
          (then
            (local.set $p (call $markdownAfterLine (local.get $lineEnd)))
            (local.set $to (global.get $end))
            (block $frontDone
              (loop $front
                (br_if $frontDone (i32.ge_u (local.get $p) (global.get $end)))
                (local.set $lineEnd (call $markdownLineEnd (local.get $p)))
                (if (i32.and
                      (i32.eq (i32.sub (local.get $lineEnd) (local.get $p)) (i32.const 3))
                      (i32.eq (i32.and (i32.load (local.get $p)) (i32.const 0xffffff))
                              (i32.const "---")))
                  (then
                    (local.set $to (call $markdownAfterLine (local.get $lineEnd)))
                    (br $frontDone)))
                (local.set $p (call $markdownAfterLine (local.get $lineEnd)))
                (br $front)))
            (call $mdxMarkdownRange (global.get $ptr) (local.get $to))))))
    (local.set $from (global.get $ptr))
    (local.set $p (global.get $ptr))
    (local.set $fenceAt (global.get $ptr))
    (block $done
      (loop $scan
        (local.set $p (call $lexFindEither
          (local.get $p) (i32.const "{") (i32.const "<")))
        (br_if $done (i32.ge_u (local.get $p) (global.get $end)))
        ;; Walk whole lines up to the hit, skipping fenced blocks. `$fenceAt`
        ;; only moves forward, so each line is examined once across the scan.
        (local.set $inFence (i32.const 0))
        (block $fenceChecked
          (loop $fenceLines
            (br_if $fenceChecked (i32.gt_u (local.get $fenceAt) (local.get $p)))
            (br_if $fenceChecked (i32.ge_u (local.get $fenceAt) (global.get $end)))
            (local.set $to (call $mdxFenceEnd (local.get $fenceAt)))
            (if (local.get $to)
              (then
                (local.set $fenceAt (local.get $to))
                (if (i32.gt_u (local.get $to) (local.get $p))
                  (then
                    (local.set $inFence (i32.const 1))
                    (br $fenceChecked))))
              (else
                (local.set $fenceAt (call $markdownAfterLine
                  (call $markdownLineEnd (local.get $fenceAt))))))
            (br $fenceLines)))
        (if (local.get $inFence)
          (then
            (local.set $p (local.get $fenceAt))
            (br $scan)))
        (if (i32.eq (i32.load8_u (local.get $p)) (i32.const "{"))
          (then
            (local.set $to (call $tsxExpressionEnd (local.get $p) (local.get $p)))
            (call $mdxMarkdownRange (local.get $from) (local.get $p))
            (if (i32.and
                  (global.get $streaming)
                  (i32.and
                    (i32.eq (local.get $to) (global.get $end))
                    (i32.or
                      (i32.eq (local.get $to) (local.get $p))
                      (i32.ne
                        (i32.load8_u (i32.sub (local.get $to) (i32.const 1)))
                        (i32.const "}")))))
              (then
                (call $emitTok
                  (enum.get $Token.punctuation.bracket)
                  (local.get $p) (i32.add (local.get $p) (i32.const 1)))
                (global.set $ptr (global.get $end))
                (call $streamSetRegion (i32.const 8))
                (global.set $ptr (i32.add (local.get $p) (i32.const 1)))
                (drop (call $hlTsxExpressionStream
                  (i32.const 1) (i32.const 1)))
                (global.set $ptr (global.get $end))
                (global.set $streamRegionStarted (i32.const 1)))
              (else (call $mdxTsxRange (local.get $p) (local.get $to))))
            (local.set $from (local.get $to))
            (local.set $p (local.get $to))
            (br $scan)))
        (if (i32.eq (i32.load8_u (local.get $p)) (i32.const "<"))
          (then
            (if (i32.and
                  (i32.le_u (i32.add (local.get $p) (i32.const 4)) (global.get $end))
                  (i32.eq (i32.load (local.get $p)) (i32.const "<!--")))
              (then
                (local.set $to (call $markdownHtmlEnd
                  (local.get $p) (call $markdownLineEnd (local.get $p))))
                (call $mdxMarkdownRange (local.get $from) (local.get $to))
                (local.set $from (local.get $to))
                (local.set $p (local.get $to))
                (br $scan)))
            (local.set $to (i32.add (local.get $p) (i32.const 1)))
            (if (i32.eqz (local.get $noClose))
              (then
                (local.set $to (call $mdxJsxEnd (local.get $p)))
                (if (i32.le_u (local.get $to) (i32.add (local.get $p) (i32.const 1)))
                  (then
                    ;; no tag closed here; when no `>` follows at all, every
                    ;; later `<` in the chunk would rescan to $end for nothing
                    (if (i32.ge_u
                          (call $lexFindByte (i32.add (local.get $p) (i32.const 1)) (i32.const ">"))
                          (global.get $end))
                      (then (local.set $noClose (i32.const 1))))))))
            (if (i32.gt_u (local.get $to) (i32.add (local.get $p) (i32.const 1)))
              (then
                (call $mdxMarkdownRange (local.get $from) (local.get $p))
                (call $mdxTsxRange (local.get $p) (local.get $to))
                (local.set $from (local.get $to))
                (local.set $p (local.get $to))
                (br $scan)))
            (if (i32.and
                  (global.get $streaming)
                  (i32.and
                    (i32.lt_u (i32.add (local.get $p) (i32.const 1)) (global.get $end))
                    (i32.and
                      (call $lexIsIdentStart
                        (i32.load8_u offset=1 (local.get $p)))
                      (call $mdxTagStartContinues (local.get $p)))))
              (then
                (call $mdxMarkdownRange (local.get $from) (local.get $p))
                (global.set $ptr (global.get $end))
                (call $streamSetRegion (i32.const 5))
                (local.set $to (global.get $end))
                (global.set $ptr (local.get $p))
                (call $hlTsxStream (i32.const 1))
                (global.set $ptr (local.get $to))
                (global.set $streamRegionStarted (i32.const 1))
                (local.set $from (local.get $to))
                (local.set $p (local.get $to))
                (br $scan)))))
        (local.set $p (i32.add (local.get $p) (i32.const 1)))
        (br $scan)))
    (call $mdxMarkdownRange (local.get $from) (global.get $end))
    (global.set $ptr (global.get $end)))
)
