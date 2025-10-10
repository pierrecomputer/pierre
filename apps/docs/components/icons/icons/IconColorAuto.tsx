// Generated from svgs/IconColorAuto.svg
import { type Color, Colors } from '../Color';

interface IconProps {
  size?: 10 | 12 | 16 | 20 | 32 | 48 | '1em';
  color?: keyof Color | 'currentcolor';
  style?: React.CSSProperties;
  className?: string;
}

// prettier-ignore
export const IconColorAuto = ({
	size = 16,
	color = "currentcolor",
	style,
	className,
	...props
}: IconProps) => {
	const height = size;
	const width = size === "1em" ? "1em" : Math.round(Number(size) * 1);

	return (
		<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width={width} height={height} fill={Colors[color as 'black'] || color} style={style} className={`pi ${className ? className : ''}`} {...props}><path d="M2.75 8a5.25 5.25 0 0 0 4.75 5.227c.275.025.5-.2.5-.477v-9.5a.465.465 0 0 0-.5-.477 5.2 5.2 0 0 0-1.672.446 5.26 5.26 0 0 0-2.876 3.333c-.131.46-.202.946-.202 1.448" /><path d="M8 0a8 8 0 1 1 0 16A8 8 0 0 1 8 0m6.5 8a6.5 6.5 0 1 0-13 0 6.5 6.5 0 0 0 13 0" /></svg>
	);
};

export { IconColorAuto as ReactComponent };
