// Generated `bun run icons:build`, see README for details
import { Colors, type IconProps } from '../Color';

export function IconSidebarLeftOpen({
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
      <path d="M13.25 2.5c.69 0 1.25.56 1.25 1.25v8.5c0 .69-.56 1.25-1.25 1.25H7.5V15h5.75A2.75 2.75 0 0 0 16 12.25v-8.5A2.75 2.75 0 0 0 13.25 1H7.5v1.5zM5.75 1a.75.75 0 0 1 .75.75v12.5a.75.75 0 0 1-.75.75h-3A2.75 2.75 0 0 1 0 12.25v-8.5A2.75 2.75 0 0 1 2.75 1z" />
    </svg>
  );
}
