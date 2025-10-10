// Generated from svgs/IconAt.svg
import { type Color, Colors } from '../Color';

interface IconProps {
  size?: 10 | 12 | 16 | 20 | 32 | 48 | '1em';
  color?: keyof Color | 'currentcolor';
  style?: React.CSSProperties;
  className?: string;
}

// prettier-ignore
export const IconAt = ({
	size = 16,
	color = "currentcolor",
	style,
	className,
	...props
}: IconProps) => {
	const height = size;
	const width = size === "1em" ? "1em" : Math.round(Number(size) * 1);

	return (
		<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width={width} height={height} fill={Colors[color as 'black'] ?? color} style={style} className={`pi ${className ?? ''}`} {...props}><path d="M1.5 8a6.5 6.5 0 0 1 13 0q0 .951-.048 1.73c-.03.465-.33.897-.81 1.128l-.045.022A1.462 1.462 0 0 1 11.5 9.562V5H10a3.75 3.75 0 1 0 .263 5.783 2.96 2.96 0 0 0 3.985 1.448l.046-.022c.907-.437 1.588-1.315 1.655-2.384Q16.002 8.985 16 8a8 8 0 1 0-4.137 7.007l-.726-1.313A6.5 6.5 0 0 1 1.5 8m4 0A2.25 2.25 0 1 1 10 8a2.25 2.25 0 0 1-4.5 0" /></svg>
	);
};

export { IconAt as ReactComponent };
