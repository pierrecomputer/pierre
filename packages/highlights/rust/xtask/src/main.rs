//! Translate the Highlights wasm module into Rust source.
//!
//! The module is closed-world: one memory, a handful of host imports, one
//! function table, and only integer and SIMD instructions. Each wasm function
//! becomes a method on `Instance`; wasm globals become struct fields; the
//! operand stack becomes typed slot variables (`s{depth}_{type}`) that LLVM
//! promotes to registers. Pure operations stay folded as Rust expressions until
//! a side effect forces them into their slot.
//!
//! Usage: `xtask gen <named.wasm> <out-dir>` writes `mod.rs` and `memory.bin`.

use std::collections::{BTreeSet, HashMap};
use std::fmt::Write as _;
use std::path::Path;

use wasmparser::{
    BlockType, DataKind, ElementItems, ElementKind, ExternalKind, FunctionBody, KnownCustom, Name,
    Operator, Parser, Payload, TypeRef, ValType,
};

fn main() {
    let args: Vec<String> = std::env::args().collect();
    match args.get(1).map(String::as_str) {
        Some("gen") => {
            let bytes = std::fs::read(&args[2]).expect("read wasm");
            let out = Path::new(&args[3]);
            std::fs::create_dir_all(out).unwrap();
            let module = Module::parse(&bytes);
            let (code, memory) = module.emit();
            std::fs::write(out.join("mod.rs"), code).unwrap();
            std::fs::write(out.join("memory.bin"), memory).unwrap();
        }
        _ => {
            eprintln!("usage: xtask gen <named.wasm> <out-dir>");
            std::process::exit(2);
        }
    }
}

#[derive(Clone)]
struct FuncType {
    params: Vec<ValType>,
    results: Vec<ValType>,
}

struct Global {
    name: String,
    ty: ValType,
    init: i64,
}

struct Module<'a> {
    types: Vec<FuncType>,
    /// Imported function `(module, name, type index)`, which come first in the
    /// function index space.
    imports: Vec<(String, String, u32)>,
    func_types: Vec<u32>,
    func_names: HashMap<u32, String>,
    local_names: HashMap<u32, HashMap<u32, String>>,
    global_names: HashMap<u32, String>,
    globals: Vec<Global>,
    exports: Vec<(String, u32)>,
    table: Vec<u32>,
    data: Vec<(u32, &'a [u8])>,
    memory_pages: u64,
    bodies: Vec<FunctionBody<'a>>,
    /// Function names that occur once, so their Rust methods can drop the
    /// index prefix and the host can call them by name.
    unique_names: BTreeSet<String>,
}

fn const_i64(expr: &wasmparser::ConstExpr) -> i64 {
    let mut r = expr.get_operators_reader();
    match r.read().unwrap() {
        Operator::I32Const { value } => value as i64,
        Operator::I64Const { value } => value,
        op => panic!("unsupported const expr {op:?}"),
    }
}

fn rust_ty(t: ValType) -> &'static str {
    match t {
        ValType::I32 => "i32",
        ValType::I64 => "i64",
        ValType::V128 => "V128",
        t => panic!("unsupported value type {t:?}"),
    }
}

fn ty_tag(t: ValType) -> &'static str {
    match t {
        ValType::I32 => "i",
        ValType::I64 => "l",
        ValType::V128 => "v",
        t => panic!("unsupported value type {t:?}"),
    }
}

fn zero(t: ValType) -> &'static str {
    match t {
        ValType::I32 => "0i32",
        ValType::I64 => "0i64",
        ValType::V128 => "v_zero()",
        t => panic!("unsupported value type {t:?}"),
    }
}

/// Turn a wasm name like `$hlEcmaImpl` or `$mem.streamState` into a Rust
/// identifier fragment.
fn sanitize(name: &str) -> String {
    let mut s: String = name
        .trim_start_matches('$')
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '_' {
                c
            } else {
                '_'
            }
        })
        .collect();
    if s.is_empty() || s.starts_with(|c: char| c.is_ascii_digit()) {
        s.insert(0, '_');
    }
    s
}

