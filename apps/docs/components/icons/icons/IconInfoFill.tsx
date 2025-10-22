// Generated `bun run icons:build`, see README for details
import { Colors, type IconProps } from '../Color';

export function IconInfoFill({
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
      <path d="M8 0a8 8 0 1 0 0 16A8 8 0 0 0 8 0m.037 11.103q-.05.244.019.388.068.137.29.137.148 0 .364-.054.222-.06.401-.203l-.117.514q-.222.268-.673.442a2.5 2.5 0 0 1-.883.173q-.573 0-.796-.34-.216-.34-.068-1.022l.778-3.517q.043-.216-.019-.31-.061-.096-.29-.138L6.5 7.089l.111-.478 2.482-.304zm-.03-6.17a.75.75 0 0 1-.235-.561q0-.365.259-.615a.9.9 0 0 1 .642-.257.8.8 0 0 1 .586.227q.24.22.241.561 0 .245-.123.442a.9.9 0 0 1-.321.317.9.9 0 0 1-.457.113.82.82 0 0 1-.593-.227" />
    </svg>
  );
}
