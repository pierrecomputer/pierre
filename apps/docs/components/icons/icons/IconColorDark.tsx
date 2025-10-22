// Generated from svgs/IconColorDark.svg
import { type Color, Colors } from '../Color';

interface IconProps {
  size?: 10 | 12 | 16 | 20 | 32 | 48 | '1em';
  color?: keyof Color | 'currentcolor';
  style?: React.CSSProperties;
  className?: string;
}

// prettier-ignore
export const IconColorDark = ({
	size = 16,
	color = "currentcolor",
	style,
	className,
	...props
}: IconProps) => {
	const height = size;
	const width = size === "1em" ? "1em" : Math.round(Number(size) * 1);

	return (
		<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width={width} height={height} fill={Colors[color as 'black'] || color} style={style} className={`pi ${className ? className : ''}`} {...props}><path d="M6.25 1.243a.67.67 0 0 1 .07.751 6.3 6.3 0 0 0-.768 3.028c0 3.518 2.868 6.367 6.404 6.367.46 0 .91-.048 1.34-.14a.69.69 0 0 1 .71.277.64.64 0 0 1-.027.781A7.3 7.3 0 0 1 8.3 15.001C4.267 15 1 11.75 1 7.747c0-3.014 1.85-5.599 4.484-6.694a.66.66 0 0 1 .766.19"/><path d="M10.794 3.148a.217.217 0 0 1 .412 0l.387 1.162c.173.518.58.924 1.097 1.097l1.162.387a.217.217 0 0 1 0 .412l-1.162.387a1.73 1.73 0 0 0-1.097 1.097l-.387 1.162a.217.217 0 0 1-.412 0l-.387-1.162A1.74 1.74 0 0 0 9.31 6.593l-1.162-.387a.217.217 0 0 1 0-.412l1.162-.387a1.73 1.73 0 0 0 1.097-1.097zm3.07-3.049a.144.144 0 0 1 .22-.07.14.14 0 0 1 .053.07l.258.774c.115.346.386.617.732.732l.774.258a.145.145 0 0 1 0 .274l-.774.258a1.16 1.16 0 0 0-.732.732l-.258.774a.145.145 0 0 1-.274 0l-.258-.774a1.16 1.16 0 0 0-.732-.732l-.774-.258a.145.145 0 0 1 0-.274l.774-.258c.346-.115.617-.386.732-.732z"/></svg>
	);
};

export { IconColorDark as ReactComponent };