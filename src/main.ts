import "./style.css";
import { createHighlighter, createOnigurumaEngine } from "shiki";

const highlighter = await createHighlighter({
	engine: createOnigurumaEngine(import("shiki/wasm")),
	langs: ["yaml"],
	themes: ["min-dark", "min-light"],
});

const ADD_LINE_NUMBERS = true;

const start = performance.now();
const html = highlighter.codeToHtml(
	`<div>Word</div>


<div>Toggle     Theme</div>`,
	{
		lang: "yaml",
		themes: {
			light: "min-light",
			dark: "min-dark",
		},
		defaultColor: false,
		transformers: [
			{
				code(code) {
					code.properties["data-code"] = "";
				},
				line(node, line) {
					node.tagName = "div";
					node.properties["data-column-content"] = "";
					delete node.properties.class;
					const children = [node];
					if (ADD_LINE_NUMBERS) {
						children.unshift({
							tagName: "div",
							type: "element",
							properties: {
								"data-column-number": "",
							},
							children: [{ type: "text", value: `${line}` }],
						});
					}
					return {
						tagName: "div",
						type: "element",
						properties: {
							"data-line": `${line}`,
						},
						children,
					};
				},
				pre(pre) {
					pre.properties["data-code"] = "";
					pre.properties["data-theme"] = "dark";
					const code = (() => {
						for (const child of pre.children) {
							if (child.type === "element" && child.tagName === "code") {
								return child;
							}
						}
					})();
					if (code == null) return;
					delete pre.properties.class;
					code.properties = pre.properties;
					return code;
				},
			},
		],
	},
);
console.log("ZZZZZ - totalTime", performance.now() - start);

const wrapper = document.getElementById("app");

if (wrapper != null) {
	wrapper.innerHTML = `
  <button id="toggle-theme">Toggle Theme</button>
  ${html}
`;
}

const element = document.getElementById("toggle-theme");
if (element != null) {
	element.addEventListener("click", () => {
		const code = document.querySelector("[data-theme]");
		if (!(code instanceof HTMLElement)) return;
		code.dataset.theme = code.dataset.theme === "light" ? "dark" : "light";
	});
}
