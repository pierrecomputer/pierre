import pkg from '../package.json' with { type: 'json' };
import * as themeBundle from '../themes/index.mjs';

const examples = {
  ts: `/**
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

console.log(distance({ x: 0, y: 0 }, { x: 3, y: 4 }));
`,

  js: `/**
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

console.log(\`slug: \${slug("Hello, WAT & Wasm!")}\`);
`,

  tsx: `// Badge.tsx

import { useState } from "react";

type BadgeProps = {
  /** The label of the badge. */
  label: string;
  /** The count of the badge. */
  count?: number;
};

export default function Badge({ label, count = 0 }: BadgeProps) {
  const [hot, setHot] = useState(count > 99);
  return (
    <button className={\`badge \${hot ? "hot" : "calm"}\`} onClick={() => setHot(!hot)}>
      {label}: <strong>{count.toLocaleString()}</strong>
    </button>
  );
}
`,

  html: `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Hello, chamele</title>
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
</html>
`,

  css: `/* style.css */

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
}
`,

  jsonc: `// comments and trailing commas are supported
{
  "name": "chamele-playground",
  "theme": "pierre-dark",
  "langs": ["tsx", "html", "css", "jsonc"],
  "wasm": {
    "simd": true, /* 16 bytes per step */
    "pages": 3,
  },
  "escape": "a\\nb \\u0041",
  "fallback": null,
}
`,
  bash: `#!/usr/bin/env bash
set -euo pipefail

greet() {
  local name="\${1:-world}"
  printf "Hello, %s!\\n" "$name"
}

for name in Ada Linus; do
  greet "$name"
done
`,
  c: `#include <stdio.h>

typedef struct { int x, y; } Point;

static int distance_squared(Point a, Point b) {
  int dx = a.x - b.x;
  int dy = a.y - b.y;
  return dx * dx + dy * dy;
}

int main(void) {
  printf("%d\\n", distance_squared((Point){0, 0}, (Point){3, 4}));
}
`,
  cpp: `#include <iostream>

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
}
`,
  go: `package main

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
}
`,
  python: `from dataclasses import dataclass

@dataclass(frozen=True)
class Point:
    x: float
    y: float

def distance_squared(a: Point, b: Point) -> float:
    dx, dy = a.x - b.x, a.y - b.y
    return dx ** 2 + dy ** 2

print(f"distance² = {distance_squared(Point(0, 0), Point(3, 4))}")
`,
  rust: `#[derive(Clone, Copy, Debug)]
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
}
`,
  yaml: `defaults: &defaults
  retries: 3
  enabled: true

service:
  <<: *defaults
  name: chamele
  languages: [rust, python, yaml]
  command: >-
    pnpm test

metadata:
  owner: wat-labs
  stable: false
`,
  php: `<?php
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
</ul>
`,
  sql: `WITH active_users AS (
  SELECT id, name
  FROM users
  WHERE active = TRUE AND created_at >= :since
)
SELECT u.name, COUNT(p.id) AS projects
FROM active_users AS u
LEFT JOIN projects AS p ON p.owner_id = u.id
GROUP BY u.id, u.name
HAVING COUNT(p.id) > 3
ORDER BY projects DESC
LIMIT 10;
`,
  swift: `struct Point {
    let x: Double
    let y: Double

    func distanceSquared(to other: Point) -> Double {
        let dx = x - other.x
        let dy = y - other.y
        return dx * dx + dy * dy
    }
}

let origin = Point(x: 0, y: 0)
print("distance² = \\(origin.distanceSquared(to: Point(x: 3, y: 4)))")
`,
  haskell: `module Main where

data Point = Point Int Int
  deriving (Eq, Show)

distanceSquared :: Point -> Point -> Int
distanceSquared (Point ax ay) (Point bx by) =
  let dx = ax - bx
      dy = ay - by
  in dx * dx + dy * dy

main :: IO ()
main = print (distanceSquared (Point 0 0) (Point 3 4))
`,
  kotlin: `data class Point(val x: Int, val y: Int)

fun distanceSquared(a: Point, b: Point): Int {
    val dx = a.x - b.x
    val dy = a.y - b.y
    return dx * dx + dy * dy
}

fun main() {
    val distance = distanceSquared(Point(0, 0), Point(3, 4))
    println("distance² = \${distance}")
}
`,
  astro: `---
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
</style>
`,
  vue: `<script setup lang="ts">
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
</style>
`,
  svelte: `<script lang="ts">
  let count = 0;
  $: doubled = count * 2;
</script>

<button class:active={count > 0} on:click={() => count += 1}>
  Count: {count} · doubled: {doubled}
</button>

<style>
  button.active { color: #60d199; }
</style>
`,
  xml: `<?xml version="1.0" encoding="UTF-8"?>
<catalog xmlns:lang="urn:languages">
  <!-- XML remains case-sensitive markup. -->
  <lang:item id="wat" stable="true">
    <name>WebAssembly Text</name>
    <sample><![CDATA[(module (func $run))]]></sample>
  </lang:item>
</catalog>
`,
  markdown: `---
title: Fast highlighting
draft: false
tags: [wasm, simd]
---

# Chamele

Use \`codeToHtml\` to highlight code in one pass.

<aside data-kind="tip">Inline HTML is highlighted too.</aside>

\`\`\`rust
fn main() {
    println!("hello");
}
\`\`\`
`,
  mdx: `export const meta = { title: "Language examples" };

# {meta.title}

<Card tone="accent">
  MDX mixes **Markdown** with <code>JSX</code>.
</Card>

{["Rust", "WAT", "MDX"].map((lang) => (
  <Badge key={lang}>{lang}</Badge>
))}
`,
  asm: `section .data
message: db "Hello, assembly!", 10
length: equ $ - message

section .text
global _start

_start:
    mov rax, 1
    mov rdi, 1
    mov rsi, message
    mov rdx, length
    syscall
`,
  wat: `(module
  (func $square (param $x i32) (result i32)
    local.get $x
    local.get $x
    i32.mul)

  (export "square" (func $square))
)
`,
  diff: `diff --git a/src/config.js b/src/config.js
index 1a2b3c4..5d6e7f8 100644
--- a/src/config.js
+++ b/src/config.js
@@ -1,4 +1,5 @@
 export const config = {
-  mode: "slow",
+  mode: "simd",
+  batchSize: 16,
 };
`,
  glsl: `#version 450

layout(location = 0) in vec3 normal;
layout(location = 1) in vec2 uv;
layout(location = 0) out vec4 outColor;

uniform sampler2D albedo;

void main() {
  vec3 light = normalize(vec3(0.4, 0.8, 0.2));
  float diffuse = max(dot(normal, light), 0.0);
  outColor = texture(albedo, uv) * vec4(vec3(diffuse), 1.0);
}
`,
  lua: `local function greet(name)
  return ("Hello, %s!"):format(name)
end

local users = { "Ada", "Linus", "Grace" }

for index, name in ipairs(users) do
  print(index, greet(name))
end
`,
  zig: `const std = @import("std");

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
}
`,
  toml: `title = "chamele"
enabled = true
languages = ["zig", "toml", "wat"]

[wasm]
simd = true
pages = 3

[theme]
name = "pierre-dark"
colors = { background = "#0a0a0a", foreground = "#fafafa" }
`,
};

