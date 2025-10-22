// Generated `bun run icons:build`, see README for details
import { Colors, type IconProps } from '../Color';

export function IconBranch({
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
      <path d="M2.5 1.75a2.5 2.5 0 1 0 2.385 3.253c.744.031 1.364.323 1.81.814.477.524.805 1.333.805 2.433v1a3.75 3.75 0 0 0 3.614 3.748 2.501 2.501 0 1 0 .002-1.502A2.25 2.25 0 0 1 9 9.25v-1C9 6.953 8.638 5.834 7.969 5h3.145a2.501 2.501 0 1 0 0-1.5H4.887A2.5 2.5 0 0 0 2.5 1.75m-1 2.5a1 1 0 1 1 2 0 1 1 0 0 1-2 0m12-1a1 1 0 1 1 0 2 1 1 0 0 1 0-2m-1 9a1 1 0 1 1 2 0 1 1 0 0 1-2 0" />
    </svg>
  );
}
