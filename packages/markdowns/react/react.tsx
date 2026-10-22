'use client';

import { createMarkdownSession } from '@pierre/markdowns';
import type { MarkdownElement, MarkdownNode } from '@pierre/markdowns';
import {
  createElement,
  memo,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import type {
  ComponentProps,
  ComponentType,
  ElementType,
  HTMLAttributes,
  JSX,
  ReactNode,
} from 'react';

import { AnimatedText } from './animated-text';
import type { AnimateOptions } from './animated-text';
import { createFadeController, serverReducedMotion } from './fade-controller';
import type { FadeController } from './fade-controller';

export type { AnimateOptions } from './animated-text';

export interface ExtraProps {
  node: MarkdownElement;
  inline?: boolean;
  isIncomplete: boolean;
}
export type Components = {
  [Tag in keyof JSX.IntrinsicElements]?: ComponentType<
    JSX.IntrinsicElements[Tag] & ExtraProps
  >;
} & { inlineCode?: ComponentType<ComponentProps<'code'> & ExtraProps> };
export interface HighlightToken {
  content: string;
  color?: string;
  bgColor?: string;
  htmlStyle?: Record<string, string>;
}
export interface CodeHighlighterSession {
  /** Release cached state. A subsequent highlight may start a fresh session. */
  dispose(): void;
  highlight: CodeHighlighterPlugin['highlight'];
}
export interface CodeHighlighterPlugin {
  /** Create independent incremental state for each mounted code block. */
  createSession?(): CodeHighlighterSession;
  highlight(options: {
    code: string;
    language: string;
    isIncomplete: boolean;
  }): { tokens: HighlightToken[][] } | null;
}
export interface CustomRendererProps {
  code: string;
  language: string;
  isIncomplete: boolean;
}
export interface PluginConfig {
  code?: CodeHighlighterPlugin;
  renderers?: {
    language: string | string[];
    component: ComponentType<CustomRendererProps>;
  }[];
}
export interface ControlsConfig {
  code?: boolean | { copy?: boolean; download?: boolean };
}
export interface MarkdownProps extends Omit<
  HTMLAttributes<HTMLDivElement>,
  'children'
> {
  children?: string;
  mode?: 'streaming' | 'static';
  isAnimating?: boolean;
  /** Fade newly appended text while streaming. Disabled by default. */
  animated?: boolean | AnimateOptions;
  parseIncompleteMarkdown?: boolean;
  components?: Components;
  plugins?: PluginConfig;
  controls?: boolean | ControlsConfig;
  lineNumbers?: boolean;
  caret?: 'block' | 'circle';
  allowedElements?: string[];
  disallowedElements?: string[];
  unwrapDisallowed?: boolean;
  urlTransform?: (
    url: string,
    key: 'href' | 'src',
    node: MarkdownElement
  ) => string | null | undefined;
  onAnimationStart?: () => void;
  onAnimationEnd?: () => void;
}

/** Validate navigation URLs after the optional application transform. */
export function defaultUrlTransform(url: string): string | undefined {
  const normalized = url.replace(/[\u0000-\u0020\u007f-\u009f]/g, '');
  if (normalized.startsWith('//') || normalized.startsWith('\\'))
    return undefined;
  const scheme = /^([^/?#]*):/.exec(normalized)?.[1];
  if (scheme !== undefined && !/^(https?|mailto|tel)$/i.test(scheme))
    return undefined;
  return url;
}

const safeTags = new Set([
  'a',
  'blockquote',
  'br',
  'code',
  'del',
  'em',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'hr',
  'img',
  'input',
  'li',
  'ol',
  'p',
  'pre',
  'section',
  'strong',
  'sup',
  'table',
  'tbody',
  'td',
  'th',
  'thead',
  'tr',
  'ul',
]);
const allowedAttributes = new Set([
  'alt',
  'title',
  'start',
  'align',
  'class',
  'id',
  'type',
  'disabled',
  'checked',
  'aria-label',
  'data-footnotes',
  'data-footnote-ref',
  'data-footnote-backref',
  'data-footnote-backref-idx',
]);
const emptyComponents: Components = {};

interface RenderContext {
  components: Components;
  plugins?: PluginConfig;
  controls: boolean | ControlsConfig;
  lineNumbers: boolean;
  allowedElements?: string[];
  disallowedElements?: string[];
  unwrapDisallowed?: boolean;
  urlTransform?: MarkdownProps['urlTransform'];
  idPrefix: string;
  animationDuration?: number;
  fadeController: FadeController;
}

const useIsomorphicLayoutEffect =
  typeof window === 'undefined' ? useEffect : useLayoutEffect;

/** Collect literal code from generated elements without parsing Markdown in JS. */
function textContent(node: MarkdownNode): string {
  return node.type === 'text'
    ? node.value
    : node.children.map(textContent).join('');
}

/** Convert CSS token names to React style names, preserving theme variables. */
function tokenStyle(token: HighlightToken): import('react').CSSProperties {
  const styles: Record<string, string | undefined> = {
    color: token.color,
    backgroundColor: token.bgColor,
  };
  for (const [name, value] of Object.entries(token.htmlStyle ?? {})) {
    const property = name.startsWith('--')
      ? name
      : name.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase());
    styles[property] = value;
  }
  return styles;
}

function CodeBlock({
  node,
  context,
  isIncomplete,
  animate,
}: {
  node: MarkdownElement;
  context: RenderContext;
  isIncomplete: boolean;
  animate: boolean;
}): ReactNode {
  const [copiedCode, setCopiedCode] = useState<string | null>(null);
  const code = textContent(node);
  const language = node.properties.class?.replace(/^language-/, '') ?? 'text';
  const plugin = context.plugins?.code;
  const session = useMemo(() => plugin?.createSession?.(), [plugin]);
  useEffect(() => () => session?.dispose(), [session]);
  const highlighted = useMemo(
    () => (session ?? plugin)?.highlight({ code, language, isIncomplete }),
    [session, plugin, code, language, isIncomplete]
  );
  const customRenderer = context.plugins?.renderers?.find((renderer) =>
    typeof renderer.language === 'string'
      ? renderer.language === language
      : renderer.language.includes(language)
  );
  if (customRenderer !== undefined)
    return createElement(customRenderer.component, {
      code,
      language,
      isIncomplete,
    });
  const CustomCode = context.components.code;
  const controls =
    context.controls === false
      ? false
      : typeof context.controls === 'object'
        ? (context.controls.code ?? true)
        : true;
  const showCopy =
    controls !== false &&
    (typeof controls !== 'object' || controls.copy !== false);
  const showDownload =
    controls !== false &&
    (typeof controls !== 'object' || controls.download !== false);
  const lines: HighlightToken[][] =
    highlighted?.tokens ??
    code
      .replace(/\n$/, '')
      .split('\n')
      .map((content) => [{ content }]);
  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(code);
      setCopiedCode(code);
    } catch {
      setCopiedCode(null);
    }
  };
  const download = (): void => {
    const url = URL.createObjectURL(
      new Blob([code], { type: 'text/plain;charset=utf-8' })
    );
    const link = document.createElement('a');
    link.href = url;
    link.download = `code.${/^[a-z0-9]+$/i.test(language) ? language : 'txt'}`;
    link.click();
    URL.revokeObjectURL(url);
  };
  return (
    <div data-markdown="code-block" data-incomplete={isIncomplete || undefined}>
      <div data-markdown="code-header">
        <span>{language}</span>
        <span>
          {showCopy && (
            <button
              type="button"
              disabled={isIncomplete}
              onClick={() => {
                void copy();
              }}
              aria-label="Copy code"
            >
              {copiedCode === code ? 'Copied' : 'Copy'}
            </button>
          )}
          {showDownload && (
            <button type="button" disabled={isIncomplete} onClick={download}>
              Download
            </button>
          )}
        </span>
      </div>
      <pre dir="ltr">
        {CustomCode !== undefined ? (
          <CustomCode
            node={node}
            isIncomplete={isIncomplete}
            inline={false}
            className={node.properties.class}
          >
            {code}
          </CustomCode>
        ) : (
          <code className={node.properties.class}>
            {lines.map((line, index) => (
              <span key={index} data-markdown="code-line">
                {context.lineNumbers && (
                  <span data-markdown="line-number" aria-hidden="true">
                    {index + 1}
                  </span>
                )}
                {line.map((token, tokenIndex) => (
                  <span key={tokenIndex} style={tokenStyle(token)}>
                    {context.animationDuration === undefined ? (
                      token.content
                    ) : (
                      <AnimatedText
                        controller={context.fadeController}
                        value={token.content}
                        active={animate}
                        duration={context.animationDuration}
                      />
                    )}
                  </span>
                ))}
              </span>
            ))}
          </code>
        )}
      </pre>
    </div>
  );
}

