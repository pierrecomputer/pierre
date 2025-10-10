// Generated from svgs/IconPersonStatus.svg
import { type Color, Colors } from '../Color';

interface IconProps {
  size?: 10 | 12 | 16 | 20 | 32 | 48 | '1em';
  color?: keyof Color | 'currentcolor';
  style?: React.CSSProperties;
  className?: string;
}

// prettier-ignore
export const IconPersonStatus = ({
	size = 16,
	color = "currentcolor",
	style,
	className,
	...props
}: IconProps) => {
	const height = size;
	const width = size === "1em" ? "1em" : Math.round(Number(size) * 1);

	return (
		<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width={width} height={height} fill={Colors[color as 'black'] ?? color} style={style} className={`pi ${className ?? ''}`} {...props}><circle cx="13.5" cy="13.5" r="2.5" /><path d="M4.5 3.5a3.5 3.5 0 1 1 7 0 3.5 3.5 0 0 1-7 0M2.661 10.042A7.97 7.97 0 0 1 8 8c2.031 0 3.887.758 5.298 2.006a3.5 3.5 0 0 0-2.395 5.841C10.055 15.959 9.089 16 8 16c-1.953 0-3.511-.133-4.71-.568-1.175-.428-1.762-1.447-1.83-2.498a3.62 3.62 0 0 1 1.201-2.892" /></svg>
	);
};

export { IconPersonStatus as ReactComponent };
