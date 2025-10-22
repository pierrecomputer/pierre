// Generated `bun run icons:build`, see README for details
import { Colors, type IconProps } from '../Color';

export function IconTarget({
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
      viewBox="0 0 17 17"
      width={width}
      height={height}
      fill={Colors[color] ?? color}
      style={style}
      className={`pi${className ? ` ${className}` : ''}`}
      {...props}
    >
      <path
        d="M5.15 8.15a3 3 0 1 1 6 0 3 3 0 0 1-6 0m3-1.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3"
        clip-rule="evenodd"
      />
      <path
        d="M8.9.75a.75.75 0 0 0-1.5 0v.44A7 7 0 0 0 1.19 7.4H.75a.75.75 0 1 0 0 1.5h.44a7 7 0 0 0 6.21 6.21v.439a.75.75 0 0 0 1.5 0v-.44a7 7 0 0 0 6.21-6.21h.439a.75.75 0 0 0 0-1.5h-.44A7 7 0 0 0 8.9 1.19zm-.75 1.9a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11"
        clip-rule="evenodd"
      />
    </svg>
  );
}
