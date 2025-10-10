// Generated from svgs/IconExpandRow.svg
import { type Color, Colors } from '../Color';

interface IconProps {
  size?: 10 | 12 | 16 | 20 | 32 | 48 | '1em';
  color?: keyof Color | 'currentcolor';
  style?: React.CSSProperties;
  className?: string;
}

// prettier-ignore
export const IconExpandRow = ({
	size = 16,
	color = "currentcolor",
	style,
	className,
	...props
}: IconProps) => {
	const height = size;
	const width = size === "1em" ? "1em" : Math.round(Number(size) * 0.75);

	return (
		<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 12 16" width={width} height={height} fill={Colors[color as 'black'] || color} style={style} className={`pi ${className ? className : ''}`} {...props}><path d="M5.47.22a.75.75 0 0 1 1.06 0l2.5 2.5a.75.75 0 0 1-1.06 1.06L6.75 2.56V6h-1.5V2.56L4.03 3.78a.75.75 0 0 1-1.06-1.06zM2.97 12.22a.75.75 0 0 1 1.06 0l1.22 1.22V10h1.5v3.44l1.22-1.22a.75.75 0 0 1 1.06 1.06l-2.5 2.5a.75.75 0 0 1-1.06 0l-2.5-2.5a.75.75 0 0 1 0-1.06M.5 7.5a.5.5 0 0 0 0 1h11a.5.5 0 0 0 0-1z" /></svg>
	);
};

export { IconExpandRow as ReactComponent };
