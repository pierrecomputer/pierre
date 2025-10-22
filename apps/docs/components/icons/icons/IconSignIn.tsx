// Generated `bun run icons:build`, see README for details
import { Colors, type IconProps } from '../Color';

export function IconSignIn({
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
      <path d="M7.25.75A.75.75 0 0 1 8 0h4.25A2.75 2.75 0 0 1 15 2.75v10.5A2.75 2.75 0 0 1 12.25 16H8a.75.75 0 0 1 0-1.5h4.25c.69 0 1.25-.56 1.25-1.25V2.75c0-.69-.56-1.25-1.25-1.25H8a.75.75 0 0 1-.75-.75" />
      <path d="M6.47 4.22a.75.75 0 0 1 1.06 0l3.25 3.25a.75.75 0 0 1 0 1.06l-3.25 3.25a.75.75 0 0 1-1.06-1.06l1.97-1.97H2.75a.75.75 0 0 1 0-1.5h5.69L6.47 5.28a.75.75 0 0 1 0-1.06" />
    </svg>
  );
}
