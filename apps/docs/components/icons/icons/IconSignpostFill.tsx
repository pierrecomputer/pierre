// Generated from svgs/IconSignpostFill.svg
import { type Color, Colors } from '../Color';

interface IconProps {
  size?: 10 | 12 | 16 | 20 | 32 | 48 | '1em';
  color?: keyof Color | 'currentcolor';
  style?: React.CSSProperties;
  className?: string;
}

// prettier-ignore
export const IconSignpostFill = ({
	size = 16,
	color = "currentcolor",
	style,
	className,
	...props
}: IconProps) => {
	const height = size;
	const width = size === "1em" ? "1em" : Math.round(Number(size) * 1);

	return (
		<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width={width} height={height} fill={Colors[color as 'black'] || color} style={style} className={`pi ${className ? className : ''}`} {...props}><path d="M8 0a.75.75 0 0 1 .75.75V3h4a.75.75 0 0 1 .53.22l2.5 2.5a.75.75 0 0 1 0 1.06l-2.5 2.5a.75.75 0 0 1-.53.22h-4v5.75a.75.75 0 0 1-1.5 0V9.5h-4a3.25 3.25 0 1 1 0-6.5h4V.75A.75.75 0 0 1 8 0" /></svg>
	);
};

export { IconSignpostFill as ReactComponent };
