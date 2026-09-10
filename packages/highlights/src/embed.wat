(module
  ;; Stream resumption of embedded regions: raw-text script/style bodies,
  ;; front matter, and framework expressions that a chunk boundary cut open
  ;; ($streamRegionKind 1-8). The top-level driver in highlights.wat resumes
  ;; them for html-like documents, and markdown.wat resumes them inside a
  ;; fenced body that is streamed line by line - hence the import cycle with
  ;; markdown.wat, which the build's one-inline-per-module import expansion
  ;; tolerates.
  (import "./common.wat")
  (import "./langs/tsx.wat")
  (import "./langs/html.wat")
  (import "./langs/css.wat")
  (import "./langs/yaml.wat")
  (import "./langs/markdown.wat")

  (func $streamEmbedRange (param $kind i32) (param $from i32) (param $to i32)
    (local $reset i32)
    (local $saveDepth i32)
    (local $saveEnd i32)
    (local $saveReset i32)
    (local.set $reset (i32.eqz (global.get $streamRegionStarted)))
    (local.set $saveDepth (global.get $streamDepth))
    (local.set $saveEnd (global.get $end))
    (local.set $saveReset (global.get $streamReset))
    (global.set $streamDepth (i32.const 0))
    (global.set $streamReset (local.get $reset))
    (global.set $end (local.get $to))
    (global.set $ptr (local.get $from))
    (block $bodyDone
      ;; CSS and YAML use the common comment/string modes. Resume them only
      ;; after the region end is installed; ECMAScript owns its own machine.
      (if
        (i32.and
          (i32.eqz (local.get $reset))
          (i32.or
            (i32.eq (local.get $kind) (i32.const 2))
            (i32.eq (local.get $kind) (i32.const 4))))
        (then (br_if $bodyDone (call $streamResumeCommon))))
      (if (i32.eq (local.get $kind) (i32.const 1))
        (then (call $hlJsStream (local.get $reset)))
        (else
          (if (i32.eq (local.get $kind) (i32.const 2))
            (then (call $hlCss))
            (else
              (if (i32.eq (local.get $kind) (i32.const 4))
                (then
                  ;; a block scalar left open by the previous chunk is a
                  ;; yaml-owned mode that the top-level resume only checks
                  ;; for yaml documents; resume it inside the range first
                  (if
                    (i32.and
                      (i32.eqz (local.get $reset))
                      (i32.eq (global.get $streamMode) (i32.const 11)))
                    (then (drop (call $yamlStreamResume))))
                  (call $hlYaml))
                (else (call $hlTsxStream (local.get $reset)))))))))
    (global.set $end (local.get $saveEnd))
    (global.set $ptr (local.get $to))
    (global.set $streamReset (local.get $saveReset))
    (global.set $streamDepth (local.get $saveDepth))
    (global.set $streamRegionStarted (i32.const 1)))

  (func $streamResumeRegion (result i32)
    (local $after i32)
    (local $close i32)
    (local $closeLen i32)
    (local $kind i32)
    (local $lineEnd i32)
    (local $p i32)
    (local $found i32)
    (local.set $kind (global.get $streamRegionKind))
    (local.set $close (global.get $end))
    (local.set $p (global.get $ptr))
    ;; Framework expression bodies: Vue uses `}}`; Astro, MDX, and Svelte use
    ;; `}`. The TSX lexer stops before the outer delimiter.
    (if (i32.ge_u (local.get $kind) (i32.const 6))
      (then
        (local.set $closeLen
          (select (i32.const 2) (i32.const 1) (i32.eq (local.get $kind) (i32.const 6))))
        (if (i32.eqz (call $hlTsxExpressionStream (i32.const 0) (local.get $closeLen)))
          (then (return (i32.const 1))))
        (local.set $close (global.get $ptr))
        (local.set $after (i32.add (local.get $close) (local.get $closeLen)))
        (call $emitTok
          (select
            (enum.get $Token.punctuation.special)
            (enum.get $Token.punctuation.bracket)
            (i32.le_u (local.get $kind) (i32.const 7)))
          (local.get $close)
          (local.get $after))
        (global.set $ptr (local.get $after))
        (global.set $streamRegionKind (i32.const 0))
        (global.set $streamMode (i32.const 0))
        (return (i32.const 0))))
    (if (i32.le_u (local.get $kind) (i32.const 2))
      (then
        (block $rawDone
          (loop $raw
            (local.set $p (call $lexFindByte (local.get $p) (i32.const "<")))
            (br_if $rawDone (i32.ge_u (local.get $p) (global.get $end)))
            (if (call $isRawTextClose (local.get $p) (local.get $kind))
              (then
                (local.set $close (local.get $p))
                (local.set $found (i32.const 1))
                (br $rawDone)))
            (local.set $p (i32.add (local.get $p) (i32.const 1)))
            (br $raw))))
      (else
        (if (i32.eq (local.get $kind) (i32.const 5))
          (then
            (local.set $p (call $lexFindByte (local.get $p) (i32.const ">")))
            (if (i32.lt_u (local.get $p) (global.get $end))
              (then
                (local.set $close (i32.add (local.get $p) (i32.const 1)))
                (local.set $found (i32.const 1)))))
          (else
            (block $frontDone
              (loop $front
                (br_if $frontDone (i32.ge_u (local.get $p) (global.get $end)))
                (local.set $lineEnd (call $markdownLineEnd (local.get $p)))
                (if
                  (i32.and
                    (i32.eq (i32.sub (local.get $lineEnd) (local.get $p)) (i32.const 3))
                    (i32.eq
                      (i32.and (i32.load (local.get $p)) (i32.const 0xffffff))
                      (i32.const "---")))
                  (then
                    (local.set $close (local.get $p))
                    (local.set $found (i32.const 1))
                    (br $frontDone)))
                (local.set $p (call $markdownAfterLine (local.get $lineEnd)))
                (br $front)))))))
    (call $streamEmbedRange (local.get $kind) (global.get $ptr) (local.get $close))
    (if (i32.eqz (local.get $found))
      (then (return (i32.const 1))))
    (global.set $ptr (local.get $close))
    (global.set $streamRegionKind (i32.const 0))
    (global.set $streamMode (i32.const 0))
    (if
      (i32.and (i32.gt_u (local.get $kind) (i32.const 2)) (i32.ne (local.get $kind) (i32.const 5)))
      (then
        (local.set $after (call $markdownAfterLine (call $markdownLineEnd (global.get $ptr))))
        (call $emitTok (enum.get $Token.punctuation.special) (global.get $ptr) (local.get $after))
        (global.set $ptr (local.get $after))))
    (i32.const 0))
)
