// Generated `bun run icons:build`, see README for details
import { Colors, type IconProps } from '../Color';

export function IconHome2Fill({
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
      <path
        d="M9.505.195a.75.75 0 0 0-1.01 0L1.01 7H1v.01l-.754.685a.75.75 0 0 0 .766 1.258c.029 1.103.116 2.057.295 2.872.23 1.05.623 1.916 1.288 2.58.664.665 1.53 1.058 2.58 1.289C6.216 15.922 7.484 16 9 16s2.784-.078 3.825-.306c1.05-.23 1.916-.624 2.58-1.289s1.058-1.53 1.289-2.58c.178-.815.265-1.769.294-2.872a.75.75 0 0 0 .767-1.258L17 7.009V7h-.01L15 5.191V2.5a.5.5 0 0 0-.5-.5h-1a.5.5 0 0 0-.5.5v.873zM8 6c0-.828.172-1 1-1s1 .172 1 1-.172 1-1 1-1-.172-1-1m3 8.435V9.5a.5.5 0 0 0-.5-.5h-3a.5.5 0 0 0-.5.5v4.935c.586.045 1.249.065 2 .065s1.414-.02 2-.065"
        clip-rule="evenodd"
      />
    </svg>
  );
}
