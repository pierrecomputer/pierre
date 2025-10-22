// Generated `bun run icons:build`, see README for details
import { Colors, type IconProps } from '../Color';

export function IconType({
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
      <path d="M12.297 12.997c-1.586 0-2.68-.985-2.68-2.492 0-1.438 1-2.344 2.883-2.352h2.164v-.836c0-1.078-.625-1.672-1.734-1.672-1.055 0-1.657.54-1.735 1.36H9.93c.086-1.438 1.062-2.485 3.047-2.485 1.75 0 3.023.953 3.023 2.68v5.664h-1.29v-1.023h-.038c-.414.664-1.164 1.156-2.375 1.156m.36-1.117c1.148 0 2.007-.72 2.007-1.743v-.953h-2.062c-1.125 0-1.61.532-1.61 1.274 0 .969.805 1.422 1.664 1.422m-11.234.984H0L3.797 2h1.39l3.797 10.864H7.547L6.469 9.661H2.5zM4.508 3.61h-.04l-1.6 4.95h3.234z" />
    </svg>
  );
}
