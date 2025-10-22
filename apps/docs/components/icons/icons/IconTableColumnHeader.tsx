// Generated `bun run icons:build`, see README for details
import { Colors, type IconProps } from '../Color';

export function IconTableColumnHeader({
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
      <path d="M2.25 1A2.25 2.25 0 0 0 0 3.25v9.5A2.25 2.25 0 0 0 2.25 15h11.5A2.25 2.25 0 0 0 16 12.75v-9.5A2.25 2.25 0 0 0 13.75 1zM4 7.25V2.5h4.5v4.75zm6 0V2.5h3.75a.75.75 0 0 1 .75.75v4zm0 1.5h4.5v4a.75.75 0 0 1-.75.75H10zm-1.5 0v4.75H4V8.75z" />
    </svg>
  );
}
