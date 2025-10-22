// Generated from svgs/IconFolderOpen.svg
import { type Color, Colors } from '../Color';

interface IconProps {
  size?: 10 | 12 | 16 | 20 | 32 | 48 | '1em';
  color?: keyof Color | 'currentcolor';
  style?: React.CSSProperties;
  className?: string;
}

// prettier-ignore
export const IconFolderOpen = ({
	size = 16,
	color = "currentcolor",
	style,
	className,
	...props
}: IconProps) => {
	const height = size;
	const width = size === "1em" ? "1em" : Math.round(Number(size) * 1.125);

	return (
		<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 18 16" width={width} height={height} fill={Colors[color as 'black'] || color} style={style} className={`pi ${className ? className : ''}`} {...props}><path d="M1 3.25A2.25 2.25 0 0 1 3.25 1h3.335c.407 0 .807.11 1.157.32L9.53 2.394a.75.75 0 0 0 .385.107h4.835A2.25 2.25 0 0 1 17 4.75v1.291a1.25 1.25 0 0 1 .918 1.374l-.751 5.632A2.25 2.25 0 0 1 14.937 15H3.063a2.25 2.25 0 0 1-2.23-1.953L.082 7.415A1.25 1.25 0 0 1 1 6.041zM15.5 6V4.75a.75.75 0 0 0-.75-.75H9.915a2.25 2.25 0 0 1-1.157-.32L6.97 2.606a.75.75 0 0 0-.385-.107H3.25a.75.75 0 0 0-.75.75V6z"/></svg>
	);
};

export { IconFolderOpen as ReactComponent };