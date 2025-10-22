// Generated `bun run icons:build`, see README for details
import { Colors, type IconProps } from '../Color';

export function IconComment({
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
      <path d="M8 1.5a6.5 6.5 0 0 0-4.596 11.096.75.75 0 0 1 0 1.06l-.843.844H8a6.5 6.5 0 1 0 0-13M0 8a8 8 0 1 1 8 8H.75a.75.75 0 0 1-.53-1.28l1.618-1.618A7.97 7.97 0 0 1 0 8" />
    </svg>
  );
}
