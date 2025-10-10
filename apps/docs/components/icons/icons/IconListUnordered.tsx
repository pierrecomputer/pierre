// Generated from svgs/IconListUnordered.svg
import { type Color, Colors } from '../Color';

interface IconProps {
  size?: 10 | 12 | 16 | 20 | 32 | 48 | '1em';
  color?: keyof Color | 'currentcolor';
  style?: React.CSSProperties;
  className?: string;
}

// prettier-ignore
export const IconListUnordered = ({
	size = 16,
	color = "currentcolor",
	style,
	className,
	...props
}: IconProps) => {
	const height = size;
	const width = size === "1em" ? "1em" : Math.round(Number(size) * 1);

	return (
		<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width={width} height={height} fill={Colors[color as 'black'] ?? color} style={style} className={`e2e2pi ${className ?? ''}`} {...props}><path d="M1 3a1 1 0 1 1 2 0 1 1 0 0 1-2 0M1 8a1 1 0 1 1 2 0 1 1 0 0 1-2 0M2 12a1 1 0 1 0 0 2 1 1 0 0 0 0-2M5.75 2.5a.75.75 0 0 0 0 1.5h9.5a.75.75 0 0 0 0-1.5zM5.75 7.5a.75.75 0 0 0 0 1.5h9.5a.75.75 0 0 0 0-1.5zM5.75 12.5a.75.75 0 0 0 0 1.5h9.5a.75.75 0 0 0 0-1.5z" /></svg>
	);
};

export { IconListUnordered as ReactComponent };
