// Generated from svgs/IconCiFailed.svg
import { type Color, Colors } from '../Color';

interface IconProps {
  size?: 10 | 12 | 16 | 20 | 32 | 48 | '1em';
  color?: keyof Color | 'currentcolor';
  style?: React.CSSProperties;
  className?: string;
}

// prettier-ignore
export const IconCiFailed = ({
	size = 16,
	color = "currentcolor",
	style,
	className,
	...props
}: IconProps) => {
	const height = size;
	const width = size === "1em" ? "1em" : Math.round(Number(size) * 1);

	return (
		<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width={width} height={height} fill={Colors[color as 'black'] || color} style={style} className={`pi ${className ? className : ''}`} {...props}><path d="M8 1.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13M0 8a8 8 0 1 1 16 0A8 8 0 0 1 0 8m4.97-3.03a.75.75 0 0 1 1.06 0L8 6.94l1.97-1.97a.75.75 0 1 1 1.06 1.06L9.06 8l1.97 1.97a.75.75 0 1 1-1.06 1.06L8 9.06l-1.97 1.97a.75.75 0 1 1-1.06-1.06L6.94 8 4.97 6.03a.75.75 0 0 1 0-1.06"/></svg>
	);
};

export { IconCiFailed as ReactComponent };