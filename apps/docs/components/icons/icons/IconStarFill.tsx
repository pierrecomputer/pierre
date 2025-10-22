// Generated `bun run icons:build`, see README for details
import { Colors, type IconProps } from '../Color';

export function IconStarFill({
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
        d="M9.11.673c-.451-.897-1.769-.897-2.22 0L5.105 4.228l-4.043.577c-.94.135-1.461 1.299-.687 2.04L3.31 9.66l-.688 3.94c-.09.52.17.96.525 1.193a1.26 1.26 0 0 0 1.273.066L8 13.008l3.579 1.85a1.26 1.26 0 0 0 1.273-.066 1.18 1.18 0 0 0 .524-1.193l-.687-3.94 2.936-2.814c.774-.741.252-1.905-.687-2.04l-4.043-.577z"
        clip-rule="evenodd"
      />
    </svg>
  );
}