/** Convert WAT element records into React nodes after filtering attributes and URLs. */
function renderNode(
  node: MarkdownNode,
  context: RenderContext,
  key: number,
  isIncomplete: boolean,
  animate: boolean,
  blockCode = false
): ReactNode {
  if (node.type === 'text')
    return context.animationDuration === undefined ? (
      node.value
    ) : (
      <AnimatedText
        controller={context.fadeController}
        key={key}
        value={node.value}
        active={animate}
        duration={context.animationDuration}
      />
    );
  const tag = node.tagName;
  if (!safeTags.has(tag)) return null;
  const disallowed =
    context.allowedElements !== undefined
      ? !context.allowedElements.includes(tag)
      : context.disallowedElements?.includes(tag) === true;
  if (disallowed)
    return context.unwrapDisallowed === true
      ? node.children.map((child, index) =>
          renderNode(child, context, index, isIncomplete, animate)
        )
      : null;
  if (
    tag === 'pre' &&
    context.components.pre === undefined &&
    node.children[0]?.type === 'element' &&
    node.children[0].tagName === 'code' &&
    (context.allowedElements === undefined ||
      context.allowedElements.includes('code')) &&
    context.disallowedElements?.includes('code') !== true
  ) {
    return (
      <CodeBlock
        key={key}
        node={node.children[0]}
        context={context}
        isIncomplete={isIncomplete && node.incomplete === true}
        animate={animate}
      />
    );
  }
  const props: Record<string, unknown> = { key, 'data-markdown': tag };
  for (const [name, value] of Object.entries(node.properties)) {
    if (name === 'href' || name === 'src') {
      if (value === 'streamdown:incomplete-link') continue;
      const transformed =
        context.urlTransform === undefined
          ? value
          : context.urlTransform(value, name, node);
      if (transformed !== null && transformed !== undefined) {
        const safe = defaultUrlTransform(transformed);
        if (safe !== undefined)
          props[name] =
            name === 'href' &&
            safe.startsWith('#fn') &&
            ('data-footnote-ref' in node.properties ||
              'data-footnote-backref' in node.properties)
              ? `#${context.idPrefix}${safe.slice(1)}`
              : safe;
      }
    } else if (allowedAttributes.has(name)) {
      if (name === 'class') props.className = value;
      else if (name === 'id') props.id = `${context.idPrefix}${value}`;
      else if (name === 'disabled' || name === 'checked') props[name] = true;
      else props[name] = value;
    }
  }
  if (tag === 'input') {
    props.type = 'checkbox';
    props.disabled = true;
    props.readOnly = true;
  }
  if (tag === 'img') {
    if (props.src === undefined) return null;
    props.loading = 'lazy';
    props.alt ??= '';
  }
  // Keep the same link component while its destination arrives. Replacing a
  // placeholder span would remount the label and restart its entrance fades.
  if (tag === 'a' && props.href === undefined)
    props['data-markdown'] = 'incomplete-link';
  if ((tag === 'td' || tag === 'th') && typeof props.align === 'string') {
    props.style = { textAlign: props.align };
    delete props.align;
  }
  const Component = (
    tag === 'code'
      ? blockCode
        ? context.components.code
        : (context.components.inlineCode ?? context.components.code)
      : context.components[tag as keyof Components]
  ) as ElementType | undefined;
  if (Component !== undefined) {
    props.node = node;
    props.isIncomplete = isIncomplete;
    if (tag === 'code') props.inline = !blockCode;
  }
  const children = node.children.map((child, index) =>
    renderNode(child, context, index, isIncomplete, animate, tag === 'pre')
  );
  return createElement(Component ?? tag, props, ...children);
}

