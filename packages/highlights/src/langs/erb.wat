(module
  (import "../common.wat")
  (import "./html.wat")
  (import "./ruby.wat")

  ;; Html is lexed in ranges between ERB tags, like Svelte's `{...}`: a start tag
  ;; an ERB tag interrupts keeps its state in $htmlOpenTag. Stream region 26 is a
  ;; start tag cut by a chunk end, 27 an open ERB tag with its start tag in
  ;; $streamC; bit 30 of $streamC marks a `<%#` comment.

  ;; Comments, declarations, and script/style bodies are lexed whole, so ERB tags
  ;; inside them stay text.
  (func $erbNextCut (param $p i32) (result i32)
    (local $c i32)
    (block $done
      (loop $scan
        (local.set $p (call $lexFindByte (local.get $p) (i32.const "<")))
        (br_if $done (i32.ge_u (local.get $p) (global.get $end)))
        (local.set $c (call $templateByte (i32.add (local.get $p) (i32.const 1))))
        (br_if $done (call $erbIsOpen (local.get $p)))
        (br_if $done (i32.or (i32.eq (local.get $c) (i32.const "!")) (i32.eq (local.get $c) (i32.const "?"))))
        (br_if $done (call $erbRawKind (local.get $p)))
        (local.set $p (i32.add (local.get $p) (i32.const 1)))
        (br $scan)))
    (local.get $p))

  (func $erbRawKind (param $p i32) (result i32)
    (call $rawTextKind
      (i32.add (local.get $p) (i32.const 1))
      (call $htmlNameEnd (i32.add (local.get $p) (i32.const 1)))))

  (func $erbIsOpen (param $p i32) (result i32)
    (i32.and
      (i32.eq (call $templateByte (i32.add (local.get $p) (i32.const 1))) (i32.const "%"))
      (i32.ne (call $templateByte (i32.add (local.get $p) (i32.const 2))) (i32.const "%"))))

  (func $erbFindClose (param $p i32) (result i32)
    (block $done
      (loop $scan
        (local.set $p (call $lexFindByte (local.get $p) (i32.const "%")))
        (br_if $done (i32.ge_u (local.get $p) (global.get $end)))
        (br_if $done (i32.eq (call $templateByte (i32.add (local.get $p) (i32.const 1))) (i32.const ">")))
        (local.set $p (i32.add (local.get $p) (i32.const 1)))
        (br $scan)))
    (local.get $p))

  ;; Returns 1 after the closer, 0 at $end. An open body saves region 27; its Ruby
  ;; runs as a stream root so its locals carry on.
  (func $erbBody (param $state i32) (result i32)
    (local $close i32)
    (local $code i32)
    (local $save i32)
    (local $saveDepth i32)
    (local $saveReset i32)
    (local $open i32)
    (local.set $close (call $erbFindClose (global.get $ptr)))
    (local.set $open (i32.ge_u (local.get $close) (global.get $end)))
    (if (i32.and (local.get $state) (i32.const 0x40000000))
      (then
        (local.set $code (global.get $ptr))
        (global.set $ptr
          (select (global.get $end) (i32.add (local.get $close) (i32.const 2)) (local.get $open)))
        (call $emitTok (enum.get $Token.comment) (local.get $code) (global.get $ptr)))
      (else
        (local.set $code (local.get $close))
        (if
          (i32.and
            (i32.and (i32.eqz (local.get $open)) (i32.gt_u (local.get $close) (global.get $ptr)))
            (i32.eq (i32.load8_u (i32.sub (local.get $close) (i32.const 1))) (i32.const "-")))
          (then (local.set $code (i32.sub (local.get $close) (i32.const 1)))))
        (local.set $save (global.get $end))
        (local.set $saveDepth (global.get $streamDepth))
        (local.set $saveReset (global.get $streamReset))
        (global.set $end (local.get $code))
        (if
          (i32.and
            (global.get $streaming)
            (i32.and (local.get $open) (i32.eq (local.get $code) (global.get $eof))))
          (then
            (global.set $streamDepth (i32.const 0))
            (global.set $streamReset
              (i32.or
                (local.get $saveReset)
                (i32.ne (global.get $streamRegionKind) (i32.const 27))))))
        (block $ruby
          ;; a resumed body first finishes the Ruby mode its previous chunk left
          (if (i32.and (global.get $streaming) (i32.eqz (global.get $streamDepth)))
            (then
              (if (i32.eqz (global.get $streamReset))
                (then (br_if $ruby (call $streamResumeCommon))))))
          (call $hlRuby))
        (global.set $end (local.get $save))
        (global.set $streamDepth (local.get $saveDepth))
        (global.set $streamReset (local.get $saveReset))
        (global.set $ptr
          (select (global.get $end) (i32.add (local.get $close) (i32.const 2)) (local.get $open)))
        (call $emitTok (enum.get $Token.punctuation.special) (local.get $code) (global.get $ptr))))
    (if (i32.and (local.get $open) (global.get $streaming))
      (then
        (if (i32.eq (global.get $ptr) (global.get $eof))
          (then
            (call $streamSetRegion (i32.const 27))
            (global.set $streamC (local.get $state))))))
    (i32.eqz (local.get $open)))

  (func $erbTag (param $tag i32) (result i32)
    (local $lhs i32)
    (local $c i32)
    (local.set $lhs (global.get $ptr))
    (global.set $ptr (i32.add (local.get $lhs) (i32.const 2)))
    (local.set $c (call $templateByte (global.get $ptr)))
    (if (i32.eq (local.get $c) (i32.const "#"))
      (then
        (global.set $ptr (local.get $lhs))
        (return (call $erbBody (i32.or (local.get $tag) (i32.const 0x40000000))))))
    (if (i32.or (i32.eq (local.get $c) (i32.const "=")) (i32.eq (local.get $c) (i32.const "-")))
      (then
        (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
        (if
          (i32.and
            (i32.eq (local.get $c) (i32.const "="))
            (i32.eq (call $templateByte (global.get $ptr)) (i32.const "=")))
          (then (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))))))
    (call $emitTok (enum.get $Token.punctuation.special) (local.get $lhs) (global.get $ptr))
    (call $erbBody (local.get $tag)))

  (func $erbTagRest (param $tag i32)
    (local $r i32)
    (local $save i32)
    (block $done
      (loop $next
        (local.set $save (global.get $end))
        (global.set $end (call $erbNextCut (global.get $ptr)))
        (global.set $htmlOpenTag (i32.const 0))
        (local.set $r
          (call $htmlAttrs
            (i32.const 0)
            (i32.and (i32.shr_u (local.get $tag) (i32.const 8)) (i32.const 255))
            (i32.shr_u (local.get $tag) (i32.const 16))
            (i32.const 26)))
        (global.set $end (local.get $save))
        (call $htmlTagEnd (local.get $r))
        (local.set $tag (global.get $htmlOpenTag))
        (global.set $htmlOpenTag (i32.const 0))
        (br_if $done (i32.eqz (local.get $tag)))
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        (br_if $done (i32.eqz (call $erbIsOpen (global.get $ptr))))
        (br_if $next (call $erbTag (local.get $tag))))))

  (func $hlErb
    (local $from i32)
    (local $p i32)
    (local $save i32)
    (local $tag i32)
    (call $lexEmitLeadingContinuation)
    (local.set $from (global.get $ptr))
    (block $done
      (loop $scan
        (local.set $p (call $erbNextCut (local.get $from)))
        (global.set $htmlOpenTag (i32.const 0))
        (if (i32.lt_u (local.get $from) (local.get $p))
          (then
            (local.set $save (global.get $end))
            (global.set $end (local.get $p))
            (global.set $ptr (local.get $from))
            (call $htmlLex (i32.const 26))
            (global.set $end (local.get $save))))
        (global.set $ptr (local.get $p))
        (local.set $tag (global.get $htmlOpenTag))
        (global.set $htmlOpenTag (i32.const 0))
        (br_if $done (i32.ge_u (local.get $p) (global.get $end)))
        (if (call $erbIsOpen (local.get $p))
          (then
            (if (call $erbTag (local.get $tag))
              (then
                (if (local.get $tag)
                  (then (call $erbTagRest (local.get $tag)))))))
          (else
            (if (call $erbRawKind (local.get $p))
              (then (call $htmlTag (i32.const 26)))
              (else
                (if
                  (i32.and
                    (i32.le_u (i32.add (local.get $p) (i32.const 4)) (global.get $end))
                    (i32.eq (i32.load (local.get $p)) (i32.const "<!--")))
                  (then (call $htmlComment (local.get $p)))
                  (else
                    (call $htmlDecl
                      (local.get $p)
                      (i32.eq (i32.load8_u offset=1 (local.get $p)) (i32.const "?"))
                      (select
                        (enum.get $Token.comment)
                        (enum.get $Token.tag.doctype)
                        (i32.eq (i32.load8_u offset=1 (local.get $p)) (i32.const "?"))))))))))
        (local.set $from (global.get $ptr))
        (br $scan)))
    (global.set $ptr (global.get $end)))

  ;; Region 26 stops a resumed start tag where the html range would have been cut,
  ;; unless it is a script or style tag ($streamA set).
  (func $erbStreamResume (result i32)
    (local $r i32)
    (local $save i32)
    (local $tag i32)
    (if (i32.eq (global.get $streamRegionKind) (i32.const 27))
      (then
        (local.set $tag (global.get $streamC))
        (if (i32.eqz (call $erbBody (local.get $tag)))
          (then (return (i32.const 1))))
        (global.set $streamRegionKind (i32.const 0))
        (global.set $streamMode (i32.const 0))
        (global.set $streamC (i32.const 0))
        ;; WARNING: the finished body's Ruby locals would keep live line states apart
        (call $streamClearCheckpoints)
        (local.set $tag (i32.and (local.get $tag) (i32.const 0x3fffffff)))
        (if (local.get $tag)
          (then
            (global.set $streamDepth (i32.const 1))
            (call $erbTagRest (local.get $tag))
            (global.set $streamDepth (i32.const 0))))
        (return (i32.ge_u (global.get $ptr) (global.get $end)))))
    (local.set $save (global.get $end))
    (if (i32.eqz (global.get $streamA))
      (then (global.set $end (call $erbNextCut (global.get $ptr)))))
    (global.set $htmlOpenTag (i32.const 0))
    (local.set $r (call $htmlTagResume (i32.const 26)))
    (global.set $end (local.get $save))
    (local.set $tag (global.get $htmlOpenTag))
    (global.set $htmlOpenTag (i32.const 0))
    (if
      (i32.and
        (i32.ne (local.get $tag) (i32.const 0))
        (i32.and
          (i32.lt_u (global.get $ptr) (global.get $end))
          (call $erbIsOpen (global.get $ptr))))
      (then
        (global.set $streamDepth (i32.const 1))
        (if (call $erbTag (local.get $tag))
          (then (call $erbTagRest (local.get $tag))))
        (global.set $streamDepth (i32.const 0))
        (local.set $r (i32.ge_u (global.get $ptr) (global.get $end)))))
    (local.get $r))
)
