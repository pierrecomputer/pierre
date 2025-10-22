// Generated `bun run icons:build`, see README for details
import { Colors, type IconProps } from '../Color';

export function IconSquircle({
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
      <path d="M8 3c-4.117 0-5 .882-5 5s.882 5 5 5 5-.883 5-5-.883-5-5-5" />
    </svg>
  );
}
