// Generated `bun run icons:build`, see README for details
import { Colors, type IconProps } from '../Color';

export function IconInfo({
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
      <path d="m8.322 10.758.908-4.263-2.134.27L7 7.19l.467.075q.196.037.25.122.052.085.016.276l-.67 3.127q-.127.605.06.907.19.303.684.303.371 0 .759-.154.387-.154.579-.393l.1-.456a.9.9 0 0 1-.345.18 1.3 1.3 0 0 1-.313.048q-.19 0-.25-.122-.057-.127-.015-.345m-.027-5.484a.7.7 0 0 0 .51.202.8.8 0 0 0 .393-.101.8.8 0 0 0 .276-.281.74.74 0 0 0 .106-.393.66.66 0 0 0-.207-.5A.68.68 0 0 0 8.869 4q-.324 0-.552.228a.74.74 0 0 0-.223.547q0 .298.201.499" />
      <path d="M0 8a8 8 0 1 1 16 0A8 8 0 0 1 0 8m8-6.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13" />
    </svg>
  );
}
