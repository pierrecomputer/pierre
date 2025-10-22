// Generated `bun run icons:build`, see README for details
import { Colors, type IconProps } from '../Color';

export function IconLinearDone({
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
        d="M8 0a8 8 0 1 0 0 16A8 8 0 0 0 8 0m4.08 5.975a.75.75 0 0 0-1.16-.95L6.943 9.884 5.03 7.97a.75.75 0 0 0-1.06 1.06l2.5 2.5a.75.75 0 0 0 1.11-.055z"
        clip-rule="evenodd"
      />
    </svg>
  );
}
