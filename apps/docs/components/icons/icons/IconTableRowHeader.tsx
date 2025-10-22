// Generated from svgs/IconTableRowHeader.svg
import { type Color, Colors } from '../Color';

interface IconProps {
  size?: 10 | 12 | 16 | 20 | 32 | 48 | '1em';
  color?: keyof Color | 'currentcolor';
  style?: React.CSSProperties;
  className?: string;
}

// prettier-ignore
export const IconTableRowHeader = ({
	size = 16,
	color = "currentcolor",
	style,
	className,
	...props
}: IconProps) => {
	const height = size;
	const width = size === "1em" ? "1em" : Math.round(Number(size) * 1);

	return (
		<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width={width} height={height} fill={Colors[color as 'black'] || color} style={style} className={`pi ${className ? className : ''}`} {...props}><path d="M2.25 1A2.25 2.25 0 0 0 0 3.25v9.5A2.25 2.25 0 0 0 2.25 15h11.5A2.25 2.25 0 0 0 16 12.75v-9.5A2.25 2.25 0 0 0 13.75 1zm6.5 4h5.75v3.5H8.75zm0 5h5.75v2.75a.75.75 0 0 1-.75.75h-5zm-1.5 0v3.5h-5a.75.75 0 0 1-.75-.75V10zm0-1.5H1.5V5h5.75z"/></svg>
	);
};

export { IconTableRowHeader as ReactComponent };