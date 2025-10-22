// Generated `bun run icons:build`, see README for details
import { Colors, type IconProps } from '../Color';

export function IconBrandBuildkite({
  size = 16,
  color = 'currentcolor',
  style,
  className,
  ...props
}: IconProps) {
  const height = size;
  const width = size === '1em' ? '1em' : Math.round(Number(size) * 1.5);

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 16"
      width={width}
      height={height}
      fill={Colors[color] ?? color}
      style={style}
      className={`pi${className ? ` ${className}` : ''}`}
      {...props}
    >
      <path d="M16 8v8l8-4V4z" />
      <path d="M16 0v8l8-4z" opacity=".6" />
      <path d="M8 4v8l8-4V0z" />
      <path d="M0 0v8l8 4V4z" opacity=".6" />
    </svg>
  );
}
