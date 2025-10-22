// Generated `bun run icons:build`, see README for details
import { Colors, type IconProps } from '../Color';

export function IconShare({
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
      <path d="M9.75.75c0 .414.336.75.75.75h2.94L7.47 7.47a.75.75 0 0 0 1.06 1.06l5.97-5.97V5.5a.75.75 0 0 0 1.5 0V.75a.75.75 0 0 0-.75-.75H10.5a.75.75 0 0 0-.75.75M7.161 2.513a.75.75 0 1 0-.045-1.499c-2.214.066-3.872.408-4.897 1.616C1.224 3.8 1 5.6 1 8.003c0 1.304.069 2.403.27 3.31.204.917.553 1.685 1.145 2.276.591.591 1.358.94 2.275 1.144.908.202 2.007.27 3.31.27 2.404 0 4.203-.223 5.374-1.218 1.208-1.025 1.55-2.683 1.616-4.898a.75.75 0 1 0-1.5-.044c-.065 2.196-.419 3.232-1.087 3.799-.703.597-1.958.862-4.402.862-1.27 0-2.239-.07-2.986-.235-.738-.164-1.212-.413-1.54-.74-.327-.328-.576-.802-.74-1.54-.166-.747-.235-1.716-.235-2.986 0-2.444.265-3.7.862-4.403.567-.667 1.603-1.021 3.799-1.087" />
    </svg>
  );
}
