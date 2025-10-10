// Generated from svgs/IconArray.svg
import { type Color, Colors } from '../Color';

interface IconProps {
  size?: 10 | 12 | 16 | 20 | 32 | 48 | '1em';
  color?: keyof Color | 'currentcolor';
  style?: React.CSSProperties;
  className?: string;
}

// prettier-ignore
export const IconArray = ({
	size = 16,
	color = "currentcolor",
	style,
	className,
	...props
}: IconProps) => {
	const height = size;
	const width = size === "1em" ? "1em" : Math.round(Number(size) * 1);

	return (
		<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width={width} height={height} fill={Colors[color as 'black'] ?? color} style={style} className={`pi ${className ?? ''}`} {...props}><path d="M1 2.75C1 1.784 1.784 1 2.75 1h1.5a.75.75 0 0 1 0 1.5h-1.5a.25.25 0 0 0-.25.25v10.5c0 .138.112.25.25.25h1.5a.75.75 0 0 1 0 1.5h-1.5A1.75 1.75 0 0 1 1 13.25zM15 2.75A1.75 1.75 0 0 0 13.25 1h-1.5a.75.75 0 0 0 0 1.5h1.5a.25.25 0 0 1 .25.25v10.5a.25.25 0 0 1-.25.25h-1.5a.75.75 0 0 0 0 1.5h1.5A1.75 1.75 0 0 0 15 13.25z" /><path d="M6 8a1 1 0 1 1-2 0 1 1 0 0 1 2 0M9 8a1 1 0 1 1-2 0 1 1 0 0 1 2 0M11 9a1 1 0 1 0 0-2 1 1 0 0 0 0 2" /></svg>
	);
};

export { IconArray as ReactComponent };
