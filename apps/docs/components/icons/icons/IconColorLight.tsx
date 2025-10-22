// Generated `bun run icons:build`, see README for details
import { Colors, type IconProps } from '../Color';

export function IconColorLight({
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
      <path d="M12 8a4 4 0 1 1-8 0 4 4 0 0 1 8 0" />
      <path d="M8.21.109a.256.256 0 0 0-.42 0L6.534 1.893a.256.256 0 0 1-.316.085l-1.982-.917a.256.256 0 0 0-.362.21l-.196 2.174a.256.256 0 0 1-.232.232l-2.175.196a.256.256 0 0 0-.209.362l.917 1.982a.256.256 0 0 1-.085.316L.11 7.791a.256.256 0 0 0 0 .418l1.784 1.258a.256.256 0 0 1 .085.316l-.917 1.982a.256.256 0 0 0 .21.362l2.174.196c.123.011.22.11.232.232l.196 2.175a.256.256 0 0 0 .362.209l1.982-.917a.256.256 0 0 1 .316.085l1.258 1.785a.256.256 0 0 0 .418 0l1.258-1.785a.256.256 0 0 1 .316-.085l1.982.917a.256.256 0 0 0 .362-.21l.196-2.174a.256.256 0 0 1 .232-.232l2.175-.196a.256.256 0 0 0 .209-.362l-.917-1.982a.256.256 0 0 1 .085-.316l1.785-1.258a.256.256 0 0 0 0-.418l-1.785-1.258a.256.256 0 0 1-.085-.316l.917-1.982a.256.256 0 0 0-.21-.362l-2.174-.196a.256.256 0 0 1-.232-.232l-.196-2.175a.256.256 0 0 0-.362-.209l-1.982.917a.256.256 0 0 1-.316-.085zM8 13A5 5 0 1 1 8 3a5 5 0 0 1 0 10" />
    </svg>
  );
}