const wasmSize = pkg.meta['chamele.wasm'];
const gzipSize = pkg.meta['chamele.wasm.gz'];
const wasmInfo = `Wasm: ${formatBytes(wasmSize)} (${formatBytes(gzipSize, 'gzipped')})`;
const themes = Object.fromEntries(
  Object.entries(themeBundle)
    .filter(([, theme]) => typeof theme === 'object' && !theme.cssVariables)
    .sort(([, a], [, b]) => a.name.localeCompare(b.name))
);
const languageGroups = [
  [
    'System',
    [
      ['asm', 'Assembly'],
      ['bash', 'Bash'],
      ['c', 'C'],
      ['cpp', 'C++'],
      ['go', 'Go'],
      ['haskell', 'Haskell'],
      ['kotlin', 'Kotlin'],
      ['lua', 'Lua'],
      ['php', 'PHP'],
      ['python', 'Python'],
      ['rust', 'Rust'],
      ['swift', 'Swift'],
      ['zig', 'Zig'],
    ],
  ],
  [
    'Web',
    [
      ['astro', 'Astro'],
      ['css', 'CSS'],
      ['html', 'HTML'],
      ['js', 'JavaScript'],
      ['mdx', 'MDX'],
      ['svelte', 'Svelte'],
      ['ts', 'TypeScript'],
      ['tsx', 'TSX'],
      ['vue', 'Vue'],
      ['wat', 'WebAssembly Text'],
    ],
  ],
  [
    'Data',
    [
      ['jsonc', 'JSON/JSONC'],
      ['toml', 'TOML'],
      ['yaml', 'YAML'],
      ['xml', 'XML'],
    ],
  ],
  [
    'Other',
    [
      ['diff', 'Diff'],
      ['glsl', 'GLSL'],
      ['markdown', 'Markdown'],
      ['sql', 'SQL'],
    ],
  ],
];
const themeOptions = pickerOptions(
  ['dark', 'light'].map((appearance) => [
    appearance[0].toUpperCase() + appearance.slice(1),
    Object.entries(themes)
      .filter(([, theme]) => theme.appearance === appearance)
      .map(([key, theme]) => [
        key,
        theme.name,
        appearance === 'dark' ? 'moon' : 'sun',
        key.startsWith('pierre') ? 'badge-check' : '',
      ]),
  ]),
  'theme'
);
const languageOptions = pickerOptions(languageGroups, 'lang', 'ts');

