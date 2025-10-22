// Generated `bun run icons:build`, see README for details
import { Colors, type IconProps } from '../Color';

export function IconMicrophone({
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
      <path d="M5 3a3 3 0 0 1 6 0v4a3 3 0 0 1-6 0z" />
      <path d="M4.75 15.25a.75.75 0 0 1 .75-.75h1.75v-1.799A5.75 5.75 0 0 1 2.25 7a.75.75 0 0 1 1.5 0 4.25 4.25 0 0 0 8.5 0 .75.75 0 0 1 1.5 0 5.75 5.75 0 0 1-5 5.701V14.5h1.75a.75.75 0 0 1 0 1.5h-5a.75.75 0 0 1-.75-.75" />
    </svg>
  );
}
