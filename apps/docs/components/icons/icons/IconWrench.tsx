// Generated `bun run icons:build`, see README for details
import { Colors, type IconProps } from '../Color';

export function IconWrench({
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
      <path
        d="M12.505 6.381a.25.25 0 0 0 .241-.065l2.692-2.691c.13-.13.35-.08.398.099a5 5 0 0 1-7.16 5.705l-4.408 5.839a2.5 2.5 0 1 1-3.536-3.536l5.84-4.408A5 5 0 0 1 12.278.165c.178.047.229.267.099.397L9.685 3.254a.25.25 0 0 0-.065.242l.572 2.136a.25.25 0 0 0 .177.177zM3.5 13.5a1 1 0 1 1-2 0 1 1 0 0 1 2 0"
        clip-rule="evenodd"
      />
    </svg>
  );
}
