// Generated from svgs/IconCommentIssue.svg
import { type Color, Colors } from '../Color';

interface IconProps {
  size?: 10 | 12 | 16 | 20 | 32 | 48 | '1em';
  color?: keyof Color | 'currentcolor';
  style?: React.CSSProperties;
  className?: string;
}

// prettier-ignore
export const IconCommentIssue = ({
	size = 16,
	color = "currentcolor",
	style,
	className,
	...props
}: IconProps) => {
	const height = size;
	const width = size === "1em" ? "1em" : Math.round(Number(size) * 1);

	return (
		<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width={width} height={height} fill={Colors[color as 'black'] || color} style={style} className={`pi ${className ? className : ''}`} {...props}><path d="M8 1.5a6.5 6.5 0 0 0-4.596 11.096.75.75 0 0 1 0 1.06l-.843.844H8a6.5 6.5 0 1 0 0-13M0 8a8 8 0 1 1 8 8H.75a.75.75 0 0 1-.53-1.28l1.618-1.618A7.97 7.97 0 0 1 0 8" /><path d="M7.002 11a1 1 0 1 1 2 0 1 1 0 0 1-2 0M7.1 4.995a.905.905 0 1 1 1.8 0l-.35 3.507a.552.552 0 0 1-1.1 0z" /></svg>
	);
};

export { IconCommentIssue as ReactComponent };
