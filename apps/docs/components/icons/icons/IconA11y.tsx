// Generated `bun run icons:build`, see README for details
import { Colors, type IconProps } from '../Color';

export function IconA11y({
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
      <path d="M8 4a2 2 0 1 0 0-4 2 2 0 0 0 0 4" />
      <path d="M4.039 6.567c.648.231 1.482.462 2.461.587v3.402l-2.357 3.93a1 1 0 0 0 1.715 1.028L8 11.945l2.143 3.57a1 1 0 0 0 1.714-1.028L9.5 10.556V7.154a11.8 11.8 0 0 0 2.461-.587c.48-.172.861-.344 1.127-.477a7 7 0 0 0 .4-.217l.027-.016.009-.005.003-.002.002-.001.001-.001a1 1 0 0 0-1.057-1.698l-.008.005-.048.028a5 5 0 0 1-.224.118c-.202.101-.51.241-.904.382a9.8 9.8 0 0 1-6.578 0 8 8 0 0 1-.904-.382 5 5 0 0 1-.272-.146l-.008-.005A1 1 0 0 0 2.47 5.848l.003.002.003.002.009.005.027.016.088.052q.112.063.312.165c.266.133.647.305 1.127.477" />
    </svg>
  );
}