const indexHtml = /*html*/ `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>chamele playground</title>
  <link rel="icon" type="image/png" sizes="48x48" href="/favicon-light.png" media="(prefers-color-scheme: light)">
  <link rel="icon" type="image/png" sizes="48x48" href="/favicon-dark.png" media="(prefers-color-scheme: dark)">
  <link rel="modulepreload" href="/browser.mjs">
  <link rel="modulepreload" href="/chamele.wasm.mjs">
  <link rel="modulepreload" href="/index.mjs">
  <link rel="modulepreload" href="/theme.mjs">
  <link rel="modulepreload" href="/token-types.mjs">
  <style>
    :root {
      color-scheme: light dark;
      --ui-panel: color-mix(in srgb, Canvas 97%, CanvasText 3%);
      --ui-control: color-mix(in srgb, Canvas 94%, CanvasText 6%);
      --ui-hover: color-mix(in srgb, Canvas 92%, CanvasText 9%);
      --ui-active: color-mix(in srgb, Canvas 90%, CanvasText 10%);
      --ui-border: color-mix(in srgb, CanvasText 8%, transparent);
    }
    * { box-sizing: border-box; }
    body { margin: 0; height: 100vh; display: flex; flex-direction: column; font-family: ui-sans-serif, system-ui, sans-serif; }
    header { display: flex; align-items: center; gap: 0.75rem; padding: .5rem 1rem; border-bottom: 1px solid color-mix(in srgb, currentColor 20%, transparent); }
    header h1 { margin: 0; font-size: .95rem; font-weight: 600; display: flex; align-items: center; gap: .5rem; cursor: pointer; }
    header h1 .subtitle { font-size: .8rem; font-weight: 500; opacity: .6; }
    #version { font-size: .8rem; opacity: .6; background: var(--ui-active); border-radius: 6px; padding: .15rem .5rem; color: inherit; text-decoration: none; cursor: pointer; }
    #version-info { margin: 0; inset: auto; padding: .4rem .6rem; border: 1px solid color-mix(in srgb, currentColor 20%, transparent); border-radius: 6px; color: color-mix(in srgb, currentColor 80%, transparent); background: Canvas; box-shadow: 0 4px 16px #0003; font-size: .75rem; line-height: 1; white-space: nowrap; pointer-events: none; }
    .spacer { flex: 1; }
    #status { display: flex; align-items: center; gap: .3rem; font-size: .8rem; opacity: .5; }
    #status[hidden] { display: none; }
    #status svg { width: 1rem; height: 1rem; color: currentColor; }
    header .icon-btn { display: flex; padding: .4rem; border: 0; border-radius: 6px; background: none; color: color-mix(in srgb, currentColor 60%, transparent); cursor: pointer; }
    header .icon-btn:hover { color: currentColor; background: color-mix(in srgb, currentColor 12%, transparent); }
    .picker { display: flex; }
    .picker-trigger {
      display: flex;
      align-items: center;
      gap: .45rem;
      height: 2rem;
      max-width: 13rem;
      padding: 0 .55rem;
      border: 1px solid transparent;
      border-radius: 8px;
      color: CanvasText;
      background: var(--ui-control);
      font: 500 .8rem/1 ui-sans-serif, system-ui, sans-serif;
      cursor: pointer;
    }
    .picker-trigger:hover { background: var(--ui-hover); }
    .picker-trigger:focus-visible {
      outline: 2px solid color-mix(in srgb, CanvasText 65%, transparent);
      outline-offset: 2px;
    }
    .picker-trigger[aria-expanded="true"] {
      border-color: var(--ui-border);
      background: var(--ui-active);
    }
    .picker-trigger svg, .picker-option svg {
      flex: none;
      width: 1rem;
      height: 1rem;
    }
    .picker-label {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .picker-chevron {
      margin-left: .15rem;
      opacity: .55;
      transition: transform 120ms ease;
    }
    .picker-trigger[aria-expanded="true"] .picker-chevron { transform: rotate(180deg); }
    .picker-menu {
      position: fixed;
      inset: auto;
      width: min(19rem, calc(100vw - 1rem));
      max-height: min(31rem, calc(100vh - 4rem));
      margin: 0;
      padding: 0;
      overflow: hidden;
      border: 1px solid var(--ui-border);
      border-radius: 12px;
      color: CanvasText;
      background: var(--ui-panel);
      opacity: 0;
      transform: translateY(-4px) scale(.98);
      transition: opacity 120ms ease, transform 120ms ease, overlay 120ms allow-discrete, display 120ms allow-discrete;
    }
    .picker-menu:popover-open {
      display: flex;
      flex-direction: column;
      opacity: 1;
      transform: translateY(0) scale(1);
    }
    @starting-style {
      .picker-menu:popover-open {
        opacity: 0;
        transform: translateY(-4px) scale(.98);
      }
    }
    .picker-menu::backdrop { background: transparent; }
    .picker-options {
      position: relative;
      min-height: 0;
      padding: 0 .4rem .4rem;
      overflow-y: auto;
      overscroll-behavior: contain;
      scrollbar-gutter: stable;
    }
    .picker-highlight {
      position: absolute;
      z-index: 0;
      top: 0;
      left: .6rem;
      right: .6rem;
      height: 0;
      border-radius: 7px;
      background: var(--ui-hover);
      opacity: 0;
      pointer-events: none;
      transform: translateY(0);
    }
    @media (hover: hover) and (pointer: fine) {
      .picker-options:hover .picker-highlight { transition: background-color 120ms ease, height 120ms ease, opacity 80ms ease, transform 120ms ease; }
    }
    .picker-highlight.active { background: var(--ui-active); }
    .picker-search {
      position: relative;
      flex: none;
      padding: .8rem .8rem .4rem;
      background: var(--ui-panel);
    }
    .picker-search input {
      width: 100%;
      height: 2.25rem;
      padding: 0 2rem 0 .65rem;
      border: 1px solid transparent;
      border-radius: 7px;
      outline: 0;
      color: CanvasText;
      font: .8rem ui-sans-serif, system-ui, sans-serif;
    }
    .picker-search input::-webkit-search-cancel-button { appearance: none; }
    .picker-search input:focus {
      border-color: var(--ui-border);
    }
    .picker-clear {
      position: absolute;
      top: 50%;
      right: .75rem;
      display: grid;
      place-items: center;
      width: 1.5rem;
      height: 1.5rem;
      padding: 0;
      border: 0;
      border-radius: 6px;
      color: color-mix(in srgb, CanvasText 55%, transparent);
      background: transparent;
      transform: translateY(-50%);
      cursor: pointer;
    }
    .picker-clear:hover, .picker-clear:focus-visible {
      outline: 0;
      color: CanvasText;picker.menu.style.top
    }
    .picker-clear svg { width: .9rem; height: .9rem; }
    .picker-empty {
      padding: 1rem .75rem;
      color: color-mix(in srgb, CanvasText 55%, transparent);
      font-size: .8rem;
      text-align: center;
    }
    .picker-group { position: relative; z-index: 1; padding: .2rem; }
    .picker-group + .picker-group {
      margin-top: .25rem;
      border-top: 1px solid var(--ui-border);
    }
    .picker-group-label {
      padding: .45rem .55rem .3rem;
      color: color-mix(in srgb, CanvasText 45%, transparent);
      font-size: .67rem;
      font-weight: 600;
      letter-spacing: .08em;
      text-transform: uppercase;
    }
    .picker-option {
      position: relative;
      display: flex;
      align-items: center;
      gap: .55rem;
      width: 100%;
      min-height: 2rem;
      padding: .45rem 1.6rem .45rem .55rem;
      border: 0;
      border-radius: 7px;
      color: inherit;
      background: transparent;
      font: 400 .8rem/1.25 ui-sans-serif, system-ui, sans-serif;
      text-align: left;
      cursor: pointer;
    }
    .picker-option:focus-visible { outline: 0; }
    .picker-option[aria-selected="true"] {
      font-weight: 650;
    }
    .picker-option .picker-deco,
    .picker-option[aria-selected="true"]::after {
      position: absolute;
      top: 50%;
      right: .55rem;
      width: 0.9rem;
      height: 0.9rem;
      transform: translateY(-50%);
    }
    .picker-option .picker-deco {
      opacity: .85;
    }
    .picker-option[aria-selected="true"] .picker-deco { display: none; }
    .picker-option[aria-selected="true"]::after {
      content: "";
      background: currentColor;
      clip-path: circle(.21rem);
    }
    .picker-menu [hidden] { display: none; }
    main { flex: 1; display: grid; grid-template-columns: 1fr 1fr; min-height: 0; }
    #editor { position: relative; min-width: 0; border-right: 1px solid color-mix(in srgb, currentColor 20%, transparent);   }
    #highlight, #editor textarea { position: absolute; inset: 0; }
    #highlight { overflow: hidden; }
    #output { min-width: 0; overflow: auto; }
    textarea, .chamele { margin: 0; padding: 0.8rem; font: 13px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace; white-space: pre; }
    .chamele { min-width: max-content; min-height: 100%; }
    .chamele code { font: inherit; }
    textarea { resize: none; border: 0; outline: 0; overflow: auto; background: transparent; color: transparent; caret-color: CanvasText; }
    textarea::selection { background: rgba(88, 166, 255, .35); color: transparent; }
    #output.error { color: #e5484d; white-space: pre-wrap; padding: 1rem; font: 13px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace; }
    @media (max-width: 48rem) { #status { display: none; } .picker-trigger { max-width: 10rem; } }
    @media (max-width: 34rem) { header h1 .subtitle, #version { display: none; } .picker-trigger { max-width: 7rem; } }
  </style>
</head>
<body>
  <svg xmlns="http://www.w3.org/2000/svg" width="0" height="0" style="position: absolute" aria-hidden="true">
    <symbol id="icon-logo" viewBox="0 0 24 24"><title>tree-2</title><path d="M12 12h3M12 22V9M20 6.01V6M4 6.01V6M6 4.01V4M18 4.01V4M22 13V8M2 13V8M20 15.01V15M4 15.01V15M12 17h6M8 2h8M6 17h2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="square"></path></symbol>
    <symbol id="icon-github" viewBox="0 0 24 24"><path fill-rule="evenodd" clip-rule="evenodd" d="M12 0C5.37 0 0 5.37 0 12C0 17.31 3.435 21.795 8.205 23.385C8.805 23.49 9.03 23.13 9.03 22.815C9.03 22.53 9.015 21.585 9.015 20.58C6 21.135 5.22 19.845 4.98 19.17C4.845 18.825 4.26 17.76 3.75 17.475C3.33 17.25 2.73 16.695 3.735 16.68C4.68 16.665 5.355 17.55 5.58 17.91C6.66 19.725 8.385 19.215 9.075 18.9C9.18 18.12 9.495 17.595 9.84 17.295C7.17 16.995 4.38 15.96 4.38 11.37C4.38 10.065 4.845 8.985 5.61 8.145C5.49 7.845 5.07 6.615 5.73 4.965C5.73 4.965 6.735 4.65 9.03 6.195C9.99 5.925 11.01 5.79 12.03 5.79C13.05 5.79 14.07 5.925 15.03 6.195C17.325 4.635 18.33 4.965 18.33 4.965C18.99 6.615 18.57 7.845 18.45 8.145C19.215 8.985 19.68 10.05 19.68 11.37C19.68 15.975 16.875 16.995 14.205 17.295C14.64 17.67 15.015 18.39 15.015 19.515C15.015 21.12 15 22.41 15 22.815C15 23.13 15.225 23.505 15.825 23.385C18.2072 22.5808 20.2773 21.0498 21.7438 19.0074C23.2103 16.9651 23.9994 14.5143 24 12C24 5.37 18.63 0 12 0Z" fill="currentColor"></path></symbol>
    <symbol id="icon-sun" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="square"><path d="M12 21H12.01"></path><path d="M18 18H18.01"></path><path d="M6 18H6.01"></path><path d="M11 17L13 17"></path><path d="M15 15H15.01"></path><path d="M9 15H9.01"></path><path d="M21 12H21.01"></path><path d="M3 12H3.01"></path><path d="M17 11L17 13"></path><path d="M6.99999 11L7 13"></path><path d="M15 9H15.01"></path><path d="M9 9H9.01"></path><path d="M11 7.00001L13 7"></path><path d="M18 6H18.01"></path><path d="M6 6H6.01"></path><path d="M12 3H12.01"></path></g></symbol>
    <symbol id="icon-moon" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="square"><path d="M4 6L4 6.01"></path><path d="M11 6L11 6.01"></path><path d="M6 4L6 4.01"></path><path d="M13 4L13 4.01"></path><path d="M20.01 6L20 6"></path><path d="M18.01 4L18 4"></path><path d="M20.01 18L20 18"></path><path d="M18.01 20L18 20"></path><path d="M6.01001 20L6.00001 20"></path><path d="M13.01 20L13 20"></path><path d="M4.01001 18L4.00001 18"></path><path d="M11.01 18L11 18"></path><path d="M22 8L22 16"></path><path d="M2 8L2 16"></path><path d="M9 8L9 16"></path><path d="M8 2L16 2"></path><path d="M8 22L16 22"></path></g></symbol>
    <symbol id="icon-chevron-down" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="square"><path d="M12 16.99L12 17"></path><path d="M10 14.99L10 15"></path><path d="M14 14.99L14 15"></path><path d="M16 12.99L16 13"></path><path d="M8 12.99L8 13"></path><path d="M6 10.99L6 11"></path><path d="M18 10.99L18 11"></path><path d="M20 8.98999L20 8.99999"></path><path d="M4 8.98999L4 8.99999"></path></g></symbol>
    <symbol id="icon-bolt" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="square"><path d="M15 19L15 20"></path><path d="M11 17V22H13"></path><path d="M17 16L17 17"></path><path d="M9 15L3 15L3 13"></path><path d="M19 13L19 14"></path><path d="M5 10L4.99999 11"></path><path d="M15 9L21 9V11"></path><path d="M6.99999 7L7 8"></path><path d="M8.99999 4L9 5"></path><path d="M13 7V2H11"></path></g></symbol>
    <symbol id="icon-badge-check" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="square"><path d="M13 22L11 22"></path><path d="M15 20L18 20"></path><path d="M6 20L9 20"></path><path d="M20 15L20 18"></path><path d="M10.01 15L10 15"></path><path d="M4 15L4 18"></path><path d="M12.01 13L12 13"></path><path d="M8.01001 13L8.00001 13"></path><path d="M22 11L22 13"></path><path d="M14.01 11L14 11"></path><path d="M2 11L2 13"></path><path d="M16.01 9L16 9"></path><path d="M20 6L20 9"></path><path d="M4 6L4 9"></path><path d="M15 4L18 4"></path><path d="M6 4L9 4"></path><path d="M13 2L11 2"></path></g></symbol>
    <symbol id="icon-xmark" viewBox="0 0 24 24"><g fill="currentColor"><rect width="2" height="2" transform="matrix(-1 0 0 1 13 11)"></rect><rect width="2" height="2" transform="matrix(-1 0 0 1 11 9)"></rect><rect width="2" height="2" transform="matrix(-1 0 0 1 15 13)"></rect><rect width="2" height="2" transform="matrix(-1 0 0 1 15 9)"></rect><rect width="2" height="2" transform="matrix(-1 0 0 1 11 13)"></rect><rect width="2" height="2" transform="matrix(-1 0 0 1 9 15)"></rect><rect width="2" height="2" transform="matrix(-1 0 0 1 7 17)"></rect><rect width="2" height="2" transform="matrix(-1 0 0 1 5 19)"></rect><rect width="2" height="2" transform="matrix(-1 0 0 1 17 7)"></rect><rect width="2" height="2" transform="matrix(-1 0 0 1 19 5)"></rect><rect width="2" height="2" transform="matrix(-1 0 0 1 21 3)"></rect><rect width="2" height="2" transform="matrix(-1 0 0 1 19 17)"></rect><rect width="2" height="2" transform="matrix(-1 0 0 1 17 15)"></rect><rect width="2" height="2" transform="matrix(-1 0 0 1 21 19)"></rect><rect width="2" height="2" transform="matrix(-1 0 0 1 9 7)"></rect><rect width="2" height="2" transform="matrix(-1 0 0 1 7 5)"></rect><rect width="2" height="2" transform="matrix(-1 0 0 1 5 3)"></rect></g></symbol>
  </svg>
  <header>
    <h1><svg class="logo" width="20" height="20" aria-hidden="true"><use href="#icon-logo"></use></svg>
    CHAMELẼ <span class="subtitle">Playground</span></h1>
    <a id="version" href="https://github.com/wat-labs/chamele/releases/tag/v${pkg.version}" aria-describedby="version-info">v${pkg.version}</a>
    <div id="version-info" popover="hint" role="tooltip">${wasmInfo}</div>
    <div class="spacer"></div>
    <span id="status" hidden><svg aria-hidden="true"><use href="#icon-bolt"></use></svg><span id="status-text"></span></span>
    <div class="picker" id="theme-picker" style="visibility: hidden">
      <button
        class="picker-trigger"
        id="theme-trigger"
        type="button"
        popovertarget="theme-menu"
        aria-haspopup="listbox"
        aria-controls="theme-options"
        aria-expanded="false"
      >
        <svg aria-hidden="true"><use id="theme-icon" href="#icon-moon"></use></svg>
        <span class="picker-label" id="theme-label">Pierre Dark</span>
        <svg class="picker-chevron" aria-hidden="true"><use href="#icon-chevron-down"></use></svg>
      </button>
      <div class="picker-menu" id="theme-menu" popover>
        <div class="picker-search">
          <input id="theme-search" type="search" placeholder="Search themes…" autocomplete="off" aria-label="Search themes" aria-controls="theme-options">
          <button class="picker-clear" id="theme-clear" type="button" aria-label="Clear theme search" hidden>
            <svg aria-hidden="true"><use href="#icon-xmark"></use></svg>
          </button>
        </div>
        <div class="picker-options" id="theme-options" role="listbox" aria-label="Theme"><div class="picker-highlight" id="theme-highlight" aria-hidden="true"></div>${themeOptions}</div>
        <div class="picker-empty" id="theme-empty" hidden>No themes found</div>
      </div>
    </div>
    <div class="picker">
      <button
        class="picker-trigger"
        id="lang-trigger"
        type="button"
        popovertarget="lang-menu"
        aria-haspopup="listbox"
        aria-controls="lang-options"
        aria-expanded="false"
      >
        <span class="picker-label" id="lang-label">TypeScript</span>
        <svg class="picker-chevron" aria-hidden="true"><use href="#icon-chevron-down"></use></svg>
      </button>
      <div class="picker-menu" id="lang-menu" popover>
        <div class="picker-search">
          <input id="lang-search" type="search" placeholder="Search languages…" autocomplete="off" aria-label="Search languages" aria-controls="lang-options">
          <button class="picker-clear" id="lang-clear" type="button" aria-label="Clear language search" hidden>
            <svg aria-hidden="true"><use href="#icon-xmark"></use></svg>
          </button>
        </div>
        <div class="picker-options" id="lang-options" role="listbox" aria-label="Language"><div class="picker-highlight" id="lang-highlight" aria-hidden="true"></div>${languageOptions}</div>
        <div class="picker-empty" id="lang-empty" hidden>No languages found</div>
      </div>
    </div>
    <a class="icon-btn" href="https://github.com/wat-labs/chamele" target="_blank" rel="noopener" aria-label="GitHub repository" title="GitHub">
      <svg width="18" height="18"><use href="#icon-github"></use></svg>
    </a>
  </header>
  <main>
    <div id="editor">
      <div id="highlight" aria-hidden="true"></div>
      <textarea id="input" spellcheck="false" wrap="off" aria-label="code"></textarea>
    </div>
    <div id="output"></div>
  </main>
  <script type="module">
    import { codeToHtml } from "/browser.mjs";

    const themes = ${serialize(themes)};
    const systemTheme = window.matchMedia("(prefers-color-scheme: dark)");
    const input = document.getElementById("input");
    const highlight = document.getElementById("highlight");
    const output = document.getElementById("output");
    const status = document.getElementById("status");
    const statusText = document.getElementById("status-text");
    const themePicker = getPicker("theme");
    const langPicker = getPicker("lang");
    const themeIcon = document.getElementById("theme-icon");
    const version = document.getElementById("version");
    const versionInfo = document.getElementById("version-info");
    const decoder = new TextDecoder();
    const examples = ${serialize(examples)};
    let theme;
    let language = "ts";
    let followsSystemTheme = true;
    const syncScroll = () => highlight.scrollTo(input.scrollLeft, input.scrollTop);

    function getPicker(name) {
      return {
        name,
        trigger: document.getElementById(name + "-trigger"),
        menu: document.getElementById(name + "-menu"),
        label: document.getElementById(name + "-label"),
        search: document.getElementById(name + "-search"),
        options: document.getElementById(name + "-options"),
        highlight: document.getElementById(name + "-highlight"),
        clear: document.getElementById(name + "-clear"),
        empty: document.getElementById(name + "-empty"),
        selected: null,
        highlighted: null,
      };
    }

    function selectPicker(picker, key) {
      if (picker.selected) {
        picker.selected.setAttribute("aria-selected", "false");
        picker.selected.tabIndex = -1;
      }
      picker.selected = picker.menu.querySelector('[data-' + picker.name + '="' + key + '"]');
      picker.selected.setAttribute("aria-selected", "true");
      picker.selected.tabIndex = 0;
      picker.label.textContent = picker.selected.textContent;
      picker.trigger.title = picker.selected.textContent;
      if (picker.highlighted && picker.menu.matches(":popover-open")) movePickerHighlight(picker, picker.highlighted);
    }

    function movePickerHighlight(picker, option) {
      picker.highlighted = option;
      if (!option || option.hidden || option.parentElement.hidden) {
        picker.highlight.style.opacity = 0;
        return;
      }
      picker.highlight.style.height = option.offsetHeight + "px";
      picker.highlight.style.transform = "translateY(" + (option.parentElement.offsetTop + option.offsetTop) + "px)";
      picker.highlight.style.opacity = 1;
      picker.highlight.classList.toggle("active", option === picker.selected);
    }

    function filterPicker(picker) {
      const query = picker.search.value.trim().toLowerCase();
      let visible = false;
      for (const group of picker.menu.querySelectorAll(".picker-group")) {
        let groupVisible = false;
        for (const option of group.querySelectorAll(".picker-option")) {
          option.hidden = !option.textContent.toLowerCase().includes(query);
          groupVisible ||= !option.hidden;
        }
        group.hidden = !groupVisible;
        visible ||= groupVisible;
      }
      picker.clear.hidden = !query;
      picker.empty.hidden = visible;
      picker.options.scrollTop = 0;
      if (picker.menu.matches(":popover-open")) movePickerHighlight(picker, picker.selected.hidden ? null : picker.selected);
    }

    function applyTheme(key) {
      theme = themes[key];
      document.documentElement.style.colorScheme = theme.appearance;
    }

    function previewTheme(key) {
      if (theme === themes[key]) return;
      applyTheme(key);
      render();
    }

    function selectTheme(key) {
      applyTheme(key);
      selectPicker(themePicker, key);
      themeIcon.setAttribute("href", theme.appearance === "dark" ? "#icon-moon" : "#icon-sun");
    }

    function selectLanguage(key) {
      language = key;
      selectPicker(langPicker, key);
    }

    function render() {
      const code = input.value;
      try {
        const start = performance.now();
        const out = codeToHtml(code, { lang: language, theme });
        const ms = performance.now() - start;
        const frag = decoder.decode(out);
        highlight.innerHTML = code.endsWith("\\n")
          ? decoder.decode(codeToHtml(code + " ", { lang: language, theme }))
          : frag;
        output.innerHTML = decoder.decode(codeToHtml(frag, { lang: "html", theme }));
        output.classList.remove("error");
        statusText.textContent = "Rendered in " + (ms < 1 ? (ms * 1e3).toFixed(0) + " µs" : ms.toFixed(2) + " ms");
        status.hidden = false;
      } catch (err) {
        const fallback = document.createElement("pre");
        fallback.className = "chamele";
        fallback.textContent = code;
        highlight.replaceChildren(fallback);
        output.textContent = String(err);
        output.classList.add("error");
        statusText.textContent = "";
        status.hidden = true;
      }
      syncScroll();
    }

    const showVersionInfo = () => {
      const rect = version.getBoundingClientRect();
      versionInfo.style.top = rect.bottom + 6 + "px";
      versionInfo.style.left = rect.left + "px";
      if (!versionInfo.matches(":popover-open")) versionInfo.showPopover();
    };
    const hideVersionInfo = () => {
      if (versionInfo.matches(":popover-open")) versionInfo.hidePopover();
    };
    version.addEventListener("pointerenter", showVersionInfo);
    version.addEventListener("pointerleave", () => {
      if (document.activeElement !== version) hideVersionInfo();
    });
    version.addEventListener("focus", showVersionInfo);
    version.addEventListener("blur", () => {
      if (!version.matches(":hover")) hideVersionInfo();
    });
    for (const picker of [themePicker, langPicker]) {
      picker.menu.addEventListener("toggle", () => {
        const open = picker.menu.matches(":popover-open");
        picker.trigger.setAttribute("aria-expanded", String(open));
        if (!open) {
          if (picker === themePicker) previewTheme(picker.selected.dataset.theme);
          return;
        }
        const rect = picker.trigger.getBoundingClientRect();
        picker.menu.style.top = Math.max(8, Math.min(rect.bottom + 4, innerHeight - picker.menu.offsetHeight - 8)) + "px";
        picker.menu.style.left = Math.max(8, Math.min(rect.right - picker.menu.offsetWidth, innerWidth - picker.menu.offsetWidth - 8)) + "px";
        picker.search.value = "";
        filterPicker(picker);
        picker.selected.scrollIntoView({ block: "center", inline: "nearest" });
        movePickerHighlight(picker, picker.selected);
        picker.search.focus();
      });
      picker.menu.addEventListener("keydown", event => {
        if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
        const options = [...picker.menu.querySelectorAll(".picker-option:not([hidden])")];
        let index = options.indexOf(document.activeElement);
        if (event.key === "ArrowDown") index = index < 0 ? 0 : Math.min(index + 1, options.length - 1);
        if (event.key === "ArrowUp") index = index < 0 ? 0 : Math.max(index - 1, 0);
        if (event.key === "Home") index = 0;
        if (event.key === "End") index = options.length - 1;
        event.preventDefault();
        options[index]?.focus();
      });
      picker.search.addEventListener("input", () => filterPicker(picker));
      picker.options.addEventListener("pointermove", event => {
        const option = event.target.closest(".picker-option") ?? picker.selected;
        if (option === picker.highlighted) return;
        movePickerHighlight(picker, option);
        if (picker === themePicker) previewTheme(option.dataset.theme);
      });
      picker.options.addEventListener("pointerleave", () => {
        movePickerHighlight(picker, picker.selected);
        if (picker === themePicker) previewTheme(picker.selected.dataset.theme);
      });
      picker.options.addEventListener("focusin", event => {
        const option = event.target.closest(".picker-option");
        if (!option) return;
        movePickerHighlight(picker, option);
        if (picker === themePicker) previewTheme(option.dataset.theme);
      });
      picker.clear.addEventListener("click", () => {
        picker.search.value = "";
        filterPicker(picker);
        picker.search.focus();
      });
    }
    input.addEventListener("input", () => {
      examples[language] = input.value;
      render();
    });
    input.addEventListener("scroll", syncScroll);
    themePicker.menu.addEventListener("click", event => {
      const option = event.target.closest("[data-theme]");
      if (!option) return;
      followsSystemTheme = false;
      selectTheme(option.dataset.theme);
      themePicker.menu.hidePopover();
      themePicker.trigger.focus();
      render();
    });
    systemTheme.addEventListener("change", () => {
      if (!followsSystemTheme) return;
      selectTheme(systemTheme.matches ? "pierreDark" : "pierreLight");
      render();
    });
    langPicker.menu.addEventListener("click", event => {
      const option = event.target.closest("[data-lang]");
      if (!option) return;
      selectLanguage(option.dataset.lang);
      langPicker.menu.hidePopover();
      langPicker.trigger.focus();
      input.value = examples[language] ?? "";
      input.scrollTop = 0;
      input.scrollLeft = 0;
      render();
    });
    selectTheme(systemTheme.matches ? "pierreDark" : "pierreLight");
    document.getElementById("theme-picker").style.visibility = "";
    selectLanguage(language);
    input.value = examples[language];
    render();
  </script>
</body>
</html>
`;

