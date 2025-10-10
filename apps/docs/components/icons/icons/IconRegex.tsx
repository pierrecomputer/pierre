// Generated from svgs/IconRegex.svg
import { type Color, Colors } from '../Color';

interface IconProps {
  size?: 10 | 12 | 16 | 20 | 32 | 48 | '1em';
  color?: keyof Color | 'currentcolor';
  style?: React.CSSProperties;
  className?: string;
}

// prettier-ignore
export const IconRegex = ({
	size = 16,
	color = "currentcolor",
	style,
	className,
	...props
}: IconProps) => {
	const height = size;
	const width = size === "1em" ? "1em" : Math.round(Number(size) * 1);

	return (
		<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width={width} height={height} fill={Colors[color as 'black'] ?? color} style={style} className={`pi ${className ?? ''}`} {...props}><path d="M8.608 6.59A.25.25 0 0 1 9 6.819l-.225 2.409a.25.25 0 0 0 .249.273h.95a.25.25 0 0 0 .25-.273l-.226-2.409a.25.25 0 0 1 .393-.227l1.973 1.4a.25.25 0 0 0 .361-.08l.476-.823a.25.25 0 0 0-.112-.352l-2.2-1.009a.25.25 0 0 1 0-.454l2.2-1.009a.25.25 0 0 0 .112-.352l-.476-.824a.25.25 0 0 0-.36-.079l-1.974 1.4A.25.25 0 0 1 10 4.182l.225-2.409a.25.25 0 0 0-.249-.273h-.95a.25.25 0 0 0-.25.273l.226 2.409a.25.25 0 0 1-.393.227l-1.973-1.4a.25.25 0 0 0-.361.08l-.476.823a.25.25 0 0 0 .112.352l2.2 1.009a.25.25 0 0 1 0 .454l-2.2 1.009a.25.25 0 0 0-.112.352l.476.824a.25.25 0 0 0 .36.079zM4 11a1 1 0 0 0-1 1v1a1 1 0 0 0 1 1h1a1 1 0 0 0 1-1v-1a1 1 0 0 0-1-1z" /></svg>
	);
};

export { IconRegex as ReactComponent };