impl<'a> Module<'a> {
    fn parse(bytes: &'a [u8]) -> Self {
        let mut m = Module {
            types: vec![],
            imports: vec![],
            func_types: vec![],
            func_names: HashMap::new(),
            local_names: HashMap::new(),
            global_names: HashMap::new(),
            globals: vec![],
            exports: vec![],
            table: vec![],
            data: vec![],
            memory_pages: 0,
            bodies: vec![],
            unique_names: BTreeSet::new(),
        };
        for payload in Parser::new(0).parse_all(bytes) {
            match payload.unwrap() {
                Payload::TypeSection(r) => {
                    for ty in r.into_iter_err_on_gc_types() {
                        let ty = ty.unwrap();
                        m.types.push(FuncType {
                            params: ty.params().to_vec(),
                            results: ty.results().to_vec(),
                        });
                    }
                }
                Payload::ImportSection(r) => {
                    for imp in r {
                        let imp = imp.unwrap();
                        match imp.ty {
                            TypeRef::Func(t) => {
                                m.imports.push((imp.module.into(), imp.name.into(), t))
                            }
                            other => panic!("unsupported import {other:?}"),
                        }
                    }
                }
                Payload::FunctionSection(r) => {
                    for t in r {
                        m.func_types.push(t.unwrap());
                    }
                }
                Payload::MemorySection(r) => {
                    for mem in r {
                        m.memory_pages = mem.unwrap().initial;
                    }
                }
                Payload::GlobalSection(r) => {
                    for g in r {
                        let g = g.unwrap();
                        let idx = m.globals.len();
                        m.globals.push(Global {
                            name: format!("g{idx}"),
                            ty: g.ty.content_type,
                            init: const_i64(&g.init_expr),
                        });
                    }
                }
                Payload::ExportSection(r) => {
                    for e in r {
                        let e = e.unwrap();
                        if e.kind == ExternalKind::Func {
                            m.exports.push((e.name.into(), e.index));
                        }
                    }
                }
                Payload::ElementSection(r) => {
                    for e in r {
                        let e = e.unwrap();
                        let ElementKind::Active { offset_expr, .. } = e.kind else {
                            panic!("unsupported element kind");
                        };
                        let base = const_i64(&offset_expr) as usize;
                        let ElementItems::Functions(funcs) = e.items else {
                            panic!("unsupported element items");
                        };
                        for (i, f) in funcs.into_iter().enumerate() {
                            if m.table.len() <= base + i {
                                m.table.resize(base + i + 1, u32::MAX);
                            }
                            m.table[base + i] = f.unwrap();
                        }
                    }
                }
                Payload::DataSection(r) => {
                    for d in r {
                        let d = d.unwrap();
                        let DataKind::Active { offset_expr, .. } = d.kind else {
                            panic!("unsupported passive data");
                        };
                        m.data.push((const_i64(&offset_expr) as u32, d.data));
                    }
                }
                Payload::CodeSectionEntry(body) => m.bodies.push(body),
                Payload::CustomSection(c) => {
                    if let KnownCustom::Name(names) = c.as_known() {
                        for n in names {
                            match n.unwrap() {
                                Name::Function(map) => {
                                    for n in map {
                                        let n = n.unwrap();
                                        m.func_names.insert(n.index, n.name.into());
                                    }
                                }
                                Name::Local(map) => {
                                    for f in map {
                                        let f = f.unwrap();
                                        let mut locals = HashMap::new();
                                        for n in f.names {
                                            let n = n.unwrap();
                                            locals.insert(n.index, n.name.to_string());
                                        }
                                        m.local_names.insert(f.index, locals);
                                    }
                                }
                                Name::Global(map) => {
                                    for n in map {
                                        let n = n.unwrap();
                                        m.global_names.insert(n.index, n.name.into());
                                    }
                                }
                                _ => {}
                            }
                        }
                    }
                }
                _ => {}
            }
        }
        let mut counts: HashMap<String, usize> = HashMap::new();
        for name in m.func_names.values() {
            *counts.entry(sanitize(name)).or_default() += 1;
        }
        m.unique_names = m
            .func_names
            .values()
            .filter(|n| counts[&sanitize(n)] == 1)
            .cloned()
            .collect();
        // Give globals readable, unique names.
        let mut seen = BTreeSet::new();
        for (i, g) in m.globals.iter_mut().enumerate() {
            let base = m
                .global_names
                .get(&(i as u32))
                .map(|n| format!("g_{}", sanitize(n)))
                .unwrap_or_else(|| format!("g{i}"));
            let mut name = base.clone();
            if !seen.insert(name.clone()) {
                name = format!("{base}_{i}");
                seen.insert(name.clone());
            }
            g.name = name;
        }
        m
    }

    fn func_type(&self, idx: u32) -> &FuncType {
        let n = self.imports.len() as u32;
        if idx < n {
            &self.types[self.imports[idx as usize].2 as usize]
        } else {
            &self.types[self.func_types[(idx - n) as usize] as usize]
        }
    }

    /// Rust method name for a function index. Imports map to host methods
    /// that `rt.rs` implements.
    fn func_name(&self, idx: u32) -> String {
        let n = self.imports.len() as u32;
        if idx < n {
            return format!("host_{}", sanitize(&self.imports[idx as usize].1));
        }
        match self.func_names.get(&idx) {
            Some(name) if self.unique_names.contains(name) => format!("f_{}", sanitize(name)),
            Some(name) => format!("f{idx}_{}", sanitize(name)),
            None => format!("f{idx}"),
        }
    }

