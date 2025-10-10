// Generated from svgs/IconArrow.svg
import { type Color, Colors } from '../Color';

interface IconProps {
  size?: 10 | 12 | 16 | 20 | 32 | 48 | '1em';
  color?: keyof Color | 'currentcolor';
  style?: React.CSSProperties;
  className?: string;
}

// prettier-ignore
export const IconArrow = ({
	size = 16,
	color = "currentcolor",
	style,
	className,
	...props
}: IconProps) => {
	const height = size;
	const width = size === "1em" ? "1em" : Math.round(Number(size) * 1);

	return (
		<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width={width} height={height} fill={Colors[color as 'black'] ?? color} style={style} className={`pi ${className ?? ''}`} {...props}><path d="M7.53 2.22a.75.75 0 0 1 0 1.06L3.56 7.25h10.69a.75.75 0 0 1 0 1.5H3.56l3.97 3.97a.75.75 0 1 1-1.06 1.06L1.22 8.53a.75.75 0 0 1 0-1.06l5.25-5.25a.75.75 0 0 1 1.06 0" /></svg>
	);
};

export { IconArrow as ReactComponent };
