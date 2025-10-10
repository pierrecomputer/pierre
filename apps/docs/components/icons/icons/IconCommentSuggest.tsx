// Generated from svgs/IconCommentSuggest.svg
import { type Color, Colors } from '../Color';

interface IconProps {
  size?: 10 | 12 | 16 | 20 | 32 | 48 | '1em';
  color?: keyof Color | 'currentcolor';
  style?: React.CSSProperties;
  className?: string;
}

// prettier-ignore
export const IconCommentSuggest = ({
	size = 16,
	color = "currentcolor",
	style,
	className,
	...props
}: IconProps) => {
	const height = size;
	const width = size === "1em" ? "1em" : Math.round(Number(size) * 1);

	return (
		<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width={width} height={height} fill={Colors[color as 'black'] ?? color} style={style} className={`pi ${className ?? ''}`} {...props}><path d="M8.75 4.75a.75.75 0 0 0-1.5 0v1.5h-1.5a.75.75 0 0 0 0 1.5h1.5V9h1.5V7.75h1.5a.75.75 0 0 0 0-1.5h-1.5zM5.75 9.75a.75.75 0 0 0 0 1.5h4.5a.75.75 0 0 0 0-1.5z" /><path d="M8 0a8 8 0 0 0-6.162 13.102L.22 14.72A.75.75 0 0 0 .75 16H8A8 8 0 1 0 8 0M1.5 8A6.5 6.5 0 1 1 8 14.5H2.56l.844-.843a.75.75 0 0 0 0-1.06A6.48 6.48 0 0 1 1.5 8" /></svg>
	);
};

export { IconCommentSuggest as ReactComponent };