    fn emit(&self) -> (String, Vec<u8>) {
        let mut memory = vec![0u8; 65536];
        for (base, bytes) in &self.data {
            let base = *base as usize;
            assert!(base + bytes.len() <= memory.len(), "data outside page 1");
            memory[base..base + bytes.len()].copy_from_slice(bytes);
        }

        let mut out = String::new();
        out.push_str(
            "// @generated by `xtask gen` from highlights.wasm - do not edit\n\
             #![allow(unused_mut, unused_labels, unused_assignments, unused_variables, unused_parens,\n\
             unreachable_code, non_snake_case, dead_code, clippy::all)]\n\n\
             use crate::rt::*;\n\n",
        );
        writeln!(
            out,
            "pub const MEMORY_PAGES: usize = {};",
            self.memory_pages
        )
        .unwrap();
        out.push_str("pub static MEMORY_INIT: &[u8; 65536] = include_bytes!(\"memory.bin\");\n\n");

        out.push_str("pub struct Instance {\n    pub mem: Memory,\n    pub ext: Ext,\n");
        for g in &self.globals {
            writeln!(out, "    pub {}: {},", g.name, rust_ty(g.ty)).unwrap();
        }
        out.push_str("}\n\nimpl Instance {\n    pub fn new() -> Self {\n        Instance {\n");
        out.push_str("            mem: Memory::new(MEMORY_PAGES, MEMORY_INIT),\n");
        out.push_str("            ext: Ext::default(),\n");
        for g in &self.globals {
            let init = match g.ty {
                ValType::I32 => format!("{}i32", g.init as i32),
                ValType::I64 => format!("{}i64", g.init),
                _ => "v_zero()".into(),
            };
            writeln!(out, "            {}: {},", g.name, init).unwrap();
        }
        out.push_str("        }\n    }\n\n");

        for (name, idx) in &self.exports {
            let ty = self.func_type(*idx);
            let params: Vec<String> = ty
                .params
                .iter()
                .enumerate()
                .map(|(i, t)| format!("p{i}: {}", rust_ty(*t)))
                .collect();
            let args: Vec<String> = (0..ty.params.len()).map(|i| format!("p{i}")).collect();
            writeln!(
                out,
                "    #[inline]\n    pub fn export_{}(&mut self, {}){} {{ self.{}({}) }}",
                sanitize(name),
                params.join(", "),
                ret_sig(&ty.results),
                self.func_name(*idx),
                args.join(", ")
            )
            .unwrap();
        }
        out.push('\n');

        // Direct dispatch through the function table for the host, matching
        // the `call_indirect` in the `highlight` export.
        out.push_str("    pub fn call_table(&mut self, idx: u32) {\n        match idx {\n");
        for (i, f) in self.table.iter().enumerate() {
            if *f == u32::MAX {
                continue;
            }
            let ty = self.func_type(*f);
            if ty.params.is_empty() && ty.results.is_empty() {
                writeln!(out, "            {i} => self.{}(),", self.func_name(*f)).unwrap();
            }
        }
        out.push_str("            _ => trap(),\n        }\n    }\n\n");

        for (i, body) in self.bodies.iter().enumerate() {
            let idx = self.imports.len() as u32 + i as u32;
            FuncEmitter::new(self, idx, body).emit(&mut out);
        }

        // The single call_indirect site dispatches through this table.
        out.push_str("}\n");
        (out, memory)
    }
}

fn ret_sig(results: &[ValType]) -> String {
    match results {
        [] => String::new(),
        [t] => format!(" -> {}", rust_ty(*t)),
        ts => format!(
            " -> ({})",
            ts.iter()
                .map(|t| rust_ty(*t))
                .collect::<Vec<_>>()
                .join(", ")
        ),
    }
}

#[derive(Clone)]
struct Entry {
    expr: String,
    ty: ValType,
}

#[derive(PartialEq)]
enum FrameKind {
    Block,
    Loop,
    If,
    Func,
}

struct Frame {
    kind: FrameKind,
    label: String,
    /// Operand stack height when the frame was entered.
    height: usize,
    results: Vec<ValType>,
    /// The rest of the frame is unreachable after a branch or return.
    dead: bool,
    /// Nested blocks opened inside dead code, which emit nothing.
    dead_depth: usize,
}

struct FuncEmitter<'m, 'a> {
    m: &'m Module<'a>,
    idx: u32,
    body: &'m FunctionBody<'a>,
    stack: Vec<Entry>,
    frames: Vec<Frame>,
    slots: BTreeSet<(usize, &'static str)>,
    locals: Vec<(String, ValType)>,
    code: String,
    indent: usize,
    labels: usize,
}

impl<'m, 'a> FuncEmitter<'m, 'a> {
    fn new(m: &'m Module<'a>, idx: u32, body: &'m FunctionBody<'a>) -> Self {
        FuncEmitter {
            m,
            idx,
            body,
            stack: vec![],
            frames: vec![],
            slots: BTreeSet::new(),
            locals: vec![],
            code: String::new(),
            indent: 2,
            labels: 0,
        }
    }

    fn line(&mut self, s: &str) {
        for _ in 0..self.indent {
            self.code.push_str("    ");
        }
        self.code.push_str(s);
        self.code.push('\n');
    }

    fn slot(&mut self, depth: usize, ty: ValType) -> String {
        let tag = ty_tag(ty);
        self.slots.insert((depth, tag));
        format!("s{depth}{tag}")
    }

