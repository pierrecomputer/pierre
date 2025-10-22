// Generated `bun run icons:build`, see README for details
import { Colors, type IconProps } from '../Color';

export function IconCodeStyleBars({
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
      <path
        d="M4.25 13a.75.75 0 0 1 0 1.5h-1.5a.75.75 0 0 1 0-1.5zm2-12a.75.75 0 0 1 0 1.5h-3.5a.75.75 0 0 1 0-1.5zM4 4.75A.75.75 0 0 1 4.75 4h6.5a.75.75 0 0 1 0 1.5h-6.5A.75.75 0 0 1 4 4.75"
        opacity=".4"
      />
      <path
        d="M4 7.75A.75.75 0 0 1 4.75 7h10.5a.75.75 0 0 1 0 1.5H4.75A.75.75 0 0 1 4 7.75"
        clip-rule="evenodd"
      />
      <path d="M4 10.75a.75.75 0 0 1 .75-.75h8.5a.75.75 0 0 1 0 1.5h-8.5a.75.75 0 0 1-.75-.75M0 7.5A.5.5 0 0 1 .5 7h1a.5.5 0 0 1 .5.5V11a.5.5 0 0 1-.5.5h-1A.5.5 0 0 1 0 11z" />
    </svg>
  );
}
