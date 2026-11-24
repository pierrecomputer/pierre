(module
  (import "../emitter.wat")
  (import "@pierre/wat-tools/lexer-state.wat")
  (memory-region $mem.bslFold 32)
  (memory-region $mem.bslWords 266)
  (memory-region $mem.sdblWords 284)

  (import "@pierre/wat-tools/common.wat")

  ;; 1C words are case-insensitive and have a Russian and an English
  ;; spelling. $bslFold copies a word with ASCII in lowercase and each
  ;; Cyrillic letter, in either case, as one byte of this map:
  ;; а A, б B, в V, г G, д D, е E, ж @, з Z, и I, й J, к K, л L, м M, н N,
  ;; о O, п P, р R, с S, т T, у U, ф F, х H, ц C, ч Q, ш W, щ X, ъ $, ы Y,
  ;; ь !, э #, ю ., я -. English words fold to lowercase, so a folded
  ;; Russian word never equals an English one. A word with `ё` or another
  ;; non-ASCII letter is never a keyword.
  (data (i32.const $mem.bslFold) "ABVGDE@ZIJKLMNOPRSTUFHCQWX\24Y!#.-")

  ;; Folded words. Token in the low byte; the high byte captures the next
  ;; name: 1 a routine, 2 a type. `КонецПопытки` (KONECPOPYTKI) and
  ;; `except` share their hashes with `КонецФункции` and `export` and are
  ;; matched directly.
  (keyword-table $bslWords $mem.bslWords $mem.bslWords+266
    (group $Token.keyword.declaration+256
      "PROCEDURA" "procedure" ;; Процедура
      "FUNKCI-" "function")   ;; Функция
    (group $Token.keyword+512 "NOVYJ" "new") ;; Новый
    (group $Token.keyword.declaration
      "KONECPROCEDURY" "endprocedure" ;; КонецПроцедуры
      "KONECFUNKCII" "endfunction"    ;; КонецФункции
      "PEREM" "var"                   ;; Перем
      "ZNAQ" "val"                    ;; Знач
      "#KSPORT" "export")             ;; Экспорт
    (group $Token.keyword.control
      "ESLI" "if"                     ;; Если
      "TOGDA" "then"                  ;; Тогда
      "INAQEESLI" "elsif"             ;; ИначеЕсли
      "INAQE" "else"                  ;; Иначе
      "KONECESLI" "endif"             ;; КонецЕсли
      "DL-" "for"                     ;; Для
      "KA@DOGO" "each"                ;; Каждого
      "IZ" "in"                       ;; Из
      "PO" "to"                       ;; По
      "CIKL" "do"                     ;; Цикл
      "KONECCIKLA" "enddo"            ;; КонецЦикла
      "POKA" "while"                  ;; Пока
      "POPYTKA" "try"                 ;; Попытка
      "ISKL.QENIE"                    ;; Исключение
      "endtry"
      "VOZVRAT" "return"              ;; Возврат
      "PRODOL@IT!" "continue"         ;; Продолжить
      "PRERVAT!" "break"              ;; Прервать
      "VYZVAT!ISKL.QENIE" "raise"     ;; ВызватьИсключение
      "PEREJTI" "goto")               ;; Перейти
    (group $Token.keyword
      "ASINH" "async"                 ;; Асинх
      "@DAT!" "await"                 ;; Ждать
      "VYPOLNIT!" "execute")          ;; Выполнить
    (group $Token.keyword.operator
      "ILI" "or"                      ;; ИЛИ
      "NE" "not"                      ;; НЕ
      "and")
    (group $Token.boolean
      "ISTINA" "true"                 ;; Истина
      "LO@!" "false")                 ;; Ложь
    (group $Token.constant.builtin
      "NEOPREDELENO" "undefined"      ;; Неопределено
      "null"))

  ;; Folded query words. Token in the low byte; bits 8-9 are 3 when a table
  ;; path follows; bit 10 marks a word that starts query text.
  (keyword-table $sdblWords $mem.sdblWords $mem.sdblWords+284
    (group $Token.keyword+1024 "VYBRAT!" "select")       ;; ВЫБРАТЬ
    (group $Token.keyword+1792 "UNIQTO@IT!" "drop")      ;; УНИЧТОЖИТЬ
    (group $Token.keyword+768
      "IZ" "from"                     ;; ИЗ
      "SOEDINENIE" "join"             ;; СОЕДИНЕНИЕ
      "POMESTIT!" "into")             ;; ПОМЕСТИТЬ
    (group $Token.keyword
      "RAZREWENNYE" "allowed"         ;; РАЗРЕШЕННЫЕ
      "RAZLIQNYE" "distinct"          ;; РАЗЛИЧНЫЕ
      "PERVYE" "top"                  ;; ПЕРВЫЕ
      "GDE" "where"                   ;; ГДЕ
      "KAK" "as"                      ;; КАК
      "LEVOE" "left"                  ;; ЛЕВОЕ
      "PRAVOE" "right"                ;; ПРАВОЕ
      "VNUTRENNEE" "inner"            ;; ВНУТРЕННЕЕ
      "POLNOE" "full"                 ;; ПОЛНОЕ
      "VNEWNEE" "outer"               ;; ВНЕШНЕЕ
      "PO" "by" "on"                  ;; ПО
      "SGRUPPIROVAT!" "group"         ;; СГРУППИРОВАТЬ
      "UPOR-DOQIT!" "order"           ;; УПОРЯДОЧИТЬ
      "IME.XIE" "having"              ;; ИМЕЮЩИЕ
      "OB$EDINIT!" "union"            ;; ОБЪЕДИНИТЬ
      "VSE" "all"                     ;; ВСЕ
      "ITOGI" "totals"                ;; ИТОГИ
      "VOZR" "asc"                    ;; ВОЗР
      "UBYV" "desc")                  ;; УБЫВ
    (group $Token.keyword.control
      "VYBOR" "case"                  ;; ВЫБОР
      "KOGDA" "when"                  ;; КОГДА
      "TOGDA" "then"                  ;; ТОГДА
      "INAQE" "else"                  ;; ИНАЧЕ
      "KONEC" "end")                  ;; КОНЕЦ
    (group $Token.keyword.operator
      "ILI" "or"                      ;; ИЛИ
      "NE" "not"                      ;; НЕ
      "ME@DU" "between"               ;; МЕЖДУ
      "PODOBNO" "like"                ;; ПОДОБНО
      "EST!" "is"                     ;; ЕСТЬ
      "and" "in")
    (group $Token.boolean
      "ISTINA" "true"                 ;; ИСТИНА
      "LO@!" "false")                 ;; ЛОЖЬ
    (group $Token.constant.builtin
      "NEOPREDELENO" "undefined"      ;; НЕОПРЕДЕЛЕНО
      "null"))

  ;; Copy the word [lhs,rhs) to $mem.lexLowerScratch for a keyword lookup,
  ;; folded as the $mem.bslFold comment says. Return the folded length, or
  ;; 0 when the word holds another non-ASCII character.
  (func $bslFold (param $lhs i32) (param $rhs i32) (result i32)
    (local $n i32)
    (local $c i32)
    (local $d i32)
    (local $v i32)
    (if (i32.gt_u (i32.sub (local.get $rhs) (local.get $lhs)) (i32.const 62))
      (then (return (i32.const 0))))
    (block $done
      (loop $l
        (br_if $done (i32.ge_u (local.get $lhs) (local.get $rhs)))
        (local.set $c (i32.load8_u (local.get $lhs)))
        (local.set $lhs (i32.add (local.get $lhs) (i32.const 1)))
        (if (i32.ge_u (local.get $c) (i32.const 0x80))
          (then
            ;; D0 90..BF and D1 80..8F give 0..3F; the low five bits index а..я
            (local.set $d (i32.load8_u (local.get $lhs)))
            (local.set $v
              (i32.sub
                (i32.or
                  (i32.shl (i32.and (local.get $c) (i32.const 1)) (i32.const 6))
                  (i32.and (local.get $d) (i32.const 0x3f)))
                (i32.const 0x10)))
            (if
              (i32.or
                (i32.or
                  (i32.ne (i32.or (local.get $c) (i32.const 1)) (i32.const 0xd1))
                  (i32.ge_u (local.get $v) (i32.const 0x40)))
                (i32.or
                  (i32.ne (i32.and (local.get $d) (i32.const 0xc0)) (i32.const 0x80))
                  (i32.ge_u (local.get $lhs) (local.get $rhs))))
              (then (return (i32.const 0))))
            (local.set $c
              (i32.load8_u
                (i32.add (i32.const $mem.bslFold) (i32.and (local.get $v) (i32.const 31)))))
            (local.set $lhs (i32.add (local.get $lhs) (i32.const 1))))
          (else
            (local.set $c
              (i32.or
                (local.get $c)
                (i32.shl
                  (i32.lt_u (i32.sub (local.get $c) (i32.const "A")) (i32.const 26))
                  (i32.const 5))))))
        (i32.store8 (i32.add (i32.const $mem.lexLowerScratch) (local.get $n)) (local.get $c))
        (local.set $n (i32.add (local.get $n) (i32.const 1)))
        (br $l)))
    (local.get $n))

  ;; Whether the first word at $p, after blanks, starts query text
  ;; (`ВЫБРАТЬ`, `УНИЧТОЖИТЬ`), so a BSL string from there is a query.
  (func $bslQueryAt (param $p i32) (result i32)
    (local $save i32)
    (local $n i32)
    (local.set $p (call $lexSkipSpaceAt (local.get $p)))
    (if (i32.eqz (call $lexIsNameStart (call $templateByte (local.get $p))))
      (then (return (i32.const 0))))
    (local.set $save (global.get $ptr))
    (global.set $ptr (local.get $p))
    (call $scanIdentRun (i32.const "_"))
    (local.set $n (call $bslFold (local.get $p) (global.get $ptr)))
    (global.set $ptr (local.get $save))
    (i32.eq
      (i32.and
        (keyword-table.value $sdblWords
          (i32.const $mem.lexLowerScratch)
          (i32.add (i32.const $mem.lexLowerScratch) (local.get $n)))
        (i32.const 0x8400))
      (i32.const 0x400)))

  ;; A string body from $ptr through the closing quote, or to the line end.
  ;; `""` is an escaped quote. Emit from $seg; return 1 when closed.
  (func $bslString (param $seg i32) (result i32)
    (local $p i32)
    (local $closed i32)
    (block $done
      (loop $l
        (local.set $p
          (call $scanFindSpecial (global.get $ptr) (global.get $end) (i32.const 34) (i32.const 0) (i32.const 1)))
        (global.set $ptr (local.get $p))
        (br_if $done (i32.ge_u (local.get $p) (global.get $end)))
        (br_if $done (i32.ne (i32.load8_u (local.get $p)) (i32.const 34)))
        (global.set $ptr (i32.add (local.get $p) (i32.const 1)))
        (local.set $closed (i32.ne (call $templateByte (global.get $ptr)) (i32.const 34)))
        (br_if $done (local.get $closed))
        (call $emitTok (enum.get $Token.string) (local.get $seg) (local.get $p))
        (global.set $ptr (i32.add (local.get $p) (i32.const 2)))
        (call $emitTok (enum.get $Token.string.escape) (local.get $p) (global.get $ptr))
        (local.set $seg (global.get $ptr))
        (br $l)))
    (call $emitTok (enum.get $Token.string) (local.get $seg) (global.get $ptr))
    (local.get $closed))

  ;; Query text in a BSL string ends at a lone `"`. Advance $ptr from $p to
  ;; that quote, the line end, or past the first `""` when $pair is set.
  (func $bslQueryFind (param $p i32) (param $pair i32)
    (block $done
      (loop $l
        (local.set $p
          (call $scanFindSpecial (local.get $p) (global.get $end) (i32.const 34) (i32.const 0) (i32.const 1)))
        (br_if $done (i32.ne (call $templateByte (local.get $p)) (i32.const 34)))
        (br_if $done (i32.ne (call $templateByte (i32.add (local.get $p) (i32.const 1))) (i32.const 34)))
        (local.set $p (i32.add (local.get $p) (i32.const 2)))
        (br_if $l (i32.eqz (local.get $pair)))))
    (global.set $ptr (local.get $p)))

  (func $hlBsl
    (call $hlBslImpl (i32.const 0)))

  (func $hlSdbl
    (call $hlBslImpl (i32.const 1)))

  ;; $sdbl selects the query language. In BSL, $str is 1 inside a string
  ;; that continues on `|` lines (3 while its first line is blank), and 2
  ;; inside a string of query text. $expect is the pending capture: 1 a
  ;; routine name, 2 a type, 3 a table path, 4 the `(` of a routine.
  ;; $params is 1 in a parameter list and $member 1 after `.`.
  (func $hlBslImpl (param $sdbl i32)
    (local $c i32)
    (local $c2 i32)
    (local $gap i32)
    (local $lhs i32)
    (local $rhs i32)
    (local $n i32)
    (local $v i32)
    (local $hl i32)
    (local $q i32)
    (local $str i32)
    (local $expect i32)
    (local $params i32)
    (local $member i32)
    (call $lexEmitLeadingContinuation)
    (block $done
      (loop $next
        (local.set $gap (global.get $ptr))
        (call $scanWhitespace)
        (call $emitGap (local.get $gap) (global.get $ptr))
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        (local.set $lhs (global.get $ptr))
        (local.set $c (i32.load8_u (local.get $lhs)))
        (local.set $c2 (call $templateByte (i32.add (local.get $lhs) (i32.const 1))))

        ;; The first token of a line inside a string: `|` continues it, a
        ;; comment line keeps it open, anything else ends it.
        (if
          (i32.and
            (i32.ne (local.get $str) (i32.const 0))
            (i32.or
              (i32.ne (local.get $str) (i32.const 2))
              (i32.eqz (call $lexLineByteBefore (local.get $lhs)))))
          (then
            (if (i32.eq (local.get $c) (i32.const "|"))
              (then
                (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
                (if
                  (i32.and
                    (i32.eq (local.get $str) (i32.const 3))
                    (call $bslQueryAt (global.get $ptr)))
                  (then (local.set $str (i32.const 2))))
                (if (i32.eq (local.get $str) (i32.const 2))
                  (then
                    (call $emitTok (enum.get $Token.string) (local.get $lhs) (global.get $ptr))
                    (br $next)))
                (local.set $str (i32.eqz (call $bslString (local.get $lhs))))
                (br $next)))
            (if (i32.and (i32.eq (local.get $c) (i32.const "/")) (i32.eq (local.get $c2) (i32.const "/")))
              (then
                (call $lexLineComment (i32.const 2) (enum.get $Token.comment))
                (br $next)))
            (local.set $str (i32.const 0))
            (local.set $expect (i32.const 0))))
        (local.set $q (i32.or (local.get $sdbl) (i32.eq (local.get $str) (i32.const 2))))

        (if (i32.and (i32.eq (local.get $c) (i32.const "/")) (i32.eq (local.get $c2) (i32.const "/")))
          (then
            (if (i32.eq (local.get $str) (i32.const 2))
              (then
                (call $bslQueryFind (local.get $lhs) (i32.const 0))
                (call $emitTok (enum.get $Token.comment) (local.get $lhs) (global.get $ptr)))
              (else (call $lexLineComment (i32.const 2) (enum.get $Token.comment))))
            (br $next)))

        ;; every token but a name or `.` ends a capture and a member access
        (if (i32.eqz (call $lexIsNameStart (local.get $c)))
          (then
            (if (i32.ne (local.get $c) (i32.const "."))
              (then
                (local.set $member (i32.const 0))
                (if (i32.and (i32.eq (local.get $c) (i32.const "(")) (i32.eq (local.get $expect) (i32.const 4)))
                  (then (local.set $params (i32.const 1))))
                (local.set $expect (i32.const 0))))))

        (if (i32.eq (local.get $c) (i32.const 34))
          (then
            (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
            (if (i32.eq (local.get $str) (i32.const 2))
              (then
                ;; `""` delimits a query string; a lone `"` ends the BSL string
                (if (i32.eq (local.get $c2) (i32.const 34))
                  (then (call $bslQueryFind (i32.add (local.get $lhs) (i32.const 2)) (i32.const 1)))
                  (else (local.set $str (i32.const 0))))
                (call $emitTok (enum.get $Token.string) (local.get $lhs) (global.get $ptr))
                (br $next)))
            (if (i32.and (i32.eqz (local.get $sdbl)) (call $bslQueryAt (global.get $ptr)))
              (then
                (call $emitTok (enum.get $Token.string) (local.get $lhs) (global.get $ptr))
                (local.set $str (i32.const 2))
                (br $next)))
            ;; an unclosed BSL string continues on `|` lines
            (if (i32.eqz (i32.or (call $bslString (local.get $lhs)) (local.get $sdbl)))
              (then
                (local.set $str
                  (select
                    (i32.const 3)
                    (i32.const 1)
                    (i32.eq
                      (call $lexSkipSpaceAt (i32.add (local.get $lhs) (i32.const 1)))
                      (global.get $ptr))))))
            (br $next)))

        ;; `'20240131'` dates
        (if (i32.and (i32.eq (local.get $c) (i32.const 39)) (i32.eqz (local.get $q)))
          (then
            (global.set $ptr
              (call $scanFindSpecial
                (i32.add (local.get $lhs) (i32.const 1))
                (global.get $end)
                (i32.const 39)
                (i32.const 0)
                (i32.const 1)))
            (if (i32.eq (call $templateByte (global.get $ptr)) (i32.const 39))
              (then (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))))
            (call $emitTok (enum.get $Token.string.special) (local.get $lhs) (global.get $ptr))
            (br $next)))

        ;; `&НаСервере` annotations, `&Параметр` query parameters, `~Метка` labels
        (if
          (i32.and
            (i32.or (i32.eq (local.get $c) (i32.const "&")) (i32.eq (local.get $c) (i32.const "~")))
            (call $lexIsNameStart (local.get $c2)))
          (then
            (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
            (call $scanIdentRun (i32.const "_"))
            (call $emitTok
              (select
                (enum.get $Token.label)
                (select (enum.get $Token.variable.parameter) (enum.get $Token.attribute) (local.get $q))
                (i32.eq (local.get $c) (i32.const "~")))
              (local.get $lhs)
              (global.get $ptr))
            (br $next)))

        ;; `#Область`, `#Если Сервер Тогда` preprocessor lines
        (if
          (i32.and
            (i32.and (i32.eq (local.get $c) (i32.const "#")) (i32.eqz (local.get $q)))
            (i32.eqz (call $lexLineByteBefore (local.get $lhs))))
          (then
            (call $lexLineComment (i32.const 1) (enum.get $Token.preproc))
            (br $next)))

        (if (call $lexIsNameStart (local.get $c))
          (then
            (call $scanIdentRun (i32.const "_"))
            (local.set $rhs (global.get $ptr))
            (local.set $c2 (call $templateByte (call $lexSkipSpaceAt (local.get $rhs))))
            (local.set $v (i32.const -1))
            (if (i32.eqz (local.get $member))
              (then
                (local.set $n (call $bslFold (local.get $lhs) (local.get $rhs)))
                (local.set $v
                  (if (result i32) (local.get $q)
                    (then
                      (keyword-table.value $sdblWords
                        (i32.const $mem.lexLowerScratch)
                        (i32.add (i32.const $mem.lexLowerScratch) (local.get $n))))
                    (else
                      (keyword-table.value $bslWords
                        (i32.const $mem.lexLowerScratch)
                        (i32.add (i32.const $mem.lexLowerScratch) (local.get $n))))))
                (if
                  (i32.and
                    (i32.eqz (local.get $q))
                    (i32.or
                      (i32.and
                        (i32.eq (local.get $n) (i32.const 12))
                        (i32.and
                          (i64.eq (i64.load (i32.const $mem.lexLowerScratch)) (i64.const "KONECPOP"))
                          (i32.eq (i32.load (i32.const $mem.lexLowerScratch+8)) (i32.const "YTKI"))))
                      (i32.and
                        (i32.eq (local.get $n) (i32.const 6))
                        (i64.eq
                          (i64.and (i64.load (i32.const $mem.lexLowerScratch)) (i64.const 0xffffffffffff))
                          (i64.const "except")))))
                  (then (local.set $v (enum.get $Token.keyword.control))))
                ;; one-letter `И`, and `В` in queries
                (if (i32.eq (local.get $n) (i32.const 1))
                  (then
                    (local.set $n (i32.load8_u (i32.const $mem.lexLowerScratch)))
                    (if
                      (i32.or
                        (i32.eq (local.get $n) (i32.const "I"))
                        (i32.and (local.get $q) (i32.eq (local.get $n) (i32.const "V"))))
                      (then (local.set $v (enum.get $Token.keyword.operator))))))))
            (if (i32.ge_s (local.get $v) (i32.const 0))
              (then
                (local.set $hl (i32.and (local.get $v) (i32.const 255)))
                (local.set $expect (i32.and (i32.shr_u (local.get $v) (i32.const 8)) (i32.const 3))))
              (else
                (local.set $hl (enum.get $Token.variable))
                (if (local.get $params)
                  (then (local.set $hl (enum.get $Token.variable.parameter))))
                (if (i32.eq (local.get $c2) (i32.const "("))
                  (then (local.set $hl (enum.get $Token.function))))
                (if (local.get $member)
                  (then
                    (local.set $hl
                      (select
                        (enum.get $Token.function.method)
                        (enum.get $Token.property)
                        (i32.eq (local.get $c2) (i32.const "("))))))
                (if (i32.eq (local.get $expect) (i32.const 1))
                  (then
                    (local.set $hl (enum.get $Token.function.definition))
                    (local.set $expect (i32.const 4))))
                (if (i32.eq (local.get $expect) (i32.const 2))
                  (then
                    (local.set $hl (enum.get $Token.type))
                    (local.set $expect (i32.const 0))))
                ;; `Справочник.Товары`: namespaces up to the table name
                (if (i32.eq (local.get $expect) (i32.const 3))
                  (then
                    (local.set $hl (enum.get $Token.type))
                    (if (i32.eq (call $templateByte (local.get $rhs)) (i32.const "."))
                      (then (local.set $hl (enum.get $Token.namespace)))
                      (else (local.set $expect (i32.const 0))))))))
            (call $emitTok (local.get $hl) (local.get $lhs) (local.get $rhs))
            (local.set $member (i32.const 0))
            (br $next)))

        (if (call $lexIsDigit (local.get $c))
          (then
            (call $lexScanNumber)
            (call $emitTok (enum.get $Token.number) (local.get $lhs) (global.get $ptr))
            (br $next)))

        (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
        (local.set $hl (enum.get $Token.none))
        (if (byteset.get "()[]" (local.get $c))
          (then
            (local.set $hl (enum.get $Token.punctuation.bracket))
            (if (i32.eq (local.get $c) (i32.const ")"))
              (then (local.set $params (i32.const 0))))))
        (if (byteset.get ",.:;" (local.get $c))
          (then (local.set $hl (enum.get $Token.punctuation.delimiter))))
        (if (i32.eq (local.get $c) (i32.const "."))
          (then (local.set $member (i32.const 1))))
        (if (i32.or (byteset.get "+-*/=<>&%" (local.get $c)) (i32.eq (local.get $c) (i32.const "?")))
          (then
            (local.set $hl (enum.get $Token.operator))
            ;; `<=`, `>=`, `<>`
            (if
              (i32.and
                (i32.or (i32.eq (local.get $c) (i32.const "<")) (i32.eq (local.get $c) (i32.const ">")))
                (i32.or (i32.eq (local.get $c2) (i32.const "=")) (i32.eq (local.get $c2) (i32.const ">"))))
              (then (global.set $ptr (i32.add (local.get $lhs) (i32.const 2)))))))
        (if (i32.eqz (local.get $hl))
          (then (global.set $ptr (call $utf8SpanEnd (global.get $ptr) (global.get $end)))))
        (call $emitTok (local.get $hl) (local.get $lhs) (global.get $ptr))
        (br $next))))
)
