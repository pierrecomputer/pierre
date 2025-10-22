// Generated `bun run icons:build`, see README for details
import { Colors, type IconProps } from '../Color';

export function IconPlay({
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
      <path d="M12.652 7.31c.463.38.464.996 0 1.376-.604.496-1.678 1.272-3.542 2.366-1.723 1.012-2.877 1.565-3.615 1.867-.632.26-1.229-.132-1.306-.82C4.094 11.262 4 9.939 4 7.998c0-1.933.094-3.253.187-4.09.078-.694.681-1.088 1.318-.827.74.304 1.893.857 3.605 1.862 1.86 1.092 2.936 1.87 3.542 2.367" />
    </svg>
  );
}
