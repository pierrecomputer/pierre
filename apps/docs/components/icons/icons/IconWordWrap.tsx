// Generated `bun run icons:build`, see README for details
import { Colors, type IconProps } from '../Color';

export function IconWordWrap({
  size = 16,
  color = 'currentcolor',
  style,
  className,
  ...props
}: IconProps) {
  const height = size;
  const width = size === '1em' ? '1em' : Math.round(Number(size) * 1);

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 16 16"
      width={width}
      height={height}
      fill={Colors[color] ?? color}
      style={style}
      className={`pi${className ? ` ${className}` : ''}`}
      {...props}
    >
      <path d="M0 8.25a.75.75 0 0 1 .75-.75h12a3.25 3.25 0 0 1 0 6.5h-2.19l.72.72a.75.75 0 1 1-1.06 1.06l-2-2a.75.75 0 0 1 0-1.06l2-2a.75.75 0 1 1 1.06 1.06l-.72.72h2.19a1.75 1.75 0 1 0 0-3.5h-12A.75.75 0 0 1 0 8.25" />
      <path
        d="M0 3.25a.75.75 0 0 1 .75-.75h14.5a.75.75 0 0 1 0 1.5H.75A.75.75 0 0 1 0 3.25m0 10a.75.75 0 0 1 .75-.75h4.5a.75.75 0 0 1 0 1.5H.75a.75.75 0 0 1-.75-.75"
        opacity=".4"
      />
    </svg>
  );
}