    fn push(&mut self, expr: String, ty: ValType) {
        self.stack.push(Entry { expr, ty });
    }

    fn pop(&mut self) -> Entry {
        self.stack.pop().expect("operand stack underflow")
    }

    fn is_const(expr: &str) -> bool {
        let e = expr.strip_prefix('-').unwrap_or(expr);
        let digits = e.trim_end_matches("i32").trim_end_matches("i64");
        digits.len() + 3 == e.len()
            && !digits.is_empty()
            && digits.bytes().all(|b| b.is_ascii_digit())
    }

    /// Write every pending expression into its slot, bottom to top, so a side
    /// effect cannot change what they read.
    fn flush(&mut self) {
        for d in 0..self.stack.len() {
            let Entry { expr, ty } = self.stack[d].clone();
            let slot = self.slot(d, ty);
            if expr == slot || Self::is_const(&expr) {
                continue;
            }
            self.line(&format!("{slot} = {expr};"));
            self.stack[d].expr = slot;
        }
    }

    /// Materialize a side-effecting result directly into the slot it occupies.
    fn push_effect(&mut self, expr: String, ty: ValType) {
        let d = self.stack.len();
        let slot = self.slot(d, ty);
        self.line(&format!("{slot} = {expr};"));
        self.push(slot, ty);
    }

    fn block_results(&self, bt: BlockType) -> Vec<ValType> {
        match bt {
            BlockType::Empty => vec![],
            BlockType::Type(t) => vec![t],
            BlockType::FuncType(i) => {
                let ty = &self.m.types[i as usize];
                assert!(ty.params.is_empty(), "block params are unsupported");
                ty.results.clone()
            }
        }
    }

    /// Copy the top `results.len()` stack values into the result slots of a
    /// frame entered at `height`.
    fn assign_results(&mut self, height: usize, results: &[ValType]) {
        let n = results.len();
        let top = self.stack.len() - n;
        for (i, t) in results.iter().enumerate() {
            let slot = self.slot(height + i, *t);
            let expr = self.stack[top + i].expr.clone();
            if expr != slot {
                self.line(&format!("{slot} = {expr};"));
            }
        }
    }

    /// Emit a branch to the frame `depth` levels out.
    fn branch(&mut self, depth: u32) {
        let fi = self.frames.len() - 1 - depth as usize;
        let (kind_loop, kind_func, label, height, results) = {
            let f = &self.frames[fi];
            (
                f.kind == FrameKind::Loop,
                f.kind == FrameKind::Func,
                f.label.clone(),
                f.height,
                f.results.clone(),
            )
        };
        if kind_func {
            self.ret();
            return;
        }
        if kind_loop {
            self.line(&format!("continue {label};"));
        } else {
            self.assign_results(height, &results);
            self.line(&format!("break {label};"));
        }
    }

    fn ret(&mut self) {
        let results = self.frames[0].results.clone();
        let n = results.len();
        let vals: Vec<String> = self.stack[self.stack.len() - n..]
            .iter()
            .map(|e| e.expr.clone())
            .collect();
        match n {
            0 => self.line("return;"),
            1 => self.line(&format!("return {};", vals[0])),
            _ => self.line(&format!("return ({});", vals.join(", "))),
        }
    }

    fn mark_dead(&mut self) {
        self.frames.last_mut().unwrap().dead = true;
    }

    fn new_label(&mut self, prefix: &str) -> String {
        self.labels += 1;
        format!("'{prefix}{}", self.labels)
    }

    fn binop(&mut self, ty: ValType, f: impl FnOnce(&str, &str) -> String) {
        let b = self.pop();
        let a = self.pop();
        self.push(f(&a.expr, &b.expr), ty);
    }

    fn unop(&mut self, ty: ValType, f: impl FnOnce(&str) -> String) {
        let a = self.pop();
        self.push(f(&a.expr), ty);
    }

    fn load(&mut self, ty: ValType, func: &str, offset: u64) {
        let a = self.pop();
        self.push(format!("self.mem.{func}({}, {offset})", a.expr), ty);
    }

    fn store(&mut self, func: &str, offset: u64) {
        let v = self.pop();
        let a = self.pop();
        self.flush();
        self.line(&format!(
            "self.mem.{func}({}, {offset}, {});",
            a.expr, v.expr
        ));
    }

    fn call(&mut self, func: String, ty: FuncType, extra: Option<String>) {
        let mut args: Vec<String> = (0..ty.params.len()).map(|_| self.pop().expr).collect();
        args.reverse();
        if let Some(e) = extra {
            args.insert(0, e);
        }
        self.flush();
        let call = format!("{func}({})", args.join(", "));
        match ty.results.as_slice() {
            [] => self.line(&format!("{call};")),
            [t] => self.push_effect(call, *t),
            _ => panic!("multi-value calls are unsupported"),
        }
    }

