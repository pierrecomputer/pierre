// Generated from svgs/IconLineGraph.svg
import { type Color, Colors } from '../Color';

interface IconProps {
  size?: 10 | 12 | 16 | 20 | 32 | 48 | '1em';
  color?: keyof Color | 'currentcolor';
  style?: React.CSSProperties;
  className?: string;
}

// prettier-ignore
export const IconLineGraph = ({
	size = 16,
	color = "currentcolor",
	style,
	className,
	...props
}: IconProps) => {
	const height = size;
	const width = size === "1em" ? "1em" : Math.round(Number(size) * 1);

	return (
		<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width={width} height={height} fill={Colors[color as 'black'] ?? color} style={style} className={`pi ${className ?? ''}`} {...props}><path d="M16 9.25a.75.75 0 0 1-1.5 0V6.56l-4.97 4.97a.75.75 0 0 1-1.06 0L6 9.06l-4.72 4.72a.75.75 0 1 1-1.06-1.06l5.25-5.25.056-.052a.75.75 0 0 1 1.004.052L9 9.94l4.44-4.44h-2.69a.75.75 0 0 1 0-1.5h4.5a.75.75 0 0 1 .75.75z" /></svg>
	);
};

export { IconLineGraph as ReactComponent };
