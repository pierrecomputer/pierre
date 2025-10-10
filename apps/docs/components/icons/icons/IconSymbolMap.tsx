// Generated from svgs/IconSymbolMap.svg
import { type Color, Colors } from '../Color';

interface IconProps {
  size?: 10 | 12 | 16 | 20 | 32 | 48 | '1em';
  color?: keyof Color | 'currentcolor';
  style?: React.CSSProperties;
  className?: string;
}

// prettier-ignore
export const IconSymbolMap = ({
	size = 16,
	color = "currentcolor",
	style,
	className,
	...props
}: IconProps) => {
	const height = size;
	const width = size === "1em" ? "1em" : Math.round(Number(size) * 1);

	return (
		<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width={width} height={height} fill={Colors[color as 'black'] ?? color} style={style} className={`pi ${className ?? ''}`} {...props}><path d="M15.25 13a.75.75 0 0 1 0 1.5H3.75a.75.75 0 0 1 0-1.5zm-2-3a.75.75 0 0 1 0 1.5H.75a.75.75 0 0 1 0-1.5zm2-3a.75.75 0 0 1 0 1.5H3.75a.75.75 0 0 1 0-1.5zm-1-3a.75.75 0 0 1 0 1.5H1.75a.75.75 0 0 1 0-1.5zm-2-3a.75.75 0 0 1 0 1.5H.75a.75.75 0 0 1 0-1.5z" /></svg>
	);
};

export { IconSymbolMap as ReactComponent };
