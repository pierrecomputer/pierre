// Generated from svgs/IconGrip.svg
import { type Color, Colors } from '../Color';

interface IconProps {
  size?: 10 | 12 | 16 | 20 | 32 | 48 | '1em';
  color?: keyof Color | 'currentcolor';
  style?: React.CSSProperties;
  className?: string;
}

// prettier-ignore
export const IconGrip = ({
	size = 16,
	color = "currentcolor",
	style,
	className,
	...props
}: IconProps) => {
	const height = size;
	const width = size === "1em" ? "1em" : Math.round(Number(size) * 1);

	return (
		<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width={width} height={height} fill={Colors[color as 'black'] || color} style={style} className={`pi ${className ? className : ''}`} {...props}><path d="M7 2a1 1 0 1 1-2 0 1 1 0 0 1 2 0M7 5a1 1 0 1 1-2 0 1 1 0 0 1 2 0M7 8a1 1 0 1 1-2 0 1 1 0 0 1 2 0M7 11a1 1 0 1 1-2 0 1 1 0 0 1 2 0M7 14a1 1 0 1 1-2 0 1 1 0 0 1 2 0M10 2a1 1 0 1 1-2 0 1 1 0 0 1 2 0M10 5a1 1 0 1 1-2 0 1 1 0 0 1 2 0M10 8a1 1 0 1 1-2 0 1 1 0 0 1 2 0M10 11a1 1 0 1 1-2 0 1 1 0 0 1 2 0M10 14a1 1 0 1 1-2 0 1 1 0 0 1 2 0" /></svg>
	);
};

export { IconGrip as ReactComponent };
