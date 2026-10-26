(module
  (import "../common.wat")
  (import "./hlsl.wat")
  (import "./glsl.wat")

  ;; ShaderLab ignores case, so words are looked up lowercased. Structure
  ;; blocks are declarations, render-state and other commands keywords,
  ;; property types built-in types, and command values built-in constants.
  ;; `2D`, `3D`, and `2DArray` start with a digit and are matched as numbers.
  ;; $shaderlabWordHl strips the `OneMinus` of blend factors and matches
  ;; `FailBack`, which shares hash features with `Fallback`.
  (keyword-table $shaderlabWords $mem.shaderlabWords $mem.coqWords
    (group $Token.keyword.declaration
      "pass" "shader" "category" "fallback" "grabpass" "usepass" "subshader" "properties"
      "dependency" "customeditor")
    (group $Token.keyword
      "lod" "fog" "ref" "cull" "comp" "fail" "name" "tags" "bind" "zfail" "zclip" "ztest"
      "blend" "zwrite" "offset" "blendop" "combine" "stencil" "lighting" "material"
      "passback" "readmask" "compback" "alphatest" "colormask" "passfront"
      "failfront" "compfront" "writemask" "zfailback" "settexture" "zfailfront" "alphatomask"
      "conservative" "bindchannels")
    (group $Token.type.builtin
      "any" "int" "cube" "color" "float" "range" "vector" "integer" "cubearray")
    (group $Token.constant.builtin
      "on" "add" "max" "min" "off" "one" "sub" "back" "keep" "less" "zero" "equal" "front"
      "never" "always" "invert" "revsub" "gequal" "lequal" "decrsat" "greater" "incrsat"
      "replace" "decrwrap" "dstcolor" "dstalpha" "incrwrap" "notequal" "srcalpha" "srccolor")
    (group $Token.boolean "true" "false"))

  ;; The lowercased word's token, or -1.
  (func $shaderlabWordHl (param $lhs i32) (param $rhs i32) (result i32)
    (local $p i32)
    (local $n i32)
    (local.set $n (call $lexLowerCopy (local.get $lhs) (local.get $rhs) (i32.const $mem.lexLowerScratch)))
    (local.set $p (i32.const $mem.lexLowerScratch))
    (if (i32.eq (local.get $n) (i32.const 8))
      (then
        (if (i64.eq (i64.load (local.get $p)) (i64.const "failback"))
          (then (return (enum.get $Token.keyword))))))
    (if
      (i32.and
        (i32.gt_u (local.get $n) (i32.const 8))
        (i64.eq (i64.load (local.get $p)) (i64.const "oneminus")))
      (then
        (local.set $p (i32.add (local.get $p) (i32.const 8)))
        (local.set $n (i32.sub (local.get $n) (i32.const 8)))))
    (keyword-table.value $shaderlabWords (local.get $p) (i32.add (local.get $p) (local.get $n))))

  ;; 38 for `CGPROGRAM`, `CGINCLUDE`, `HLSLPROGRAM`, and `HLSLINCLUDE`, whose
  ;; bodies are HLSL; 39 for `GLSLPROGRAM` and `GLSLINCLUDE`; 0 otherwise.
  ;; Unlike ShaderLab words, these are uppercase only.
  (func $shaderlabOpener (param $lhs i32) (param $rhs i32) (result i32)
    (local $n i32)
    (local $tail i64)
    (local.set $n (i32.sub (local.get $rhs) (local.get $lhs)))
    (if (i32.and (i32.ne (local.get $n) (i32.const 9)) (i32.ne (local.get $n) (i32.const 11)))
      (then (return (i32.const 0))))
    (local.set $tail
      (i64.and (i64.load (i32.sub (local.get $rhs) (i32.const 7))) (i64.const 0x00ffffffffffffff)))
    (if
      (i32.and
        (i64.ne (local.get $tail) (i64.const "PROGRAM"))
        (i64.ne (local.get $tail) (i64.const "INCLUDE")))
      (then (return (i32.const 0))))
    (if (i32.eq (local.get $n) (i32.const 9))
      (then
        (return
          (select (i32.const 38) (i32.const 0) (i32.eq (i32.load16_u (local.get $lhs)) (i32.const "CG"))))))
    (if (i32.eq (i32.load (local.get $lhs)) (i32.const "HLSL"))
      (then (return (i32.const 38))))
    (select (i32.const 39) (i32.const 0) (i32.eq (i32.load (local.get $lhs)) (i32.const "GLSL"))))

  ;; The first whole word `ENDCG`, `ENDHLSL`, or `ENDGLSL` at or after $p, or
  ;; $end. Any of them closes a body, as the text search a reader does.
  (func $shaderlabBodyEnd (param $p i32) (result i32)
    (local $n i32)
    (local $w i64)
    (block $done
      (loop $find
        (local.set $p (call $lexFindByte (local.get $p) (i32.const "E")))
        (br_if $done (i32.ge_u (local.get $p) (global.get $end)))
        ;; the wide load stays inside the input slack
        (local.set $w (i64.and (i64.load (local.get $p)) (i64.const 0x00ffffffffffffff)))
        (local.set $n
          (select
            (i32.const 5)
            (select
              (i32.const 7)
              (i32.const 0)
              (i32.or (i64.eq (local.get $w) (i64.const "ENDHLSL")) (i64.eq (local.get $w) (i64.const "ENDGLSL"))))
            (i64.eq (i64.and (local.get $w) (i64.const 0xffffffffff)) (i64.const "ENDCG"))))
        (if
          (i32.and
            (i32.ne (local.get $n) (i32.const 0))
            (i32.le_u (i32.add (local.get $p) (local.get $n)) (global.get $end)))
          (then
            (if
              (i32.eqz
                (i32.or
                  (call $lexIsIdentContinue (call $templateByte (i32.add (local.get $p) (local.get $n))))
                  (i32.and
                    (i32.gt_u (local.get $p) (global.get $srcBase))
                    (call $lexIsIdentContinue (i32.load8_u (i32.sub (local.get $p) (i32.const 1)))))))
              (then (return (local.get $p))))))
        (local.set $p (i32.add (local.get $p) (i32.const 1)))
        (br $find)))
    (global.get $end))

  ;; Lex an embedded body from $ptr to its closer with the HLSL (region 38)
  ;; or GLSL (39) lexer, then emit the closer. The body lexer runs as a stream
  ;; root, so its locals carry across chunks; a body still open at the chunk
  ;; end saves its region, and $resume continues it in the next chunk.
  (func $shaderlabBody (param $kind i32) (param $resume i32)
    (local $close i32)
    (local $save i32)
    (local $depth i32)
    (local $reset i32)
    (local.set $close (call $shaderlabBodyEnd (global.get $ptr)))
    (local.set $save (global.get $end))
    (local.set $depth (global.get $streamDepth))
    (local.set $reset (global.get $streamReset))
    (global.set $end (local.get $close))
    (global.set $streamDepth (i32.const 0))
    (global.set $streamReset (i32.eqz (local.get $resume)))
    (global.set $streamRegionKind (i32.const 0))
    (block $run
      ;; a resumed body first finishes the comment or string its lexer left open
      (if (local.get $resume)
        (then (br_if $run (call $streamResumeCommon))))
      (if (i32.eq (local.get $kind) (i32.const 38))
        (then (call $hlHlsl))
        (else (call $hlGlslImpl (i32.const 0)))))
    (global.set $streamDepth (local.get $depth))
    (global.set $streamReset (local.get $reset))
    (global.set $end (local.get $save))
    (global.set $ptr (local.get $close))
    (if (i32.lt_u (local.get $close) (global.get $end))
      (then
        (call $scanIdentRun (i32.const "_"))
        (call $emitTok (enum.get $Token.keyword) (local.get $close) (global.get $ptr))
        ;; WARNING: the finished body's mode and locals would keep live line
        ;; states after it apart; ShaderLab itself keeps no state
        (if (global.get $streaming)
          (then
            (global.set $streamMode (i32.const 0))
            (call $streamClearCheckpoints))))
      (else (call $streamSetRegion (local.get $kind)))))

  (func $shaderlabStreamResume (result i32)
    (call $shaderlabBody (global.get $streamRegionKind) (i32.const 1))
    (i32.ge_u (global.get $ptr) (global.get $end)))

  ;; $attr: 1 right after the `[` of an attribute list such as `[HideInInspector]`,
  ;; 2 inside it, 3 right after its `]`, where another list may follow. A `[`
  ;; elsewhere, as in `Cull [_Cull]`, references a property. It resets at line
  ;; breaks, which every chunk starts after, so no state carries across chunks.
  (func $hlShaderlab
    (local $c i32)
    (local $c2 i32)
    (local $lhs i32)
    (local $rhs i32)
    (local $gap i32)
    (local $hl i32)
    (local $n i32)
    (local $attr i32)
    (call $lexEmitLeadingContinuation)
    (local.set $attr (i32.const 0))
    (block $done
      (loop $next
        (local.set $gap (global.get $ptr))
        (call $scanWhitespace)
        (if (call $lexGapHasBreak (local.get $gap) (global.get $ptr))
          (then (local.set $attr (i32.const 0))))
        (call $emitGap (local.get $gap) (global.get $ptr))
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        (local.set $lhs (global.get $ptr))
        (local.set $c (i32.load8_u (local.get $lhs)))
        (local.set $c2 (call $templateByte (i32.add (local.get $lhs) (i32.const 1))))

        (if (i32.eq (local.get $c) (i32.const "["))
          (then
            (local.set $attr
              (i32.or
                (i32.eqz (call $lexLineByteBefore (local.get $lhs)))
                (i32.eq (local.get $attr) (i32.const 3))))
            (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
            (call $emitTok (enum.get $Token.punctuation.bracket) (local.get $lhs) (global.get $ptr))
            (br $next)))
        (if (i32.eq (local.get $attr) (i32.const 3))
          (then (local.set $attr (i32.const 0))))

        (if (i32.eq (local.get $c) (i32.const "/"))
          (then
            (if (i32.eq (local.get $c2) (i32.const "/"))
              (then
                (call $lexLineComment (i32.const 2) (enum.get $Token.comment))
                (br $next)))
            (if (i32.eq (local.get $c2) (i32.const "*"))
              (then
                (call $lexBlockComment (i32.const 2) (enum.get $Token.comment))
                (br $next)))))
        (if (i32.eq (local.get $c) (i32.const 34))
          (then
            ;; ShaderLab strings have no escapes
            (call $lexRawString (i32.const 34) (i32.const 0) (enum.get $Token.string))
            (br $next)))

        ;; numbers, and the `2D`, `3D`, and `2DArray` texture types
        (if
          (i32.or
            (call $lexIsDigit (local.get $c))
            (i32.and (i32.eq (local.get $c) (i32.const ".")) (call $lexIsDigit (local.get $c2))))
          (then
            (call $lexScanNumber)
            (call $emitTok
              (select
                (enum.get $Token.type.builtin)
                (enum.get $Token.number)
                (i32.and
                  (i32.le_u (i32.sub (local.get $c) (i32.const "2")) (i32.const 1))
                  (i32.eq (i32.or (local.get $c2) (i32.const 32)) (i32.const "d"))))
              (local.get $lhs)
              (global.get $ptr))
            (br $next)))

        (if (i32.and (call $lexIsIdentStart (local.get $c)) (i32.ne (local.get $c) (i32.const "$")))
          (then
            (call $scanIdentRun (i32.const "_"))
            (local.set $rhs (global.get $ptr))
            (local.set $n (call $shaderlabOpener (local.get $lhs) (local.get $rhs)))
            (if (local.get $n)
              (then
                (call $emitTok (enum.get $Token.keyword) (local.get $lhs) (local.get $rhs))
                (call $shaderlabBody (local.get $n) (i32.const 0))
                (br $next)))
            (block $classified
              (if (i32.eq (local.get $attr) (i32.const 1))
                (then
                  (local.set $hl (enum.get $Token.attribute))
                  (local.set $attr (i32.const 2))
                  (br $classified)))
              (local.set $hl (call $shaderlabWordHl (local.get $lhs) (local.get $rhs)))
              (br_if $classified (i32.ge_s (local.get $hl) (i32.const 0)))
              ;; `ColorMask` channels: one to four of R, G, B, and A
              (local.set $hl (enum.get $Token.constant.builtin))
              (if (i32.le_u (i32.sub (local.get $rhs) (local.get $lhs)) (i32.const 4))
                (then
                  (local.set $n (local.get $lhs))
                  (block $channels
                    (loop $channel
                      (br_if $classified (i32.ge_u (local.get $n) (local.get $rhs)))
                      (local.set $c (i32.load8_u (local.get $n)))
                      (br_if $channels
                        (i32.eqz
                          (i32.or
                            (i32.or (i32.eq (local.get $c) (i32.const "R")) (i32.eq (local.get $c) (i32.const "G")))
                            (i32.or (i32.eq (local.get $c) (i32.const "B")) (i32.eq (local.get $c) (i32.const "A"))))))
                      (local.set $n (i32.add (local.get $n) (i32.const 1)))
                      (br $channel)))))
              ;; a property declaration: `_MainTex ("Texture", 2D) = "white" {}`
              (if (i32.eq (call $templateByte (call $lexSkipSpaceAt (local.get $rhs))) (i32.const "("))
                (then
                  (local.set $hl (enum.get $Token.property))
                  (br $classified)))
              (local.set $hl
                (select
                  (enum.get $Token.constant)
                  (enum.get $Token.variable)
                  (call $lexIsConstCase (local.get $lhs) (local.get $rhs)))))
            (call $emitTok (local.get $hl) (local.get $lhs) (local.get $rhs))
            (br $next)))

        (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
        (local.set $hl (enum.get $Token.none))
        (if (byteset.get "()[]{}" (local.get $c))
          (then
            (local.set $hl (enum.get $Token.punctuation.bracket))
            (if (i32.eq (local.get $c) (i32.const "]"))
              (then (local.set $attr (select (i32.const 3) (i32.const 0) (local.get $attr)))))))
        (if (byteset.get ",.:;" (local.get $c))
          (then (local.set $hl (enum.get $Token.punctuation.delimiter))))
        (if (byteset.get "!%&*+-/<=>?^|~" (local.get $c))
          (then (local.set $hl (enum.get $Token.operator))))
        (if (i32.eqz (local.get $hl))
          (then (global.set $ptr (call $utf8SpanEnd (global.get $ptr) (global.get $end)))))
        (call $emitTok (local.get $hl) (local.get $lhs) (global.get $ptr))
        (br $next))))
)
