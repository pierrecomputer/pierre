(module
  (import "../common.wat")
  (import "./php.wat")
  (import "./template.wat")

  ;; An `@end...` name takes the class of the name it closes, so those stay out.
  (keyword-table $bladeWords $mem.bladeWords $mem.razorWords
    (group $Token.keyword.control
      "if" "elseif" "else" "unless" "isset" "empty" "switch" "case" "break" "default" "for"
      "foreach" "forelse" "while" "continue" "auth" "guest" "can" "cannot" "env" "production"
      "error" "once")
    (group $Token.keyword.import "extends" "include" "includeif" "includewhen" "each")
    (group $Token.keyword
      "section" "yield" "show" "stop" "append" "parent" "hassection" "push" "pushonce" "prepend"
      "stack" "component" "slot" "props" "aware" "csrf" "method" "inject" "lang" "json" "js"
      "dd" "dump" "class" "style" "checked" "selected" "disabled" "readonly" "required" "vite"
      "livewire" "livewirestyles" "livewirescripts" "use")
    (group $Token.keyword+256 "php")
    (group $Token.keyword+512 "verbatim"))

  ;; Token, plus 256 for `@php` and 512 for `@verbatim`, or -1 when unknown.
  (func $bladeDirective (param $lhs i32) (param $rhs i32) (result i32)
    (local $n i32)
    (local $hl i32)
    (local.set $n (call $lexLowerCopy (local.get $lhs) (local.get $rhs) (i32.const $mem.lexLowerScratch)))
    (local.set $hl
      (keyword-table.value $bladeWords
        (i32.const $mem.lexLowerScratch)
        (i32.add (i32.const $mem.lexLowerScratch) (local.get $n))))
    (if
      (i32.and
        (i32.lt_s (local.get $hl) (i32.const 0))
        (i32.and
          (i32.gt_u (local.get $n) (i32.const 3))
          (i32.eq
            (i32.and (i32.load (i32.const $mem.lexLowerScratch)) (i32.const 0xffffff))
            (i32.const "end"))))
      (then
        (local.set $hl
          (keyword-table.value $bladeWords
            (i32.const $mem.lexLowerScratch+3)
            (i32.add (i32.const $mem.lexLowerScratch) (local.get $n))))
        (if (i32.ge_s (local.get $hl) (i32.const 0))
          (then (local.set $hl (i32.and (local.get $hl) (i32.const 255)))))))
    (local.get $hl))

  (func $bladeVerbatimEnd (param $p i32) (result i32)
    (block $found
      (loop $scan
        (local.set $p (call $tmplFindWord (local.get $p) (i64.const "@endverb") (i32.const 8)))
        (br_if $found (i32.ge_u (local.get $p) (global.get $end)))
        (br_if $found
          (i32.and
            (i32.le_u (i32.add (local.get $p) (i32.const 12)) (global.get $end))
            (i32.eq (i32.load offset=8 (local.get $p)) (i32.const "atim"))))
        (local.set $p (i32.add (local.get $p) (i32.const 1)))
        (br $scan)))
    (select (local.get $p) (global.get $end) (i32.lt_u (local.get $p) (global.get $end))))

  ;; $markup: the $tmplMarkup state. $php: the open PHP region, kind in bits 0-3
  ;; (1 `{{`, 2 `{!!`, 3 directive arguments, 4 `@php`, 5 an attribute value, 6
  ;; `<?php`), a quote in bits 8-15, argument depth from bit 16. As in Blade's
  ;; compiler, a region ends at the first `}}`, `!!}`, `@endphp`, quote, or `?>`,
  ;; or at the `)` that balances the arguments. $phpMode: a PHP comment or string
  ;; mode open at a chunk end, resumed only within the region's bound.
  (func $hlBlade
    (local $markup i32)
    (local $php i32)
    (local $phpMode i32)
    (local $verbatim i32)
    (local $skip i32)
    (local $c i32)
    (local $depth i32)
    (local $hl i32)
    (local $kind i32)
    (local $lhs i32)
    (local $n i32)
    (local $p i32)
    (local $q i32)
    (local $r i32)
    (local $resumed i32)
    (local $saveEnd i32)
    (local $word i64)
    (call $lexEmitLeadingContinuation)
    (local.set $resumed (i32.const 0))
    (if (global.get $streamRegionKind)
      (then
        (local.set $saveEnd (global.get $end))
        (if (local.get $verbatim)
          (then (global.set $end (call $bladeVerbatimEnd (global.get $ptr)))))
        (local.set $resumed (call $streamResumeAnyRegion))
        (if (i32.and (local.get $resumed) (i32.lt_u (global.get $end) (local.get $saveEnd)))
          (then
            (call $tmplCut)
            (local.set $resumed (i32.const 0))))
        (global.set $end (local.get $saveEnd))))
    (block $done
      (br_if $done (local.get $resumed))
      (loop $next
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        (local.set $lhs (global.get $ptr))
        (if (local.get $php)
          (then
            (local.set $kind (i32.and (local.get $php) (i32.const 15)))
            (local.set $hl (enum.get $Token.punctuation.bracket))
            (local.set $n (i32.const 1))
            (local.set $word (i64.const 0))
            (if (i32.eq (local.get $kind) (i32.const 3))
              (then
                (local.set $q (i32.and (i32.shr_u (local.get $php) (i32.const 8)) (i32.const 255)))
                (local.set $depth (i32.shr_u (local.get $php) (i32.const 16)))
                (local.set $p (local.get $lhs))
                (block $found
                  (loop $scan
                    (if (local.get $q)
                      (then
                        (local.set $p
                          (call $scanFindSpecial
                            (local.get $p)
                            (global.get $end)
                            (local.get $q)
                            (i32.const 1)
                            (i32.const 0)))
                        (br_if $found (i32.ge_u (local.get $p) (global.get $end)))
                        (if (i32.eq (i32.load8_u (local.get $p)) (local.get $q))
                          (then (local.set $q (i32.const 0)))
                          (else (local.set $p (i32.add (local.get $p) (i32.const 1)))))
                        (local.set $p (i32.add (local.get $p) (i32.const 1)))
                        (br $scan)))
                    (local.set $p
                      (call $tmplFind4 (local.get $p) (i32.const "(") (i32.const ")") (i32.const 34) (i32.const 39)))
                    (br_if $found (i32.ge_u (local.get $p) (global.get $end)))
                    (local.set $c (i32.load8_u (local.get $p)))
                    (if (i32.eq (local.get $c) (i32.const ")"))
                      (then
                        (br_if $found (i32.eqz (local.get $depth)))
                        (local.set $depth (i32.sub (local.get $depth) (i32.const 1))))
                      (else
                        (if (i32.eq (local.get $c) (i32.const "("))
                          (then (local.set $depth (i32.add (local.get $depth) (i32.const 1))))
                          (else (local.set $q (local.get $c))))))
                    (local.set $p (i32.add (local.get $p) (i32.const 1)))
                    (br $scan)))
                (if (i32.gt_u (local.get $p) (global.get $end))
                  (then (local.set $p (global.get $end))))
                (local.set $php
                  (i32.or
                    (i32.const 3)
                    (i32.or (i32.shl (local.get $q) (i32.const 8)) (i32.shl (local.get $depth) (i32.const 16))))))
              (else
                (byte-switch (local.get $kind)
                  (case 1
                    (local.set $word (i64.const "}}"))
                    (local.set $n (i32.const 2))
                    (local.set $hl (enum.get $Token.punctuation.special)))
                  (case 2
                    (local.set $word (i64.const "!!}"))
                    (local.set $n (i32.const 3))
                    (local.set $hl (enum.get $Token.punctuation.special)))
                  (case 4
                    (local.set $word (i64.const "@endphp"))
                    (local.set $n (i32.const 7))
                    (local.set $hl (enum.get $Token.keyword)))
                  (case 5
                    (local.set $word (i64.extend_i32_u (i32.shr_u (local.get $php) (i32.const 8))))
                    (local.set $hl (enum.get $Token.string)))
                  (case 6
                    (local.set $word (i64.const "?>"))
                    (local.set $n (i32.const 2))
                    (local.set $hl (enum.get $Token.preproc))))
                (local.set $p (call $tmplFindWord (local.get $lhs) (local.get $word) (local.get $n)))))
            (local.set $saveEnd (global.get $end))
            (global.set $end (local.get $p))
            (if (local.get $phpMode)
              (then
                (global.set $streamMode (local.get $phpMode))
                (local.set $phpMode (i32.const 0))
                (if (i32.eq (global.get $streamMode) (i32.const 14))
                  (then (drop (call $phpHeredocResume)))
                  (else
                    (if (i32.eq (global.get $streamMode) (i32.const 15))
                      (then
                        (if (call $phpSingleBody (global.get $ptr))
                          (then (global.set $streamMode (i32.const 0)))))
                      (else (drop (call $streamResumeCommon))))))))
            (block $codeDone
              (loop $code
                (call $phpCode (i32.const 1))
                (br_if $codeDone (i32.ge_u (global.get $ptr) (global.get $end)))
                ;; `?>` only ends a `<?php` block; the code after it starts afresh in streams too
                (local.set $q (global.get $ptr))
                (global.set $ptr (i32.add (local.get $q) (i32.const 2)))
                (call $emitTok (enum.get $Token.operator) (local.get $q) (global.get $ptr))
                (global.set $phpStreamDecl (i32.const 0))
                (global.set $phpStreamMember (i32.const 0))
                (br $code)))
            (global.set $end (local.get $saveEnd))
            (if (i32.lt_u (local.get $p) (global.get $end))
              (then
                (global.set $streamMode (i32.const 0))
                (global.set $phpStreamDecl (i32.const 0))
                (global.set $phpStreamMember (i32.const 0))
                (global.set $ptr (i32.add (local.get $p) (local.get $n)))
                (call $emitTok (local.get $hl) (local.get $p) (global.get $ptr))
                (if (i32.eq (local.get $kind) (i32.const 5))
                  (then
                    (local.set $markup
                      (i32.or (i32.and (local.get $markup) (i32.const 0xffff00e8)) (i32.const 1)))))
                (local.set $php (i32.const 0)))
              (else
                ;; WARNING: the shared resume would run PHP's mode past the closer, so the
                ;; region keeps it until its bound is known
                (if (i32.and (global.get $streaming) (i32.eq (global.get $ptr) (global.get $eof)))
                  (then
                    (local.set $phpMode (global.get $streamMode))
                    (global.set $streamMode (i32.const 0))))))
            (br $next)))
        (local.set $saveEnd (global.get $end))
        (if (local.get $verbatim)
          (then
            (global.set $end (call $bladeVerbatimEnd (local.get $lhs)))
            (if (local.get $phpMode)
              (then
                (global.set $streamMode (local.get $phpMode))
                (local.set $phpMode (i32.const 0))
                (drop (call $streamResumeCommon))))))
        (local.set $skip (i32.const 0))
        (loop $markupNext
          (local.set $r
            (call $tmplMarkup
              (local.get $markup)
              (i32.or (i32.shl (local.get $verbatim) (i32.const 2)) (i32.shl (local.get $skip) (i32.const 4)))))
          (global.set $end (local.get $saveEnd))
          (local.set $markup (i32.and (local.get $r) (i32.const 0xffffff)))
          (local.set $r (i32.shr_u (local.get $r) (i32.const 24)))
          (if (local.get $verbatim)
            (then
              (if (i32.lt_u (global.get $ptr) (global.get $end))
                (then
                  (call $tmplCut)
                  (local.set $lhs (global.get $ptr))
                  (global.set $ptr (i32.add (local.get $lhs) (i32.const 12)))
                  (call $emitTok (enum.get $Token.keyword) (local.get $lhs) (global.get $ptr))
                  (local.set $verbatim (i32.const 0))
                  (local.set $markup (i32.const 0)))
                (else
                  ;; WARNING: the shared resume would run a comment past `@endverbatim`; the block
                  ;; resumes it within its bound
                  (if
                    (i32.and
                      (i32.and (global.get $streaming) (i32.eq (global.get $ptr) (global.get $eof)))
                      (i32.eqz (global.get $streamRegionKind)))
                    (then
                      (local.set $phpMode (global.get $streamMode))
                      (global.set $streamMode (i32.const 0))))))
              (br $next)))
          (br_if $next (i32.eqz (local.get $r)))
          (local.set $lhs (global.get $ptr))
          (block $plain
            (block $construct
              (if (i32.eq (local.get $r) (i32.const 2))
                (then
                  (local.set $php (i32.or (i32.const 5) (i32.and (local.get $markup) (i32.const 0xff00))))
                  (br $construct)))
              (local.set $c (i32.load8_u (local.get $lhs)))
              (local.set $q (call $templateByte (i32.add (local.get $lhs) (i32.const 1))))
              (if (i32.eq (local.get $c) (i32.const "<"))
                (then
                  (global.set $ptr
                    (i32.add
                      (local.get $lhs)
                      (select
                        (i32.const 3)
                        (i32.const 5)
                        (i32.eq (i32.load8_u offset=2 (local.get $lhs)) (i32.const "=")))))
                  (call $emitTok (enum.get $Token.preproc) (local.get $lhs) (global.get $ptr))
                  (local.set $php (i32.const 6))
                  (br $construct)))
              (if (i32.eq (local.get $c) (i32.const "{"))
                (then
                  (local.set $p (call $templateByte (i32.add (local.get $lhs) (i32.const 2))))
                  (if (i32.eq (local.get $q) (i32.const "!"))
                    (then
                      (br_if $plain (i32.ne (local.get $p) (i32.const "!")))
                      (local.set $php (i32.const 2))
                      (local.set $n (i32.const 3)))
                    (else
                      (br_if $plain (i32.ne (local.get $q) (i32.const "{")))
                      (if
                        (i32.and
                          (i32.eq (local.get $p) (i32.const "-"))
                          (i32.eq (call $templateByte (i32.add (local.get $lhs) (i32.const 3))) (i32.const "-")))
                        (then
                          (call $tmplComment (i32.const 4) (i32.const "--}}") (i32.const 4))
                          (br $construct)))
                      (local.set $php (i32.const 1))
                      (local.set $n (i32.const 2))))
                  (global.set $ptr (i32.add (local.get $lhs) (local.get $n)))
                  (call $emitTok (enum.get $Token.punctuation.special) (local.get $lhs) (global.get $ptr))
                  (br $construct)))
              (if
                (i32.or
                  (i32.eq (local.get $q) (i32.const "@"))
                  (i32.and
                    (i32.eq (local.get $q) (i32.const "{"))
                    (i32.eq (call $templateByte (i32.add (local.get $lhs) (i32.const 2))) (i32.const "{"))))
                (then
                  (global.set $ptr
                    (i32.add (local.get $lhs) (select (i32.const 3) (i32.const 2) (i32.eq (local.get $q) (i32.const "{")))))
                  (call $emitTok (enum.get $Token.string.escape) (local.get $lhs) (global.get $ptr))
                  (br $construct)))
              ;; `@name` only after a byte that cannot end a word (not an email)
              (br_if $plain
                (i32.and
                  (i32.gt_u (i32.sub (i32.or (local.get $q) (i32.const 32)) (i32.const "a")) (i32.const 25))
                  (i32.ne (local.get $q) (i32.const "_"))))
              (br_if $plain
                (i32.and
                  (i32.gt_u (local.get $lhs) (global.get $srcBase))
                  (call $lexIsIdentContinue (i32.load8_u (i32.sub (local.get $lhs) (i32.const 1))))))
              (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
              (call $scanIdentRun (i32.const "_"))
              (local.set $q (global.get $ptr))
              (local.set $hl (call $bladeDirective (i32.add (local.get $lhs) (i32.const 1)) (local.get $q)))
              ;; an unknown name is a custom directive only with arguments
              (local.set $p (call $lexSkipSpaceAt (local.get $q)))
              (local.set $c (i32.eq (call $templateByte (local.get $p)) (i32.const "(")))
              (if (i32.lt_s (local.get $hl) (i32.const 0))
                (then
                  (global.set $ptr (local.get $lhs))
                  (br_if $plain (i32.eqz (local.get $c)))
                  (local.set $hl (enum.get $Token.function))))
              (call $emitTok (i32.and (local.get $hl) (i32.const 255)) (local.get $lhs) (local.get $q))
              (global.set $ptr (local.get $q))
              (if (local.get $c)
                (then
                  (call $emitGap (local.get $q) (local.get $p))
                  (global.set $ptr (i32.add (local.get $p) (i32.const 1)))
                  (call $emitTok (enum.get $Token.punctuation.bracket) (local.get $p) (global.get $ptr))
                  (local.set $php (i32.const 3))
                  (br $construct)))
              (if (i32.eq (i32.shr_u (local.get $hl) (i32.const 8)) (i32.const 1))
                (then (local.set $php (i32.const 4))))
              (local.set $verbatim (i32.eq (i32.shr_u (local.get $hl) (i32.const 8)) (i32.const 2))))
            ;; a construct right after `=` is the attribute's whole value
            (if (i32.eq (i32.and (local.get $markup) (i32.const 7)) (i32.const 3))
              (then (local.set $markup (i32.xor (local.get $markup) (i32.const 2)))))
            (if (local.get $php)
              (then
                (global.set $phpStreamDecl (i32.const 0))
                (global.set $phpStreamMember (i32.const 0))))
            (br $next))
          (local.set $skip (i32.const 1))
          (br $markupNext)))))
)
