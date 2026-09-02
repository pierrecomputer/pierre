(module
  (import "../common.wat")

  ;; Exact keyword words live in a shared perfect-hash table; the families with
  ;; open-ended dimensional suffixes stay as prefix checks below, and the few
  ;; words the table hash cannot separate get direct compares in $glslWordHl.
  ;; Group order is the dispatch order in $glslWordHl.
  (keyword-table $glslWords $mem.glslWords $mem.glslWords+1152 32 128
    (group "true" "false") ;; 1: booleans
    (group ;; 2: control flow, including the ray-tracing control statements
      "break" "case" "continue" "default" "do" "else" "for" "if"
      "return" "switch" "while" "discard" "demote"
      "terminateInvocation" "terminateRayNV"
      "ignoreIntersectionEXT" "ignoreIntersectionNV")
    (group "struct") ;; 3: declaration, next name is a type
    (group ;; 4: scalar, extension scalar and opaque built-in types
      "void" "bool" "int" "uint" "float" "double" "atomic_uint"
      "int8_t" "uint8_t"
      "subpassInput" "isubpassInput" "usubpassInput"
      "accelerationStructureEXT" "rayQueryEXT")
    (group ;; 5: storage, interpolation, precision and extension qualifiers
      "const" "in" "out" "inout" "uniform" "shared" "attribute" "varying"
      "buffer" "coherent" "volatile" "restrict" "readonly" "writeonly"
      "layout" "centroid" "flat" "smooth" "noperspective" "patch"
      "sample" "invariant" "precise" "highp" "mediump" "lowp"
      "precision" "subroutine"
      "rayPayloadEXT" "rayPayloadInEXT" "hitAttributeEXT"
      "callableDataEXT" "callableDataInEXT" "shaderRecordEXT"
      "rayPayloadNV" "rayPayloadInNV" "hitAttributeNV"
      "callableDataNV" "callableDataInNV" "shaderRecordNV"
      "require" "enable" "warn" "disable" "typedef" "enum" "union"))

  (func $glslWordHl (param $lhs i32) (param $rhs i32) (result i32)
    (local $g i32)
    (local $len i32)
    (local $last i32)
    (local $w i32)
    (local.set $g (keyword-table.get $glslWords (local.get $lhs) (local.get $rhs)))
    (if (i32.eq (local.get $g) (i32.const 1))
      (then (return (enum.get $Token.boolean))))
    (if (i32.eq (local.get $g) (i32.const 2))
      (then (return (enum.get $Token.keyword.control))))
    (if (i32.eq (local.get $g) (i32.const 3))
      (then (return (enum.get $Token.keyword.declaration))))
    (if (i32.eq (local.get $g) (i32.const 4))
      (then (return (enum.get $Token.type.builtin))))
    (if (local.get $g)
      (then (return (enum.get $Token.keyword))))
    (local.set $len (i32.sub (local.get $rhs) (local.get $lhs)))

    ;; The table hash mixes only the first two bytes, last byte and length, so
    ;; intN_t/uintN_t/floatN_t collide within each family for N of 16/32/64;
    ;; match the width tail plus the length-keyed stem exactly instead.
    (if (i32.ge_u (local.get $len) (i32.const 7))
      (then
        (local.set $w (i32.load (i32.sub (local.get $rhs) (i32.const 4))))
        (if (i32.and
              (i32.or
                (i32.or
                  (i32.eq (local.get $w) (i32.const "16_t"))
                  (i32.eq (local.get $w) (i32.const "32_t")))
                (i32.eq (local.get $w) (i32.const "64_t")))
              (i32.or
                (i32.or
                  (i32.and
                    (i32.eq (local.get $len) (i32.const 7))
                    (i32.eq
                      (i32.and (i32.load (local.get $lhs)) (i32.const 0xffffff))
                      (i32.const "int")))
                  (i32.and
                    (i32.eq (local.get $len) (i32.const 8))
                    (i32.eq (i32.load (local.get $lhs)) (i32.const "uint"))))
                (i32.and
                  (i32.eq (local.get $len) (i32.const 9))
                  (i64.eq
                    (i64.and (i64.load (local.get $lhs)) (i64.const 0x000000ffffffffff))
                    (i64.const "float")))))
          (then (return (enum.get $Token.type.builtin))))))

    ;; terminateRayEXT shares its low hash bits with layout, so no table
    ;; geometry can hold both; keep the rare one as a direct compare.
    (if (i32.and
          (i32.eq (local.get $len) (i32.const 15))
          (i32.and
            (i64.eq (i64.load (local.get $lhs)) (i64.const "terminat"))
            (i64.eq (i64.load offset=7 (local.get $lhs)) (i64.const "teRayEXT"))))
      (then (return (enum.get $Token.keyword.control))))

    ;; vecN/matN, their typed forms, and rectangular matrices.
    (local.set $last (i32.load8_u (i32.sub (local.get $rhs) (i32.const 1))))
    (if (i32.le_u (i32.sub (local.get $last) (i32.const "2")) (i32.const 2))
      (then
        (if (i32.eq (local.get $len) (i32.const 4))
          (then
            (local.set $w (i32.and (i32.load (local.get $lhs)) (i32.const 0xffffff)))
            (if (i32.or
                  (i32.eq (local.get $w) (i32.const "vec"))
                  (i32.eq (local.get $w) (i32.const "mat")))
              (then (return (enum.get $Token.type.builtin))))))
        (if (i32.eq (local.get $len) (i32.const 5))
          (then
            (local.set $w (i32.load (local.get $lhs)))
            (if (i32.or
                  (i32.or
                    (i32.eq (local.get $w) (i32.const "bvec"))
                    (i32.eq (local.get $w) (i32.const "ivec")))
                  (i32.or
                    (i32.eq (local.get $w) (i32.const "uvec"))
                    (i32.or
                      (i32.eq (local.get $w) (i32.const "dvec"))
                      (i32.eq (local.get $w) (i32.const "dmat")))))
              (then (return (enum.get $Token.type.builtin))))))
        (if (i32.and
              (i32.eq (local.get $len) (i32.const 6))
              (i32.and
                (i32.eq
                  (i32.and (i32.load (local.get $lhs)) (i32.const 0xffffff))
                  (i32.const "mat"))
                (i32.and
                  (i32.le_u
                    (i32.sub (i32.load8_u offset=3 (local.get $lhs)) (i32.const "2"))
                    (i32.const 2))
                  (i32.eq (i32.load8_u offset=4 (local.get $lhs)) (i32.const "x")))))
          (then (return (enum.get $Token.type.builtin))))
        (if (i32.and
              (i32.eq (local.get $len) (i32.const 7))
              (i32.and
                (i32.eq (i32.load (local.get $lhs)) (i32.const "dmat"))
                (i32.and
                  (i32.le_u
                    (i32.sub (i32.load8_u offset=4 (local.get $lhs)) (i32.const "2"))
                    (i32.const 2))
                  (i32.eq (i32.load8_u offset=5 (local.get $lhs)) (i32.const "x")))))
          (then (return (enum.get $Token.type.builtin))))))

    ;; Opaque sampler/image/texture families have many dimensional suffixes.
    (if (i32.and
          (i32.ge_u (local.get $len) (i32.const 7))
          (i64.eq
            (i64.and (i64.load (local.get $lhs)) (i64.const 0x00ffffffffffffff))
            (i64.const "sampler")))
      (then (return (enum.get $Token.type.builtin))))
    (if (i32.and
          (i32.ge_u (local.get $len) (i32.const 8))
          (i32.or
            (i64.eq (i64.load (local.get $lhs)) (i64.const "isampler"))
            (i64.eq (i64.load (local.get $lhs)) (i64.const "usampler"))))
      (then (return (enum.get $Token.type.builtin))))
    (if (i32.and
          (i32.ge_u (local.get $len) (i32.const 5))
          (i64.eq
            (i64.and (i64.load (local.get $lhs)) (i64.const 0x000000ffffffffff))
            (i64.const "image")))
      (then (return (enum.get $Token.type.builtin))))
    (if (i32.and
          (i32.ge_u (local.get $len) (i32.const 6))
          (i32.or
            (i64.eq
              (i64.and (i64.load (local.get $lhs)) (i64.const 0x0000ffffffffffff))
              (i64.const "iimage"))
            (i64.eq
              (i64.and (i64.load (local.get $lhs)) (i64.const 0x0000ffffffffffff))
              (i64.const "uimage"))))
      (then (return (enum.get $Token.type.builtin))))
    (if (i32.or
          (i32.and
            (i32.ge_u (local.get $len) (i32.const 8))
            (i64.eq
              (i64.and (i64.load (local.get $lhs)) (i64.const 0x00ffffffffffffff))
              (i64.const "texture")))
          (i32.and
            (i32.ge_u (local.get $len) (i32.const 7))
            (i64.eq
              (i64.and (i64.load (local.get $lhs)) (i64.const 0x00ffffffffffffff))
              (i64.const "coopmat"))))
      (then (return (enum.get $Token.type.builtin))))
    (if (i32.and
          (i32.ge_u (local.get $len) (i32.const 8))
          (i32.or
            (i64.eq (i64.load (local.get $lhs)) (i64.const "itexture"))
            (i64.eq (i64.load (local.get $lhs)) (i64.const "utexture"))))
      (then (return (enum.get $Token.type.builtin))))

    (enum.get $Token.none))

  (func $hlGlsl
    (local $c i32)
    (local $n i32)
    (local $lhs i32)
    (local $gap i32)
    (local $p i32)
    (local $word i32)
    (local $hl i32)
    (local $afterDot i32)
    (local $wantType i32)
    (local $include i32)
    (call $lexEmitLeadingContinuation)
    (block $done
      (loop $next
        (local.set $gap (global.get $ptr))
        (call $scanWhitespace)
        (call $emitGap (local.get $gap) (global.get $ptr))
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        (local.set $lhs (global.get $ptr))
        (local.set $c (i32.load8_u (global.get $ptr)))

        ;; `#directive`, with the whitespace before its name, is one preproc token.
        (if (i32.eq (local.get $c) (i32.const "#"))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (block $spaceDone
              (loop $space
                (br_if $spaceDone (i32.ge_u (global.get $ptr) (global.get $end)))
                (local.set $c (i32.load8_u (global.get $ptr)))
                (br_if $spaceDone (i32.and
                  (i32.ne (local.get $c) (i32.const 32))
                  (i32.ne (local.get $c) (i32.const 9))))
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                (br $space)))
            (local.set $word (global.get $ptr))
            (call $lexScanIdent)
            (local.set $include (i32.and
              (i32.eq (i32.sub (global.get $ptr) (local.get $word)) (i32.const 7))
              (i64.eq
                (i64.and (i64.load (local.get $word)) (i64.const 0x00ffffffffffffff))
                (i64.const "include"))))
            (call $emitTok (enum.get $Token.preproc) (local.get $lhs) (global.get $ptr))
            (local.set $afterDot (i32.const 0))
            (local.set $wantType (i32.const 0))
            (br $next)))

        ;; Angle-bracket include paths are strings, not comparison operators.
        (if (i32.and (local.get $include) (i32.eq (local.get $c) (i32.const "<")))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (block $headerDone
              (loop $header
                (br_if $headerDone (i32.ge_u (global.get $ptr) (global.get $end)))
                (local.set $c (i32.load8_u (global.get $ptr)))
                (if (i32.eq (local.get $c) (i32.const ">"))
                  (then
                    (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                    (br $headerDone)))
                (br_if $headerDone (i32.or
                  (i32.eq (local.get $c) (i32.const 10))
                  (i32.eq (local.get $c) (i32.const 13))))
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                (br $header)))
            (call $emitTok (enum.get $Token.string) (local.get $lhs) (global.get $ptr))
            (local.set $include (i32.const 0))
            (local.set $afterDot (i32.const 0))
            (local.set $wantType (i32.const 0))
            (br $next)))

        ;; Comments; Doxygen `///`, `//!`, `/**` and `/*!` are doc comments.
        (if (i32.eq (local.get $c) (i32.const "/"))
          (then
            (local.set $n (select
              (i32.load8_u offset=1 (global.get $ptr)) (i32.const 0)
              (i32.lt_u (i32.add (global.get $ptr) (i32.const 1)) (global.get $end))))
            (if (i32.eq (local.get $n) (i32.const "/"))
              (then
                (local.set $hl (enum.get $Token.comment))
                (if (i32.lt_u (i32.add (global.get $ptr) (i32.const 2)) (global.get $end))
                  (then
                    (local.set $n (i32.load8_u offset=2 (global.get $ptr)))
                    (if (i32.or
                          (i32.eq (local.get $n) (i32.const "/"))
                          (i32.eq (local.get $n) (i32.const "!")))
                      (then (local.set $hl (enum.get $Token.comment.doc))))))
                (call $lexLineComment (i32.const 2) (local.get $hl))
                (br $next)))
            (if (i32.eq (local.get $n) (i32.const "*"))
              (then
                (local.set $hl (enum.get $Token.comment))
                (if (i32.lt_u (i32.add (global.get $ptr) (i32.const 2)) (global.get $end))
                  (then
                    (local.set $n (i32.load8_u offset=2 (global.get $ptr)))
                    (if (i32.or
                          (i32.eq (local.get $n) (i32.const "*"))
                          (i32.eq (local.get $n) (i32.const "!")))
                      (then (local.set $hl (enum.get $Token.comment.doc))))))
                (call $lexBlockComment (i32.const 2) (local.get $hl))
                (br $next)))))

        (if (i32.or
              (i32.eq (local.get $c) (i32.const 34))
              (i32.eq (local.get $c) (i32.const 39)))
          (then
            (call $lexString (local.get $c) (i32.const 0) (enum.get $Token.string))
            (local.set $include (i32.const 0))
            (local.set $afterDot (i32.const 0))
            (local.set $wantType (i32.const 0))
            (br $next)))

        ;; A dot begins a number only when a bounded lookahead sees a digit.
        (if (i32.or
              (call $lexIsDigit (local.get $c))
              (i32.and
                (i32.eq (local.get $c) (i32.const "."))
                (i32.and
                  (i32.lt_u (i32.add (global.get $ptr) (i32.const 1)) (global.get $end))
                  (call $lexIsDigit (i32.load8_u offset=1 (global.get $ptr))))))
          (then
            (call $lexScanNumber)
            ;; The shared lexer keeps a dot only when a decimal digit follows.
            ;; Hex floats also permit `a-f` after it (`0x1.fp2`).
            (if (i32.and
                  (i32.and
                    (i32.lt_u (i32.add (local.get $lhs) (i32.const 1)) (global.get $end))
                    (i32.eq (i32.load8_u (local.get $lhs)) (i32.const "0")))
                  (i32.and
                    (i32.eq
                      (i32.or (i32.load8_u offset=1 (local.get $lhs)) (i32.const 32))
                      (i32.const "x"))
                    (i32.and
                      (i32.lt_u (global.get $ptr) (global.get $end))
                      (i32.eq (i32.load8_u (global.get $ptr)) (i32.const ".")))))
              (then
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                (call $lexScanNumber)))
            (call $emitTok (enum.get $Token.number) (local.get $lhs) (global.get $ptr))
            (local.set $include (i32.const 0))
            (local.set $afterDot (i32.const 0))
            (local.set $wantType (i32.const 0))
            (br $next)))

        (if (call $lexIsIdentStart (local.get $c))
          (then
            (call $lexScanIdent)
            (local.set $hl (call $glslWordHl (local.get $lhs) (global.get $ptr)))
            (if (i32.eq (local.get $hl) (enum.get $Token.none))
              (then
                (if (local.get $wantType)
                  (then (local.set $hl (enum.get $Token.type)))
                  (else
                    (if (i32.and
                          (i32.ge_u (i32.sub (global.get $ptr) (local.get $lhs)) (i32.const 3))
                          (i32.eq
                            (i32.and (i32.load (local.get $lhs)) (i32.const 0xffffff))
                            (i32.const "gl_")))
                      (then (local.set $hl (enum.get $Token.variable.special)))
                      (else
                        (local.set $p (call $lexSkipSpaceAt (global.get $ptr)))
                        (if (i32.and
                              (i32.lt_u (local.get $p) (global.get $end))
                              (i32.eq (i32.load8_u (local.get $p)) (i32.const "(")))
                          (then (local.set $hl (select
                            (enum.get $Token.function.method)
                            (enum.get $Token.function)
                            (local.get $afterDot))))
                          (else
                            (if (local.get $afterDot)
                              (then (local.set $hl (enum.get $Token.property)))
                              (else
                                (if (call $lexIsConstCase (local.get $lhs) (global.get $ptr))
                                  (then (local.set $hl (enum.get $Token.constant)))
                                  (else
                                    (if (i32.le_u
                                          (i32.sub
                                            (i32.load8_u (local.get $lhs)) (i32.const "A"))
                                          (i32.const 25))
                                      (then (local.set $hl (enum.get $Token.type)))
                                      (else (local.set $hl (enum.get $Token.variable))))))))))))))))
            (call $emitTok (local.get $hl) (local.get $lhs) (global.get $ptr))
            (local.set $wantType (i32.eq (local.get $hl) (enum.get $Token.keyword.declaration)))
            (local.set $afterDot (i32.const 0))
            (local.set $include (i32.const 0))
            (br $next)))

        (if (i32.or
              (i32.or
                (i32.eq (local.get $c) (i32.const "("))
                (i32.eq (local.get $c) (i32.const ")")))
              (i32.or
                (i32.or
                  (i32.eq (local.get $c) (i32.const "["))
                  (i32.eq (local.get $c) (i32.const "]")))
                (i32.or
                  (i32.eq (local.get $c) (i32.const "{"))
                  (i32.eq (local.get $c) (i32.const "}")))))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (call $emitTok (enum.get $Token.punctuation.bracket)
              (local.get $lhs) (global.get $ptr))
            (local.set $include (i32.const 0))
            (local.set $afterDot (i32.const 0))
            (local.set $wantType (i32.const 0))
            (br $next)))

        (if (i32.or
              (i32.or
                (i32.eq (local.get $c) (i32.const ","))
                (i32.eq (local.get $c) (i32.const ";")))
              (i32.or
                (i32.eq (local.get $c) (i32.const ":"))
                (i32.eq (local.get $c) (i32.const "."))))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (call $emitTok (enum.get $Token.punctuation.delimiter)
              (local.get $lhs) (global.get $ptr))
            (local.set $include (i32.const 0))
            (local.set $afterDot (i32.eq (local.get $c) (i32.const ".")))
            (local.set $wantType (i32.const 0))
            (br $next)))

        ;; Longest useful GLSL/C operator (one to three bytes).
        (if (i32.or
              (i32.or
                (i32.or
                  (i32.eq (local.get $c) (i32.const "+"))
                  (i32.eq (local.get $c) (i32.const "-")))
                (i32.or
                  (i32.eq (local.get $c) (i32.const "*"))
                  (i32.eq (local.get $c) (i32.const "/"))))
              (i32.or
                (i32.or
                  (i32.eq (local.get $c) (i32.const "%"))
                  (i32.eq (local.get $c) (i32.const "=")))
                (i32.or
                  (i32.or
                    (i32.eq (local.get $c) (i32.const "!"))
                    (i32.eq (local.get $c) (i32.const "<")))
                  (i32.or
                    (i32.or
                      (i32.eq (local.get $c) (i32.const ">"))
                      (i32.eq (local.get $c) (i32.const "&")))
                    (i32.or
                      (i32.or
                        (i32.eq (local.get $c) (i32.const "|"))
                        (i32.eq (local.get $c) (i32.const "^")))
                      (i32.or
                        (i32.or
                          (i32.eq (local.get $c) (i32.const "~"))
                          (i32.eq (local.get $c) (i32.const "?")))
                        (i32.eq (local.get $c) (i32.const 92))))))))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (if (i32.lt_u (global.get $ptr) (global.get $end))
              (then
                (local.set $n (i32.load8_u (global.get $ptr)))
                (if (i32.or
                      (i32.eq (local.get $n) (i32.const "="))
                      (i32.and
                        (i32.eq (local.get $n) (local.get $c))
                        (i32.or
                          (i32.or
                            (i32.eq (local.get $c) (i32.const "+"))
                            (i32.eq (local.get $c) (i32.const "-")))
                          (i32.or
                            (i32.or
                              (i32.eq (local.get $c) (i32.const "<"))
                              (i32.eq (local.get $c) (i32.const ">")))
                            (i32.or
                              (i32.eq (local.get $c) (i32.const "&"))
                              (i32.eq (local.get $c) (i32.const "|")))))))
                  (then
                    (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                    (if (i32.and
                          (i32.or
                            (i32.eq (local.get $c) (i32.const "<"))
                            (i32.eq (local.get $c) (i32.const ">")))
                          (i32.and
                            (i32.lt_u (global.get $ptr) (global.get $end))
                            (i32.eq (i32.load8_u (global.get $ptr)) (i32.const "="))))
                      (then (global.set $ptr
                        (i32.add (global.get $ptr) (i32.const 1)))))))))
            (call $emitTok (enum.get $Token.operator) (local.get $lhs) (global.get $ptr))
            (local.set $include (i32.const 0))
            (local.set $afterDot (i32.const 0))
            (local.set $wantType (i32.const 0))
            (br $next)))

        ;; Invalid control bytes are rare; batch them instead of emitting bytewise.
        (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
        (block $plainDone
          (loop $plain
            (br_if $plainDone (i32.ge_u (global.get $ptr) (global.get $end)))
            (local.set $c (i32.load8_u (global.get $ptr)))
            (br_if $plainDone (i32.or
              (i32.ge_u (local.get $c) (i32.const 32))
              (i32.le_u (i32.sub (local.get $c) (i32.const 9)) (i32.const 4))))
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (br $plain)))
        (call $emitTok (enum.get $Token.none) (local.get $lhs) (global.get $ptr))
        (local.set $include (i32.const 0))
        (local.set $afterDot (i32.const 0))
        (local.set $wantType (i32.const 0))
        (br $next))))
)
