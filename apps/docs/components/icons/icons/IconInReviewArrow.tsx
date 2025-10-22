// Generated `bun run icons:build`, see README for details
import { Colors, type IconProps } from '../Color';

export function IconInReviewArrow({
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
      <path
        d="M8 1.563c-1.68 0-3.21.637-4.364 1.683A.75.75 0 1 1 2.63 2.134 7.97 7.97 0 0 1 8 .064c1.18 0 2.3.255 3.31.715a8.02 8.02 0 0 1 4.382 5.078A8 8 0 0 1 8 16.064H.75a.75.75 0 0 1-.53-1.281l1.618-1.618A7.97 7.97 0 0 1 0 8.063a.75.75 0 0 1 1.5 0c0 1.795.727 3.42 1.904 4.596a.75.75 0 0 1 0 1.061l-.843.843H8a6.5 6.5 0 0 0 0-13"
        clip-rule="evenodd"
      />
      <path
        d="M1.504.044a.75.75 0 0 0-.494.631L.656 4.211a.75.75 0 0 0 .821.82l3.536-.353a.75.75 0 0 0 .456-1.276L2.287.22a.75.75 0 0 0-.783-.176"
        clip-rule="evenodd"
      />
      <path d="M6 8.063a1 1 0 1 1-2 0 1 1 0 0 1 2 0m3 0a1 1 0 1 1-2 0 1 1 0 0 1 2 0m3 0a1 1 0 1 1-2 0 1 1 0 0 1 2 0" />
    </svg>
  );
}
