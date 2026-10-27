import type { Lang } from '@pierre/highlights';

export const PLAYGROUND_LANGUAGES = [
  [
    'abap',
    'ABAP',
    `* Inventory report
REPORT zinventory.

CLASS lcl_inventory DEFINITION FINAL.
  PUBLIC SECTION.
    TYPES: BEGIN OF ty_item,
             id   TYPE i,
             name TYPE string,
           END OF ty_item,
           tt_items TYPE STANDARD TABLE OF ty_item WITH EMPTY KEY.
    "! Total quantity of all items
    METHODS total RETURNING VALUE(rv_total) TYPE i.
  PRIVATE SECTION.
    DATA mt_items TYPE tt_items.
ENDCLASS.

CLASS lcl_inventory IMPLEMENTATION.
  METHOD total.
    LOOP AT mt_items ASSIGNING FIELD-SYMBOL(<ls_item>) WHERE id > 0.
      rv_total = rv_total + <ls_item>-id. " running sum
    ENDLOOP.
    IF sy-subrc <> 0 AND rv_total = 0.
      cl_demo_output=>display( |Empty: { lines( mt_items ) } items \\|
        still text| ) ##NO_TEXT.
    ENDIF.
    DATA(lv_text) = \`it\`\`s\` && 'don''t'.
    me->log( abap_true ).
  ENDMETHOD.
ENDCLASS.`,
  ],
  [
    'ada',
    'Ada',
    `--  Bounded stacks
with Ada.Text_IO; use Ada.Text_IO;
package body Stacks is
   type Count is range 0 .. 16#FF#;
   Limit : constant Natural := 1_000;
   procedure Push (S : in out Stack; X : Integer) is
   begin
      if S.Top = S.Data'Last then
         raise Overflow;
      end if;
      Put_Line ("Pushed """ & Integer'Image (X) & """");
      C := 'x';
      <<Done>>
      S.Ready := True and not S.Full;
   end Push;
end Stacks;`,
  ],
  [
    'angular-html',
    'Angular HTML',
    `<!-- Bindings, interpolation, pipes, and control flow -->
@let user = currentUser();

<section [class.signed-in]="user !== null">
  @if (user; as profile) {
    <h2>Hello, {{ profile.name | uppercase }}!</h2>
    <label>
      Search
      <input #search [(ngModel)]="query" (keyup.enter)="searchProducts(query)" />
    </label>

    <ul>
      @for (product of products(); track product.id; let i = $index) {
        <li [attr.data-index]="i">
          <span>{{ product.name }}</span>
          <strong>{{ product.price | currency : "USD" }}</strong>
          <button [disabled]="!product.inStock" (click)="addToCart(product)">
            Add to cart
          </button>
        </li>
      } @empty {
        <li>No products match {{ query }}.</li>
      }
    </ul>
  } @else {
    <p>Please sign in to browse your favorites.</p>
  }
</section>

@defer (on viewport) {
  <app-recommendations />
} @placeholder {
  <p>Recommendations will appear here.</p>
} @loading {
  <p>Loading recommendations…</p>
} @error {
  <p>Could not load recommendations.</p>
}`,
  ],
  [
    'angular-ts',
    'Angular TypeScript',
    `import { Component, signal } from "@angular/core";

@Component({
  selector: "app-counter",
  template: \`
    <section class="counter" [class.active]="count() > 0">
      <h2>{{ title }}</h2>
      <button [disabled]="count() === 0" (click)="decrement()">−</button>
      <output>{{ count() }}</output>
      <button (click)="increment()">+</button>

      @if (count() > 0) {
        <p>You clicked {{ count() }} times.</p>
      } @else {
        <p>Click + to get started.</p>
      }
    </section>
  \`,
  styles: \`
    :host { display: block; font-family: system-ui; }
    .counter { padding: 1rem; border: 1px solid #444; border-radius: 8px; }
    .counter.active { border-color: rebeccapurple; }
    output { padding: 0 1rem; font-weight: bold; }
    button:disabled { opacity: 0.5; }
  \`,
})
export class CounterComponent {
  readonly title = "Angular counter";
  readonly count = signal(0);

  increment() {
    this.count.update((value) => value + 1);
  }

  decrement() {
    this.count.update((value) => Math.max(0, value - 1));
  }
}`,
  ],
  [
    'apache',
    'Apache',
    `# Virtual host for example.com
ServerRoot "/etc/httpd"
Listen 8080
Include conf.d/*.conf
<VirtualHost *:80>
    ServerName example.com
    <IfModule mod_rewrite.c>
        RewriteEngine On
        RewriteCond %{HTTP_HOST} ^www\\.(.*)$ [NC]
        RewriteRule ^(.*)$ https://%1/$1 [L,R=301]
    </IfModule>
    ErrorLog \${APACHE_LOG_DIR}/error.log
    Header set X-Note "\\"quoted\\""
    AddType application/x-httpd-php .php \\
        .phtml
</VirtualHost>`,
  ],
  [
    'apex',
    'Apex',
    `/**
 * Account helpers
 */
public with sharing class AccountService {
    @AuraEnabled(cacheable=true)
    public static List<Account> find(String name, Integer max) {
        // inline SOQL across lines
        List<Account> rows = [
            SELECT Id, Name FROM Account
            WHERE Name LIKE :name ORDER BY Name LIMIT :max
        ];
        String msg = 'Found \\'' + rows.size() + '\\'\\n';
        System.debug(msg);
        if (rows.isEmpty() && max > 0) { insert new Account(Name = name); }
        return rows;
    }
    public Integer total { get; set; }
}`,
  ],
  [
    'applescript',
    'AppleScript',
    `-- Greet the user
(* A block (* nested *)
   comment *)
property greeting : "Hello"
on run argv
	set counter to 0
	tell application "Finder"
		set theName to name of window 1
	end tell
	repeat with i from 1 to 3
		if i is greater than 1.5 then set counter to counter + i
	end repeat
	display dialog greeting & ", \\"" & theName & "\\"" buttons {"OK"}
	return missing value
end run`,
  ],
  [
    'asciidoc',
    'AsciiDoc',
    `= Release Notes
:version: 2.1
// line comment

== Getting *Started*

Use *bold*, _italic_, \`mono\` and {version}.
See <<setup>> or https://example.com[the site].
Escaped \\*text* here.

[source,python]
----
print("hello\\n")
----

NOTE: Read this first.

* item
. step
CPU:: brain

////
comment block
////`,
  ],
  [
    'asm',
    'Assembly',
    `section .data
message: db "Hello, assembly!", 10
length: equ $ - message

section .text
global _start

_start:
    mov rax, 1
    mov rdi, 1
    mov rsi, message
    mov rdx, length
    syscall`,
  ],
  [
    'astro',
    'Astro',
    `---
interface Props {
  name?: string;
}

const { name = "world" } = Astro.props;
const languages = ["Rust", "Python", "WAT"];
---
<main>
  <h1>Hello, {name}!</h1>
  <ul>{languages.map((lang) => <li>{lang}</li>)}</ul>
</main>

<style>
  h1 { color: rebeccapurple; }
</style>`,
  ],
  [
    'awk',
    'AWK',
    `#!/usr/bin/awk -f
# Sum sizes per owner
BEGIN { FS = ":"; OFS = "\\t"; limit = 1.5e3 }
/^#/ { next }
$3 ~ /[0-9]+\\/s/ && !/skip/ {
  total[$1] += $3 / 2; rows = NR
  if (length($NF) > 0x10) printf "%s=%d\\n", $1, $3
}
function owner(name,   parts) {
  split(name, parts, "/")
  return parts[1]
}
END {
  for (who in total) print owner(who), total[who] | "sort"
  note = "multi \\
line"
}`,
  ],
  [
    'bash',
    'Bash',
    `#!/usr/bin/env bash
set -euo pipefail

greet() {
  local name="\${1:-world}"
  printf "Hello, %s!\\n" "$name"
}

for name in Ada Linus; do
  greet "$name"
done`,
  ],
  [
    'batch',
    'Windows Batch',
    `@echo off
REM Build selected files
setlocal enabledelayedexpansion
set "ROOT=%~dp0"
:build
for %%F in (*.txt) do (
  echo "%%~fF: !ROOT!"
)
echo first ^
  second ^& third
if not exist "%ROOT%out" mkdir "%ROOT%out"
exit /b 0`,
  ],
  [
    'bibtex',
    'BibTeX',
    `% Library export
Text outside entries is a comment.
@string{acm = "ACM \\"Press\\""}
@Article{knuth1984,
  author   = {Donald E. Knuth and {\\"O}rjan L{\\'e}vy},
  title    = "The {\\TeX}book",
  journal  = acm # " Journal",
  year     = 1984,
  month    = jan,
  abstract = {First line
    continues {nested} here},
}
@comment{ignored}
@book(lamport94, title = {LaTeX}, pages = 272)`,
  ],
  [
    'bicep',
    'Bicep',
    `// Storage account
targetScope = 'resourceGroup'

@description('Where to deploy')
param location string = resourceGroup().location
param count int = 3

var name = 'st\${uniqueString(resourceGroup().id)}\\n'
/* tags for
   every resource */
resource stg 'Microsoft.Storage/storageAccounts@2023-01-01' = {
  name: name
  location: location
  properties: {
    enabled: true
    tier: count > 2 ? 'Premium' : null
  }
}

output id string = stg.id`,
  ],
  [
    'blade',
    'Blade',
    `{{-- Product list --}}
@extends('layouts.app')

@section('content')
<div class="grid {{ $compact ? 'gap-1' : 'gap-4' }}" @click="open = !open">
  <h1>{{ __('Products') }} &amp; more</h1>
  @forelse ($products as $i => $product)
    <x-card :product="$product" :index="$i + 1" wire:key="p-{{ $product->id }}" />
  @empty
    <p>No products for {{ $user->name }}.</p>
  @endforelse
  {!! $pager->links() !!}
  @php
    $total = 0x1F; /* across
       lines */
    $label = "Total: \\"{$total}\\"";
  @endphp
  <span>@{{ vueValue }}</span>
  @verbatim
    <div>{{ untouched }}</div>
  @endverbatim
  @include('partials.footer', [
    'year' => 2024,
  ])
</div>
@endsection`,
  ],
  [
    'c',
    'C',
    `#include <stdio.h>

typedef struct { int x, y; } Point;

static int distance_squared(Point a, Point b) {
  int dx = a.x - b.x;
  int dy = a.y - b.y;
  return dx * dx + dy * dy;
}

int main(void) {
  printf("%d\\n", distance_squared((Point){0, 0}, (Point){3, 4}));
}`,
  ],
  [
    'c3',
    'C3',
    `module demo;
import std::io;

const int MAX = 10;

struct Counter {
    String label;
    int count;
}

fault CounterError { FULL }

<* Return a copy with the count bumped. *>
fn Counter! Counter.increment(&self) {
    if (self.count >= MAX) return CounterError.FULL?;
    return { .label = self.label, .count = self.count + 1 };
}

fn void main() {
    Counter c = { .label = "hits", .count = 0 };
    Counter! next = c.increment();
    if (catch err = next) {
        io::printfn("error: %s", err);
        return;
    }
    io::printfn("%s=%d", next.label, next.count);
}`,
  ],
  [
    'clojure',
    'Clojure',
    `(ns demo.core
  (:require [clojure.string :as str])
  (:import (java.util Date)))

;; A record and a protocol
(defprotocol Shape (area [this]))
(defrecord Circle [r]
  Shape
  (area [_] (* Math/PI r r)))

(def ^:private max-items 10)
(defonce state (atom {:count 0, :names #{}}))

(defn- greet
  "Say hello."
  [name & rest]
  (println (str "Hello, " name "!") #"\\d+" \\a \\newline))

(defn process [items]
  (let [total (reduce + 0 items)
        avg (/ total (count items))]
    (if-let [x (first items)]
      (when-not (nil? x)
        (->> items (map inc) (filter even?) (into [])))
      (throw (ex-info "empty" {:items items})))
    #_(comment ignored)
    (case avg 1N :one 0x1F :hex 1/2 :half "multi
line" nil true false)
    #(+ % %2) @state 'quoted \`(unquote ~x ~@xs) #inst "2024"
    (.toUpperCase "x") (Date.) (str/join "," items)))`,
  ],
  [
    'cmake',
    'CMake',
    `# Top-level build
cmake_minimum_required(VERSION 3.16)
project(Demo VERSION 1.2.3 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
option(DEMO_TESTS "Build tests" ON)
#[[ a bracket
     comment ]]
if(DEMO_TESTS AND NOT WIN32 OR "\${CMAKE_BUILD_TYPE}" STREQUAL "Debug")
  add_subdirectory(tests)
endif()
add_executable(demo src/main.cpp src/util.cpp)
target_link_libraries(demo PRIVATE Qt5::Core $<$<CONFIG:Debug>:dbg>)
message(STATUS "Building \${PROJECT_NAME} in $ENV{HOME} \\"quoted\\"")
foreach(f IN LISTS SRCS)
  list(APPEND ALL "\${f};x")
endforeach()
set(DOC [[raw
text]])`,
  ],
  [
    'cobol',
    'COBOL',
    `000100 IDENTIFICATION DIVISION.                                         PAYROLL1
000200 PROGRAM-ID. PAYROLL.
000300* Payroll report
000400 DATA DIVISION.
000500 WORKING-STORAGE SECTION.
000600 01  WS-TOTAL        PIC S9(7)V99 COMP-3 VALUE ZERO.
000700 01  WS-NAME         PIC X(30) VALUE "It""s".
000800 01  WS-EOF          PIC X VALUE 'N'.
000900     88  END-OF-FILE VALUE 'Y'.
001000 PROCEDURE DIVISION.
001100 MAIN-PARA.
001200     PERFORM CALC-TOTAL UNTIL END-OF-FILE
001300     IF WS-TOTAL > 1000.50 AND NOT END-OF-FILE
001400        DISPLAY "Total: " WS-TOTAL      *> show it
001500     END-IF
001600     MOVE "A LONG LITERAL THAT CONTIN
001700-    "UES HERE" TO WS-NAME
001800     STOP RUN.
001900 CALC-TOTAL.
002000     COMPUTE WS-TOTAL = WS-TOTAL + 1
002100     MOVE 'Y' TO WS-EOF.`,
  ],
  [
    'codeowners',
    'CODEOWNERS',
    `# Code owners for the repo
*                     @org/core-team
*.js                  @js-owner @dev-team # JS files
/docs/                docs@example.com
/build/logs/ @doctocat
\\#notes.md            @writer
src/my\\ app/      @app-team
!/docs/internal/

[Documentation][2] @docs-team
docs/**/*.md
^[Optional ]
/scripts/             @ops`,
  ],
  [
    'codeql',
    'CodeQL',
    `/**
 * @name Unsafe command
 * @kind problem
 */
import java
import semmle.code.java.dataflow.DataFlow

/* Calls that run a shell
   command */
class ExecCall extends MethodAccess {
  ExecCall() { this.getMethod().hasName("exec\\n") }

  pragma[inline]
  override string toString() { result = "exec" }
}

predicate isTainted(DataFlow::Node node, int depth) {
  depth in [0 .. 3] and exists(@expr e | node.asExpr() = e)
}

// report every call
from ExecCall call, float weight
where weight = 1.5 and not call.getNumArgument() != 2
select call, "Shell call", count(Expr e | any()), true`,
  ],
  [
    'coffee',
    'CoffeeScript',
    `# Shopping cart model
###
Totals are cached and recomputed on change.
###
class Cart extends Model
  constructor: (@owner, items = []) ->
    super()
    @items = items

  add: (item, qty = 1) =>
    throw new Error "bad qty: #{qty}\\n" unless qty > 0
    @items.push {item, qty}
    this

  total: ->
    sum = 0
    sum += i.item.price * i.qty for i in @items when i?
    Math.round(sum * 100) / 100

isSku = /^[A-Z]{3}-\\d+$/i
mask = 0xff & 0b1010
note = """
  Owner: #{cart.owner}
"""
legacy = \`window.cart || null\``,
  ],
  [
    'coq',
    'Coq',
    `(** Natural number lemmas *)
Require Import Coq.Arith.PeanoNat.
Set Implicit Arguments.

Inductive tree (A : Type) : Type :=
  | Leaf : tree A
  | Node : tree A -> A -> tree A -> tree A.

Fixpoint size {A : Type} (t : tree A) : nat :=
  match t with
  | Leaf => 0
  | Node l _ r => size l + 1 + size r
  end.

Definition greeting := "say ""hi""
  across lines".

(* a nested (* comment
   *) still a comment *)
Theorem add_0_r : forall n : nat, n + 0 = n.
Proof.
  intros n. induction n as [| n' IHn'].
  - reflexivity.
  - simpl. rewrite IHn'. reflexivity.
Qed.

#[export] Hint Resolve add_0_r : core.
Check Nat.add 0x10 true.`,
  ],
  [
    'cpp',
    'C++',
    `#include <iostream>

struct Point {
  int x;
  int y;
};

constexpr int distance_squared(Point a, Point b) {
  const auto dx = a.x - b.x;
  const auto dy = a.y - b.y;
  return dx * dx + dy * dy;
}

int main() {
  std::cout << distance_squared({0, 0}, {3, 4}) << "\\n";
}`,
  ],
  [
    'csharp',
    'C#',
    `using System.Collections.Generic;

namespace Demo;

/// <summary>A labelled counter.</summary>
public sealed record Counter(string Label, int Count)
{
    private const int Max = 10;

    public Counter Increment() =>
        Count >= Max ? throw new InvalidOperationException("full")
                     : this with { Count = Count + 1 };

    public static void Main()
    {
        var c = new Counter("hits", 0).Increment();
        Console.WriteLine($"{c.Label}={c.Count}");
    }
}`,
  ],
  [
    'css',
    'CSS',
    `/* style.css */

:root {
  --accent: #60d199;
  color-scheme: dark;
}

.panel {
  display: grid;
  gap: 0.5rem 1rem;
  background: color-mix(in srgb, var(--accent) 12%, transparent);

  /* nested selectors are supported */
  & > header {
    font-weight: 600;

    &:hover { color: var(--accent) !important; }
  }
}

@media (width < 40rem) {
  .panel { grid-template-columns: 1fr; }
}`,
  ],
  [
    'csv',
    'CSV',
    `id,name,team,joined,notes
1,Ada Lovelace,Engines,1843-07-10,"Wrote the first program, by most accounts"
2,Grace Hopper,Compilers,1952-05-01,"Said ""ask forgiveness, not permission"""
3,Alan Turing,Machines,1936-11-12,"Quoted fields can span
two lines"
4,Katherine Johnson,Orbits,1953-06-01,`,
  ],
  [
    'cuda',
    'CUDA',
    `#include <cuda_runtime.h>

// Scale values on the GPU
__global__ void scale(float *values, int count) {
  int i = blockIdx.x * blockDim.x + threadIdx.x;
  /* Each thread
     handles one value. */
  if (i < count) values[i] *= 2.0f;
  __syncthreads();
}

void run(float *values) {
  scale<<<1, 256>>>(values, 256);
}`,
  ],
  [
    'cypher',
    'Cypher',
    `// Friends of friends
MATCH (p:Person {name: $name})-[r:KNOWS*1..3]->(f:Person)
OPTIONAL MATCH (f)<-[:WORKS_AT]-(c:\`Big Company\`)
WHERE p.age >= 18 AND NOT f.name STARTS WITH 'A\\'s'
/* collect the
   friends */
WITH p, collect(DISTINCT f.name) AS names, count(*) AS total
RETURN p {.name}, names, total * 1.5 AS score,
  CASE WHEN total > 0x10 THEN "many\\n" ELSE null END AS label, true
ORDER BY score DESC LIMIT 10;`,
  ],
  [
    'd',
    'D',
    `/// Geometry helpers
module app.geometry;
import std.stdio, std.conv : to;
/+ nested /+ comment +/ spans
   lines +/
@safe struct Point(T) {
    T x = 0x1F, y = 1.5e3f;
    @property T len() const pure nothrow { return x * y; }
}
enum Color { red, green }
void main(string[] args) {
    auto p = Point!int(1, 2);
    string s = "tab\\there
second line"w;
    auto raw = r"C:\\path" ~ \`tick\` ~ q"(text)" ~ q{ int y; };
    char c = '\\n';
    writeln(to!string(p.x), s, __LINE__);
    if (args.length > 0 && p !is null) foreach (i; 0 .. 10) writefln("%d", i);
    int[] arr = [1, 2, 3]; arr[$ - 1] = true ? 4 : 0;
}`,
  ],
  [
    'dart',
    'Dart',
    `import 'dart:math';

/// A point in 2D space.
class Point {
  final double x, y;
  const Point(this.x, this.y);

  double distanceTo(Point other) {
    final dx = x - other.x, dy = y - other.y;
    return sqrt(dx * dx + dy * dy);
  }

  @override
  String toString() => 'Point($x, $y)';
}

void main() {
  const a = Point(0, 0);
  print('\${a.distanceTo(const Point(3, 4))}');
}`,
  ],
  [
    'dax',
    'DAX',
    `// Sales measures
DEFINE
    MEASURE Sales[Total Sales] =
        VAR CurrentYear = YEAR ( TODAY () )
        RETURN
            CALCULATE (
                SUM ( Sales[Amount] ),
                'Date Table'[Year] = CurrentYear && NOT ISBLANK ( [Region] ),
                Sales[Channel] IN { "Web", "Store" }
            ) * 1.5e2 -- trailing
/* block comment
   across lines */
EVALUATE
    SUMMARIZECOLUMNS ( Product[Color], "Note", "Say ""hi""", "Flag", TRUE () )
ORDER BY [Total Sales] DESC`,
  ],
  [
    'diff',
    'Diff',
    `diff --git a/src/config.js b/src/config.js
index 1a2b3c4..5d6e7f8 100644
--- a/src/config.js
+++ b/src/config.js
@@ -1,4 +1,5 @@
 export const config = {
-  mode: "slow",
+  mode: "simd",
+  batchSize: 16,
 };`,
  ],
  [
    'dockerfile',
    'Dockerfile',
    `# syntax=docker/dockerfile:1
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN --mount=type=cache,target=/root/.pnpm \
    corepack enable && pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

FROM nginx:1.27 AS runtime
ARG PORT=8080
ENV PORT=\${PORT}
COPY --from=build /app/dist /usr/share/nginx/html
RUN <<EOF
echo "listen \${PORT}" >> /etc/nginx/conf.d/port.conf
EOF
EXPOSE 8080
HEALTHCHECK --interval=30s CMD wget -q -O - http://localhost:\${PORT}/ || exit 1
CMD ["nginx", "-g", "daemon off;"]`,
  ],
  [
    'dotenv',
    'Dotenv',
    `# Application settings
APP_NAME="Demo"
export PORT=8080
DEBUG=true
API_KEY='raw $value'
BASE_URL=https://\${HOST}:$PORT/api # inline note
GREETING="Hello\\n\${USER:-guest}"
PRIVATE_KEY="-----BEGIN KEY-----
abc123
-----END KEY-----"
EMPTY=
RATIO=0.75`,
  ],
  [
    'elixir',
    'Elixir',
    `defmodule Demo.Counter do
  @moduledoc """
  A labelled counter.
  """
  @max 10

  defstruct label: nil, count: 0

  def increment(%__MODULE__{count: count}) when count >= @max do
    {:error, :full}
  end

  def increment(%__MODULE__{} = counter) do
    {:ok, %{counter | count: counter.count + 1}}
  end

  def to_string(%{label: label, count: count}), do: "#{label}=#{count}"
end

{:ok, c} = Demo.Counter.increment(%Demo.Counter{label: :hits})
IO.puts(Demo.Counter.to_string(c))`,
  ],
  [
    'elm',
    'Elm',
    `module Main exposing (main)
import Html exposing (text)
{-| A nested {- comment -}
    describing the program. -}
type alias Model = { count : Int }
message = """Hello
world!"""
update model =
    if model.count > 0 then True else False
main = text (message ++ "\\n")`,
  ],
  [
    'erb',
    'ERB',
    `<%# Order summary, rendered per user %>
<!DOCTYPE html>
<section class="orders <%= @theme %>" data-count=<%= @orders.size %>>
  <% if @orders.empty? -%>
    <p>No orders &amp; no <em>pending</em> yet</p>
  <% else %>
    <% @orders.each_with_index do |order, i| %>
      <li id="order-<%= i + 1 %>"><%= order.total * 0x10 %></li>
    <% end %>
  <% end %>
</section>
<%= render "footer", locals: {
  note: "Thanks!\\n", year: 2024, ok: true
} %>
<p>Use <%%= to print a literal tag</p>`,
  ],
  [
    'erlang',
    'Erlang',
    `-module(counter).
-behaviour(gen_server).
-export([start_link/0, add/1]).
-record(state, {count = 0 :: integer()}).
-define(TIMEOUT, 5000).

%% Public API
start_link() ->
    gen_server:start_link({local, ?MODULE}, ?MODULE, [], []).

add(N) when is_integer(N), N > 0 ->
    gen_server:call(?MODULE, {add, N}, ?TIMEOUT).

%% Callbacks
init([]) -> {ok, #state{}}.

handle_call({add, N}, _From, State = #state{count = C}) ->
    io:format("adding ~p~n", [N]),
    {reply, C + N, State#state{count = C + N}};
handle_call(_Msg, _From, State) ->
    {reply, {error, unknown}, State}.

handle_cast(_Msg, State) -> {noreply, State}.`,
  ],
  [
    'fish',
    'Fish',
    `# Greet users
function greet --description 'Say "hi"'
    set -l name $argv[1]
    if test -z "$name"; and not set -q GREETING
        echo "Hello, $name! \\$5 $(date +%Y)" >&2
    else if contains -- $name admin root
        return 1
    end
    for i in (seq 1 3)
        echo $i 'it\\'s' \\x41 ""
    end
end
set -gx PATH "/usr/local/bin
$PATH"`,
  ],
  [
    'fortran',
    'Fortran',
    `program demo
  use iso_fortran_env, only: real64
  implicit none
  real(real64) :: x = 1.5d+2
  logical :: ready = .true.
  character(len=*), parameter :: message = "hello &
    &world"
  ! Print the result
  if (ready .and. x > 0) then
    print *, message, sqrt(x)
  end if
end program demo`,
  ],
  [
    'fortran-fixed-form',
    'Fortran (fixed form)',
    `C     Column-one C opens a comment line
Cno blank is needed after the marker
      PROGRAM DEMO
      INTEGER I, N
      REAL X(10)
      DATA N /10/
      DO 10 I = 1, N
        X(I) = SQRT(REAL(I)) * 2.0E0
   10 CONTINUE
      IF (X(1) .GT. 0.5) WRITE (*, '(A, F6.2)') 'first: ', X(1)
* an asterisk comment
      END`,
  ],
  [
    'fsharp',
    'F#',
    `/// A shape module.
module Demo.Shapes

open System

(* nested (* comment *) *)
type Shape =
    | Circle of radius: float
    | Rect of w: float * h: float

[<Struct>]
type Point = { X: int; Y: int }

let area (s: Shape) : float =
    match s with
    | Circle r when r > 0.0 -> Math.PI * r * r
    | Rect (w, h) -> w * h
    | _ -> 0.0

let mutable count = 0
let rec fact n = if n <= 1 then 1 else n * fact (n - 1)

type Counter() =
    member this.Count = count
    member _.Bump(n: int) = count <- count + n

let names = [ "a"; "b" ] |> List.map (fun s -> s.ToUpper())
let msg = $"total {count} of {names.Length}"
let raw = @"C:\\path\\""quoted"""
let tri = """multi
line"""
let c = 'x'
let opt: int option = Some 42
let big = 0x1F + 1_000L + 2.5e3
printfn "%s %d" msg 1
#if DEBUG
let debug = true
#endif`,
  ],
  [
    'gdresource',
    'Godot Resource',
    `[gd_scene load_steps=3 format=3 uid="uid://c4ylbqk3m2v1x"]

[ext_resource type="Script" path="res://player.gd" id="1_script"]

[sub_resource type="CircleShape2D" id="CircleShape2D_1"]
radius = 12.0

[node name="Player" type="CharacterBody2D"]
script = ExtResource("1_script")
metadata/_edit_group_ = true

[node name="Collision" type="CollisionShape2D" parent="."]
shape = SubResource("CircleShape2D_1")
points = PackedVector2Array(0, 0, 16, 8)
tags = Array[StringName]([&"hero", &"player"])

[connection signal="body_entered" from="." to="." method="_on_body_entered"]`,
  ],
  [
    'gdscript',
    'GDScript',
    `@tool
class_name Player
extends CharacterBody2D

## Emitted when the player picks up a coin.
signal coin_collected(total: int)

const SPEED := 220.0
@export var jump_height: float = 48.0
@onready var sprite: Sprite2D = $Visual/Sprite2D

var coins := 0

func _physics_process(delta: float) -> void:
    var input := Input.get_axis(&"move_left", &"move_right")
    velocity.x = input * SPEED
    if not is_on_floor():
        velocity.y += get_gravity().y * delta
    move_and_slide()

func collect(amount: int = 1) -> void:
    coins += amount
    %ScoreLabel.text = "Coins: %d" % coins
    coin_collected.emit(coins)`,
  ],
  [
    'gdshader',
    'Godot Shader',
    `shader_type canvas_item;
render_mode blend_mix, unshaded;

uniform vec4 tint : source_color = vec4(1.0);
uniform sampler2D noise : filter_linear_mipmap, repeat_enable;
uniform float speed : hint_range(0.0, 4.0) = 1.0;

varying vec2 world_uv;

void vertex() {
  world_uv = (MODEL_MATRIX * vec4(VERTEX, 0.0, 1.0)).xy;
}

void fragment() {
  float wave = texture(noise, world_uv * 0.01 + TIME * speed).r;
  COLOR = texture(TEXTURE, UV) * tint;
  COLOR.rgb *= 0.8 + 0.2 * sin(wave * TAU);
}`,
  ],
  [
    'gherkin',
    'Gherkin',
    `# language: en
@billing @smoke
Feature: Account balance
  Rules for customers

  Scenario Outline: Withdraw <amount>
    Given the account has 100 dollars
    When I withdraw "cash \\"now\\""
    Then the balance is <balance>
    And a receipt reads:
      """json
      {"total": 80}
      """

    Examples:
      | amount | balance |
      | 20     | 80      |`,
  ],
  [
    'gleam',
    'Gleam',
    `import gleam/int
import gleam/io
import gleam/list
import gleam/string

/// A geometric shape.
pub type Shape {
  Circle(radius: Float)
  Rect(width: Float, height: Float)
}

pub fn area(shape: Shape) -> Float {
  case shape {
    Circle(radius: r) -> 3.14159 *. r *. r
    Rect(width: w, height: h) -> w *. h
  }
}

@external(erlang, "erlang", "system_time")
fn now() -> Int

pub fn main() {
  let shapes = [Circle(1.0), Rect(2.0, 3.5)]
  let total =
    shapes
    |> list.map(area)
    |> list.fold(0.0, fn(acc, x) { acc +. x })
  let assert Ok(count) = int.parse("42")
  io.println("total: " <> string.inspect(total) <> " of " <> int.to_string(count))
  io.println("at " <> int.to_string(now()))
}`,
  ],
  [
    'glsl',
    'GLSL',
    `#version 450

layout(location = 0) in vec3 normal;
layout(location = 1) in vec2 uv;
layout(location = 0) out vec4 outColor;

uniform sampler2D albedo;

void main() {
  vec3 light = normalize(vec3(0.4, 0.8, 0.2));
  float diffuse = max(dot(normal, light), 0.0);
  outColor = texture(albedo, uv) * vec4(vec3(diffuse), 1.0);
}`,
  ],
  [
    'gnuplot',
    'Gnuplot',
    `# Plot sine waves
set terminal pngcairo size 800,600 font 'Arial,10'
set output "plot\\t.png"
set xrange [-pi:pi]
f(x, a) = a * sin(x) + 0.5e-3
$Data << EOD
1 2.5
2 3.5
EOD
plot $Data u 1:2 w lp t "data", \\
     f(x, 2) with lines lw 2
do for [i=1:3] {
    print sprintf("i=%d", i)
}`,
  ],
  [
    'go',
    'Go',
    `package main

import "fmt"

type Point struct {
    X, Y int
}

func distanceSquared(a, b Point) int {
    dx, dy := a.X-b.X, a.Y-b.Y
    return dx*dx + dy*dy
}

func main() {
    fmt.Println(distanceSquared(Point{0, 0}, Point{3, 4}))
}`,
  ],
  [
    'graphql',
    'GraphQL',
    `"""
A registered user.
"""
type User implements Node {
  id: ID!
  name: String!
  role: Role = MEMBER
  posts(first: Int = 10, after: String): PostConnection!
}

enum Role {
  ADMIN
  MEMBER
}

input NewUser {
  name: String!
  email: String!
}

directive @auth(role: Role = MEMBER) on FIELD_DEFINITION

# Fetch a user with their latest posts
query GetUser($id: ID!, $withPosts: Boolean = false) {
  user(id: $id) {
    id
    name
    ...UserFields
    posts(first: 3) @include(if: $withPosts) {
      edges { node { title } }
    }
  }
}

fragment UserFields on User {
  role
}

mutation CreateUser($input: NewUser!) {
  createUser(input: $input) { id }
}`,
  ],
  [
    'groq',
    'GROQ',
    `*[_type == 'movie' && releaseYear >= 1979] | order(releaseYear){
  _id, title, releaseYear,
  "directorName": director->name
}[0...100]`,
  ],
  [
    'groovy',
    'Groovy',
    `#!/usr/bin/env groovy
package demo

import groovy.transform.ToString

/**
 * A shape.
 */
@ToString
class Circle implements Shape {
    static final double PI2 = Math.PI * 2
    Double radius = 1.5

    double area() {
        return PI2 / 2 * radius ** 2
    }

    def describe(String name = 'circle', int count = 1) {
        def msg = "$name has \${count} item\${count > 1 ? 's' : ''}"
        println msg
        return [name: name, count: count, ok: true]
    }
}

// Gradle-style DSL
dependencies {
    implementation 'org.example:lib:1.0'
    testImplementation group: 'junit', name: 'junit', version: '4.13'
}

def shapes = [new Circle(2), new Circle(0x10)] as List
for (s in shapes) {
    switch (s.radius) {
        case 2: println "two"; break
        default: println '''multi
line'''
    }
}
assert shapes.size() == 2L && shapes[0] instanceof Circle
def text = """triple \${shapes[0].area()}
quoted"""
def f = { a, b -> a <=> b }`,
  ],
  [
    'hack',
    'Hack',
    `<?hh // strict
/**
 * Inventory service
 */
namespace App\\Inventory;

enum Status: string {
  ACTIVE = 'active';
  RETIRED = 'retired';
}

<<__ConsistentConstruct>>
final class Item<T as arraykey> {
  const int LIMIT = 0x10;

  public function __construct(private T $id, private ?string $name = null) {}

  <<__Memoize>>
  public async function loadAsync(dict<string, mixed> $opts): Awaitable<vec<int>> {
    $ids = await fetch_ids_async($this->id, $opts['limit'] ?? 10);
    return $ids |> Vec\\map($$, ($n) ==> $n * 2.5);
  }
}

function describe(Item<int> $item, shape('count' => int) $s): string {
  // escapes and a heredoc
  $label = "count:\\t{$s['count']}";
  return <<<EOT
Item $label
EOT;
}`,
  ],
  [
    'haml',
    'Haml',
    `!!! 5
-# Order page, rendered per user
%html{lang: "en"}
  %head
    %title= @title || "Orders\\t"
    :css
      .total { color: #c00; /* sale
         price */ }
  %body#orders.page{data: {count: @orders.size,
                           ready: true}}
    / Visible html comment
    - @orders.each_with_index do |order, i|
      %li.order(id="order-#{i}" data-n=i)= order.total * 0x10
      %p Total for #{order.name}: \\n escapes stay text
    - if @orders.empty?
      %p.empty No orders yet
    :javascript
      const n = \`\${1 + 2}\`;`,
  ],
  [
    'handlebars',
    'Handlebars',
    `{{!-- Comment list partial,
      rendered per post --}}
<ul class="comments {{#if empty}}empty{{/if}}">
  {{#each comments as |comment index|}}
    <li id="c-{{index}}">{{comment.author.name}}: {{{comment.html}}}</li>
    {{> reply-button target=comment.id size=12 label="Reply \\"now\\""}}
  {{else}}
    <li>{{t "comments.none"}} &amp;</li>
  {{/each}}
</ul>
{{! inline comment }}
{{#with author}}{{../title}} by {{this.name}} ({{@root.site}}){{/with}}
{{format-date published "long" utc=true}}`,
  ],
  [
    'haskell',
    'Haskell',
    `module Main where

data Point = Point Int Int
  deriving (Eq, Show)

distanceSquared :: Point -> Point -> Int
distanceSquared (Point ax ay) (Point bx by) =
  let dx = ax - bx
      dy = ay - by
  in dx * dx + dy * dy

main :: IO ()
main = print (distanceSquared (Point 0 0) (Point 3 4))`,
  ],
  [
    'haxe',
    'Haxe',
    `package demo.app;

import haxe.ds.StringMap;
using StringTools;

/** Greets one name */
@:keep
class Greeter<T> extends Base implements IGreeter {
  static inline var MAX_COUNT:Int = 0xFF;
  public var name(default, null):String;
  var pattern = ~/^[a-z]+\\d*$/i;

  public function new(name:String) {
    super();
    this.name = 'Hi $name, \${name.length} chars\\t$$';
  }

  // a string literal may span lines
  public function render(count:Float = 1.5e3):Void {
    var text = "first line
second line \\u0041";
    for (i in 0...10) trace(i);
    #if (js && !debug)
    js.Browser.alert(text);
    #else
    Sys.println(cast(count, Int));
    #end
    if (name != null && count > 0) return;
  }
}

enum abstract Color(Int) { var Red = 1; }
typedef Point = { x:Float, y:Float, ok:Bool };
var done = true;`,
  ],
  [
    'hlsl',
    'HLSL',
    `cbuffer Params : register(b0) {
  float4x4 mvp;
  float2 uv_scale;
};

Texture2D<float4> tex : register(t0);
SamplerState samp : register(s0);

struct VSOut {
  float4 pos : SV_Position;
  float2 uv : TEXCOORD0;
};

VSOut vs_main(float3 pos : POSITION, float2 uv : TEXCOORD0) {
  VSOut o;
  o.pos = mul(mvp, float4(pos, 1.0));
  o.uv = uv * uv_scale;
  return o;
}

[earlydepthstencil]
float4 ps_main(VSOut i) : SV_Target {
  float4 c = tex.Sample(samp, i.uv);
  if (c.a < 0.5f) discard;
  return c * 0.5h;
}`,
  ],
  [
    'html',
    'HTML',
    `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Hello, highlights</title>
  <style>
    body { font: 16px/1.5 system-ui; background: #0a0a0a; color: #fafafa; }
    .card { padding: 1rem; border: 1px solid #333; border-radius: 8px; }
  </style>
</head>
<body>
  <!-- one pass over WebAssembly linear memory -->
  <main class="card" data-lang="html">
    <h1>Fast &amp; tiny</h1>
    <button id="go" disabled>Highlight</button>
  </main>
  <script type="module">
    const btn = document.querySelector("#go");
    btn.disabled = false;
    btn.addEventListener("click", () => console.log("go!"));
  </script>
</body>
</html>`,
  ],
  [
    'http',
    'HTTP',
    `@host = https://api.example.com

### Create a user
# @name createUser
POST {{host}}/users?page=2 HTTP/1.1
Content-Type: application/json

{
  "name": "\\n",
  "tags": ["a", "b"],
  "age": 42
}

###
// fetch the feed
GET {{host}}/feed HTTP/1.1

<feed id="1">
  <!-- spans
       lines -->
  <entry>Hi &amp; bye</entry>
</feed>

###
HTTP/1.1 200 OK
Content-Length: 4

done`,
  ],
  [
    'ini',
    'INI',
    `; Service unit
[Unit]
Description="Web \\"api\\" server"
After = network.target
# restart policy
[Service]
Restart=always
Port = 8080
Enabled=true
Name[de]=Hallo
[remote "origin"]
url = https://example.com/x
message=first \\
  second line
flag`,
  ],
  [
    'java',
    'Java',
    `package demo;

import java.util.List;

/** A labelled counter. */
public record Counter(String label, int count) {
  private static final int MAX = 10;

  public Counter increment() {
    if (count >= MAX) throw new IllegalStateException("full");
    return new Counter(label, count + 1);
  }

  public static void main(String[] args) {
    var c = new Counter("hits", 0).increment();
    System.out.printf("%s=%d%n", c.label(), c.count());
  }
}`,
  ],
  [
    'jinja',
    'Jinja',
    `{# Post list template,
   rendered per page #}
{% extends "layouts/base.html" %}
{% block content %}
<ul class="posts {{ 'empty' if not posts }}">
{% for post in posts|sort(attribute="date", reverse=true) if post.visible %}
  <li data-id="{{ post.id }}">{{ post.title|title }} &amp; {{ "a\\tb" }}</li>
{% else %}
  <li>{{ _("No posts") }}</li>
{% endfor %}
</ul>
{% set total = posts|length * 2 + 0.5 %}
{% if total is not none and loop is defined %}{{ total|round(1) }}{% endif %}
{% raw %}{{ shown as is }}{% endraw %}
{% endblock %}`,
  ],
  [
    'js',
    'JavaScript',
    `/**
 * Memoizes a function.
 * @param {Function} fn - The function to memoize.
 * @returns {Function} The memoized function.
 */
function memoize(fn) {
  const cache = new Map();
  return (...args) => {
    const key = JSON.stringify(args);
    if (!cache.has(key)) cache.set(key, fn(...args));
    return cache.get(key);
  };
}

// Slugifies a title.
const slug = memoize((title) =>
  title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")
);

console.log(\`slug: \${slug("Hello, WAT & Wasm!")}\`);`,
  ],
  [
    'json5',
    'JSON5',
    `// JSON5 allows comments, unquoted keys, and trailing commas
{
  name: 'highlights-playground',
  version: "1.0.0",
  hex: 0xC0FFEE,
  ratio: .5,
  limits: [+Infinity, -Infinity, NaN],
  multiline: 'first line \\
second line \\x41',
  /* nested settings */
  wasm: { simd: true, pages: 3, },
}`,
  ],
  [
    'jsonc',
    'JSON/JSONC',
    `// comments and trailing commas are supported
{
  "name": "highlights-playground",
  "theme": "pierre-dark",
  "langs": ["tsx", "html", "css", "jsonc"],
  "wasm": {
    "simd": true, /* 16 bytes per step */
    "pages": 3,
  },
  "escape": "a\\nb \\u0041",
  "fallback": null,
}`,
  ],
  [
    'jsonl',
    'JSON Lines',
    `{"id": 1, "event": "open", "path": "/src/main.ts", "ok": true}
{"id": 2, "event": "edit", "range": [10, 24], "text": "const x = 1;\\n"}
{"id": 3, "event": "save", "size": 2048, "meta": null}`,
  ],
  [
    'jsonnet',
    'Jsonnet',
    `// Service config
local lib = import 'lib.libsonnet';
local port = 8080;
local greet(name, punct='!') = 'Hello, ' + name + punct;
/* block
   comment */
{
  name: "api\\tserver",
  hidden:: std.length([1, 2.5e3]),
  method(x):: x * port,
  [std.toString(port)]: null,
  script: |||
    echo "hi"
  |||,
  verbatim: @'it''s',
  list: [x for x in [1, 2] if x > 1],
  enabled: true,
  parent: self.name + super.base + $.name,
}`,
  ],
  [
    'jsx',
    'JSX',
    `import React, { useState } from 'react';

/** A counter button. */
export function Counter({ initial = 0, label }) {
  const [count, setCount] = useState(initial);
  const items = [1, 2, 3];
  return (
    <div className="counter" data-count={count} onClick={() => setCount(count + 1)}>
      <Button.Icon name="plus" disabled={count > 0x10} />
      {label ? <span>{label}: {count}</span> : null}
      <ul>
        {items.map((n) => <li key={n}>{\`item \${n}\`}</li>)}
      </ul>
      {/* comment */}
      <>fragment &amp; text</>
    </div>
  );
}`,
  ],
  [
    'julia',
    'Julia',
    `# Statistics helpers
module Stats

using LinearAlgebra: norm
export mean, Point

#= a block
   comment =#
const MAX_ITER = 1_000
abstract type Shape end
struct Point{T<:Real} <: Shape
    x::T
    y::T
end

"""
Compute the mean of \`xs\`.
"""
function mean(xs::Vector{Float64}; skip=false)::Float64
    isempty(xs) && return NaN
    total = 0.0
    for (i, x) in enumerate(xs)
        total += x
    end
    return total / length(xs)
end

sq(x) = x^2
norm2(p::Point) = sqrt(p.x^2 + p.y^2)

function Base.show(io::IO, p::Point)
    print(io, "Point($(p.x), $(p.y)) $MAX_ITER")
end

let v = [1, 2, 3]'
    m = v' * v
    r = r"\\d+"
    c = 'x'; d = '\\n'
    ok = true && !false || nothing === missing
    @assert length(v) == 3 "bad"
    push!(v, 0x1F + 2im)
    lst = [x for x in 1:10 if x % 2 == 0]
    sym = :foo
    println(\`ls -la $(homedir())\`)
end

end # module`,
  ],
  [
    'just',
    'Just',
    `# Build tasks
set shell := ["bash", "-uc"]
export RUST_LOG := "debug\\t\\u{1F600}"
version := \`git describe --tags\`
alias b := build

[group('ci')]
build target='debug' +flags='': clean (lint "src")
    @echo "Building {{target}} with {{ flags }}"
    cargo build --{{target}} -j 4 | tee build.log

doc := '''
  multi-line
'''`,
  ],
  [
    'kdl',
    'KDL',
    `// Package manifest
package {
  name "my-pkg"
  description "Say \\"hi\\" to \\u{1F600}\\n"
  (date)released "2024-12-21"
  authors {
    - "Alice" email="alice@example.com" admin=#true
  }
  limits max=0xFF min=-1.5e3 size=1_000 ratio=#inf none=#null
  /- disabled "skip" { child }
  flags 1 /-2 3 \\ // continued
    4 5
  script #"C:\\path "quoted""#
  notes """
    multi-line text
    """
  /* block /* nested */ comment */
}`,
  ],
  [
    'kotlin',
    'Kotlin',
    `data class Point(val x: Int, val y: Int)

fun distanceSquared(a: Point, b: Point): Int {
    val dx = a.x - b.x
    val dy = a.y - b.y
    return dx * dx + dy * dy
}

fun main() {
    val distance = distanceSquared(Point(0, 0), Point(3, 4))
    println("distance² = \${distance}")
}`,
  ],
  [
    'latex',
    'LaTeX',
    `\\documentclass[11pt]{article}
\\usepackage{amsmath, graphicx}

% Title block
\\title{Notes on \\emph{Highlights}}
\\author{Pierre}

\\begin{document}
\\maketitle

\\section{Introduction}\\label{sec:intro}
Inline math $e^{i\\pi} + 1 = 0$ and a \\textbf{bold} claim, see~\\eqref{eq:sum}.

\\begin{equation}
  \\sum_{k=1}^{n} k = \\frac{n(n+1)}{2} \\label{eq:sum}
\\end{equation}

\\begin{itemize}
  \\item Docs at \\url{https://diffs.com}
  \\item Inline code: \\verb|raw_text|
\\end{itemize}

\\newcommand{\\R}{\\mathbb{R}}
\\end{document}`,
  ],
  [
    'lean',
    'Lean',
    `import Mathlib
/-! Module documentation -/
namespace Demo
/-- Prove an implication. /- Nested explanation -/ -/
@[simp] theorem identity (p : Prop) : p → p := by
  intro h
  exact h
def count : Nat := 12
def ready : Bool := true
def message := "first\\n
-- still a string"
def raw := r##"raw "# content
with \\slashes"##
def «quoted name» := 'λ'
-- A normal comment
#check ∀ (α : Type), α → α
end Demo`,
  ],
  [
    'less',
    'Less',
    `// Variables and mixins
@primary: #3b82f6;
@radius: 4px;

.rounded(@r: @radius) {
  border-radius: @r;
}

.card {
  .rounded();
  color: darken(@primary, 10%);
  padding: (@radius * 2);

  &-title {
    font-weight: bold;
  }

  &:hover when (lightness(@primary) > 50%) {
    background: @primary;
  }

  @media (min-width: 768px) {
    width: ~"calc(100% - @{radius})";
  }
}`,
  ],
  [
    'liquid',
    'Liquid',
    `{% comment %}
  Product card
{% endcomment %}
{%- assign title = product.title | escape | append: " - Shop" -%}
<div class="card {% if product.available %}in-stock{% endif %}">
  <h2>{{ title | truncate: 40 }}</h2>
  {% for image in product.images limit: 3 %}
    <img src="{{ image | image_url: width: 400 }}" alt="{{ image.alt }}">
  {% endfor %}
  {% if product.price > 1000 and forloop.first == false %}{{ 'sale' | t }}{% endif %}
  {% render 'price', product: product, show_compare: true %}
</div>
{% liquid
  # stock note
  assign stock = product.inventory | plus: 0.5
  echo stock
%}`,
  ],
  [
    'lisp',
    'Lisp',
    `;;; A labelled counter.
(defpackage :demo (:use :cl))
(in-package :demo)

(defconstant +max+ 10)

(defstruct counter label (count 0))

(defun increment (c)
  "Return a copy of C with its count bumped."
  (when (>= (counter-count c) +max+)
    (error "full: ~a" (counter-label c)))
  (make-counter :label (counter-label c)
                :count (1+ (counter-count c))))

(let ((c (increment (make-counter :label :hits))))
  (format t "~a=~d~%" (counter-label c) (counter-count c)))`,
  ],
  [
    'llvm',
    'LLVM IR',
    `; ModuleID = 'demo.c'
source_filename = "demo.c"
target triple = "arm64-apple-macosx14.0.0"

%struct.Point = type { i32, [2 x i8], <4 x float> }
@.str = private unnamed_addr constant [4 x i8] c"\\CE\\BB\\0A\\00", align 1
@flag = dso_local global i1 true, align 1

; Function Attrs: noinline nounwind
define dso_local i32 @main(i32 noundef %0) #0 !dbg !10 {
entry:
  %1 = alloca i32, align 4
  store i32 %0, ptr %1, align 4
  %2 = load i32, ptr %1, align 4
  %cmp = icmp slt i32 %2, -10
  br i1 %cmp, label %then, label %3

then:
  %call = call i32 (ptr, ...) @printf(ptr noundef @.str), !dbg !12
  br label %3

3:
  %r = phi i32 [ 0, %entry ], [ 1, %then ]
  ret i32 %r
}

declare i32 @printf(ptr noundef, ...) #1
attributes #0 = { noinline nounwind "frame-pointer"="all" }
!0 = !{i32 7, !"PIC Level", i32 2}
!12 = !DILocation(line: 3, column: 5, scope: !10, flags: DIFlagPrototyped)`,
  ],
  [
    'log',
    'Log',
    `2026-10-25T10:00:01.123Z INFO  [main] com.example.App - Started in 3.2s
[2026-10-25 10:00:01,123] ERROR Failed to connect to "db.local:5432"
Oct 25 10:00:01 host sshd[1234]: Accepted key from 10.0.0.1 port 22
WARN  Disk usage 91% on /dev/sda1, id f47ac10b-58cc-4372-a567-0e02b2c3d479
DEBUG cache miss key='user:42' level=trace [E]
java.lang.NullPointerException: name is null
	at com.example.App.run(App.java:17)
Traceback (most recent call last):
ValueError: see https://example.com/docs?a=1&b=2.
127.0.0.1 - - [25/Oct/2026:10:00:01 +0000] "GET /x HTTP/1.1" 200 true`,
  ],
  [
    'lua',
    'Lua',
    `local function greet(name)
  return ("Hello, %s!"):format(name)
end

local users = { "Ada", "Linus", "Grace" }
local greetings = {}

for index, name in ipairs(users) do
  greetings[index] = greet(name)
end

table.sort(greetings)

for index, message in ipairs(greetings) do
  print(index, message)
end`,
  ],
  [
    'luau',
    'Luau',
    `--!strict
--- Inventory helpers
local HttpService = game:GetService("HttpService")

export type Item = {
	id: number,
	name: string,
	tags: { string }?,
}

type Callback<T> = (item: T, index: number) -> boolean

--[[ Filter items
     across lines ]]
local function filter<T>(items: { T }, predicate: Callback<T>): { T }
	local out: { T } = {}
	for i, item in items do
		if not predicate(item, i) then continue end
		table.insert(out, item)
	end
	return out
end

@native
local function total(items: { Item }): number
	local sum = 0x1F + 1_000 + 0b1010
	for _, item in items do sum += item.id end
	return sum :: number
end

local label = \`Total: {total({})} items\\n\`
print(label, "tab\\there", nil, true, MAX_ITEMS)`,
  ],
  [
    'makefile',
    'Makefile',
    `# Build config
CC := gcc
CFLAGS ?= -O2 -Wall $(EXTRA)
SRCS = $(wildcard src/*.c) \\
       lib/util.c
OBJS = $(patsubst %.c,%.o,$(SRCS))
export VERBOSE

.PHONY: all clean
all: app | dirs

app: $(OBJS)
	@echo "linking $@ with $(CC)"
	$(CC) $(CFLAGS) -o $@ $^ 2>&1 | tee log.txt

%.o: %.c
	$(CC) -c $< -o $@

ifeq ($(OS),Windows_NT)
  RM = del
else
  RM = rm -f
endif

define helper
	@echo $(1)
endef

clean:
	-$(RM) $(OBJS) app ; echo done
	cd $$HOME && ls`,
  ],
  [
    'markdown',
    'Markdown',
    `---
title: Fast highlighting
draft: false
tags: [wasm, simd]
---

# Highlights

Use \`codeToHtml\` to highlight code in one pass.

<aside data-kind="tip">Inline HTML is highlighted too.</aside>

\`\`\`rust
fn main() {
    println!("hello");
}
\`\`\``,
  ],
  [
    'matlab',
    'MATLAB',
    `% Compute statistics
%{
block
comment
%}
function [m, s] = stats(x, varargin)
    % mean and std
    n = numel(x);
    m = sum(x) / n;
    s = sqrt(sum((x - m).^2) / (n - 1));
    if nargin > 1 && strcmp(varargin{1}, 'robust')
        m = median(x);
    elseif isempty(x)
        m = NaN; s = Inf;
    end
end

classdef Shape < handle
    properties
        Name = "circle"
        Radius double = 1.5
    end
    methods
        function a = area(obj)
            a = pi * obj.Radius^2;
        end
    end
end

A = [1 2; 3 4]';
B = A.' * A;
f = @(t) sin(t) .* cos(t);
for k = 1:numel(A)
    fprintf('%d: %s\\n', k, 'it''s');
end
x = 0x1F + 2.5e3 + 3i;
y = ~(A == B) | A ~= 0;
z = x ...
    + 1; % continued
disp(MAX_VAL)`,
  ],
  [
    'mdx',
    'MDX',
    `export const meta = { title: "Language examples" };
export const languages = ["Rust", "WAT", "MDX"];

# {meta.title}

<Card tone="accent">
  MDX mixes **Markdown** with <code>JSX</code>.
</Card>

<Grid columns={3}>
  {languages.map((lang, index) => (
    <Badge key={lang} featured={index === 0}>
      {index + 1}. {lang}
    </Badge>
  ))}
</Grid>`,
  ],
  [
    'mermaid',
    'Mermaid',
    `---
title: Checkout
---
%% Order pipeline
flowchart LR
    A[Cart] -->|pay| B{Valid?}
    B -- yes --> C(("Ship #quot;now#quot;
      today"))
    B -.-> D>Retry 3x]:::warn
    subgraph S [Store]
      direction TB
    end
    classDef warn fill:#f96,stroke-width:2px`,
  ],
  [
    'moonbit',
    'MoonBit',
    `///| A point on a grid.
pub(all) struct Point {
  x : Int
  mut y : Int
} derive(Show, Eq)

///|
#deprecated("use dist")
fn Point::dist(self : Point, other~ : Point) -> Double {
  let dx = (self.x - other.x).to_double()
  let dy = (self.y - other.y).to_double()
  (dx * dx + dy * dy).sqrt()
}

///|
fn[T : Show] describe(items : Array[T], limit? : Int) -> String raise Error {
  let mut count = 0 // loop counter
  for i in 0..<items.length() {
    guard i < 0xFF else { break }
    count = count + 1
  }
  let text =
    #|raw \\n line
    $|count: \\{count}
  match limit {
    Some(n) if n < count => fail("over \\{n}\\t\\u{1F600}")
    None => text + b'a'.to_string()
    _ => @strconv.parse_int("42").to_string() + 1_000L.to_string()
  }
}

test "dist" {
  let p = Point::{ x: 3, y: 4 }
  assert_eq(p.dist(other=Point::{ x: 0, y: 0 }), 5.0)
  inspect(true, content="true")
}`,
  ],
  [
    'nginx',
    'Nginx',
    `# Reverse proxy
worker_processes auto;
http {
    include /etc/nginx/mime.types;
    server {
        listen 80;
        client_max_body_size 10m;
        gzip on;
        location ~* \\.(png|jpg)$ { expires 30d; }
        location / {
            proxy_set_header Host $host;
            if ($request_method = POST) { return 405; }
            rewrite ^/old/(.*)$ /new/$1 permanent;
        }
        set $note "\${uri}\\n
            second line";
    }
}`,
  ],
  [
    'nim',
    'Nim',
    `## Statistics helpers
import std/[strutils, strformat]

type
  Point* = object
    x*, y*: float

const MaxIter = 1_000'i32

proc mean*(xs: openArray[float]): float {.inline.} =
  ## Returns the mean of \`xs\`.
  if xs.len == 0: return NaN
  for x in xs:
    result += x
  result /= xs.len.float

#[ a block
   comment ]#
let p = Point(x: 1.5, y: 0x10.float)
echo "mean: ", mean([1.0, 2.0, 3.0]), '\\n'
echo fmt"point {p.x} {p.y}"`,
  ],
  [
    'nix',
    'Nix',
    `# A flake-style module
{ config, lib, pkgs, ... }:

let
  inherit (lib) mkOption types;
  version = "1.2.3";
  src = ./src;
  greeting = "hello \${config.user.name}!";
  banner = ''
    multi \${version}
    ''\${escaped} and '''quotes'''
  '';
  url = https://example.org/x?y=1;
  count = 3 + 4 * 2;
in rec {
  /* block
     comment */
  options.services.demo.enable = mkOption {
    type = types.bool;
    default = false;
    description = "Enable demo";
  };
  packages = with pkgs; [ hello git ];
  build = import <nixpkgs> { inherit pkgs; };
  f = x: y: if x == null then throw "bad" else x // y;
  list = builtins.map (n: n + 1) [ 1 2 3 ];
  ok = true && !false || (count >= 10);
}`,
  ],
  [
    'objc',
    'Objective-C',
    `#import <Foundation/Foundation.h>

@interface Counter : NSObject
@property (nonatomic, copy, readonly) NSString *label;
@property (nonatomic, readonly) NSInteger count;
- (instancetype)initWithLabel:(NSString *)label count:(NSInteger)count;
- (Counter *)increment;
@end

@implementation Counter
- (instancetype)initWithLabel:(NSString *)label count:(NSInteger)count {
  if ((self = [super init])) {
    _label = [label copy];
    _count = count;
  }
  return self;
}

- (Counter *)increment {
  return [[Counter alloc] initWithLabel:self.label count:self.count + 1];
}
@end

int main(void) {
  @autoreleasepool {
    Counter *c = [[[Counter alloc] initWithLabel:@"hits" count:0] increment];
    NSLog(@"%@=%ld", c.label, (long)c.count);
  }
  return 0;
}`,
  ],
  [
    'ocaml',
    'OCaml',
    `(* A labelled counter. *)
type counter = { label : string; count : int }

exception Full of string

let max = 10

let increment c =
  if c.count >= max then raise (Full c.label)
  else { c with count = c.count + 1 }

let to_string { label; count } = Printf.sprintf "%s=%d" label count

let () =
  let c = increment { label = "hits"; count = 0 } in
  print_endline (to_string c)`,
  ],
  [
    'odin',
    'Odin',
    `// A small shop example.
package main

import "core:fmt"
import strings "core:strings"

@(private="file")
MAX_ITEMS :: 10

Item :: struct {
	name:  string,
	price: f32,
}

Category :: enum { Food, Drink }

total :: proc(items: []Item) -> (sum: f32) {
	for item, i in items {
		if i >= MAX_ITEMS {
			break
		}
		sum += item.price
	}
	return
}

main :: proc() {
	items := []Item{{"tea", 2.5}, {"cake", 0x10}}
	label := """
shop
total
"""
	upper, err := strings.to_upper(label)
	if err != nil {
		fmt.eprintln("failed:", err, nil, true)
		return
	}
	/* nested /* comment */ still */
	fmt.println(upper, total(items), ---)
}`,
  ],
  [
    'openscad',
    'OpenSCAD',
    `// Parametric box
include <BOSL2/std.scad>
$fn = 64;
/** Wall size in mm,
    spanning lines */
size = [20, 30.5, 1e1];
label = "Box \\"A\\"";
module box(s = 10, center = false) {
    difference() {
        cube(s, center = center);
        #translate([1, 1, -1]) cube(s - 2);
        %sphere(r = s / 2, $fn = 32);
    }
}
function area(w, h) = w * h;
for (i = [0:2:10]) echo(i, PI);
if (!is_undef(size) && len(size) == 3) *box(size[0]); else !box(undef);`,
  ],
  [
    'pascal',
    'Delphi / Object Pascal',
    `unit Shapes;

{$mode objfpc}{$H+}

interface

uses
  SysUtils, System.Generics.Collections;

type
  { A shape }
  TShape = class(TObject)
  private
    FName: string;
  public
    constructor Create(const AName: string); overload;
    function Area: Double; virtual; abstract;
    property Name: string read FName write FName;
  end;

  PShape = ^TShape;
  TShapes = array[0..MAX_SHAPES - 1] of TShape;

const
  MAX_SHAPES = $FF;
  Version = 'v1.0''s';

implementation

(* block
   comment *)
constructor TShape.Create(const AName: string);
begin
  inherited Create;
  FName := AName;
end;

function TCircle.Area: Double;
var
  i: Integer;
begin
  Result := Pi * Sqr(FRadius);
  for i := 0 to 10 do
    if (i mod 2 = 0) or (i in [1, 3]) then
      WriteLn(Format('%d: %s', [i, FName]) + #13#10);
  case i of
    1: Exit;
    2..5: Self.FRadius := %1010;
  else
    Result := nil <> nil;
  end;
end;

end.`,
  ],
  [
    'perl',
    'Perl',
    `#!/usr/bin/perl
use strict;
use warnings;

package Demo::Counter;

my $MAX = 10;

sub new {
    my ($class, %args) = @_;
    return bless { label => $args{label}, count => $args{count} // 0 }, $class;
}

sub increment {
    my $self = shift;
    die "full\n" if $self->{count} >= $MAX;
    return Demo::Counter->new(%$self, count => $self->{count} + 1);
}

my $c = Demo::Counter->new(label => 'hits')->increment;
printf "%s=%d\n", $c->{label}, $c->{count};`,
  ],
  [
    'php',
    'PHP',
    `<?php
declare(strict_types=1);

function greet(string $name): string {
    return "Hello, {$name}!";
}

$names = ["Ada", "Linus"];
?>
<ul>
<?php foreach ($names as $name): ?>
  <li><?= greet($name) ?></li>
<?php endforeach ?>
</ul>`,
  ],
  [
    'plsql',
    'PL/SQL',
    `-- Payroll package
CREATE OR REPLACE PACKAGE BODY hr.payroll AS
  /* Raise every salary
     in one department */
  PROCEDURE raise_all(p_dept IN NUMBER, p_pct NUMBER := 5) IS
    l_note VARCHAR2(200) := q'[It's "quoted"
across lines]';
    l_row employees%ROWTYPE;
  BEGIN
    <<rows_loop>>
    FOR r IN (SELECT * FROM employees WHERE dept_id = :dept) LOOP
      UPDATE employees SET salary = salary * 1.05 WHERE id = r.id;
      dbms_output.put_line('Done: ' || r.name || '.');
    END LOOP rows_loop;
    COMMIT;
  EXCEPTION
    WHEN NO_DATA_FOUND THEN RAISE;
  END raise_all;
END payroll;
/`,
  ],
  [
    'po',
    'Gettext PO',
    `# Translator note
#. extracted for translators
#: src/main.c:42
#, c-format, fuzzy
msgctxt "menu"
msgid "Hello %s, you have %d"
msgid_plural "Hellos {name}\\n"
msgstr[0] "Bonjour %1$s\\t"
msgstr[1] ""
"continued %(count)d line\\n"
#~ msgid "obsolete"`,
  ],
  [
    'powerquery',
    'Power Query M',
    `// Load and shape sales
let
    Source = Csv.Document(File.Contents("C:\\data\\sales.csv"), [Delimiter = ",", Encoding = 65001]),
    #"Changed Type" = Table.TransformColumnTypes(Source, {{"Amount", type number}, {"Qty", Int64.Type}}),
    Added = Table.AddColumn(#"Changed Type", "Total", each [Amount] * [Qty], type number),
    Note = "Line one#(cr,lf)Line ""two""
continues here",
    Safe = try Number.From("x") otherwise null,
    Fn = (x as number) as number => if x > 0xFF then x else -x,
    Joined = Table.NestedJoin(Added, {"Id"}, Other, {"Id"}, "Other", JoinKind.LeftOuter),
    Today = #date(2024, 1, 31),
    /* block comment
       across lines */
    Result = Table.SelectRows(Joined, each [Total] <> null and _ <> true)
in
    Result`,
  ],
  [
    'powershell',
    'PowerShell',
    `#Requires -Version 7
<#
.SYNOPSIS
  Summarize the largest files under a path.
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory)]
  [string]$Path,
  [int]$Top = 5
)

function Format-Size {
  param([long]$Bytes)
  if ($Bytes -gt 1mb) { return "{0:N1} MB" -f ($Bytes / 1mb) }
  return "$([math]::Round($Bytes / 1kb, 1)) KB"
}

$files = Get-ChildItem -Path $Path -Recurse -File |
  Where-Object { $_.Length -gt 0 -and -not $_.Name.StartsWith('.') } |
  Sort-Object Length -Descending |
  Select-Object -First $Top

foreach ($file in $files) {
  $label = Format-Size -Bytes $file.Length
  Write-Host "\${label}  $($file.FullName)" -ForegroundColor Cyan
}

$report = @"
Scanned $Path
Top $Top of $($files.Count) files
"@
Write-Output $report`,
  ],
  [
    'prisma',
    'Prisma',
    `// Prisma schema
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

/// A registered user
model User {
  id      Int      @id @default(autoincrement())
  email   String   @unique
  name    String?  @default("anon\\n")
  score   Float    @default(1.5)
  active  Boolean  @default(true)
  role    Role     @default(USER)
  posts   Post[]   @relation(fields: [id], references: [userId])
  @@map("users")
}

/* Roles a user
   can take */
enum Role {
  USER
  ADMIN
}`,
  ],
  [
    'prolog',
    'Prolog',
    `% Family database
:- module(family, [parent/2, ancestor/2]).
:- use_module(library(lists)).
:- dynamic counter/1.

/* Facts and
   rules */
parent(tom, 'Bob Lee').
parent(bob, ann).
ancestor(X, Y) :- parent(X, Y).
ancestor(X, Y) :-
    parent(X, Z), !,
    ancestor(Z, Y).

count(N, M) :- M is N * 2 + 0x1F, M =\\= 0, C = 0'a, S = "tab\\there".
greeting --> [hello], name.
check(L) :- \\+ member(x, L), ( L == [] -> true ; format("~w~n", [L]) ).`,
  ],
  [
    'proto',
    'Protocol Buffers',
    `syntax = "proto3";

package demo.v1;

import "google/protobuf/timestamp.proto";

option java_package = "com.demo.v1";

// A labelled counter.
message Counter {
  string label = 1;
  int32 count = 2;
  google.protobuf.Timestamp updated_at = 3;
  repeated string tags = 4 [deprecated = true];
  reserved 5 to 9;
}

enum Status {
  STATUS_UNSPECIFIED = 0;
  STATUS_ACTIVE = 1;
}

service Counters {
  rpc Increment(Counter) returns (Counter);
  rpc Watch(Counter) returns (stream Counter);
}`,
  ],
  [
    'pug',
    'Pug',
    `doctype html
//- Order page, rendered per user
html(lang="en")
  head
    title= pageTitle + "\\t"
    style.
      .total { color: #c00; /* sale
         price */ }
  body#orders.page
    mixin order(item, i = 0)
      li.order(id=\`order-\${i}\`, data-n=i)= item.total * 0x10
    each item, i in orders
      +order(item, i)
    if orders.length === 0
      p.empty No orders yet
    else
      p Total: #{total.toFixed(2)} #[em "with tax\\n"]
    a(
      href="/orders"
      title=label
    ) All orders
    script.
      const ready = true;`,
  ],
  [
    'puppet',
    'Puppet',
    `# Manage nginx
class nginx (
  String $version = 'latest',
  Integer $port = 8080,
) inherits nginx::params {
  package { 'nginx':
    ensure => $version,
  }
  service { "nginx-\${facts['os']['family']}":
    ensure  => running,
    require => Package['nginx'],
  }
  if $facts['os']['name'] =~ /^(Debian|Ubuntu)$/ {
    notice("Port\\t\${port}")
  }
  $conf = @("EOT")
    listen \${port};
    | EOT
}
/* block
   comment */`,
  ],
  [
    'python',
    'Python',
    `from dataclasses import dataclass

@dataclass(frozen=True)
class Point:
    x: float
    y: float

def distance_squared(a: Point, b: Point) -> float:
    dx, dy = a.x - b.x, a.y - b.y
    return dx ** 2 + dy ** 2

print(f"distance² = {distance_squared(Point(0, 0), Point(3, 4))}")`,
  ],
  [
    'qml',
    'QML',
    `// Counter window
import QtQuick 2.15
import QtQuick.Controls 2.15 as QQC2

/* Root item with
   a counter */
Rectangle {
    id: root
    width: 640; height: 480
    color: count > 0 ? "#ff0000" : "blue"
    property int count: 0x10
    readonly property string title: qsTr("Count: \\"%1\\"").arg(count)
    signal clicked(int x, string name)
    enum Mode { Idle, Busy }

    onClicked: {
        console.log("clicked", x);
        count += 1
    }
    function reset(value: int): bool {
        count = value
        return true
    }
    Text {
        anchors.centerIn: parent
        text: root.title + "!"
    }
}`,
  ],
  [
    'r',
    'R',
    `#' Fit a simple model and summarize it.
library(dplyr)
library(ggplot2)

fib <- function(n = 10L) {
  if (n <= 1L) return(n)
  fib(n - 1L) + fib(n - 2L)
}

data <- tibble(x = 1:20, y = 2.5 * x + rnorm(20, sd = 3))

summary_stats <- data %>%
  filter(!is.na(y)) |>
  mutate(z = (y - mean(y)) / sd(y), \`odd row\` = x %% 2 == 1) %>%
  summarise(across(c(x, y), list(mean = mean, sd = sd)))

fit <- lm(y ~ x, data = data)
coefs <- coef(fit)
cat(sprintf("slope %.2f, intercept %.2f\\n", coefs[["x"]], coefs[[1]]))

square <- \\(v) v^2
for (i in seq_len(3)) if (i %in% c(1, 3)) print(square(i)) else next
raw <- r"(C:\\data\\input.csv)"
stats::median(data$y, na.rm = TRUE)`,
  ],
  [
    'razor',
    'Razor',
    `@page "/orders/{id:int}"
@model OrdersModel
@using System.Globalization
@* Orders page
   lists recent orders *@
@{
    ViewData["Title"] = "Orders \\"open\\"";
    var total = Model.Orders.Sum(o => o.Price * 1.2m);
    /* tax is
       included */
}
<h1>@ViewData["Title"] &amp; more</h1>
<p class="total">Total: @(total.ToString("C2")), mail sales@example.com</p>
@if (Model.Orders.Count > 0)
{
    <ul>
        @foreach (var order in Model.Orders)
        {
            <li data-id="@order.Id">@order.Name</li>
        }
    </ul>
}
else
{
    <p>No orders yet.</p>
}
<button @onclick="() => Refresh(0x10)">Refresh</button>
@code {
    [Parameter] public int Id { get; set; }
    private void Refresh(int max) => Count = max;
}`,
  ],
  [
    'reg',
    'Windows Registry',
    `Windows Registry Editor Version 5.00

; Settings for the app
[HKEY_CURRENT_USER\\Software\\Example]
@="Default value"
"Path"="C:\\\\Program Files\\\\Example"
"Quote"="say \\"hi\\""
"Count"=dword:0000001f
"Big"=qword:00000000000000ff
"Data"=hex:00,01,ff,\\
  0a,0b,0c
"Expand"=hex(2):25,00,50,00,00,00
"Old"=-

[-HKEY_CURRENT_USER\\Software\\Obsolete]`,
  ],
  [
    'rosmsg',
    'ROS Message',
    `# Pose of a robot
Header header
geometry_msgs/Pose pose
uint8 MODE_IDLE=0
string GREETING=Hello # stays text
float64[] covariance
int32[<=4] codes [1, -2, 3]
string<=16 label "robot \\"one\\""
bool active true
---
# Response
bool success
string message`,
  ],
  [
    'rst',
    'reStructuredText',
    `=====================
 Release notes
=====================

.. note:: Read *all* of this first.
   :class: tip

The \`\`build\`\` step reads :envvar:\`PATH\` and **writes** files.
See \`the docs <https://example.com/docs>\`_ or Docs_ and [1]_.
Use |version| with escaped \\*stars\\*.

.. code-block:: python
   :linenos:

   print("hello\\n")

Example::

    $ make -j 4

- first item
1. numbered item
:Author: Ada
.. _Docs: https://example.com
.. [1] A footnote.
.. A comment
   spanning lines.`,
  ],
  [
    'ruby',
    'Ruby',
    `# frozen_string_literal: true

require 'json'

module Demo
  # A labelled counter.
  class Counter
    MAX = 10
    attr_reader :label, :count

    def initialize(label:, count: 0)
      @label = label
      @count = count
    end

    def increment
      raise ArgumentError, "full" if @count >= MAX

      Counter.new(label: @label, count: @count + 1)
    end

    def to_s = "#{label}=#{count}"
  end
end

puts Demo::Counter.new(label: :hits).increment`,
  ],
  [
    'rust',
    'Rust',
    `#[derive(Clone, Copy, Debug)]
struct Point {
    x: i32,
    y: i32,
}

impl Point {
    fn distance_squared(self, other: Self) -> i32 {
        let (dx, dy) = (self.x - other.x, self.y - other.y);
        dx * dx + dy * dy
    }
}

fn main() {
    let origin = Point { x: 0, y: 0 };
    println!("{}", origin.distance_squared(Point { x: 3, y: 4 }));
}`,
  ],
  [
    'sas',
    'SAS',
    `/* Quarterly sales report
   spans two lines */
%let year = 2024;
options nodate pageno=1;
data work.summary(keep=region total);
  set sashelp.shoes(where=(sales > 0));
  by region;
  retain total 0;
  if first.region then total = 0;
  total + sales * 1.5e2;
  note = 'It''s';
  start = '01jan2024'd;
  if missing(returns) then returns = .;
  format start date9. total dollar12.2;
  * keep the last row of each region;
  if last.region and _n_ > 1 then output;
run;
data scores;
  input name $ score;
  datalines;
Alice 90
Bob 85
;
%macro report(ds);
  %if &year > 2020 %then %do;
    proc means data=&ds. noprint;
      var total;
    run;
  %end;
%mend report;`,
  ],
  [
    'sass',
    'Sass',
    `// Variables and mixins
$primary: #3b82f6
$radius: 4px

=rounded($r: $radius)
  border-radius: $r

.card
  +rounded
  color: darken($primary, 10%)
  padding: $radius * 2

  &-title
    font-weight: bold

  &:hover
    background: $primary

  @media (min-width: 768px)
    width: calc(100% - #{$radius})`,
  ],
  [
    'scala',
    'Scala',
    `package geometry

import scala.math.{Pi, sqrt}

/** A closed shape with an area. */
sealed trait Shape derives CanEqual
final case class Circle(radius: Double) extends Shape
final case class Rect(width: Double, height: Double) extends Shape

object Shape:
  given Ordering[Shape] = Ordering.by(area)

  def area(shape: Shape): Double = shape match
    case Circle(r) if r > 0 => Pi * r * r
    case Rect(w, h)         => w * h
    case _                  => 0.0

  extension (c: Circle) def scaled(k: Double): Circle = c.copy(radius = c.radius * k)

@main def run(): Unit =
  val shapes = List(Circle(1.5), Rect(2, 3), Circle(0.5).scaled(4))
  val total = shapes.map(Shape.area).sum
  println(s"\${shapes.size} shapes, total area $total")
  val report = """|areas:
                  |\${shapes.map(Shape.area).mkString(", ")}""".stripMargin
  for s <- shapes.sorted do println(f"\${Shape.area(s)}%.2f")
  lazy val largest: Option[Shape] = shapes.maxOption`,
  ],
  [
    'scss',
    'SCSS',
    `@use "sass:math";

// Variables and mixins
$primary: #3b82f6 !default;
$sizes: (sm: 4px, md: 8px);

@mixin rounded($r: map-get($sizes, sm)) {
  border-radius: $r;
}

.card {
  @include rounded;
  color: darken($primary, 10%);
  padding: math.div(16px, 2);

  &-title {
    font-weight: bold;
  }

  @each $name, $size in $sizes {
    &.pad-#{$name} {
      padding: $size;
    }
  }

  @if lightness($primary) > 50% {
    background: $primary;
  } @else {
    background: white;
  }
}`,
  ],
  [
    'shaderlab',
    'ShaderLab',
    `// Unlit shader
Shader "Custom/Unlit" {
    Properties {
        _MainTex ("Texture", 2D) = "white" {}
        [HDR] _Color ("Tint", Color) = (1, 1, 1, 0.5)
        _Cutoff ("Cutoff", Range(0, 1)) = 0.5
    }
    SubShader {
        Tags { "RenderType"="Opaque" }
        LOD 100
        /* render
           state */
        Pass {
            Cull [_Cull] ZWrite On
            Blend SrcAlpha OneMinusSrcAlpha
            CGPROGRAM
            #pragma vertex vert
            #define LABEL "tab\\there"
            sampler2D _MainTex;
            float4 frag(v2f i) : SV_Target { return tex2D(_MainTex, i.uv) * 2.0; }
            ENDCG
        }
    }
    Fallback "Diffuse"
}`,
  ],
  [
    'solidity',
    'Solidity',
    `pragma solidity ^0.8.20;
/// A counter contract
contract Counter {
  uint256 public count = 0;
  event Changed(uint256 value);
  /* Update the
     stored count. */
  function increment() external {
    require(msg.sender != address(0), "invalid\\ncaller");
    count += 1;
    emit Changed(count);
  }
}`,
  ],
  [
    'sparql',
    'SPARQL',
    `# Books and their authors
PREFIX ex: <http://example.org/library#>
PREFIX foaf: <http://xmlns.com/foaf/0.1/>
SELECT DISTINCT ?title (COUNT(?tag) AS ?tags)
WHERE {
  ?book a ex:Book ;
        ex:title ?title ;
        ex:author/foaf:name ?name .
  OPTIONAL { ?book ex:tag ?tag }
  FILTER (lang(?title) = "en" && regex(?name, "^A\\t", "i"))
  FILTER NOT EXISTS { ?book ex:hidden true }
  BIND (ex:discount(?price, 0.15) AS ?sale)
  ?book ex:note """first line
second"""@en .
}
ORDER BY DESC(?tags) LIMIT 10`,
  ],
  [
    'sql',
    'SQL',
    `WITH active_users AS (
  SELECT id, name, created_at
  FROM users
  WHERE active = TRUE AND created_at >= :since
), project_totals AS (
  SELECT owner_id, COUNT(*) AS projects
  FROM projects
  WHERE archived_at IS NULL
  GROUP BY owner_id
)
SELECT u.name, u.created_at, COALESCE(p.projects, 0) AS projects
FROM active_users AS u
LEFT JOIN project_totals AS p ON p.owner_id = u.id
WHERE COALESCE(p.projects, 0) > 3
ORDER BY projects DESC, u.name ASC
LIMIT 10;`,
  ],
  [
    'stata',
    'Stata',
    `* Wage analysis
/* Load the data
   /* nested note */ then clean */
version 17
sysuse nlsw88, clear
local controls "age tenure"
generate lwage = log(wage) if !missing(wage)
replace union = .a in 1/10
bysort industry (age): egen mean_wage = mean(wage)
quietly regress lwage \`controls' i.race c.age##c.age, ///
    vce(robust)
display "R2 = \`e(r2)' for $sample and \\$literal"
di \`"say "hi" \`"nested"' now"'
foreach v of varlist wage hours {
    summarize \`v', detail
}
program define tabby, rclass
    syntax varlist [if]
    return scalar n = _N
end`,
  ],
  [
    'stylus',
    'Stylus',
    `// Theme
$primary = #3498db
radius(n)
  border-radius n
body
  font 14px/1.5 sans-serif
  color $primary
  &:hover
    color lighten($primary, 10%)
  if $primary == #fff
    background white !important
  .col-{i}
    content "a \\"q\\""
/* block
   comment */`,
  ],
  [
    'svelte',
    'Svelte',
    `<script lang="ts">
  let count = 0;
  $: doubled = count * 2;
</script>

<button class:active={count > 0} on:click={() => count += 1}>
  Count: {count} · doubled: {doubled}
</button>

<style>
  button.active { color: #60d199; }
</style>`,
  ],
  [
    'swift',
    'Swift',
    `struct Point {
    let x: Double
    let y: Double

    func distanceSquared(to other: Point) -> Double {
        let dx = x - other.x
        let dy = y - other.y
        return dx * dx + dy * dy
    }
}

let origin = Point(x: 0, y: 0)
print("distance² = \\(origin.distanceSquared(to: Point(x: 3, y: 4)))")`,
  ],
  [
    'tcl',
    'Tcl',
    `#!/usr/bin/env tclsh
# Greet people
package require Tcl 8.6
proc ::app::greet {name {greeting "Hello"}} {
    global env
    set msg "$greeting, \${name}! [string toupper $name]\\n"
    if {$name eq "" || [llength $::argv] > 0x1F} {
        return -code error "no name"
    } else {
        puts $msg; incr count 2
    }
    set text "first line
second line $name"
    return [expr {$count * 1.5}]
}
greet \\
    world`,
  ],
  [
    'terraform',
    'Terraform',
    `terraform {
  required_providers {
    aws = { source = "hashicorp/aws", version = "~> 5.0" }
  }
}

variable "env" {
  type    = string
  default = "dev"
}

locals {
  name = "counter-\${var.env}"
  tags = { for k, v in var.tags : k => upper(v) if v != null }
}

resource "aws_instance" "counter" {
  count         = var.env == "prod" ? 3 : 1
  ami           = data.aws_ami.ubuntu.id
  instance_type = "t3.micro"
  user_data     = <<-EOT
    #!/bin/bash
    echo "hello \${local.name}"
  EOT
  tags = merge(local.tags, { Name = local.name })
}

output "ip" {
  value = aws_instance.counter[*].public_ip
}`,
  ],
  [
    'toml',
    'TOML',
    `title = "highlights"
enabled = true
languages = ["zig", "toml", "wat"]

[wasm]
simd = true
pages = 3

[theme]
name = "pierre-dark"
colors = { background = "#0a0a0a", foreground = "#fafafa" }

[build]
target = "wasm32-unknown-unknown"
optimize = "speed"

[build.features]
simd128 = true
bulk_memory = true`,
  ],
  [
    'ts',
    'TypeScript',
    `/**
 * An interface for a point in 2D space.
 */
interface Point {
  x: number;
  y: number;
}

/**
 * Calculates the distance between two points.
 * @param {Point} a - The first point.
 * @param {Point} b - The second point.
 * @returns The distance between a and b.
 */
function distance(a: Point, b: Point): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.hypot(dx, dy);
}

console.log(distance({ x: 0, y: 0 }, { x: 3, y: 4 }));`,
  ],
  [
    'tsrx',
    'TSRX',
    `// TodoList.tsrx

type Todo = {
  id: string;
  title: string;
  hidden?: boolean;
};

export function TodoList({ items }: { items: Todo[] }) @{
  const visibleItems = items.filter((item) => !item.hidden);

  <>
    <ul>
      @for (const item of visibleItems; index i; key item.id) {
        <li>{i + 1}. {item.title}</li>
      } @empty {
        <li>No todos yet</li>
      }
    </ul>

    <style>
      ul {
        display: grid;
        gap: 0.5rem;
      }
    </style>
  </>
}`,
  ],
  [
    'tsv',
    'TSV',
    `package\tversion\tlicense\tdownloads
@pierre/diffs\t1.2.0\tApache-2.0\t48210
@pierre/highlights\t0.2.0\tApache-2.0\t9120
@pierre/trees\t0.9.1\tApache-2.0\t15374`,
  ],
  [
    'tsx',
    'TSX',
    `import { useId, useState, type ReactNode } from "react";

type Status = "open" | "merged" | "closed";
type PullRequest = {
  id: number;
  title: string;
  author: { name: string; avatar?: string };
  status: Status;
  additions: number;
  deletions: number;
};

const statusLabels = {
  open: "Ready for review",
  merged: "Merged",
  closed: "Closed",
} satisfies Record<Status, string>;

/** A searchable review queue with a custom action for each pull request. */
export function ReviewQueue({ items, renderAction }: {
  items: readonly PullRequest[];
  renderAction: (item: PullRequest) => ReactNode;
}) {
  const searchId = useId();
  const [query, setQuery] = useState("");
  const matches = items.filter(({ title, author }) =>
    \`\${title} \${author.name}\`.toLowerCase().includes(query.toLowerCase())
  );

  return (
    <section aria-label="Pull requests">
      <label htmlFor={searchId}>Find a review</label>
      <input id={searchId} value={query}
        onChange={(event) => setQuery(event.currentTarget.value)} />
      <ul>
        {matches.map((pr) => (
          <li key={pr.id} className={\`review review--\${pr.status}\`}>
            <a href={\`/pull/\${pr.id}\`}>{pr.title}</a>
            <span>{statusLabels[pr.status]} · {pr.author.name}</span>
            <code>+{pr.additions} / −{pr.deletions}</code>
            {renderAction(pr)}
          </li>
        ))}
      </ul>
      {matches.length === 0 && <p>No reviews match “{query}”.</p>}
    </section>
  );
}`,
  ],
  [
    'turtle',
    'Turtle',
    `# Library catalog
@prefix ex: <http://example.org/library#> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
PREFIX foaf: <http://xmlns.com/foaf/0.1/>

ex:book1 a ex:Book ;
  ex:title "Le Petit Prince"@fr , "The \\"Little\\" Prince \\u00e9"@en ;
  ex:pages 96 ;
  ex:price "12.50"^^xsd:decimal ;
  ex:available true ;
  ex:author [ foaf:name "Antoine" ; foaf:age -44 ] ;
  ex:tags ( 'classic' 'fable' ) ;
  ex:summary """A pilot meets
a prince from asteroid B-612.""" ;
  ex:related _:b1 .
_:b1 ex:rating 4.5e0 .`,
  ],
  [
    'twig',
    'Twig',
    `{# Product page,
   with prices in € #}
{% extends "base.html.twig" %}
{% import "macros.twig" as ui %}
{% block body %}
<section class="{{ products is empty ? 'empty' : 'grid' }}">
  {% for product in products|filter(p => p.price > 0) %}
    <h2>{{ product.name|upper ~ " \\"new\\"" }}</h2>
    {{ ui.price(product.price * 1.2, {currency: 'EUR', decimals: 2}) }}
  {% else %}
    <p>{{ 'none'|trans }} &lt;&gt;</p>
  {% endfor %}
</section>
{% verbatim %}{{ not parsed }}{% endverbatim %}
{{ page.title ?? null }} {{ range(1, 10)|join(', ') }}
{% endblock %}`,
  ],
  [
    'typst',
    'Typst',
    `// Report setup
#set text(size: 11pt, lang: "en")
#let title = "Q\\"3\\""
= Results <results>
Revenue grew *12%* and _costs_ fell, see @results.
- Visit https://typst.app for \`raw\`
$ sum_(i=1)^n x_i = 1/2 $
#if true [Yes] else [No]
/* multi-line
   block comment */
#figure(image("a.png"), caption: [A *bold* caption])`,
  ],
  [
    'verilog',
    'Verilog',
    `// Counter with load
\`timescale 1ns / 1ps
\`define WIDTH 8
module counter #(parameter int W = \`WIDTH) (
  input  logic clk, rst_n,
  output logic [W-1:0] q
);
  typedef enum logic [1:0] {IDLE, RUN} state_t;
  state_t state;
  /* reset is active low;
     the count wraps */
  always_ff @(posedge clk or negedge rst_n) begin
    if (!rst_n) q <= '0;
    else if (q == 8'hFF) q <= 4'b10x1 + 32'd10;
    else q <= q + 1;
  end
  initial begin
    #10 $display("q=%0d\\n", q);
  end
  function automatic int add(input int a, b);
    return a + b + pkt.size();
  endfunction
  sub #(.W(4)) u_sub (.clk(clk));
endmodule`,
  ],
  [
    'vhdl',
    'VHDL',
    `-- Counter entity
library ieee;
use ieee.std_logic_1164.all;

entity Counter is
  generic (WIDTH : natural := 8);
  port (clk : in std_logic; q : out unsigned(WIDTH - 1 downto 0));
end entity Counter;

architecture rtl of Counter is
  signal count : unsigned(7 downto 0) := (others => '0');
  constant MASK : std_logic_vector(7 downto 0) := x"FF";
  /* a block comment
     over two lines */
begin
  tick : process (clk) is
  begin
    if rising_edge(clk) and clk'event then
      count <= count + 16#0F# when MASK(0) = '1' else count;
      report "say ""hi""" severity note;
    elsif count'length > 1.5E3 then
      count <= count sll 1;
    end if;
  end process tick;
end architecture;`,
  ],
  [
    'viml',
    'Vim Script',
    `" Editor settings
set nocompatible tabstop=4
let g:mapleader = ","
let s:items = [
      \\ 'one',
      \\ "two\\t", 0x1F,
      \\ ]
nnoremap <silent> <leader>w :w<CR>
augroup MyGroup
  autocmd BufWritePre *.py call s:Trim()
augroup END
function! s:Trim(name) abort
  if &modified && a:name ==# 'x' || v:true
    echo "saved" @a
  endif
  return 1 " done
endfunction`,
  ],
  [
    'vue',
    'Vue',
    `<script setup lang="ts">
import { computed, ref } from "vue";

const count = ref(0);
const label = computed(() => "Clicks: " + count.value);
</script>

<template>
  <button class="counter" @click="count++">
    {{ label }}
  </button>
</template>

<style scoped>
.counter { color: #60d199; }
</style>`,
  ],
  [
    'wat',
    'WebAssembly Text',
    `(module
  (memory (export "memory") 1)

  (func $square (param $x i32) (result i32)
    local.get $x
    local.get $x
    i32.mul)

  (func $store (param $address i32) (param $value i32)
    local.get $address
    local.get $value
    i32.store)

  (export "square" (func $square))
  (export "store" (func $store))
)`,
  ],
  [
    'wgsl',
    'WGSL',
    `struct VertexOutput {
  @builtin(position) pos: vec4<f32>,
  @location(0) uv: vec2f,
};

@group(0) @binding(0) var<uniform> mvp: mat4x4<f32>;
@group(0) @binding(1) var tex: texture_2d<f32>;
@group(0) @binding(2) var samp: sampler;

const SCALE: f32 = 0.5;

@vertex
fn vs_main(@location(0) pos: vec3<f32>, @location(1) uv: vec2f) -> VertexOutput {
  var out: VertexOutput;
  out.pos = mvp * vec4<f32>(pos, 1.0);
  out.uv = uv * SCALE;
  return out;
}

@fragment
fn fs_main(in: VertexOutput) -> @location(0) vec4<f32> {
  let c = textureSample(tex, samp, in.uv);
  if (c.a < 0.5) { discard; }
  return c;
}`,
  ],
  [
    'wolfram',
    'Wolfram Language',
    `(* Package: Demo
   (* nested *) comment *)
BeginPackage["Demo\`"];
square::usage = "square[x] returns x^2.\\n";
Begin["\`Private\`"];

square[x_] := x^2
f[n_Integer?Positive, opts___] /; n > 1 := Module[{t = n},
  Table[i^2, {i, 1, t}] // Total]
pairs = <|"a" -> 1, "b" :> 2|>;
nums = {2^^1010, 1.5*^10, 3.14\`20, .5};
If[True && Length[nums] > 3, Print["many"], Null];
Map[#^2 &, Range[5]] /. {x_ -> x + 1}
$Version <> " " <> ToString[\\[Alpha]]
End[]; EndPackage[]`,
  ],
  [
    'xml',
    'XML',
    `<?xml version="1.0" encoding="UTF-8"?>
<catalog xmlns:lang="urn:languages">
  <!-- XML remains case-sensitive markup. -->
  <lang:item id="wat" stable="true">
    <name>WebAssembly Text</name>
    <sample><![CDATA[(module (func $run))]]></sample>
  </lang:item>
  <lang:item id="rust" stable="true">
    <name>Rust</name>
    <sample><![CDATA[fn main() { println!("hello"); }]]></sample>
  </lang:item>
  <lang:item id="zig" stable="false">
    <name>Zig</name>
    <sample><![CDATA[pub fn main() void {}]]></sample>
  </lang:item>
</catalog>`,
  ],
  [
    'yaml',
    'YAML',
    `defaults: &defaults
  retries: 3
  enabled: true

service:
  <<: *defaults
  name: highlights
  languages: [rust, python, yaml]
  command: >-
    pnpm test

metadata:
  owner: wat-labs
  stable: false`,
  ],
  [
    'zig',
    'Zig',
    `const std = @import("std");

const Point = struct {
    x: i32,
    y: i32,
};

fn distanceSquared(a: Point, b: Point) i32 {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    return dx * dx + dy * dy;
}

pub fn main() void {
    std.debug.print("distance² = {d}\\n", .{distanceSquared(.{ .x = 0, .y = 0 }, .{ .x = 3, .y = 4 })});
}`,
  ],
  [
    'zon',
    'ZON',
    `// Zig Object Notation
.{
    .name = .highlights,
    .version = "1.0.0",
    .enabled = true,
    .optional = null,
    .paths = .{ "src", "build.zig", "build.zig.zon" },
    .limits = .{ .min = -inf, .max = inf, .missing = nan },
    .@"theme-name" = "Pierre Dark",
    .message =
        \\\\Hello from ZON!
        \\\\Multiline strings keep // comments literal.
    ,
}`,
  ],
] as const satisfies readonly (readonly [Lang, string, string])[];

export type PlaygroundLanguage = (typeof PLAYGROUND_LANGUAGES)[number][0];
