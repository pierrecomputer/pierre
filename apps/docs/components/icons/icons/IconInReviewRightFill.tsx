// Generated from svgs/IconInReviewRightFill.svg
import { type Color, Colors } from '../Color';

interface IconProps {
  size?: 10 | 12 | 16 | 20 | 32 | 48 | '1em';
  color?: keyof Color | 'currentcolor';
  style?: React.CSSProperties;
  className?: string;
}

// prettier-ignore
export const IconInReviewRightFill = ({
	size = 16,
	color = "currentcolor",
	style,
	className,
	...props
}: IconProps) => {
	const height = size;
	const width = size === "1em" ? "1em" : Math.round(Number(size) * 1);

	return (
		<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width={width} height={height} fill={Colors[color as 'black'] || color} style={style} className={`pi ${className ? className : ''}`} {...props}><path d="M8 0a8 8 0 0 1 6.162 13.102l1.618 1.618a.75.75 0 0 1-.53 1.28H8A8 8 0 1 1 8 0M5.75 7.875a1.375 1.375 0 1 1-2.75 0 1.375 1.375 0 0 1 2.75 0m3.625 0a1.375 1.375 0 1 1-2.75 0 1.375 1.375 0 0 1 2.75 0m2.25 1.375a1.375 1.375 0 1 0 0-2.75 1.375 1.375 0 0 0 0 2.75" clip-rule="evenodd"/></svg>
	);
};

export { IconInReviewRightFill as ReactComponent };