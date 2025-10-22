// Generated `bun run icons:build`, see README for details
import { Colors, type IconProps } from '../Color';

export function IconLayers({
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
      <path d="M7.772.144a1 1 0 0 0-.22.08L.895 3.553a.498.498 0 0 0 0 .894l6.659 3.33a1 1 0 0 0 .894 0l6.659-3.33a.5.5 0 0 0 0-.894L8.447.223a1 1 0 0 0-.675-.079" />
      <path d="m2.882 6.559-1.988.994a.5.5 0 0 0 0 .894l6.659 3.33a1 1 0 0 0 .894 0l6.659-3.33a.5.5 0 0 0 0-.894l-1.988-.994-4.224 2.112a2 2 0 0 1-1.788 0z" />
      <path d="m.894 11.553 1.988-.994 4.224 2.112a2 2 0 0 0 1.788 0l4.224-2.112 1.988.994a.5.5 0 0 1 0 .894l-6.659 3.33a1 1 0 0 1-.894 0l-6.659-3.33a.5.5 0 0 1 0-.894" />
    </svg>
  );
}
