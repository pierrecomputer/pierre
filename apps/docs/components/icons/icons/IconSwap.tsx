// Generated from svgs/IconSwap.svg
import { type Color, Colors } from '../Color';

interface IconProps {
  size?: 10 | 12 | 16 | 20 | 32 | 48 | '1em';
  color?: keyof Color | 'currentcolor';
  style?: React.CSSProperties;
  className?: string;
}

// prettier-ignore
export const IconSwap = ({
	size = 16,
	color = "currentcolor",
	style,
	className,
	...props
}: IconProps) => {
	const height = size;
	const width = size === "1em" ? "1em" : Math.round(Number(size) * 1);

	return (
		<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width={width} height={height} fill={Colors[color as 'black'] ?? color} style={style} className={`pi ${className ?? ''}`} {...props}><path d="M10.25 3.5A1.75 1.75 0 0 0 8.5 5.25v5.5a3.25 3.25 0 0 1-6.5 0V8.56l-.72.72A.75.75 0 0 1 .22 8.22l2-2a.75.75 0 0 1 1.06 0l2 2a.75.75 0 0 1-1.06 1.06l-.72-.72v2.19a1.75 1.75 0 1 0 3.5 0v-5.5a3.25 3.25 0 1 1 6.5 0v2.19l.72-.72a.75.75 0 1 1 1.06 1.06l-2 2a.75.75 0 0 1-1.06 0l-2-2a.75.75 0 1 1 1.06-1.06l.72.72V5.25a1.75 1.75 0 0 0-1.75-1.75" /></svg>
	);
};

export { IconSwap as ReactComponent };
