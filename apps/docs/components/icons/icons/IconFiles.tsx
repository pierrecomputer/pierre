// Generated `bun run icons:build`, see README for details
import { Colors, type IconProps } from '../Color';

export function IconFiles({
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
      <path d="M8.25 0A2.25 2.25 0 0 0 6 2.25v11.5A2.25 2.25 0 0 0 8.25 16h7.5A2.25 2.25 0 0 0 18 13.75v-9.5a.75.75 0 0 0-.22-.53l-3.5-3.5a.75.75 0 0 0-.53-.22zM7.5 2.25a.75.75 0 0 1 .75-.75H13v1.25A2.25 2.25 0 0 0 15.25 5h1.25v8.75a.75.75 0 0 1-.75.75h-7.5a.75.75 0 0 1-.75-.75z" />
      <path
        d="M5.083 14.481c.133.582.423 1.103.822 1.519H5.25A2.25 2.25 0 0 1 3 13.75V2.25A2.25 2.25 0 0 1 5.25 0h.655a3.24 3.24 0 0 0-.822 1.519.75.75 0 0 0-.583.731v11.5a.75.75 0 0 0 .583.731"
        opacity=".4"
      />
      <path
        d="M2.083 14.481c.133.582.423 1.103.822 1.519H2.25A2.25 2.25 0 0 1 0 13.75V2.25A2.25 2.25 0 0 1 2.25 0h.655a3.24 3.24 0 0 0-.822 1.519.75.75 0 0 0-.583.731v11.5a.75.75 0 0 0 .583.731"
        opacity=".1"
      />
    </svg>
  );
}
