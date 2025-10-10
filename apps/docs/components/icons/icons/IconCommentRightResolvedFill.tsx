// Generated from svgs/IconCommentRightResolvedFill.svg
import { type Color, Colors } from '../Color';

interface IconProps {
  size?: 10 | 12 | 16 | 20 | 32 | 48 | '1em';
  color?: keyof Color | 'currentcolor';
  style?: React.CSSProperties;
  className?: string;
}

// prettier-ignore
export const IconCommentRightResolvedFill = ({
	size = 16,
	color = "currentcolor",
	style,
	className,
	...props
}: IconProps) => {
	const height = size;
	const width = size === "1em" ? "1em" : Math.round(Number(size) * 1);

	return (
		<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width={width} height={height} fill={Colors[color as 'black'] ?? color} style={style} className={`pi ${className ?? ''}`} {...props}><path fillRule="evenodd" d="M8 0a8 8 0 0 1 6.162 13.102l1.618 1.618a.75.75 0 0 1-.53 1.28H8A8 8 0 1 1 8 0m4.086 6.219a.75.75 0 1 0-1.172-.938L7.438 9.627 5.53 7.72a.75.75 0 0 0-1.06 1.06l2.5 2.5a.75.75 0 0 0 1.116-.061z" clipRule="evenodd" /></svg>
	);
};

export { IconCommentRightResolvedFill as ReactComponent };