    fn emit(mut self, out: &mut String) {
        let ty = self.m.func_type(self.idx).clone();
        let names = self.m.local_names.get(&self.idx);
        let mut seen = BTreeSet::new();
        let mut local_name = |i: u32| {
            let base = names
                .and_then(|n| n.get(&i))
                .map(|n| format!("l_{}", sanitize(n)))
                .unwrap_or_else(|| format!("l{i}"));
            if seen.insert(base.clone()) {
                base
            } else {
                format!("{base}_{i}")
            }
        };
        for (i, t) in ty.params.iter().enumerate() {
            self.locals.push((local_name(i as u32), *t));
        }
        let n_params = self.locals.len();
        let mut reader = self.body.get_locals_reader().unwrap();
        for _ in 0..reader.get_count() {
            let (count, t) = reader.read().unwrap();
            for _ in 0..count {
                let i = self.locals.len() as u32;
                self.locals.push((local_name(i), t));
            }
        }

        self.frames.push(Frame {
            kind: FrameKind::Func,
            label: String::new(),
            height: 0,
            results: ty.results.clone(),
            dead: false,
            dead_depth: 0,
        });

        let mut ops = self.body.get_operators_reader().unwrap();
        while !ops.eof() {
            let op = ops.read().unwrap();
            self.op(op);
        }

        let name = self.m.func_name(self.idx);
        let params: Vec<String> = self.locals[..n_params]
            .iter()
            .map(|(n, t)| format!("mut {n}: {}", rust_ty(*t)))
            .collect();
        writeln!(
            out,
            "    #[allow(clippy::all)]\n    pub fn {name}(&mut self, {}){} {{",
            params.join(", "),
            ret_sig(&ty.results)
        )
        .unwrap();
        for (n, t) in &self.locals[n_params..] {
            writeln!(out, "        let mut {n}: {} = {};", rust_ty(*t), zero(*t)).unwrap();
        }
        for (d, tag) in &self.slots {
            let (t, z) = match *tag {
                "i" => ("i32", "0i32"),
                "l" => ("i64", "0i64"),
                _ => ("V128", "v_zero()"),
            };
            writeln!(out, "        let mut s{d}{tag}: {t} = {z};").unwrap();
        }
        out.push_str(&self.code);
        out.push_str("    }\n\n");
    }

