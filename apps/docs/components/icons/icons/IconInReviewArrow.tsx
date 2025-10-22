// Generated from svgs/IconInReviewArrow.svg
import { type Color, Colors } from '../Color';

interface IconProps {
  size?: 10 | 12 | 16 | 20 | 32 | 48 | '1em';
  color?: keyof Color | 'currentcolor';
  style?: React.CSSProperties;
  className?: string;
}

// prettier-ignore
export const IconInReviewArrow = ({
	size = 16,
	color = "currentcolor",
	style,
	className,
	...props
}: IconProps) => {
	const height = size;
	const width = size === "1em" ? "1em" : Math.round(Number(size) * 0.9411764705882353);

	return (
		<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 17" width={width} height={height} fill={Colors[color as 'black'] || color} style={style} className={`pi ${className ? className : ''}`} {...props}><path d="M8 2.5a6.47 6.47 0 0 0-4.364 1.683A.75.75 0 1 1 2.63 3.07 7.97 7.97 0 0 1 8 1c1.18 0 2.3.256 3.31.715a8.02 8.02 0 0 1 4.382 5.079A8 8 0 0 1 8 17H.75a.75.75 0 0 1-.53-1.28l1.618-1.618A7.97 7.97 0 0 1 0 9a.75.75 0 1 1 1.5 0c0 1.795.727 3.42 1.904 4.596a.75.75 0 0 1 0 1.06l-.843.844H8a6.5 6.5 0 1 0 0-13" clip-rule="evenodd"/><path d="M1.504.98a.75.75 0 0 0-.494.632L.656 5.148a.75.75 0 0 0 .821.82l3.536-.353a.75.75 0 0 0 .456-1.277L2.287 1.156A.75.75 0 0 0 1.504.98" clip-rule="evenodd"/><path d="M6 9a1 1 0 1 1-2 0 1 1 0 0 1 2 0m3 0a1 1 0 1 1-2 0 1 1 0 0 1 2 0m3 0a1 1 0 1 1-2 0 1 1 0 0 1 2 0"/></svg>
	);
};

export { IconInReviewArrow as ReactComponent };