function pickerOptions(groups, type, selected) {
  return groups
    .map(([group, options]) => {
      const label = group.replaceAll('&', '&amp;').replaceAll('<', '&lt;');
      const items = options
        .map(([value, name, icon, decoration]) => {
          const active = value === selected;
          const iconHtml = icon
            ? `<svg aria-hidden="true"><use href="#icon-${icon}"></use></svg>`
            : '';
          const decorationHtml = decoration
            ? `<svg class="picker-deco" aria-hidden="true"><use href="#icon-${decoration}"></use></svg>`
            : '';
          const text = name.replaceAll('&', '&amp;').replaceAll('<', '&lt;');
          return `<button class="picker-option" type="button" role="option" aria-selected="${active}" tabindex="${
            active ? 0 : -1
          }" data-${type}="${value}">${iconHtml}<span>${text}</span>${decorationHtml}</button>`;
        })
        .join('');
      return `<div class="picker-group" role="group" aria-label="${label}"><div class="picker-group-label">${label}</div>${items}</div>`;
    })
    .join('');
}

function serialize(value) {
  return JSON.stringify(value).replaceAll('<', '\\u003c');
}

function formatBytes(bytes, type = 'bytes') {
  return bytes.toLocaleString('en-US') + ' ' + type;
}

export default {
  fetch: (request) => {
    const url = new URL(request.url);
    const path = url.pathname;
    if (path === '/themes.json') {
      return Response.json(themes, {
        headers: {
          'Access-Control-Allow-Origin': '*',
        },
      });
    }
    return new Response(indexHtml, {
      headers: {
        'content-type': 'text/html; charset=utf-8',
        // Added COOP/COEP headers to enable cross-origin isolation.
        // This improves performance.now() `resolution from 100 µs to roughly 5 µs.
        'cross-origin-embedder-policy': 'require-corp',
        'cross-origin-opener-policy': 'same-origin',
      },
    });
  },
};
