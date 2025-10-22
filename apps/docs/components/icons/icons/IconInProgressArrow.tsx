// Generated `bun run icons:build`, see README for details
import { Colors, type IconProps } from '../Color';

export function IconInProgressArrow({
  size = 16,
  color = 'currentcolor',
  style,
  className,
  ...props
}: IconProps) {
  const height = size;
  const width =
    size === '1em' ? '1em' : Math.round(Number(size) * 0.9411764705882353);

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 16 17"
      width={width}
      height={height}
      fill={Colors[color] ?? color}
      style={style}
      className={`pi${className ? ` ${className}` : ''}`}
      {...props}
    >
      <path d="M1.506.044a.75.75 0 0 0-.494.631L.658 4.211a.75.75 0 0 0 .821.82l3.536-.353a.75.75 0 0 0 .455-1.276l-.876-.876a6.5 6.5 0 1 1-3.093 5.423.75.75 0 0 0-1.5-.026A8 8 0 1 0 3.51 1.44L2.288.22a.75.75 0 0 0-.782-.176" />
      <path d="M13.252 8.063a5.25 5.25 0 0 1-4.75 5.227.466.466 0 0 1-.5-.477v-9.5c0-.276.224-.502.5-.476.59.056 1.154.21 1.672.445a5.26 5.26 0 0 1 2.876 3.333c.131.46.202.946.202 1.448" />
    </svg>
  );
}
