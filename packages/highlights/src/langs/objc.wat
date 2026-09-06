(module
  (import "./c.wat")

  (func $objcByte (param $p i32) (result i32)
    (select (i32.load8_u (local.get $p)) (i32.const 0)
      (i32.lt_u (local.get $p) (global.get $end))))

  ;; Group order is the dispatch order in $objcWordHl below. Group 1 holds
  ;; the words that follow `@`; group 6 the property attributes, which are
  ;; keywords only inside the parens after `@property`. Everything C keeps
  ;; its classification from c.wat.
  (keyword-table $objcWords $mem.objcWords $mem.objcWords+1024
    (group ;; 1: compiler directives after `@`
      "end" "try" "defs" "catch" "class" "throw" "encode" "import" "public"
      "dynamic" "finally" "package" "private" "optional" "property" "protocol"
      "required" "selector" "available" "interface" "protected" "synthesize"
      "synchronized" "autoreleasepool" "implementation" "compatibility_alias")
    (group ;; 2: built-in types
      "id" "SEL" "IMP" "BOOL" "Class" "instancetype")
    (group "NO" "YES" "nil" "Nil")        ;; 3: built-in constants
    (group "self" "_cmd" "super")         ;; 4: special variables
    (group ;; 5: qualifiers and ownership keywords
      "in" "out" "inout" "byref" "bycopy" "oneway" "__weak" "__block"
      "__bridge" "__kindof" "__strong" "IBAction" "IBOutlet" "nonnull"
      "nullable" "_Nonnull" "_Nullable" "__nonnull" "__nullable"
      "__autoreleasing" "__bridge_retained" "__bridge_transfer"
      "__unsafe_unretained" "null_resettable" "null_unspecified")
    (group ;; 6: property attributes
      "copy" "weak" "atomic" "assign" "getter" "retain" "setter" "strong"
      "readonly" "readwrite" "nonatomic" "unsafe_unretained"))

  ;; Token in the low byte; bit 8 marks a directive that names a type next -
  ;; `@interface`, `@implementation`, `@protocol`, `@class` - and bit 9 the
  ;; `@property` directive. $at is 1 when the word followed `@`, $propAttrs
  ;; when it sits in a property attribute list. -1 means the word is left to
  ;; c.wat's classification.
  (func $objcWordHl (param $lhs i32) (param $rhs i32) (param $at i32) (param $propAttrs i32) (result i32)
    (local $g i32)
    (local $n i32)
    (local.set $g (keyword-table.get $objcWords (local.get $lhs) (local.get $rhs)))
    (if (local.get $at)
      (then
        (local.set $n (i32.sub (local.get $rhs) (local.get $lhs)))
        ;; @interface, @implementation, @protocol, and @class name a type
        (if (i32.eq (local.get $g) (i32.const 1))
          (then
            (if (i32.or
                  (i32.or
                    (i32.and
                      (i32.eq (local.get $n) (i32.const 9))
                      (i64.eq (i64.load (local.get $lhs)) (i64.const "interfac")))
                    (i32.and
                      (i32.eq (local.get $n) (i32.const 14))
                      (i64.eq (i64.load (local.get $lhs)) (i64.const "implemen"))))
                  (i32.or
                    (i32.and
                      (i32.eq (local.get $n) (i32.const 8))
                      (i64.eq (i64.load (local.get $lhs)) (i64.const "protocol")))
                    (i32.and
                      (i32.eq (local.get $n) (i32.const 5))
                      (i32.eq (i32.load (local.get $lhs)) (i32.const "clas")))))
              (then (return (i32.or (enum.get $Token.keyword) (i32.const 256)))))
            (if (i32.and
                  (i32.eq (local.get $n) (i32.const 8))
                  (i64.eq (i64.load (local.get $lhs)) (i64.const "property")))
              (then (return (i32.or (enum.get $Token.keyword) (i32.const 512)))))))
        ;; any other `@word` is a directive too
        (return (enum.get $Token.keyword))))
    (if (i32.eq (local.get $g) (i32.const 2))
      (then (return (enum.get $Token.type.builtin))))
    (if (i32.eq (local.get $g) (i32.const 3))
      (then (return (enum.get $Token.constant.builtin))))
    (if (i32.eq (local.get $g) (i32.const 4))
      (then (return (enum.get $Token.variable.special))))
    (if (i32.eq (local.get $g) (i32.const 5))
      (then (return (enum.get $Token.keyword))))
    (if (i32.and (i32.eq (local.get $g) (i32.const 6)) (local.get $propAttrs))
      (then (return (enum.get $Token.keyword))))
    (i32.const -1))

  ;; $midLine is 1 once a token sits on the current line, so `#` opens a
  ;; directive only at a line start. $expectType is 1 after a directive that
  ;; names a class or protocol. $propAttrs is 1 inside the parens after
  ;; `@property`. $declHead is 1 from a line-opening `-` or `+` to the `{`
  ;; or `;` of the method it declares, with $parens the paren depth inside
  ;; it and $declColon set once a selector part appeared, so the parts at
  ;; depth zero are the definition and a colon-less name the whole. $brackets
  ;; counts open `[` of message sends, where a name glued to `:` or ending
  ;; the send is the method. $member is 1 after `.` or `->`. All are
  ;; checkpointed.
  (func $hlObjc
    (local $c i32) (local $c2 i32) (local $c3 i32)
    (local $gap i32) (local $lhs i32) (local $rhs i32) (local $p i32)
    (local $kind i32) (local $hl i32) (local $midLine i32) (local $expectType i32)
    (local $propAttrs i32) (local $declHead i32) (local $parens i32)
    (local $brackets i32) (local $member i32) (local $prev i32) (local $nl i32)
    (local $declColon i32)
    (call $lexEmitLeadingContinuation)
    (block $done
      (loop $next
        (local.set $gap (global.get $ptr))
        (call $scanWhitespace)
        (local.set $nl (i32.lt_u
          (call $scanFindSpecial (local.get $gap) (global.get $ptr) (i32.const 10) (i32.const 0) (i32.const 1))
          (global.get $ptr)))
        (if (local.get $nl)
          (then
            (local.set $midLine (i32.const 0))
            (local.set $declHead (i32.const 0))))
        (call $emitGap (local.get $gap) (global.get $ptr))
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        (local.set $lhs (global.get $ptr))
        (local.set $c (i32.load8_u (global.get $ptr)))
        (local.set $c2 (call $objcByte (i32.add (global.get $ptr) (i32.const 1))))
        (local.set $c3 (call $objcByte (i32.add (global.get $ptr) (i32.const 2))))
        ;; the byte before this token on the same line, or 0 at a line start;
        ;; a line-fed chunk cannot look back past its start either
        (local.set $prev (select
          (i32.load8_u (i32.sub (local.get $gap) (i32.const 1))) (i32.const 0)
          (i32.and (i32.eqz (local.get $nl)) (i32.gt_u (local.get $gap) (global.get $srcBase)))))

        (if (i32.and (i32.eq (local.get $c) (i32.const "/")) (i32.eq (local.get $c2) (i32.const "/")))
          (then
            (call $lexLineComment (i32.const 2) (select
              (enum.get $Token.comment.doc) (enum.get $Token.comment)
              (i32.or (i32.eq (local.get $c3) (i32.const "/")) (i32.eq (local.get $c3) (i32.const "!")))))
            (br $next)))
        (if (i32.and (i32.eq (local.get $c) (i32.const "/")) (i32.eq (local.get $c2) (i32.const "*")))
          (then
            (call $lexBlockComment (i32.const 2) (select
              (enum.get $Token.comment.doc) (enum.get $Token.comment)
              (i32.or
                (i32.eq (local.get $c3) (i32.const "!"))
                (i32.and (i32.eq (local.get $c3) (i32.const "*"))
                  (i32.ne (call $objcByte (i32.add (global.get $ptr) (i32.const 3))) (i32.const "/"))))))
            (br $next)))

        ;; a directive owns its line; `#import` splits off its header path
        (if (i32.and (i32.eqz (local.get $midLine)) (i32.eq (local.get $c) (i32.const "#")))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (call $scanToLineEnd)
            (if (i32.eqz (call $lexEmitIncludeDirective (local.get $lhs) (global.get $ptr)))
              (then (call $emitTok (enum.get $Token.preproc) (local.get $lhs) (global.get $ptr))))
            (local.set $midLine (i32.const 1))
            (br $next)))
        (local.set $midLine (i32.const 1))

        ;; `@"literal"`, `@(box)`, `@[array]`, `@{dict}`, `@42`, and `@word`
        (if (i32.eq (local.get $c) (i32.const "@"))
          (then
            (if (i32.eq (local.get $c2) (i32.const 34))
              (then
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                (call $emitTok (enum.get $Token.string) (local.get $lhs) (global.get $ptr))
                (call $lexString (i32.const 34) (i32.const 0) (enum.get $Token.string))
                (local.set $member (i32.const 0))
                (br $next)))
            (if (call $lexIsIdentStart (local.get $c2))
              (then
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                (call $lexScanIdent)
                (local.set $kind (call $objcWordHl
                  (i32.add (local.get $lhs) (i32.const 1)) (global.get $ptr) (i32.const 1) (i32.const 0)))
                (call $emitTok (i32.and (local.get $kind) (i32.const 255)) (local.get $lhs) (global.get $ptr))
                (local.set $expectType (i32.and (i32.shr_u (local.get $kind) (i32.const 8)) (i32.const 1)))
                ;; `@property (attrs)`: the attribute list follows
                (local.set $propAttrs (i32.and (i32.shr_u (local.get $kind) (i32.const 9)) (i32.const 1)))
                (local.set $member (i32.const 0))
                (br $next)))
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (call $emitTok (enum.get $Token.punctuation.special) (local.get $lhs) (global.get $ptr))
            (local.set $member (i32.const 0))
            (br $next)))

        ;; strings and character literals, with C prefixes
        (if (i32.or (i32.eq (local.get $c) (i32.const 34)) (i32.eq (local.get $c) (i32.const 39)))
          (then
            (call $lexString (local.get $c) (i32.const 0) (enum.get $Token.string))
            (local.set $member (i32.const 0))
            (br $next)))

        (if (call $lexIsIdentStart (local.get $c))
          (then
            (call $lexScanIdent)
            (local.set $rhs (global.get $ptr))
            (if (i32.and
                  (i32.lt_u (global.get $ptr) (global.get $end))
                  (i32.and
                    (i32.eq (i32.sub (local.get $rhs) (local.get $lhs)) (i32.const 1))
                    (i32.and
                      (i32.or
                        (i32.eq (local.get $c) (i32.const "L"))
                        (i32.or (i32.eq (local.get $c) (i32.const "u")) (i32.eq (local.get $c) (i32.const "U"))))
                      (i32.or
                        (i32.eq (i32.load8_u (global.get $ptr)) (i32.const 34))
                        (i32.eq (i32.load8_u (global.get $ptr)) (i32.const 39))))))
              (then
                (call $emitTok (enum.get $Token.string) (local.get $lhs) (local.get $rhs))
                (call $lexString (i32.load8_u (global.get $ptr)) (i32.const 0) (enum.get $Token.string))
                (local.set $member (i32.const 0))
                (br $next)))
            (local.set $p (call $lexSkipSpaceAt (local.get $rhs)))
            (local.set $kind (select (i32.const -1)
              (call $objcWordHl (local.get $lhs) (local.get $rhs) (i32.const 0) (local.get $propAttrs))
              (local.get $member)))
            (if (i32.ge_s (local.get $kind) (i32.const 0))
              (then (local.set $hl (local.get $kind)))
              (else
                (if (local.get $expectType)
                  (then
                    (local.set $hl (enum.get $Token.type))
                    (local.set $expectType (i32.const 0)))
                  (else
                    ;; a selector part is glued to its colon; the last part of
                    ;; a unary send follows the receiver or a nested send
                    (if (i32.and
                          (i32.eq (call $objcByte (local.get $rhs)) (i32.const ":"))
                          (i32.ne (call $objcByte (i32.add (local.get $rhs) (i32.const 1))) (i32.const ":")))
                      (then
                        (local.set $hl (select
                          (enum.get $Token.function.definition) (enum.get $Token.function.method)
                          (i32.and (local.get $declHead) (i32.eqz (local.get $parens)))))
                        (if (local.get $declHead) (then (local.set $declColon (i32.const 1)))))
                      (else
                        ;; a unary method has no colon: its name ends the head
                        (if (i32.and
                              (i32.and (local.get $declHead) (i32.eqz (local.get $parens)))
                              (i32.and
                                (i32.eqz (local.get $declColon))
                                (i32.or
                                  (i32.eq (call $objcByte (local.get $p)) (i32.const ";"))
                                  (i32.eq (call $objcByte (local.get $p)) (i32.const "{")))))
                          (then (local.set $hl (enum.get $Token.function.definition)))
                          (else
                            (if (i32.and
                                  (i32.and
                                    (i32.ne (local.get $brackets) (i32.const 0))
                                    (i32.eq (call $objcByte (local.get $p)) (i32.const "]")))
                                  (i32.and
                                    (i32.lt_u (local.get $gap) (local.get $lhs))
                                    (i32.or
                                      (call $lexIsIdentContinue (local.get $prev))
                                      (i32.or (i32.eq (local.get $prev) (i32.const "]")) (i32.eq (local.get $prev) (i32.const ")"))))))
                              (then (local.set $hl (enum.get $Token.function.method)))
                              (else
                                (if (local.get $member)
                                  (then (local.set $hl (select
                                    (enum.get $Token.function.method) (enum.get $Token.property)
                                    (i32.eq (call $objcByte (local.get $p)) (i32.const "(")))))
                                  (else (local.set $hl (call $cWordHl (local.get $lhs) (local.get $rhs)))))))))))))))
            (call $emitTok (local.get $hl) (local.get $lhs) (local.get $rhs))
            (local.set $member (i32.const 0))
            (br $next)))

        (if (i32.or (call $lexIsDigit (local.get $c))
                    (i32.and (i32.eq (local.get $c) (i32.const ".")) (call $lexIsDigit (local.get $c2))))
          (then
            (call $cScanNumber)
            (call $emitTok (enum.get $Token.number) (local.get $lhs) (global.get $ptr))
            (local.set $member (i32.const 0))
            (br $next)))

        (if (byteset.get "()[]{}" (local.get $c))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (call $emitTok (enum.get $Token.punctuation.bracket) (local.get $lhs) (global.get $ptr))
            (if (i32.eq (local.get $c) (i32.const "("))
              (then (local.set $parens (i32.add (local.get $parens) (i32.const 1)))))
            (if (i32.eq (local.get $c) (i32.const ")"))
              (then
                (if (local.get $parens)
                  (then (local.set $parens (i32.sub (local.get $parens) (i32.const 1)))))
                (if (i32.eqz (local.get $parens))
                  (then (local.set $propAttrs (i32.const 0))))))
            (if (i32.eq (local.get $c) (i32.const "["))
              (then (local.set $brackets (i32.add (local.get $brackets) (i32.const 1)))))
            (if (i32.and (i32.eq (local.get $c) (i32.const "]")) (i32.ne (local.get $brackets) (i32.const 0)))
              (then (local.set $brackets (i32.sub (local.get $brackets) (i32.const 1)))))
            (if (i32.or (i32.eq (local.get $c) (i32.const "{")) (i32.eq (local.get $c) (i32.const "}")))
              (then
                (local.set $declHead (i32.const 0))
                (local.set $parens (i32.const 0))
                (local.set $expectType (i32.const 0))))
            (local.set $member (i32.const 0))
            (br $next)))
        (if (i32.or
              (i32.or (i32.eq (local.get $c) (i32.const ",")) (i32.eq (local.get $c) (i32.const ";")))
              (i32.eq (local.get $c) (i32.const ":")))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (call $emitTok (enum.get $Token.punctuation.delimiter) (local.get $lhs) (global.get $ptr))
            (if (i32.eq (local.get $c) (i32.const ";"))
              (then
                (local.set $declHead (i32.const 0))
                (local.set $expectType (i32.const 0))))
            (local.set $member (i32.const 0))
            (br $next)))
        (if (i32.or
              (i32.eq (local.get $c) (i32.const "."))
              (i32.and (i32.eq (local.get $c) (i32.const "-")) (i32.eq (local.get $c2) (i32.const ">"))))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (select (i32.const 2) (i32.const 1)
              (i32.eq (local.get $c) (i32.const "-")))))
            (call $emitTok (select (enum.get $Token.operator) (enum.get $Token.punctuation.delimiter)
              (i32.eq (local.get $c) (i32.const "-"))) (local.get $lhs) (global.get $ptr))
            (local.set $member (i32.const 1))
            (br $next)))

        ;; a `-` or `+` opening a line before `(` declares a method
        (if (i32.and
              (i32.or (i32.eq (local.get $c) (i32.const "-")) (i32.eq (local.get $c) (i32.const "+")))
              (i32.and
                (i32.eqz (local.get $prev))
                (i32.eq (call $objcByte (call $lexSkipSpaceAt (i32.add (global.get $ptr) (i32.const 1)))) (i32.const "("))))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (call $emitTok (enum.get $Token.operator) (local.get $lhs) (global.get $ptr))
            (local.set $declHead (i32.const 1))
            (local.set $declColon (i32.const 0))
            (local.set $parens (i32.const 0))
            (local.set $member (i32.const 0))
            (br $next)))

        (if (call $cIsOp (local.get $c))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (if (i32.or (i32.eq (local.get $c2) (i32.const "="))
                        (i32.and (i32.eq (local.get $c) (local.get $c2))
                          (byteset.get "&+-<>|" (local.get $c))))
              (then
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                (if (i32.and
                      (i32.or (i32.eq (local.get $c) (i32.const "<")) (i32.eq (local.get $c) (i32.const ">")))
                      (i32.eq (call $objcByte (global.get $ptr)) (i32.const "=")))
                  (then (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))))))
            (call $emitTok (enum.get $Token.operator) (local.get $lhs) (global.get $ptr))
            (local.set $member (i32.const 0))
            (br $next)))

        (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
        (call $emitTok (enum.get $Token.none) (local.get $lhs) (global.get $ptr))
        (local.set $member (i32.const 0))
        (br $next))))
)