    fn op(&mut self, op: Operator) {
        use Operator as O;
        use ValType::{I32, I64, V128};

        // Skip unreachable code, tracking nested blocks so `else` and `end`
        // match the right frame.
        if self.frames.last().unwrap().dead {
            match op {
                O::Block { .. } | O::Loop { .. } | O::If { .. } => {
                    self.frames.last_mut().unwrap().dead_depth += 1;
                    return;
                }
                O::End | O::Else if self.frames.last().unwrap().dead_depth > 0 => {
                    if matches!(op, O::End) {
                        self.frames.last_mut().unwrap().dead_depth -= 1;
                    }
                    return;
                }
                O::End | O::Else => {}
                _ => return,
            }
        }

        match op {
            O::Nop => {}
            O::Unreachable => {
                self.flush();
                self.line("trap();");
                self.mark_dead();
            }
            O::Block { blockty } => {
                self.flush();
                let label = self.new_label("b");
                self.line(&format!("{label}: {{"));
                self.indent += 1;
                let results = self.block_results(blockty);
                self.frames.push(Frame {
                    kind: FrameKind::Block,
                    label,
                    height: self.stack.len(),
                    results,
                    dead: false,
                    dead_depth: 0,
                });
            }
            O::Loop { blockty } => {
                self.flush();
                let label = self.new_label("l");
                self.line(&format!("{label}: loop {{"));
                self.indent += 1;
                let results = self.block_results(blockty);
                self.frames.push(Frame {
                    kind: FrameKind::Loop,
                    label,
                    height: self.stack.len(),
                    results,
                    dead: false,
                    dead_depth: 0,
                });
            }
            O::If { blockty } => {
                let cond = self.pop();
                self.flush();
                let label = self.new_label("b");
                self.line(&format!("{label}: {{ if {} != 0 {{", cond.expr));
                self.indent += 1;
                let results = self.block_results(blockty);
                self.frames.push(Frame {
                    kind: FrameKind::If,
                    label,
                    height: self.stack.len(),
                    results,
                    dead: false,
                    dead_depth: 0,
                });
            }
            O::Else => {
                let (height, results, dead) = {
                    let f = self.frames.last().unwrap();
                    (f.height, f.results.clone(), f.dead)
                };
                if !dead {
                    self.flush();
                    self.assign_results(height, &results);
                }
                self.stack.truncate(height);
                let f = self.frames.last_mut().unwrap();
                f.dead = false;
                f.dead_depth = 0;
                self.indent -= 1;
                self.line("} else {");
                self.indent += 1;
            }
            O::End => {
                let f = self.frames.pop().unwrap();
                if f.kind == FrameKind::Func {
                    if !f.dead {
                        self.frames.push(f);
                        self.ret();
                        self.frames.pop();
                    }
                    return;
                }
                if !f.dead {
                    self.flush();
                    self.assign_results(f.height, &f.results);
                }
                self.stack.truncate(f.height);
                self.indent -= 1;
                match f.kind {
                    FrameKind::Loop => {
                        if !f.dead {
                            self.indent += 1;
                            self.line(&format!("break {};", f.label));
                            self.indent -= 1;
                        }
                        self.line("}");
                    }
                    FrameKind::If => self.line("} }"),
                    _ => self.line("}"),
                }
                for (i, t) in f.results.iter().enumerate() {
                    let slot = self.slot(f.height + i, *t);
                    self.push(slot, *t);
                }
            }
            O::Br { relative_depth } => {
                self.flush();
                self.branch(relative_depth);
                self.mark_dead();
            }
            O::BrIf { relative_depth } => {
                let cond = self.pop();
                self.flush();
                self.line(&format!("if {} != 0 {{", cond.expr));
                self.indent += 1;
                self.branch(relative_depth);
                self.indent -= 1;
                self.line("}");
            }
            O::BrTable { targets } => {
                let idx = self.pop();
                self.flush();
                self.line(&format!("match {} as u32 {{", idx.expr));
                self.indent += 1;
                for (i, t) in targets.targets().enumerate() {
                    self.line(&format!("{i} => {{"));
                    self.indent += 1;
                    self.branch(t.unwrap());
                    self.indent -= 1;
                    self.line("}");
                }
                self.line("_ => {");
                self.indent += 1;
                self.branch(targets.default());
                self.indent -= 1;
                self.line("}");
                self.indent -= 1;
                self.line("}");
                self.mark_dead();
            }
            O::Return => {
                self.flush();
                self.ret();
                self.mark_dead();
            }
            O::Call { function_index } => {
                let ty = self.m.func_type(function_index).clone();
                // The host's emitter replaces the wasm one; see rt.rs.
                let name = match self.m.func_names.get(&function_index).map(String::as_str) {
                    Some("$emitTok" | "emitTok") => "self.emit_tok".to_string(),
                    Some("$emitGap" | "emitGap") => "self.emit_gap".to_string(),
                    _ => format!("self.{}", self.m.func_name(function_index)),
                };
                self.call(name, ty, None);
            }
            O::CallIndirect { type_index, .. } => {
                let ty = self.m.types[type_index as usize].clone();
                let idx = self.pop();
                let mut args: Vec<String> = (0..ty.params.len()).map(|_| self.pop().expr).collect();
                args.reverse();
                self.flush();
                let mut arms = String::new();
                for (i, f) in self.m.table.iter().enumerate() {
                    if *f == u32::MAX {
                        continue;
                    }
                    let fty = self.m.func_type(*f);
                    if fty.params != ty.params || fty.results != ty.results {
                        continue;
                    }
                    write!(
                        arms,
                        "{i} => self.{}({}), ",
                        self.m.func_name(*f),
                        args.join(", ")
                    )
                    .unwrap();
                }
                arms.push_str("_ => trap(), ");
                let expr = format!("match {} as u32 {{ {arms}}}", idx.expr);
                match ty.results.as_slice() {
                    [] => self.line(&format!("{expr};")),
                    [t] => self.push_effect(expr, *t),
                    _ => panic!("multi-value call_indirect is unsupported"),
                }
            }
            O::Drop => {
                self.pop();
            }
            O::Select | O::TypedSelect { .. } => {
                let c = self.pop();
                let b = self.pop();
                let a = self.pop();
                self.push(
                    format!(
                        "(if {} != 0 {{ {} }} else {{ {} }})",
                        c.expr, a.expr, b.expr
                    ),
                    a.ty,
                );
            }
            O::LocalGet { local_index } => {
                let (n, t) = self.locals[local_index as usize].clone();
                self.push(n, t);
            }
            O::LocalSet { local_index } => {
                let v = self.pop();
                self.flush();
                let n = self.locals[local_index as usize].0.clone();
                self.line(&format!("{n} = {};", v.expr));
            }
            O::LocalTee { local_index } => {
                let v = self.pop();
                self.flush();
                let (n, t) = self.locals[local_index as usize].clone();
                self.line(&format!("{n} = {};", v.expr));
                self.push(n, t);
            }
            O::GlobalGet { global_index } => {
                let g = &self.m.globals[global_index as usize];
                self.push(format!("self.{}", g.name), g.ty);
            }
            O::GlobalSet { global_index } => {
                let v = self.pop();
                self.flush();
                let g = &self.m.globals[global_index as usize];
                self.line(&format!("self.{} = {};", g.name, v.expr));
            }

            O::I32Load { memarg } => self.load(I32, "ld_i32", memarg.offset),
            O::I32Load8U { memarg } => self.load(I32, "ld_u8", memarg.offset),
            O::I32Load8S { memarg } => self.load(I32, "ld_s8", memarg.offset),
            O::I32Load16U { memarg } => self.load(I32, "ld_u16", memarg.offset),
            O::I32Load16S { memarg } => self.load(I32, "ld_s16", memarg.offset),
            O::I64Load { memarg } => self.load(I64, "ld_i64", memarg.offset),
            O::V128Load { memarg } => self.load(V128, "ld_v128", memarg.offset),
            O::I32Store { memarg } => self.store("st_i32", memarg.offset),
            O::I32Store8 { memarg } => self.store("st_i8", memarg.offset),
            O::I32Store16 { memarg } => self.store("st_i16", memarg.offset),
            O::I64Store { memarg } => self.store("st_i64", memarg.offset),
            O::V128Store { memarg } => self.store("st_v128", memarg.offset),
            O::MemorySize { .. } => {
                self.push("self.mem.pages()".into(), I32);
            }
            O::MemoryGrow { .. } => {
                let n = self.pop();
                self.flush();
                self.push_effect(format!("self.mem.grow({})", n.expr), I32);
            }
            O::MemoryCopy { .. } => {
                let n = self.pop();
                let src = self.pop();
                let dst = self.pop();
                self.flush();
                self.line(&format!(
                    "self.mem.copy({}, {}, {});",
                    dst.expr, src.expr, n.expr
                ));
            }
            O::MemoryFill { .. } => {
                let n = self.pop();
                let v = self.pop();
                let dst = self.pop();
                self.flush();
                self.line(&format!(
                    "self.mem.fill({}, {}, {});",
                    dst.expr, v.expr, n.expr
                ));
            }

            O::I32Const { value } => self.push(format!("{value}i32"), I32),
            O::I64Const { value } => self.push(format!("{value}i64"), I64),

            O::I32Eqz => self.unop(I32, |a| format!("(({a}) == 0) as i32")),
            O::I32Eq => self.binop(I32, |a, b| format!("(({a}) == ({b})) as i32")),
            O::I32Ne => self.binop(I32, |a, b| format!("(({a}) != ({b})) as i32")),
            O::I32LtS => self.binop(I32, |a, b| format!("(({a}) < ({b})) as i32")),
            O::I32LtU => self.binop(I32, |a, b| {
                format!("((({a}) as u32) < (({b}) as u32)) as i32")
            }),
            O::I32GtS => self.binop(I32, |a, b| format!("(({a}) > ({b})) as i32")),
            O::I32GtU => self.binop(I32, |a, b| {
                format!("((({a}) as u32) > (({b}) as u32)) as i32")
            }),
            O::I32LeS => self.binop(I32, |a, b| format!("(({a}) <= ({b})) as i32")),
            O::I32LeU => self.binop(I32, |a, b| {
                format!("((({a}) as u32) <= (({b}) as u32)) as i32")
            }),
            O::I32GeS => self.binop(I32, |a, b| format!("(({a}) >= ({b})) as i32")),
            O::I32GeU => self.binop(I32, |a, b| {
                format!("((({a}) as u32) >= (({b}) as u32)) as i32")
            }),
            O::I32Clz => self.unop(I32, |a| format!("({a}).leading_zeros() as i32")),
            O::I32Ctz => self.unop(I32, |a| format!("({a}).trailing_zeros() as i32")),
            O::I32Popcnt => self.unop(I32, |a| format!("({a}).count_ones() as i32")),
            O::I32Add => self.binop(I32, |a, b| format!("({a}).wrapping_add({b})")),
            O::I32Sub => self.binop(I32, |a, b| format!("({a}).wrapping_sub({b})")),
            O::I32Mul => self.binop(I32, |a, b| format!("({a}).wrapping_mul({b})")),
            O::I32And => self.binop(I32, |a, b| format!("(({a}) & ({b}))")),
            O::I32Or => self.binop(I32, |a, b| format!("(({a}) | ({b}))")),
            O::I32Xor => self.binop(I32, |a, b| format!("(({a}) ^ ({b}))")),
            O::I32Shl => self.binop(I32, |a, b| format!("({a}).wrapping_shl(({b}) as u32)")),
            O::I32ShrS => self.binop(I32, |a, b| format!("({a}).wrapping_shr(({b}) as u32)")),
            O::I32ShrU => self.binop(I32, |a, b| {
                format!("((({a}) as u32).wrapping_shr(({b}) as u32) as i32)")
            }),
            O::I32Rotl => self.binop(I32, |a, b| format!("({a}).rotate_left(({b}) as u32)")),
            O::I32Rotr => self.binop(I32, |a, b| format!("({a}).rotate_right(({b}) as u32)")),
            O::I32WrapI64 => self.unop(I32, |a| format!("(({a}) as i32)")),

            O::I64Eqz => self.unop(I32, |a| format!("(({a}) == 0) as i32")),
            O::I64Eq => self.binop(I32, |a, b| format!("(({a}) == ({b})) as i32")),
            O::I64Ne => self.binop(I32, |a, b| format!("(({a}) != ({b})) as i32")),
            O::I64LtU => self.binop(I32, |a, b| {
                format!("((({a}) as u64) < (({b}) as u64)) as i32")
            }),
            O::I64GtU => self.binop(I32, |a, b| {
                format!("((({a}) as u64) > (({b}) as u64)) as i32")
            }),
            O::I64Add => self.binop(I64, |a, b| format!("({a}).wrapping_add({b})")),
            O::I64Sub => self.binop(I64, |a, b| format!("({a}).wrapping_sub({b})")),
            O::I64Mul => self.binop(I64, |a, b| format!("({a}).wrapping_mul({b})")),
            O::I64And => self.binop(I64, |a, b| format!("(({a}) & ({b}))")),
            O::I64Or => self.binop(I64, |a, b| format!("(({a}) | ({b}))")),
            O::I64Xor => self.binop(I64, |a, b| format!("(({a}) ^ ({b}))")),
            O::I64Shl => self.binop(I64, |a, b| format!("({a}).wrapping_shl(({b}) as u32)")),
            O::I64ShrU => self.binop(I64, |a, b| {
                format!("((({a}) as u64).wrapping_shr(({b}) as u32) as i64)")
            }),
            O::I64ExtendI32U => self.unop(I64, |a| format!("((({a}) as u32) as i64)")),
            O::I64ExtendI32S => self.unop(I64, |a| format!("(({a}) as i64)")),
            O::I64LtS => self.binop(I32, |a, b| format!("(({a}) < ({b})) as i32")),
            O::I64GtS => self.binop(I32, |a, b| format!("(({a}) > ({b})) as i32")),
            O::I64LeS => self.binop(I32, |a, b| format!("(({a}) <= ({b})) as i32")),
            O::I64GeS => self.binop(I32, |a, b| format!("(({a}) >= ({b})) as i32")),
            O::I64LeU => self.binop(I32, |a, b| {
                format!("((({a}) as u64) <= (({b}) as u64)) as i32")
            }),
            O::I64GeU => self.binop(I32, |a, b| {
                format!("((({a}) as u64) >= (({b}) as u64)) as i32")
            }),
            O::I64ShrS => self.binop(I64, |a, b| format!("({a}).wrapping_shr(({b}) as u32)")),
            O::I64Rotl => self.binop(I64, |a, b| {
                format!("({a}).rotate_left((({b}) & 63) as u32)")
            }),
            O::I64Rotr => self.binop(I64, |a, b| {
                format!("({a}).rotate_right((({b}) & 63) as u32)")
            }),
            O::I64Clz => self.unop(I64, |a| format!("(({a}).leading_zeros() as i64)")),
            O::I64Ctz => self.unop(I64, |a| format!("(({a}).trailing_zeros() as i64)")),
            O::I64Popcnt => self.unop(I64, |a| format!("(({a}).count_ones() as i64)")),
            O::I32Extend8S => self.unop(I32, |a| format!("(({a}) as i8 as i32)")),
            O::I32Extend16S => self.unop(I32, |a| format!("(({a}) as i16 as i32)")),
            O::I64Load8U { memarg } => self.load(I64, "ld_u8_l", memarg.offset),
            O::I64Load16U { memarg } => self.load(I64, "ld_u16_l", memarg.offset),
            O::I64Load32U { memarg } => self.load(I64, "ld_u32_l", memarg.offset),
            O::I64Store8 { memarg } => self.store("st_i8_l", memarg.offset),
            O::I64Store16 { memarg } => self.store("st_i16_l", memarg.offset),
            O::I64Store32 { memarg } => self.store("st_i32_l", memarg.offset),
            O::V128Const { value } => {
                self.push(format!("v_const({}u128)", value.i128() as u128), V128)
            }
            O::V128Not => self.unop(V128, |a| format!("v_not({a})")),
            O::V128AndNot => self.binop(V128, |a, b| format!("v_andnot({a}, {b})")),

            O::I8x16Splat => self.unop(V128, |a| format!("v_splat({a})")),
            O::I8x16Eq => self.binop(V128, |a, b| format!("v_eq({a}, {b})")),
            O::I8x16Ne => self.binop(V128, |a, b| format!("v_ne({a}, {b})")),
            O::I8x16GeU => self.binop(V128, |a, b| format!("v_ge_u({a}, {b})")),
            O::I8x16GtS => self.binop(V128, |a, b| format!("v_gt_s({a}, {b})")),
            O::I8x16LeU => self.binop(V128, |a, b| format!("v_le_u({a}, {b})")),
            O::I8x16Sub => self.binop(V128, |a, b| format!("v_sub({a}, {b})")),
            O::V128And => self.binop(V128, |a, b| format!("v_and({a}, {b})")),
            O::V128Or => self.binop(V128, |a, b| format!("v_or({a}, {b})")),
            O::V128Xor => self.binop(V128, |a, b| format!("v_xor({a}, {b})")),
            O::I8x16Bitmask => self.unop(I32, |a| format!("v_bitmask({a})")),
            O::V128AnyTrue => self.unop(I32, |a| format!("v_any_true({a})")),

            op => panic!(
                "unsupported operator {op:?} in {}",
                self.m.func_name(self.idx)
            ),
        }
    }
}
