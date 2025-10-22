// Generated `bun run icons:build`, see README for details
import { Colors, type IconProps } from '../Color';

export function IconEyeSlash({
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
      <path d="m13.47 1.47-12 12 1.06 1.06 12-12zM8 14c-.92 0-1.802-.208-2.624-.547l1.173-1.174c.476.142.963.221 1.451.221 1.66 0 3.307-.949 4.626-2.196a10.4 10.4 0 0 0 1.494-1.751A5 5 0 0 0 14.443 8a5 5 0 0 0-.323-.553 10 10 0 0 0-1.238-1.5l1.061-1.062C15.222 6.173 16 7.511 16 8c0 1.05-3.582 6-8 6" />
      <path d="M8 11q-.084 0-.167-.005l3.162-3.162q.006.083.005.167a3 3 0 0 1-3 3M5.005 8.167l3.162-3.162a3 3 0 0 0-3.162 3.162" />
      <path d="M8 3.5c.485 0 .97.081 1.445.227l1.168-1.169C9.794 2.212 8.915 2 8 2 3.582 2 0 6.8 0 8c0 .555.766 1.88 2.027 3.144l1.06-1.06a9.5 9.5 0 0 1-1.203-1.461 4.3 4.3 0 0 1-.345-.617L1.536 8l.003-.006c.064-.149.176-.359.345-.617a9.8 9.8 0 0 1 1.482-1.73C4.675 4.427 6.326 3.5 8 3.5" />
    </svg>
  );
}
