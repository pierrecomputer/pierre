(module
  (import "./sql.wat")

  (func $hlPlsql
    (global.set $sqlPlsql (i32.const 1))
    (call $hlSqlImpl))
)
