// Generated from svgs/IconSortDown.svg
import { type Color, Colors } from '../Color';

interface IconProps {
  size?: 10 | 12 | 16 | 20 | 32 | 48 | '1em';
  color?: keyof Color | 'currentcolor';
  style?: React.CSSProperties;
  className?: string;
}

// prettier-ignore
export const IconSortDown = ({
	size = 16,
	color = "currentcolor",
	style,
	className,
	...props
}: IconProps) => {
	const height = size;
	const width = size === "1em" ? "1em" : Math.round(Number(size) * 1);

	return (
		<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width={width} height={height} fill={Colors[color as 'black'] ?? color} style={style} className={`pi ${className ?? ''}`} {...props}><path d="m6.28 11.53-2.5 2.5a.75.75 0 0 1-1.06 0l-2.5-2.5a.75.75 0 1 1 1.06-1.06l1.22 1.22V3A.75.75 0 0 1 4 3v8.69l1.22-1.22a.75.75 0 0 1 1.06 1.06M8.75 3a.75.75 0 0 0 0 1.5h6.5a.75.75 0 0 0 0-1.5zM8.75 6a.75.75 0 0 0 0 1.5h4.5a.75.75 0 0 0 0-1.5zM8.75 9a.75.75 0 0 0 0 1.5h2.5a.75.75 0 0 0 0-1.5zM8.75 12a.75.75 0 0 0 0 1.5h.5a.75.75 0 0 0 0-1.5z" /></svg>
	);
};

export { IconSortDown as ReactComponent };
