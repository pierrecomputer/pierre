// Generated from svgs/IconBoxTape.svg
import { type Color, Colors } from '../Color';

interface IconProps {
  size?: 10 | 12 | 16 | 20 | 32 | 48 | '1em';
  color?: keyof Color | 'currentcolor';
  style?: React.CSSProperties;
  className?: string;
}

// prettier-ignore
export const IconBoxTape = ({
	size = 16,
	color = "currentcolor",
	style,
	className,
	...props
}: IconProps) => {
	const height = size;
	const width = size === "1em" ? "1em" : Math.round(Number(size) * 1);

	return (
		<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width={width} height={height} fill={Colors[color as 'black'] || color} style={style} className={`pi ${className ? className : ''}`} {...props}><path d="M8.875.64a1.75 1.75 0 0 0-1.75 0L2.063 3.561a1.75 1.75 0 0 0-.875 1.515v5.846c0 .625.333 1.203.875 1.515l5.062 2.923a1.75 1.75 0 0 0 1.75 0l5.062-2.923a1.75 1.75 0 0 0 .875-1.515V5.077a1.75 1.75 0 0 0-.875-1.515zm-1 1.298a.25.25 0 0 1 .25 0L12.562 4.5 8 7.134 3.438 4.5zM2.688 5.8 7.25 8.433v5.268l-4.437-2.562a.25.25 0 0 1-.125-.216zm6.062 7.902V8.433l4.562-2.634v5.124a.25.25 0 0 1-.125.216z"/><path d="M4.188 9V6.5l.437-.935 6-3.465.75 1.3-5.687 3.283V10l-.75-1z" opacity=".5"/></svg>
	);
};

export { IconBoxTape as ReactComponent };