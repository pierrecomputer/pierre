// Generated `bun run icons:build`, see README for details
import { Colors, type IconProps } from '../Color';

export function IconBan({
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
      <path d="M16 8A8 8 0 1 1 0 8a8 8 0 0 1 16 0m-1.5 0a6.47 6.47 0 0 0-1.19-3.75l-9.06 9.06A6.5 6.5 0 0 0 14.5 8M3.132 12.307l9.175-9.175a6.5 6.5 0 0 0-9.175 9.175" />
    </svg>
  );
}
