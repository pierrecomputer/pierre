// Generated `bun run icons:build`, see README for details
import { Colors, type IconProps } from '../Color';

export function IconLogs({
  size = 16,
  color = 'currentcolor',
  style,
  className,
  ...props
}: IconProps) {
  const height = size;
  const width = size === '1em' ? '1em' : Math.round(Number(size) * 1.125);

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 18 16"
      width={width}
      height={height}
      fill={Colors[color] ?? color}
      style={style}
      className={`pi${className ? ` ${className}` : ''}`}
      {...props}
    >
      <path d="M4 12a.5.5 0 0 1 0 1h-.5a.5.5 0 0 1 0-1zm5.5 0a.5.5 0 0 1 0 1H6a.5.5 0 0 1 0-1zm5 0a.5.5 0 0 1 0 1H14a.5.5 0 0 1 0-1zM4 10a.5.5 0 0 1 0 1h-.5a.5.5 0 0 1 0-1zm6.5 0a.5.5 0 0 1 0 1H6a.5.5 0 0 1 0-1zm4 0a.5.5 0 0 1 0 1H14a.5.5 0 0 1 0-1zM4 8a.5.5 0 0 1 0 1h-.5a.5.5 0 0 1 0-1zm7.5 0a.5.5 0 0 1 0 1H6a.5.5 0 0 1 0-1zm3 0a.5.5 0 0 1 0 1H14a.5.5 0 0 1 0-1zM4 6a.5.5 0 0 1 0 1h-.5a.5.5 0 0 1 0-1zm7.5 0a.5.5 0 0 1 0 1H6a.5.5 0 0 1 0-1zm3 0a.5.5 0 0 1 0 1H14a.5.5 0 0 1 0-1zm-.25-3a.75.75 0 0 1 0 1.5H3.75a.75.75 0 0 1 0-1.5z" />
      <path
        d="M15.25 0A2.75 2.75 0 0 1 18 2.75v10.5A2.75 2.75 0 0 1 15.25 16H2.75A2.75 2.75 0 0 1 0 13.25V2.75A2.75 2.75 0 0 1 2.75 0zM2.75 1.5c-.69 0-1.25.56-1.25 1.25v10.5c0 .69.56 1.25 1.25 1.25h12.5c.69 0 1.25-.56 1.25-1.25V2.75c0-.69-.56-1.25-1.25-1.25z"
        clip-rule="evenodd"
      />
    </svg>
  );
}
