// Generated from svgs/IconMapFill.svg
import { type Color, Colors } from '../Color';

interface IconProps {
  size?: 10 | 12 | 16 | 20 | 32 | 48 | '1em';
  color?: keyof Color | 'currentcolor';
  style?: React.CSSProperties;
  className?: string;
}

// prettier-ignore
export const IconMapFill = ({
	size = 16,
	color = "currentcolor",
	style,
	className,
	...props
}: IconProps) => {
	const height = size;
	const width = size === "1em" ? "1em" : Math.round(Number(size) * 1);

	return (
		<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width={width} height={height} fill={Colors[color as 'black'] || color} style={style} className={`pi ${className ? className : ''}`} {...props}><path d="M4.5.357.459 2.06A.75.75 0 0 0 0 2.75v12.5a.75.75 0 0 0 1.041.691L4.5 14.485zM6 14.258l4 1.6V1.742l-4-1.6zm5.5-12.743v14.128l4.041-1.702A.75.75 0 0 0 16 13.25V.75a.75.75 0 0 0-1.041-.691z"/></svg>
	);
};

export { IconMapFill as ReactComponent };