// Generated `bun run icons:build`, see README for details
import { Colors, type IconProps } from '../Color';

export function IconLayers2Outline({
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
      <path d="m9.661 9.169-1.214.607-.107.046a1 1 0 0 1-.68 0l-.107-.046-1.215-.607 1.661-.831zm-3.339-1.67-1.657.83-.004.001-1.324-.662 1.662-.83zm6.339.17-1.323.661h-.003l-1.66-.831L11 6.838zM3.323 6l-1.662.83-.766-.383a.5.5 0 0 1 0-.894l.766-.384zm11.783-.447a.5.5 0 0 1 0 .894l-.768.383L12.677 6l1.66-.831zM6.323 4.5 5 5.161l-1.662-.83 1.323-.662zm6.338-.17L11 5.161 9.677 4.5l1.658-.83.003-.001zM7.553 2.224a1 1 0 0 1 .894 0l1.214.606L8 3.661l-1.662-.83z" />
      <path d="M15.105 9.554a.5.5 0 0 1 0 .894l-6.658 3.33c-.281.14-.613.14-.894 0l-6.659-3.33a.5.5 0 0 1 0-.894l1.989-.994 4.222 2.11a2 2 0 0 0 1.79 0l4.222-2.11z" />
    </svg>
  );
}