/** Footnotes can follow an open code block in output order. */
function hasIncompleteFence(node: MarkdownNode): boolean {
  return (
    node.type === 'element' &&
    (node.incomplete === true || node.children.some(hasIncompleteFence))
  );
}

const blockMetadata = new WeakMap<
  MarkdownNode,
  { signature: string; incompleteFence: boolean }
>();

/** Cache derived block data while the parser reuses its immutable owned nodes.
 * Weak keys let replaced blocks be collected; full reparses still compare by
 * content so unchanged custom components retain their state.
 */
function getBlockMetadata(node: MarkdownNode): {
  signature: string;
  incompleteFence: boolean;
} {
  let metadata = blockMetadata.get(node);
  if (metadata === undefined) {
    metadata = {
      signature: JSON.stringify(node),
      incompleteFence: hasIncompleteFence(node),
    };
    blockMetadata.set(node, metadata);
  }
  return metadata;
}

const Block = memo(
  function Block({
    node,
    context,
    isIncomplete,
    animate,
  }: {
    node: MarkdownNode;
    signature: string;
    context: RenderContext;
    isIncomplete: boolean;
    animate: boolean;
  }): ReactNode {
    return renderNode(node, context, 0, isIncomplete, animate);
  },
  // Lifecycle-only changes reach live fades through the controller, not historical blocks.
  (a, b) =>
    (a.node === b.node || a.signature === b.signature) &&
    a.context === b.context &&
    a.isIncomplete === b.isIncomplete
);

