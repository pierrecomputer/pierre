// Generated from svgs/IconLineGraphBase.svg
import { type Color, Colors } from '../Color';

interface IconProps {
  size?: 10 | 12 | 16 | 20 | 32 | 48 | '1em';
  color?: keyof Color | 'currentcolor';
  style?: React.CSSProperties;
  className?: string;
}

// prettier-ignore
export const IconLineGraphBase = ({
	size = 16,
	color = "currentcolor",
	style,
	className,
	...props
}: IconProps) => {
	const height = size;
	const width = size === "1em" ? "1em" : Math.round(Number(size) * 1);

	return (
		<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width={width} height={height} fill={Colors[color as 'black'] ?? color} style={style} className={`pi ${className ?? ''}`} {...props}><path d="M15.25 14.5a.75.75 0 0 1 0 1.5H.75a.75.75 0 0 1 0-1.5zM15.25 2a.75.75 0 0 1 .75.75v4.5a.75.75 0 0 1-1.5 0V4.56L9.53 9.53a.75.75 0 0 1-1.06 0L6 7.06l-4.72 4.72a.75.75 0 1 1-1.06-1.06l5.25-5.25.056-.052a.75.75 0 0 1 1.004.052L9 7.94l4.44-4.44h-2.69a.75.75 0 0 1 0-1.5z" /></svg>
	);
};

export { IconLineGraphBase as ReactComponent };
