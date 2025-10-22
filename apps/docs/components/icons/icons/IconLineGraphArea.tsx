// Generated `bun run icons:build`, see README for details
import { Colors, type IconProps } from '../Color';

export function IconLineGraphArea({
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
        d="M16 14.5a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 0 14.5v-.546a.74.74 0 0 0 .28-.174L6 8.06l2.47 2.47a.75.75 0 0 0 1.06 0L16 4.06z"
        opacity=".4"
      />
      <path d="M16 2.06 9.53 8.53a.75.75 0 0 1-1.06 0L6 6.06.28 11.78a.74.74 0 0 1-.28.174V9.94l5.47-5.47.056-.051a.75.75 0 0 1 1.004.052L9 6.94 15.72.22A.75.75 0 0 1 16 .045z" />
    </svg>
  );
}
