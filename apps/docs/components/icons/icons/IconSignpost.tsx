// Generated from svgs/IconSignpost.svg
import { type Color, Colors } from '../Color';

interface IconProps {
  size?: 10 | 12 | 16 | 20 | 32 | 48 | '1em';
  color?: keyof Color | 'currentcolor';
  style?: React.CSSProperties;
  className?: string;
}

// prettier-ignore
export const IconSignpost = ({
	size = 16,
	color = "currentcolor",
	style,
	className,
	...props
}: IconProps) => {
	const height = size;
	const width = size === "1em" ? "1em" : Math.round(Number(size) * 1);

	return (
		<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width={width} height={height} fill={Colors[color as 'black'] ?? color} style={style} className={`pi ${className ?? ''}`} {...props}><path fillRule="evenodd" d="M8.75.75a.75.75 0 0 0-1.5 0V3h-4a3.25 3.25 0 1 0 0 6.5h4v5.75a.75.75 0 0 0 1.5 0V9.5h4a.75.75 0 0 0 .53-.22l2.5-2.5a.75.75 0 0 0 0-1.06l-2.5-2.5a.75.75 0 0 0-.53-.22h-4zM1.5 6.25c0-.966.784-1.75 1.75-1.75h9.19l1.75 1.75L12.44 8H3.25A1.75 1.75 0 0 1 1.5 6.25" clipRule="evenodd" /></svg>
	);
};

export { IconSignpost as ReactComponent };