/** Render growing Markdown strings while preserving unchanged React blocks. */
export function Markdown({
  children = '',
  mode = 'streaming',
  isAnimating = false,
  animated = false,
  parseIncompleteMarkdown = true,
  components = emptyComponents,
  plugins,
  controls = true,
  lineNumbers = true,
  caret,
  allowedElements,
  disallowedElements,
  unwrapDisallowed,
  urlTransform,
  onAnimationStart,
  onAnimationEnd,
  className,
  ...props
}: MarkdownProps): ReactNode {
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const fadeController = useMemo(() => createFadeController(), []);
  const reducedMotion = useSyncExternalStore(
    fadeController.subscribeMotion,
    fadeController.getReducedMotion,
    serverReducedMotion
  );
  // Keep text boundaries mounted when disabling fades so selections survive cleanup.
  const [keepAnimatedText, setKeepAnimatedText] = useState(animated !== false);
  if (animated !== false && !keepAnimatedText) setKeepAnimatedText(true);
  useEffect(() => {
    if (keepAnimatedText && root.current !== null)
      return fadeController.attach(root.current);
    return undefined;
  }, [fadeController, keepAnimatedText]);
  const streaming = mode === 'streaming' && isAnimating;
  const requestedDuration =
    typeof animated === 'object' ? (animated.duration ?? 180) : 180;
  const animationDuration =
    animated === false && !keepAnimatedText
      ? undefined
      : animated === false
        ? 0
        : Math.max(
            0,
            Number.isFinite(requestedDuration) ? requestedDuration : 180
          );
  const animate =
    streaming &&
    animated !== false &&
    animationDuration !== 0 &&
    !reducedMotion;
  useIsomorphicLayoutEffect(() => {
    fadeController.setActive(animate);
  }, [fadeController, animate]);
  const parser = useMemo(() => createMarkdownSession(), []);
  const blocks = useMemo(
    () =>
      parser.render(children, {
        incomplete: mode === 'streaming' && parseIncompleteMarkdown,
      }),
    [parser, children, mode, parseIncompleteMarkdown]
  );
  const context = useMemo<RenderContext>(
    () => ({
      components,
      plugins,
      controls,
      lineNumbers,
      allowedElements,
      disallowedElements,
      unwrapDisallowed,
      urlTransform,
      idPrefix: `${id}-`,
      animationDuration,
      fadeController,
    }),
    [
      components,
      plugins,
      controls,
      lineNumbers,
      allowedElements,
      disallowedElements,
      unwrapDisallowed,
      urlTransform,
      id,
      animationDuration,
      fadeController,
    ]
  );
  const callbacks = useRef({ onAnimationStart, onAnimationEnd });
  useEffect(() => {
    callbacks.current = { onAnimationStart, onAnimationEnd };
  }, [onAnimationStart, onAnimationEnd]);
  useEffect(() => {
    if (!streaming) return;
    callbacks.current.onAnimationStart?.();
    return () => {
      callbacks.current.onAnimationEnd?.();
    };
  }, [streaming]);
  if (allowedElements !== undefined && disallowedElements !== undefined)
    throw new Error('Use either allowedElements or disallowedElements.');
  return (
    <div
      {...props}
      ref={root}
      className={className}
      data-markdown="root"
      data-streaming={streaming || undefined}
    >
      {blocks.map((node, index) => {
        const metadata = getBlockMetadata(node);
        return (
          <Block
            key={index}
            node={node}
            signature={metadata.signature}
            context={context}
            animate={animate}
            isIncomplete={
              streaming &&
              (index === blocks.length - 1 || metadata.incompleteFence)
            }
          />
        );
      })}
      {streaming && caret !== undefined && (
        <span data-markdown="caret" data-shape={caret} aria-hidden="true">
          {caret === 'block' ? '▍' : '●'}
        </span>
      )}
    </div>
  );
}
