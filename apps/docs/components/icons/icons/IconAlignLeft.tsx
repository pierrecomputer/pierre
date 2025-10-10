// Generated from svgs/IconAlignLeft.svg
import { type Color, Colors } from '../Color';

interface IconProps {
  size?: 10 | 12 | 16 | 20 | 32 | 48 | '1em';
  color?: keyof Color | 'currentcolor';
  style?: React.CSSProperties;
  className?: string;
}

// prettier-ignore
export const IconAlignLeft = ({
	size = 16,
	color = "currentcolor",
	style,
	className,
	...props
}: IconProps) => {
	const height = size;
	const width = size === "1em" ? "1em" : Math.round(Number(size) * 1);

	return (
		<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width={width} height={height} fill={Colors[color as 'black'] ?? color} style={style} className={`pi ${className ?? ''}`} {...props}><path d="M.75 0a.75.75 0 0 1 .75.75v14.5a.75.75 0 0 1-1.5 0V.75A.75.75 0 0 1 .75 0M3 3.5A1.5 1.5 0 0 1 4.5 2h10A1.5 1.5 0 0 1 16 3.5v2A1.5 1.5 0 0 1 14.5 7h-10A1.5 1.5 0 0 1 3 5.5zM4.5 9A1.5 1.5 0 0 0 3 10.5v2A1.5 1.5 0 0 0 4.5 14h5a1.5 1.5 0 0 0 1.5-1.5v-2A1.5 1.5 0 0 0 9.5 9z" /></svg>
	);
};

export { IconAlignLeft as ReactComponent };
