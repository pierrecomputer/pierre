(module
  (import "../common.wat")

  ;; djb2-xor hashes are computed while the identifier is scanned. This keeps
  ;; the keyword path allocation-free and avoids a static table/scratch range.
  (func $glslWordHl (param $lhs i32) (param $rhs i32) (param $hash i32) (result i32)
    (local $len i32)
    (local $last i32)
    (local $w i32)
    (local.set $len (i32.sub (local.get $rhs) (local.get $lhs)))

    (if (i32.or
          (i32.eq (local.get $hash) (i32.const 0x7c735233)) ;; true
          (i32.eq (local.get $hash) (i32.const 0x0a30b018))) ;; false
      (then (return (enum.get $Token.boolean))))

    ;; Flow keywords, including the ray-tracing control statements.
    (if (i32.or
          (i32.or
            (i32.eq (local.get $hash) (i32.const 0x0a7dd9fa)) ;; break
            (i32.eq (local.get $hash) (i32.const 0x7c70c251))) ;; case
          (i32.or
            (i32.eq (local.get $hash) (i32.const 0x8f091da4)) ;; continue
            (i32.eq (local.get $hash) (i32.const 0x9ce67dce)))) ;; default
      (then (return (enum.get $Token.keyword.control))))
    (if (i32.or
          (i32.or
            (i32.eq (local.get $hash) (i32.const 0x00596d8e)) ;; do
            (i32.eq (local.get $hash) (i32.const 0x7c6b8f5a))) ;; else
          (i32.or
            (i32.eq (local.get $hash) (i32.const 0x0b8737be)) ;; for
            (i32.eq (local.get $hash) (i32.const 0x00596f2a)))) ;; if
      (then (return (enum.get $Token.keyword.control))))
    (if (i32.or
          (i32.or
            (i32.eq (local.get $hash) (i32.const 0x7e985a8f)) ;; return
            (i32.eq (local.get $hash) (i32.const 0x7fb03db7))) ;; switch
          (i32.or
            (i32.eq (local.get $hash) (i32.const 0x0b66c65a)) ;; while
            (i32.eq (local.get $hash) (i32.const 0xa791710f)))) ;; discard
      (then (return (enum.get $Token.keyword.control))))
    (if (i32.or
          (i32.or
            (i32.eq (local.get $hash) (i32.const 0x42d58377)) ;; demote
            (i32.eq (local.get $hash) (i32.const 0x426fafdc))) ;; terminateInvocation
          (i32.or
            (i32.eq (local.get $hash) (i32.const 0x30120d7f)) ;; terminateRayEXT
            (i32.eq (local.get $hash) (i32.const 0xac1f946e)))) ;; terminateRayNV
      (then (return (enum.get $Token.keyword.control))))
    (if (i32.or
          (i32.eq (local.get $hash) (i32.const 0x4d08dd79)) ;; ignoreIntersectionEXT
          (i32.eq (local.get $hash) (i32.const 0x199b6ca8))) ;; ignoreIntersectionNV
      (then (return (enum.get $Token.keyword.control))))

    (if (i32.eq (local.get $hash) (i32.const 0x7fa39012)) ;; struct
      (then (return (enum.get $Token.keyword.declaration))))

    ;; Scalar and extension scalar types.
    (if (i32.or
          (i32.or
            (i32.eq (local.get $hash) (i32.const 0x7c76f231)) ;; void
            (i32.eq (local.get $hash) (i32.const 0x7c703ceb))) ;; bool
          (i32.or
            (i32.eq (local.get $hash) (i32.const 0x0b875316)) ;; int
            (i32.eq (local.get $hash) (i32.const 0x7c743de3)))) ;; uint
      (then (return (enum.get $Token.type.builtin))))
    (if (i32.or
          (i32.or
            (i32.eq (local.get $hash) (i32.const 0x0a364435)) ;; float
            (i32.eq (local.get $hash) (i32.const 0x4348b570))) ;; double
          (i32.or
            (i32.eq (local.get $hash) (i32.const 0xf0cfc9c1)) ;; atomic_uint
            (i32.eq (local.get $hash) (i32.const 0x5fb6f265)))) ;; int8_t
      (then (return (enum.get $Token.type.builtin))))
    (if (i32.or
          (i32.or
            (i32.eq (local.get $hash) (i32.const 0xb9e47a70)) ;; uint8_t
            (i32.eq (local.get $hash) (i32.const 0x5690fb7a))) ;; int16_t
          (i32.or
            (i32.eq (local.get $hash) (i32.const 0xf66f84cf)) ;; uint16_t
            (i32.eq (local.get $hash) (i32.const 0x569002bc)))) ;; int32_t
      (then (return (enum.get $Token.type.builtin))))
    (if (i32.or
          (i32.or
            (i32.eq (local.get $hash) (i32.const 0xf66e6c09)) ;; uint32_t
            (i32.eq (local.get $hash) (i32.const 0x568c2d1f))) ;; int64_t
          (i32.or
            (i32.eq (local.get $hash) (i32.const 0xf67210aa)) ;; uint64_t
            (i32.eq (local.get $hash) (i32.const 0x077f4b19)))) ;; float16_t
      (then (return (enum.get $Token.type.builtin))))
    (if (i32.or
          (i32.or
            (i32.eq (local.get $hash) (i32.const 0x078063df)) ;; float32_t
            (i32.eq (local.get $hash) (i32.const 0x077fd77c))) ;; float64_t
          (i32.or
            (i32.eq (local.get $hash) (i32.const 0xaa278166)) ;; subpassInput
            (i32.eq (local.get $hash) (i32.const 0x3321232f)))) ;; isubpassInput
      (then (return (enum.get $Token.type.builtin))))
    (if (i32.or
          (i32.or
            (i32.eq (local.get $hash) (i32.const 0xeed73733)) ;; usubpassInput
            (i32.eq (local.get $hash) (i32.const 0x69d779fb))) ;; accelerationStructureEXT
          (i32.eq (local.get $hash) (i32.const 0x4fac0b8c))) ;; rayQueryEXT
      (then (return (enum.get $Token.type.builtin))))

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

    ;; Storage, interpolation, precision and extension qualifiers.
    (if (i32.or
          (i32.or
            (i32.eq (local.get $hash) (i32.const 0x0a8bffc0)) ;; const
            (i32.eq (local.get $hash) (i32.const 0x00596f22))) ;; in
          (i32.or
            (i32.eq (local.get $hash) (i32.const 0x0b875f2b)) ;; out
            (i32.eq (local.get $hash) (i32.const 0x0aa84fac)))) ;; inout
      (then (return (enum.get $Token.keyword))))
    (if (i32.or
          (i32.or
            (i32.eq (local.get $hash) (i32.const 0xc04bf501)) ;; uniform
            (i32.eq (local.get $hash) (i32.const 0x8198076c))) ;; shared
          (i32.or
            (i32.eq (local.get $hash) (i32.const 0x74923ad9)) ;; attribute
            (i32.eq (local.get $hash) (i32.const 0x26635b19)))) ;; varying
      (then (return (enum.get $Token.keyword))))
    (if (i32.or
          (i32.or
            (i32.eq (local.get $hash) (i32.const 0x5a6ca0e5)) ;; buffer
            (i32.eq (local.get $hash) (i32.const 0x890f5e69))) ;; coherent
          (i32.or
            (i32.eq (local.get $hash) (i32.const 0xdf12d9c5)) ;; volatile
            (i32.eq (local.get $hash) (i32.const 0x7f9a6ad9)))) ;; restrict
      (then (return (enum.get $Token.keyword))))
    (if (i32.or
          (i32.or
            (i32.eq (local.get $hash) (i32.const 0x9f708903)) ;; readonly
            (i32.eq (local.get $hash) (i32.const 0xb15cc82c))) ;; writeonly
          (i32.or
            (i32.eq (local.get $hash) (i32.const 0x5538d7df)) ;; layout
            (i32.eq (local.get $hash) (i32.const 0xb2449b49)))) ;; centroid
      (then (return (enum.get $Token.keyword))))
    (if (i32.or
          (i32.or
            (i32.eq (local.get $hash) (i32.const 0x7c6e427a)) ;; flat
            (i32.eq (local.get $hash) (i32.const 0x813abc47))) ;; smooth
          (i32.or
            (i32.eq (local.get $hash) (i32.const 0xb1f00308)) ;; noperspective
            (i32.eq (local.get $hash) (i32.const 0x0b2f9e8b)))) ;; patch
      (then (return (enum.get $Token.keyword))))
    (if (i32.or
          (i32.or
            (i32.eq (local.get $hash) (i32.const 0x80f54c03)) ;; sample
            (i32.eq (local.get $hash) (i32.const 0x620738d5))) ;; invariant
          (i32.or
            (i32.eq (local.get $hash) (i32.const 0x6add655e)) ;; precise
            (i32.eq (local.get $hash) (i32.const 0x0a9ad1fb)))) ;; highp
      (then (return (enum.get $Token.keyword))))
    (if (i32.or
          (i32.or
            (i32.eq (local.get $hash) (i32.const 0x48598ae8)) ;; mediump
            (i32.eq (local.get $hash) (i32.const 0x7c6f2521))) ;; lowp
          (i32.or
            (i32.eq (local.get $hash) (i32.const 0x97cc0ff3)) ;; precision
            (i32.eq (local.get $hash) (i32.const 0x5b9b85df)))) ;; subroutine
      (then (return (enum.get $Token.keyword))))
    (if (i32.or
          (i32.or
            (i32.eq (local.get $hash) (i32.const 0x49ddb468)) ;; rayPayloadEXT
            (i32.eq (local.get $hash) (i32.const 0x3843254f))) ;; rayPayloadInEXT
          (i32.or
            (i32.eq (local.get $hash) (i32.const 0x0a7722a5)) ;; hitAttributeEXT
            (i32.eq (local.get $hash) (i32.const 0xad0e6ad4)))) ;; callableDataEXT
      (then (return (enum.get $Token.keyword))))
    (if (i32.or
          (i32.or
            (i32.eq (local.get $hash) (i32.const 0x2a2bb273)) ;; callableDataInEXT
            (i32.eq (local.get $hash) (i32.const 0xc2118288))) ;; shaderRecordEXT
          (i32.or
            (i32.eq (local.get $hash) (i32.const 0x769a1e19)) ;; rayPayloadNV
            (i32.eq (local.get $hash) (i32.const 0x85956ede)))) ;; rayPayloadInNV
      (then (return (enum.get $Token.keyword))))
    (if (i32.or
          (i32.or
            (i32.eq (local.get $hash) (i32.const 0x93b607f4)) ;; hitAttributeNV
            (i32.eq (local.get $hash) (i32.const 0xb7ab1a65))) ;; callableDataNV
          (i32.or
            (i32.eq (local.get $hash) (i32.const 0x4eda87e2)) ;; callableDataInNV
            (i32.eq (local.get $hash) (i32.const 0x7a3e9839)))) ;; shaderRecordNV
      (then (return (enum.get $Token.keyword))))
    (if (i32.or
          (i32.or
            (i32.eq (local.get $hash) (i32.const 0x514be348)) ;; require
            (i32.eq (local.get $hash) (i32.const 0x455ede04))) ;; enable
          (i32.or
            (i32.eq (local.get $hash) (i32.const 0x7c7752af)) ;; warn
            (i32.eq (local.get $hash) (i32.const 0xa7907691)))) ;; disable
      (then (return (enum.get $Token.keyword))))
    (if (i32.or
          (i32.or
            (i32.eq (local.get $hash) (i32.const 0x518da1fa)) ;; typedef
            (i32.eq (local.get $hash) (i32.const 0x7c6b8616))) ;; enum
          (i32.eq (local.get $hash) (i32.const 0x0afd7cf6))) ;; union
      (then (return (enum.get $Token.keyword))))

    (enum.get $Token.none))

  (func $hlGlsl
    (local $c i32)
    (local $n i32)
    (local $lhs i32)
    (local $gap i32)
    (local $p i32)
    (local $word i32)
    (local $hash i32)
    (local $hl i32)
    (local $afterDot i32)
    (local $wantType i32)
    (local $include i32)
    (call $lexEmitLeadingContinuation)
    (block $done
      (loop $next
        (local.set $gap (global.get $ptr))
        (call $lexScanWhitespace)
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
            (local.set $hash (i32.const 5381))
            (local.set $p (local.get $lhs))
            (block $hashDone
              (loop $hashLoop
                (br_if $hashDone (i32.ge_u (local.get $p) (global.get $ptr)))
                (local.set $c (i32.load8_u (local.get $p)))
                (local.set $hash (i32.xor
                  (i32.mul (local.get $hash) (i32.const 33)) (local.get $c)))
                (local.set $p (i32.add (local.get $p) (i32.const 1)))
                (br $hashLoop)))
            (local.set $hl (call $glslWordHl
              (local.get $lhs) (global.get $ptr) (local.get $hash)))
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
