// Generated `bun run icons:build`, see README for details
import { Colors, type IconProps } from '../Color';

export function IconCodeComments({
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
      <path d="M10.059 15H8.136l3.941-14H14zm-6.136 0H2L5.941 1h1.923z" />
    </svg>
  );
}
