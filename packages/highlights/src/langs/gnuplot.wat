(module
  (import "../common.wat")
  (import "./dockerfile.wat")

  ;; Group order is the dispatch order in $hlGnuplot. Axis-prefixed `set` options
  ;; (`xlabel`, `y2range`) hold the bare option.
  (keyword-table $gnuplotWords $mem.gnuplotWords $mem.prismaWords
    (group "set" "unset" "show") ;; 1: an option follows
    (group "plot" "splot" "replot" "fit") ;; 2: plot modifiers follow
    (group ;; 3: other commands
      "load" "print" "printerr" "pause" "reset" "call" "cd" "clear" "exit" "quit" "help"
      "save" "eval" "system" "shell" "pwd" "reread" "refresh" "history" "bind"
      "array" "import" "test" "undefine" "toggle")
    (group "if" "else" "do" "for" "while" "break" "continue" "in" "sum") ;; 4: control flow
    (group ;; 5: `set` options
      "terminal" "term" "output" "label" "range" "tics" "data" "zeroaxis" "key" "grid"
      "style" "logscale" "log" "format" "border" "origin" "multiplot" "samples" "isosamples"
      "view" "pm3d" "palette" "colorbox" "datafile" "arrow" "object" "boxwidth" "autoscale"
      "contour" "dgrid3d" "polar" "parametric" "margins" "lmargin" "rmargin" "tmargin"
      "bmargin" "timefmt" "table" "encoding" "mouse" "decimalsign" "dummy" "angles")
    (group ;; 6: plot modifiers, which are also `set` options
      "using" "with" "title" "notitle" "index" "every" "smooth" "axes" "via" "linewidth"
      "lw" "linecolor" "lc" "linetype" "lt" "pointtype" "pt" "ps"
      "dt" "linestyle" "ls" "fillstyle" "fs" "fill" "rgb" "font" "offset" "size" "binary" "matrix")
    (group ;; 7: plot styles
      "lines" "points" "linespoints" "lp" "dots" "impulses" "boxes" "histograms" "steps"
      "errorbars" "yerrorbars" "xerrorbars" "filledcurves" "vectors" "labels" "candlesticks")
    (group "pi" "NaN")) ;; 8: constants

  ;; $stmt: 1 at a statement start. $cmd: 1 after `set`, `unset`, or `show`, 2 in
  ;; a plot or fit command (one-letter modifiers count), 3 in a function's
  ;; parameters.
  (func $hlGnuplot
    (local $c i32)
    (local $c2 i32)
    (local $gap i32)
    (local $lhs i32)
    (local $rhs i32)
    (local $p i32)
    (local $pc i32)
    (local $g i32)
    (local $hl i32)
    (local $atStmt i32)
    (local $stmt i32)
    (local $cmd i32)
    (local.set $stmt (i32.const 1))
    (call $lexEmitLeadingContinuation)
    (block $done
      (loop $next
        (local.set $gap (global.get $ptr))
        (call $scanWhitespace)
        (if (call $lexGapHasBreak (local.get $gap) (global.get $ptr))
          (then
            (local.set $stmt (i32.const 1))
            (local.set $cmd (i32.const 0))))
        (call $emitGap (local.get $gap) (global.get $ptr))
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        (local.set $lhs (global.get $ptr))
        (local.set $c (i32.load8_u (local.get $lhs)))
        (local.set $c2 (call $templateByte (i32.add (local.get $lhs) (i32.const 1))))
        (local.set $atStmt (local.get $stmt))
        (local.set $stmt (i32.const 0))

        (if (i32.eq (local.get $c) (i32.const "#"))
          (then
            (call $lexLineComment (i32.const 1) (enum.get $Token.comment))
            (br $next)))
        (if (i32.eq (local.get $c) (i32.const 34))
          (then
            (call $lexString (i32.const 34) (i32.const 0) (enum.get $Token.string))
            (br $next)))
        (if (i32.eq (local.get $c) (i32.const 39))
          (then
            (call $lexRawString (i32.const 39) (i32.const 0) (enum.get $Token.string))
            (br $next)))
        (if (i32.eq (local.get $c) (i32.const "`"))
          (then
            (call $lexRawString (i32.const "`") (i32.const 0) (enum.get $Token.string.special))
            (br $next)))
        (if (i32.eq (local.get $c) (i32.const 92))
          (then
            (br_if $next (call $dockerLineJoin))))
        (if
          (i32.and
            (i32.or (i32.eq (local.get $c) (i32.const "$")) (i32.eq (local.get $c) (i32.const "@")))
            (call $lexIsIdentContinue (local.get $c2)))
          (then
            (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
            (call $scanIdentRun (i32.const "_"))
            (call $emitTok (enum.get $Token.variable.special) (local.get $lhs) (global.get $ptr))
            (local.set $p (call $lexSkipSpaceAt (global.get $ptr)))
            (if
              (i32.and
                (local.get $atStmt)
                (i32.and
                  (i32.eq (call $templateByte (local.get $p)) (i32.const "<"))
                  (i32.eq (call $templateByte (i32.add (local.get $p) (i32.const 1))) (i32.const "<"))))
              (then
                (local.set $rhs (call $lexSkipSpaceAt (i32.add (local.get $p) (i32.const 2))))
                (if (call $lexIsIdentStart (call $templateByte (local.get $rhs)))
                  (then
                    (call $emitGap (global.get $ptr) (local.get $p))
                    (global.set $ptr (i32.add (local.get $p) (i32.const 2)))
                    (call $emitTok (enum.get $Token.operator) (local.get $p) (global.get $ptr))
                    (call $emitGap (global.get $ptr) (local.get $rhs))
                    (global.set $ptr (local.get $rhs))
                    (call $scanIdentRun (i32.const "_"))
                    (call $emitTok (enum.get $Token.constant) (local.get $rhs) (global.get $ptr))
                    ;; with more text after the delimiter, the main loop lexes the skipped blanks
                    (local.set $p (global.get $ptr))
                    (local.set $stmt
                      (call $dockerHeredoc
                        (local.get $p)
                        (local.get $rhs)
                        (i32.sub (local.get $p) (local.get $rhs))
                        (i32.const 0)))
                    (if (i32.eqz (local.get $stmt))
                      (then (global.set $ptr (local.get $p))))))))
            (br $next)))

        (if (i32.and (call $lexIsIdentStart (local.get $c)) (i32.ne (local.get $c) (i32.const "$")))
          (then
            (call $scanIdentRun (i32.const "_"))
            (local.set $rhs (global.get $ptr))
            (local.set $pc (call $templateByte (call $lexSkipSpaceAt (local.get $rhs))))
            (local.set $g (keyword-table.get $gnuplotWords (local.get $lhs) (local.get $rhs)))
            (if (i32.and (i32.eq (local.get $cmd) (i32.const 1)) (i32.eqz (local.get $g)))
              (then
                (local.set $p (i32.add (local.get $lhs) (i32.eq (local.get $c) (i32.const "m"))))
                (if (i32.eq (i32.load16_u (local.get $p)) (i32.const 0x6263))
                  (then (local.set $p (i32.add (local.get $p) (i32.const 2))))
                  (else
                    (if (i32.le_u (i32.sub (i32.load8_u (local.get $p)) (i32.const "x")) (i32.const 2))
                      (then
                        (local.set $p (i32.add (local.get $p) (i32.const 1)))
                        (local.set $p
                          (i32.add (local.get $p) (i32.eq (i32.load8_u (local.get $p)) (i32.const "2"))))))))
                (if (i32.lt_u (local.get $p) (local.get $rhs))
                  (then
                    (local.set $g (keyword-table.get $gnuplotWords (local.get $p) (local.get $rhs)))))))
            (local.set $hl (enum.get $Token.variable))
            (if (local.get $atStmt)
              (then
                (if (i32.and (i32.ne (local.get $g) (i32.const 0)) (i32.le_u (local.get $g) (i32.const 3)))
                  (then
                    (local.set $hl (enum.get $Token.keyword))
                    (local.set $cmd (select (local.get $g) (i32.const 0) (i32.le_u (local.get $g) (i32.const 2))))))
                (if (i32.and (i32.eqz (local.get $g)) (i32.eq (local.get $pc) (i32.const "(")))
                  (then
                    (local.set $hl (enum.get $Token.function.definition))
                    (local.set $cmd (i32.const 3)))))
              (else
                (if (i32.eq (local.get $cmd) (i32.const 1))
                  (then
                    (if (i32.and (i32.ge_u (local.get $g) (i32.const 5)) (i32.le_u (local.get $g) (i32.const 6)))
                      (then (local.set $hl (enum.get $Token.property))))
                    (local.set $cmd (i32.const 0)))
                  (else
                    (if (i32.eq (local.get $cmd) (i32.const 3))
                      (then (local.set $hl (enum.get $Token.variable.parameter)))
                      (else
                        (if (i32.eq (local.get $g) (i32.const 6))
                          (then (local.set $hl (enum.get $Token.attribute))))
                        ;; `l` and `p` may end an item, but not the `t` in `sin(t)`
                        (if
                          (i32.and
                            (i32.and
                              (i32.eq (local.get $cmd) (i32.const 2))
                              (i32.eq (local.get $rhs) (i32.add (local.get $lhs) (i32.const 1))))
                            (byteset.get "lptuw" (local.get $c)))
                          (then
                            (if
                              (select
                                (i32.eqz
                                  (i32.or
                                    (byteset.get "!%&*+-/<=>?^|~" (local.get $pc))
                                    (i32.or
                                      (i32.eq (local.get $pc) (i32.const ")"))
                                      (i32.or
                                        (i32.eq (local.get $pc) (i32.const "]"))
                                        (i32.eq (local.get $pc) (i32.const ":"))))))
                                (i32.or
                                  (i32.or
                                    (call $lexIsIdentContinue (local.get $pc))
                                    (i32.eq (local.get $pc) (i32.const "(")))
                                  (i32.or (i32.eq (local.get $pc) (i32.const 34)) (i32.eq (local.get $pc) (i32.const 39))))
                                (i32.or (i32.eq (local.get $c) (i32.const "l")) (i32.eq (local.get $c) (i32.const "p"))))
                              (then (local.set $hl (enum.get $Token.attribute))))))
                        (if
                          (i32.and
                            (i32.eq (local.get $pc) (i32.const "("))
                            (i32.ne (local.get $hl) (enum.get $Token.attribute)))
                          (then (local.set $hl (enum.get $Token.function))))
                        (if (i32.eq (local.get $g) (i32.const 7))
                          (then (local.set $hl (enum.get $Token.constant))))))))))
            (if (i32.eq (local.get $g) (i32.const 4))
              (then
                (local.set $hl (enum.get $Token.keyword.control))
                ;; `else if`, `do for`: a statement still starts after the word
                (local.set $stmt (local.get $atStmt))))
            (if (i32.eq (local.get $g) (i32.const 8))
              (then (local.set $hl (enum.get $Token.constant.builtin))))
            (call $emitTok (local.get $hl) (local.get $lhs) (local.get $rhs))
            (br $next)))

        (if
          (i32.or
            (call $lexIsDigit (local.get $c))
            (i32.and (i32.eq (local.get $c) (i32.const ".")) (call $lexIsDigit (local.get $c2))))
          (then
            (call $lexScanNumber)
            (call $emitTok (enum.get $Token.number) (local.get $lhs) (global.get $ptr))
            (br $next)))

        (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
        (if (byteset.get "()[]{}" (local.get $c))
          (then
            (if (i32.or (i32.eq (local.get $c) (i32.const "{")) (i32.eq (local.get $c) (i32.const "}")))
              (then
                (local.set $stmt (i32.const 1))
                (local.set $cmd (i32.const 0))))
            (if (i32.and (i32.eq (local.get $c) (i32.const ")")) (i32.eq (local.get $cmd) (i32.const 3)))
              (then (local.set $cmd (i32.const 0))))
            (call $emitTok (enum.get $Token.punctuation.bracket) (local.get $lhs) (global.get $ptr))
            (br $next)))
        (if (byteset.get ",:;" (local.get $c))
          (then
            (if (i32.eq (local.get $c) (i32.const ";"))
              (then
                (local.set $stmt (i32.const 1))
                (local.set $cmd (i32.const 0))))
            (call $emitTok (enum.get $Token.punctuation.delimiter) (local.get $lhs) (global.get $ptr))
            (br $next)))
        (if (byteset.get "!%&*+-./<=>?^|~" (local.get $c))
          (then
            (block $opDone
              (loop $op
                (local.set $c (call $templateByte (global.get $ptr)))
                (br_if $opDone (i32.eqz (byteset.get "!%&*+-/<=>?^|~" (local.get $c))))
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                (br $op)))
            (call $emitTok (enum.get $Token.operator) (local.get $lhs) (global.get $ptr))
            (br $next)))
        (global.set $ptr (call $utf8SpanEnd (global.get $ptr) (global.get $end)))
        (call $emitTok (enum.get $Token.none) (local.get $lhs) (global.get $ptr))
        (br $next))))
)
