(module
  (import "./json.wat")
  (import "./xml.wat")

  (func $httpBodyEnd (param $p i32) (result i32)
    (block $done
      (loop $find
        (local.set $p (call $lexFindByte (local.get $p) (i32.const "#")))
        (br_if $done (i32.gt_u (i32.add (local.get $p) (i32.const 3)) (global.get $end)))
        (if
          (i32.and
            (i32.eq (i32.load16_u offset=1 (local.get $p)) (i32.const "##"))
            (i32.eqz (call $lexLineByteBefore (local.get $p))))
          (then (return (local.get $p))))
        (local.set $p (i32.add (local.get $p) (i32.const 1)))
        (br $find)))
    (global.get $end))

  (func $httpText (param $hl i32) (param $stop i32)
    (local $p i32)
    (local $q i32)
    (block $done
      (loop $l
        (br_if $done (i32.ge_u (global.get $ptr) (local.get $stop)))
        (local.set $p
          (call $scanFindSpecial (global.get $ptr) (local.get $stop) (i32.const "{") (i32.const 0) (i32.const 0)))
        (local.set $q (local.get $stop))
        (if
          (i32.and
            (i32.lt_u (i32.add (local.get $p) (i32.const 1)) (local.get $stop))
            (i32.eq (i32.load8_u offset=1 (local.get $p)) (i32.const "{")))
          (then
            (local.set $q
              (call $scanFindSpecial
                (i32.add (local.get $p) (i32.const 2))
                (local.get $stop)
                (i32.const "}")
                (i32.const 0)
                (i32.const 1)))))
        (if
          (i32.and
            (i32.lt_u (i32.add (local.get $q) (i32.const 1)) (local.get $stop))
            (i32.eq (i32.load16_u (local.get $q)) (i32.const "}}")))
          (then
            (call $emitTok (local.get $hl) (global.get $ptr) (local.get $p))
            (global.set $ptr (i32.add (local.get $p) (i32.const 2)))
            (call $emitTok (enum.get $Token.punctuation.special) (local.get $p) (global.get $ptr))
            (call $emitTok (enum.get $Token.variable) (global.get $ptr) (local.get $q))
            (global.set $ptr (i32.add (local.get $q) (i32.const 2)))
            (call $emitTok (enum.get $Token.punctuation.special) (local.get $q) (global.get $ptr))
            (br $l)))
        (local.set $p
          (select (i32.add (local.get $p) (i32.const 1)) (local.get $stop) (i32.lt_u (local.get $p) (local.get $stop))))
        (call $emitTok (local.get $hl) (global.get $ptr) (local.get $p))
        (global.set $ptr (local.get $p))
        (br $l))))

  (func $httpSkipBlanks
    (local $p i32)
    (local.set $p (call $lexSkipSpaceAt (global.get $ptr)))
    (call $emitGap (global.get $ptr) (local.get $p))
    (global.set $ptr (local.get $p)))

  (func $httpVersion (param $rhs i32) (result i32)
    (local $p i32)
    (if
      (i32.or
        (i32.gt_u (i32.add (global.get $ptr) (i32.const 5)) (local.get $rhs))
        (i32.or
          (i32.ne (i32.load (global.get $ptr)) (i32.const "HTTP"))
          (i32.ne (i32.load8_u offset=4 (global.get $ptr)) (i32.const "/"))))
      (then (return (i32.const 0))))
    (local.set $p (i32.add (global.get $ptr) (i32.const 4)))
    (call $emitTok (enum.get $Token.keyword) (global.get $ptr) (local.get $p))
    (global.set $ptr (i32.add (local.get $p) (i32.const 1)))
    (call $emitTok (enum.get $Token.punctuation.delimiter) (local.get $p) (global.get $ptr))
    (local.set $p (call $scanFindSpecial (global.get $ptr) (local.get $rhs) (i32.const 32) (i32.const 0) (i32.const 0)))
    (call $emitTok (enum.get $Token.number) (global.get $ptr) (local.get $p))
    (global.set $ptr (local.get $p))
    (i32.const 1))

  ;; JSON and XML bodies run their lexers as stream roots. An open body is region
  ;; 29; $streamRegionStarted keeps its kind and, in bit 2, an open XML start tag.
  (func $httpBody (param $info i32) (param $resume i32)
    (local $depth i32)
    (local $kind i32)
    (local $reset i32)
    (local $save i32)
    (local $stop i32)
    (local.set $kind (i32.and (local.get $info) (i32.const 3)))
    (local.set $save (global.get $end))
    (local.set $stop (call $httpBodyEnd (global.get $ptr)))
    (local.set $depth (global.get $streamDepth))
    (local.set $reset (global.get $streamReset))
    (global.set $end (local.get $stop))
    (global.set $streamDepth (i32.const 0))
    (global.set $streamReset (i32.eqz (local.get $resume)))
    (global.set $streamRegionKind
      (select
        (i32.const 10)
        (i32.const 0)
        (i32.and (local.get $resume) (i32.shr_u (local.get $info) (i32.const 2)))))
    (block $run
      (if (local.get $resume)
        (then
          (if (global.get $streamRegionKind)
            (then (br_if $run (call $xmlStreamResumeTag))))
          (br_if $run (call $streamResumeCommon))))
      (if (i32.eq (local.get $kind) (i32.const 2))
        (then
          (call $hlJson)
          (br $run)))
      (if (i32.eq (local.get $kind) (i32.const 3))
        (then
          (call $hlXml)
          (br $run)))
      (call $httpText (enum.get $Token.none) (local.get $stop)))
    (global.set $streamDepth (local.get $depth))
    (global.set $streamReset (local.get $reset))
    (global.set $end (local.get $save))
    (global.set $ptr (local.get $stop))
    (local.set $info
      (i32.or
        (local.get $kind)
        (i32.shl (i32.eq (global.get $streamRegionKind) (i32.const 10)) (i32.const 2))))
    (global.set $streamRegionKind (i32.const 0))
    (if (global.get $streaming)
      (then
        (if (i32.and (i32.eq (local.get $stop) (local.get $save)) (i32.eq (local.get $stop) (global.get $eof)))
          (then
            (global.set $streamRegionKind (i32.const 29))
            (global.set $streamRegionStarted (local.get $info)))
          (else (global.set $streamMode (i32.const 0)))))))

  (func $httpStreamResume (result i32)
    (call $httpBody (global.get $streamRegionStarted) (i32.const 1))
    (i32.ge_u (global.get $ptr) (global.get $end)))

  ;; $state: 0 before a start line, 1 in headers, 2 in the body. $type: the body
  ;; kind from Content-Type.
  (func $hlHttp
    (local $c i32)
    (local $gap i32)
    (local $lhs i32)
    (local $p i32)
    (local $q i32)
    (local $rhs i32)
    (local $state i32)
    (local $type i32)
    (call $lexEmitLeadingContinuation)
    (block $done
      (loop $next
        (local.set $gap (global.get $ptr))
        (call $scanWhitespace)
        ;; A chunk starts at a line start, so its first gap counts one break more.
        (if (i32.eq (local.get $state) (i32.const 1))
          (then
            (local.set $p (local.get $gap))
            (local.set $q (i32.eq (local.get $gap) (global.get $srcBase)))
            (block $countDone
              (loop $count
                (br_if $countDone (i32.ge_u (local.get $p) (global.get $ptr)))
                (local.set $c (i32.load8_u (local.get $p)))
                (local.set $p (i32.add (local.get $p) (i32.const 1)))
                (if
                  (i32.or
                    (i32.eq (local.get $c) (i32.const 10))
                    (i32.and
                      (i32.eq (local.get $c) (i32.const 13))
                      (i32.ne (call $templateByte (local.get $p)) (i32.const 10))))
                  (then (local.set $q (i32.add (local.get $q) (i32.const 1)))))
                (br $count)))
            (if (i32.ge_u (local.get $q) (i32.const 2))
              (then (local.set $state (i32.const 2))))))
        (call $emitGap (local.get $gap) (global.get $ptr))
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        (local.set $lhs (global.get $ptr))
        (local.set $c (i32.load8_u (local.get $lhs)))
        (local.set $p
          (i32.and
            (i32.le_u (i32.add (local.get $lhs) (i32.const 3)) (global.get $end))
            (i32.eq (i32.load16_u offset=1 (local.get $lhs)) (i32.const "##"))))
        (if
          (i32.and
            (i32.eq (local.get $c) (i32.const "#"))
            (i32.or (local.get $p) (i32.ne (local.get $state) (i32.const 2))))
          (then
            (if (local.get $p)
              (then
                (local.set $state (i32.const 0))
                (local.set $type (i32.const 0))))
            (call $lexLineComment (i32.const 1) (enum.get $Token.comment))
            (br $next)))
        (if
          (i32.and
            (i32.ne (local.get $state) (i32.const 2))
            (i32.and
              (i32.eq (local.get $c) (i32.const "/"))
              (i32.eq (call $templateByte (i32.add (local.get $lhs) (i32.const 1))) (i32.const "/"))))
          (then
            (call $lexLineComment (i32.const 2) (enum.get $Token.comment))
            (br $next)))
        (if (i32.eq (local.get $state) (i32.const 2))
          (then
            (local.set $p (local.get $type))
            (if (i32.eqz (local.get $p))
              (then
                (local.set $p
                  (select
                    (i32.const 2)
                    (select (i32.const 3) (i32.const 1) (i32.eq (local.get $c) (i32.const "<")))
                    (i32.or (i32.eq (local.get $c) (i32.const "{")) (i32.eq (local.get $c) (i32.const "[")))))))
            (call $httpBody (local.get $p) (i32.const 0))
            (local.set $state (i32.const 0))
            (local.set $type (i32.const 0))
            (br $next)))
        (call $scanToLineEnd)
        (local.set $rhs (global.get $ptr))
        (global.set $ptr (local.get $lhs))
        (if (local.get $state)
          (then
            (local.set $p
              (call $scanFindSpecial (local.get $lhs) (local.get $rhs) (i32.const ":") (i32.const 0) (i32.const 0)))
            (if (i32.lt_u (local.get $p) (local.get $rhs))
              (then
                (call $emitTok (enum.get $Token.property) (local.get $lhs) (local.get $p))
                (global.set $ptr (i32.add (local.get $p) (i32.const 1)))
                (call $emitTok (enum.get $Token.punctuation.delimiter) (local.get $p) (global.get $ptr))
                (if
                  (i32.and
                    (i32.eq (i32.sub (local.get $p) (local.get $lhs)) (i32.const 12))
                    (i32.and
                      (i64.eq
                        (i64.or (i64.load (local.get $lhs)) (i64.const 0x2020202020202020))
                        (i64.const "content-"))
                      (i32.eq
                        (i32.or (i32.load offset=8 (local.get $lhs)) (i32.const 0x20202020))
                        (i32.const "type"))))
                  (then
                    (local.set $q (global.get $ptr))
                    (block $typeDone
                      (loop $find
                        (br_if $typeDone (i32.gt_u (i32.add (local.get $q) (i32.const 3)) (local.get $rhs)))
                        (local.set $c (i32.or (i32.load (local.get $q)) (i32.const 0x20202020)))
                        (if (i32.eq (i32.and (local.get $c) (i32.const 0xffffff)) (i32.const "xml"))
                          (then
                            (local.set $type (i32.const 3))
                            (br $typeDone)))
                        (if
                          (i32.and
                            (i32.le_u (i32.add (local.get $q) (i32.const 4)) (local.get $rhs))
                            (i32.eq (local.get $c) (i32.const "json")))
                          (then
                            (local.set $type (i32.const 2))
                            (br $typeDone)))
                        (local.set $q (i32.add (local.get $q) (i32.const 1)))
                        (br $find)))))
                (call $httpSkipBlanks)))
            (call $httpText (enum.get $Token.string) (local.get $rhs))
            (br $next)))
        (if (i32.eq (local.get $c) (i32.const "@"))
          (then
            (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
            (call $scanIdentRun (i32.const 0))
            (call $emitTok (enum.get $Token.variable) (local.get $lhs) (global.get $ptr))
            (call $httpSkipBlanks)
            (if (i32.eq (call $templateByte (global.get $ptr)) (i32.const "="))
              (then
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                (call $emitTok
                  (enum.get $Token.operator)
                  (i32.sub (global.get $ptr) (i32.const 1))
                  (global.get $ptr))
                (call $httpSkipBlanks)))
            (call $httpText (enum.get $Token.string) (local.get $rhs))
            (br $next)))
        (local.set $state (i32.const 1))
        (if (call $httpVersion (local.get $rhs))
          (then
            (call $httpSkipBlanks)
            (local.set $p
              (call $scanFindSpecial (global.get $ptr) (local.get $rhs) (i32.const 32) (i32.const 0) (i32.const 0)))
            (call $emitTok (enum.get $Token.number) (global.get $ptr) (local.get $p))
            (global.set $ptr (local.get $p))
            (call $httpSkipBlanks)
            (call $emitTok (enum.get $Token.string) (global.get $ptr) (local.get $rhs))
            (global.set $ptr (local.get $rhs))
            (br $next)))
        (local.set $p
          (call $scanFindSpecial (local.get $lhs) (local.get $rhs) (i32.const 32) (i32.const 0) (i32.const 0)))
        (local.set $q (local.get $lhs))
        (block $methodDone
          (loop $method
            (br_if $methodDone (i32.ge_u (local.get $q) (local.get $p)))
            (br_if $methodDone (i32.gt_u (i32.sub (i32.load8_u (local.get $q)) (i32.const "A")) (i32.const 25)))
            (local.set $q (i32.add (local.get $q) (i32.const 1)))
            (br $method)))
        (if (i32.eq (local.get $q) (local.get $p))
          (then
            (call $emitTok (enum.get $Token.keyword) (local.get $lhs) (local.get $p))
            (global.set $ptr (local.get $p))
            (call $httpSkipBlanks)
            (local.set $p
              (call $scanFindSpecial (global.get $ptr) (local.get $rhs) (i32.const 32) (i32.const 0) (i32.const 0)))))
        (call $httpText (enum.get $Token.string) (local.get $p))
        (call $httpSkipBlanks)
        (drop (call $httpVersion (local.get $rhs)))
        (call $emitTok (enum.get $Token.none) (global.get $ptr) (local.get $rhs))
        (global.set $ptr (local.get $rhs))
        (br $next))))
)
