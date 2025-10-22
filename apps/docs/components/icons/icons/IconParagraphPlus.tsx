// Generated `bun run icons:build`, see README for details
import { Colors, type IconProps } from '../Color';

export function IconParagraphPlus({
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
      <path d="M3.75 1.5a.75.75 0 0 0-1.5 0V3H.75a.75.75 0 0 0 0 1.5h1.5V6a.75.75 0 0 0 1.5 0V4.5h1.5a.75.75 0 0 0 0-1.5h-1.5zm4-.5a.75.75 0 0 0 0 1.5h7.5a.75.75 0 0 0 0-1.5zm0 4a.75.75 0 0 0 0 1.5h7.5a.75.75 0 0 0 0-1.5zm-7 4a.75.75 0 0 0 0 1.5h14.5a.75.75 0 0 0 0-1.5zm0 4a.75.75 0 0 0 0 1.5h9.5a.75.75 0 0 0 0-1.5z" />
    </svg>
  );
}
